import { DomainEvent as PlatformDomainEvent, entityId, type Clock, type EntityId } from "#src/platform/domain/index";
import type { DomainEvent } from "#src/platform/domain/index";

import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    ExpectedVersionGuard,
    MigratingSnapshotSerializer,
    RevisionHistoryService,
    type CommandContext,
    type CurrentStateStore,
    type RevisionHistoryPage,
    type RevisionMetadata,
    type RevisionMutationService,
    type RevisionResourceHandler,
    type RevisionStore,
    type SnapshotResourceMapper,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    TrainingSession,
    type CompleteTrainingSessionInput,
    type CreateTrainingSessionInput,
    type PainRecordInput,
    type PostWorkoutRatings,
    type PreWorkoutReadiness,
    type SessionActivityInput,
    type TrainingSessionState,
    type UpdateTrainingSessionInput,
} from "#src/modules/training/domain/index";
import type { ProfileReader } from "#src/modules/profile/index";

export const TRAINING_SESSION_REPOSITORY = Symbol("TRAINING_SESSION_REPOSITORY");
export const TRAINING_SESSION_MUTATION_SERVICE = Symbol("TRAINING_SESSION_MUTATION_SERVICE");
export const TRAINING_SESSION_COMMANDS = Symbol("TRAINING_SESSION_COMMANDS");
export const TRAINING_SESSION_REVISION_HANDLER = Symbol("TRAINING_SESSION_REVISION_HANDLER");
export const TRAINING_SESSION_ENTITY_TYPE = "training.session";

/** Full detail read model: the whole session tree plus its aggregate version. */
export interface TrainingSessionResource extends TrainingSessionState {
    readonly version: number;
}

/** Bounded list projection: scalar metadata + version + child counts, without the nested trees. */
export interface TrainingSessionSummary extends Omit<TrainingSessionState, "activities" | "painRecords"> {
    readonly version: number;
    readonly activityCount: number;
    readonly painRecordCount: number;
}

export interface TrainingSessionListFilter {
    readonly includeArchived?: boolean;
}

/** Capability port over the versioned training-session root plus its activity/pain child tree. */
export interface TrainingSessionRepository<Transaction = unknown> extends CurrentStateStore<
    TrainingSessionState,
    Transaction
> {
    readSession(id: EntityId, transaction?: Transaction): Promise<TrainingSessionResource | null>;
    listSessions(filter?: TrainingSessionListFilter): Promise<readonly TrainingSessionSummary[]>;
}

export interface TrainingSessionMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateTrainingSessionCommand {
    readonly id?: string;
    readonly localDate?: string;
    readonly timeZone?: string;
    readonly sourcePlannedSessionId?: string | null;
    readonly title?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly readiness?: Partial<PreWorkoutReadiness>;
    readonly postWorkout?: Partial<PostWorkoutRatings>;
    readonly activities?: readonly SessionActivityInput[];
    readonly painRecords?: readonly PainRecordInput[];
}

export type UpdateTrainingSessionCommand = UpdateTrainingSessionInput;
export type CompleteTrainingSessionCommand = CompleteTrainingSessionInput;

export class TrainingSessionNotFoundError extends ApplicationNotFoundError {
    constructor(readonly trainingSessionId: string) {
        super(`Training session ${trainingSessionId} was not found`, { trainingSessionId });
        this.name = "TrainingSessionNotFoundError";
    }
}

export const trainingSessionSerializer = new MigratingSnapshotSerializer<TrainingSessionState>(
    1,
    state => structuredClone(state),
    value => TrainingSession.rehydrate(value as TrainingSessionState).state,
    [],
);

interface TrainingSessionCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: TrainingSessionRepository<Transaction>;
    readonly mutations: RevisionMutationService<TrainingSessionState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "getActiveProfile">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

type TrainingSessionAction = "created" | "started" | "updated" | "completed" | "reopened" | "archived" | "restored";

export class TrainingSessionCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: TrainingSessionCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Training session ID generation is not configured");
            });
    }

    async create(
        command: CreateTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        // Resolve Core/Training profile defaults through the public port (ADR 0005): the active
        // profile supplies the owner ID and the default time zone; the local date defaults to today
        // in that zone. Timer/time-zone calculation stays in the application layer, never in SQL.
        const profile = await this.runtime.profileReader.getActiveProfile();
        const now = this.clock.now();
        const timeZone = command.timeZone ?? profile.timeZone;
        const localDate = command.localDate ?? localDateInZone(now, timeZone);
        const input: CreateTrainingSessionInput = {
            id: command.id ?? this.generateId(),
            profileId: profile.id,
            localDate,
            timeZone,
            title: command.title ?? null,
            sourcePlannedSessionId: command.sourcePlannedSessionId ?? null,
            notes: command.notes ?? null,
            tags: command.tags ?? [],
            readiness: command.readiness,
            postWorkout: command.postWorkout,
            activities: command.activities,
            painRecords: command.painRecords,
        };
        return this.inTransaction(transaction, async activeTransaction => {
            const session = TrainingSession.create(input, now);
            await this.runtime.mutations.create({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: entityId(session.state.id),
                state: session.state,
                metadata: revisionMetadata(metadata, "Created training session"),
                events: [this.event("created", session.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(session.state.id, activeTransaction);
        });
    }

    start(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "started", metadata, transaction, session => session.start(now));
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        command: UpdateTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "updated", metadata, transaction, session =>
            session.update(command, now),
        );
    }

    complete(
        id: string,
        expectedVersion: number | undefined,
        command: CompleteTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "completed", metadata, transaction, session =>
            session.complete(command, now),
        );
    }

    reopen(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "reopened", metadata, transaction, session => session.reopen(now));
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "archived", metadata, transaction, session => session.archive(now));
    }

    restore(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "restored", metadata, transaction, session => session.restore(now));
    }

    private async mutate(
        id: string,
        expectedVersion: number | undefined,
        action: TrainingSessionAction,
        metadata: TrainingSessionMutationMetadata,
        transaction: Transaction | undefined,
        apply: (session: TrainingSession) => TrainingSession,
    ): Promise<TrainingSessionResource> {
        const sessionId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                TRAINING_SESSION_ENTITY_TYPE,
                sessionId,
                activeTransaction,
            );
            if (!stored) throw new TrainingSessionNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const result = await this.runtime.mutations.mutate({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: sessionId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = apply(TrainingSession.rehydrate(state));
                    return {
                        state: next.state,
                        events: [this.event(action, next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, `${capitalize(action)} training session`),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<TrainingSessionResource> {
        const resource = await this.runtime.repository.readSession(entityId(id), transaction);
        if (!resource) throw new TrainingSessionNotFoundError(id);
        return resource;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: TrainingSessionAction,
        state: TrainingSessionState,
        aggregateRevision: number,
        metadata: TrainingSessionMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.session.${action}`,
            version: 1,
            occurredAt,
            aggregateType: TRAINING_SESSION_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                trainingSessionId: state.id,
                profileId: state.profileId,
                status: state.status,
                archived: state.archivedAt !== null,
            },
        });
    }
}

const trainingSessionRevisionResourceMapper: SnapshotResourceMapper<TrainingSessionState, TrainingSessionResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class TrainingSessionRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<TrainingSessionResource> {
    readonly entityType = TRAINING_SESSION_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<TrainingSessionState, TrainingSessionResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<TrainingSessionState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Training session event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            trainingSessionSerializer,
            trainingSessionRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<TrainingSessionResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: TrainingSessionResource }> {
        const now = this.clock.now();
        const result = await this.mutations.restore({
            entityType: this.entityType,
            entityId: input.entityId,
            restoreVersion: input.restoreVersion,
            expectedVersion: input.expectedVersion,
            metadata: input.metadata,
            events: [
                new PlatformDomainEvent({
                    id: this.generateId(),
                    name: "training.session.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: { trainingSessionId: input.entityId, restoredVersion: input.restoreVersion },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: trainingSessionRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: trainingSessionSerializer.currentSchemaVersion,
                source: "restore",
                actorId: input.metadata.actorId ?? null,
                reason: input.metadata.reason ?? null,
                summary: input.metadata.summary,
                correlationId: input.metadata.correlationId,
                createdAt: now,
            }),
        };
    }
}

/** Format the local calendar date for an instant in the given IANA zone (design 11.6, TS-2). */
function localDateInZone(instant: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(instant);
    // en-CA formats as YYYY-MM-DD.
    return parts;
}

function revisionMetadata(metadata: TrainingSessionMutationMetadata, summary: string): RevisionMetadata {
    return {
        source: metadata.source ?? "user",
        actorId: metadata.actorId ?? null,
        reason: metadata.reason ?? null,
        summary,
        correlationId: metadata.correlationId,
    };
}

function capitalize(value: string): string {
    return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function validEntityId(value: string): EntityId {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Training session ID must be a UUID", {
            trainingSessionId: ["Training session ID must be a UUID"],
        });
    }
}
