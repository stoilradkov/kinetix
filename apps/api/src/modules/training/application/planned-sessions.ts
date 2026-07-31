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
    PlannedSession,
    type CreatePlannedSessionInput,
    type PlannedSessionState,
    type PublishPrescriptionDraft,
    type SessionPrescriptionState,
    type SkipCancelReason,
    type UpdatePlannedSessionInput,
} from "#src/modules/training/domain/index";
import type {
    PrescriptionPublisher,
    SessionPrescriptionRepository,
} from "#src/modules/training/application/session-prescriptions";
import type { ProfileReader } from "#src/modules/profile/index";

export const PLANNED_SESSION_REPOSITORY = Symbol("PLANNED_SESSION_REPOSITORY");
export const PLANNED_SESSION_MUTATION_SERVICE = Symbol("PLANNED_SESSION_MUTATION_SERVICE");
export const PLANNED_SESSION_COMMANDS = Symbol("PLANNED_SESSION_COMMANDS");
export const PLANNED_SESSION_REVISION_HANDLER = Symbol("PLANNED_SESSION_REVISION_HANDLER");
export const PLANNED_SESSION_ENTITY_TYPE = "training.planned-session";

export interface PlannedSessionResource extends PlannedSessionState {
    readonly version: number;
}

/** Full planned-session read model: metadata + version plus its current immutable prescription. */
export interface PlannedSessionDetail {
    readonly session: PlannedSessionResource;
    readonly prescription: SessionPrescriptionState;
}

export interface PlannedSessionListFilter {
    readonly includeArchived?: boolean;
}

/**
 * Capability port over the editable planned-session root plus its version→prescription link log.
 * Extends {@link CurrentStateStore}; `create`/`save` additionally record the version→prescription
 * link so every published planned-session prescription is preserved (design 5.7, 10.3, 12.1).
 */
export interface PlannedSessionRepository<Transaction = unknown> extends CurrentStateStore<
    PlannedSessionState,
    Transaction
> {
    readSession(id: EntityId, transaction?: Transaction): Promise<PlannedSessionResource | null>;
    listSessions(filter?: PlannedSessionListFilter): Promise<readonly PlannedSessionResource[]>;
}

export interface PlannedSessionMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

/** A planned-session edit always describes the whole prescription tree; `kind` is forced to planned. */
export type PlannedSessionDraft = Omit<PublishPrescriptionDraft, "kind">;

export interface CreatePlannedSessionCommand {
    readonly id?: string;
    readonly title?: string | null;
    readonly localDate?: string | null;
    readonly timeZone?: string | null;
    readonly preferredTime?: string | null;
    readonly expectedDurationMinutes?: number | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly prescription: PlannedSessionDraft;
}

export interface UpdatePlannedSessionCommand {
    readonly title?: string | null;
    readonly localDate?: string | null;
    readonly timeZone?: string | null;
    readonly preferredTime?: string | null;
    readonly expectedDurationMinutes?: number | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    /** Present when the edit republishes the prescription; absent for metadata-only edits. */
    readonly prescription?: PlannedSessionDraft;
}

export interface PlannedSessionOutcomeCommand {
    readonly reason?: SkipCancelReason | null;
    readonly notes?: string | null;
    readonly partial?: boolean;
}

export interface ReschedulePlannedSessionCommand {
    readonly localDate?: string | null;
    readonly timeZone?: string | null;
    readonly preferredTime?: string | null;
}

/** Inputs for creating a planned session against an already-published prescription (activation). */
export interface MaterializePlannedSessionInput extends Omit<CreatePlannedSessionInput, "id" | "profileId"> {
    readonly id?: string;
}

export class PlannedSessionNotFoundError extends ApplicationNotFoundError {
    constructor(readonly plannedSessionId: string) {
        super(`Planned session ${plannedSessionId} was not found`, { plannedSessionId });
        this.name = "PlannedSessionNotFoundError";
    }
}

export const plannedSessionSerializer = new MigratingSnapshotSerializer<PlannedSessionState>(
    1,
    state => structuredClone(state),
    value => PlannedSession.rehydrate(value as PlannedSessionState).state,
    [],
);

interface PlannedSessionCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: PlannedSessionRepository<Transaction>;
    readonly mutations: RevisionMutationService<PlannedSessionState, DomainEvent, Transaction>;
    readonly publisher: PrescriptionPublisher<Transaction>;
    readonly prescriptions: SessionPrescriptionRepository<Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

type PlannedSessionAction =
    | "created"
    | "updated"
    | "rescheduled"
    | "completed"
    | "skipped"
    | "cancelled"
    | "reopened"
    | "archived"
    | "restored";

export class PlannedSessionCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: PlannedSessionCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Planned session ID generation is not configured");
            });
    }

    async create(
        command: CreatePlannedSessionCommand,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        return this.inTransaction(transaction, async activeTransaction => {
            const prescription = await this.publish(command.prescription, metadata, activeTransaction);
            return this.materialize(
                {
                    id: command.id,
                    profileId,
                    currentPrescriptionId: prescription.id,
                    title: command.title ?? null,
                    localDate: command.localDate ?? null,
                    timeZone: command.timeZone ?? null,
                    preferredTime: command.preferredTime ?? null,
                    expectedDurationMinutes: command.expectedDurationMinutes ?? null,
                    notes: command.notes ?? null,
                    tags: command.tags ?? [],
                },
                prescription,
                metadata,
                activeTransaction,
            );
        });
    }

    /**
     * Create a planned session from an already-published prescription (used by program activation,
     * which clones a template prescription before materializing the session). Runs inside the
     * caller's transaction so generation stays atomic (design 5.6).
     */
    async materialize(
        input: MaterializePlannedSessionInput & { readonly profileId: string; readonly currentPrescriptionId: string },
        prescription: SessionPrescriptionState,
        metadata: PlannedSessionMutationMetadata,
        transaction: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        const session = PlannedSession.create(
            {
                ...input,
                id: input.id ?? this.generateId(),
            },
            now,
        );
        await this.runtime.mutations.create({
            entityType: PLANNED_SESSION_ENTITY_TYPE,
            entityId: entityId(session.state.id),
            state: session.state,
            metadata: revisionMetadata(metadata, "Created planned session"),
            events: [this.event("created", session.state, 1, metadata, now)],
            transaction,
        });
        const resource = await this.requiredResource(session.state.id, transaction);
        return { session: resource, prescription };
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        command: UpdatePlannedSessionCommand,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "updated", metadata, transaction, async activeTransaction => {
            const published = command.prescription
                ? await this.publish(command.prescription, metadata, activeTransaction)
                : null;
            const input: UpdatePlannedSessionInput = {
                ...(command.title !== undefined ? { title: command.title } : {}),
                ...(command.localDate !== undefined ? { localDate: command.localDate } : {}),
                ...(command.timeZone !== undefined ? { timeZone: command.timeZone } : {}),
                ...(command.preferredTime !== undefined ? { preferredTime: command.preferredTime } : {}),
                ...(command.expectedDurationMinutes !== undefined
                    ? { expectedDurationMinutes: command.expectedDurationMinutes }
                    : {}),
                ...(command.notes !== undefined ? { notes: command.notes } : {}),
                ...(command.tags !== undefined ? { tags: command.tags } : {}),
                ...(published ? { currentPrescriptionId: published.id } : {}),
            };
            return { apply: (session: PlannedSession) => session.update(input, now), prescription: published };
        });
    }

    /**
     * Reschedule an open planned session to a new date/time (design PR-5). Distinct from a metadata
     * update because it rejects terminal sessions — a missed session must be explicitly completed,
     * skipped, cancelled, or rescheduled and is never silently moved.
     */
    reschedule(
        id: string,
        expectedVersion: number | undefined,
        command: ReschedulePlannedSessionCommand,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "rescheduled", metadata, transaction, () =>
            Promise.resolve({
                apply: (session: PlannedSession) => session.reschedule(command, now),
                prescription: null,
            }),
        );
    }

    /**
     * Reschedule as part of a larger orchestration (e.g. a program start-date change) where the
     * caller does not track the session version. Runs inside the caller's transaction and discovers
     * the current version under the write lock, so the outer command stays atomic.
     */
    async rescheduleWithinTransaction(
        id: string,
        command: ReschedulePlannedSessionCommand,
        metadata: PlannedSessionMutationMetadata,
        transaction: Transaction,
    ): Promise<PlannedSessionDetail> {
        const stored = await this.runtime.repository.loadForUpdate(
            PLANNED_SESSION_ENTITY_TYPE,
            entityId(id),
            transaction,
        );
        if (!stored) throw new PlannedSessionNotFoundError(id);
        return this.reschedule(id, stored.version, command, metadata, transaction);
    }

    complete(
        id: string,
        expectedVersion: number | undefined,
        command: PlannedSessionOutcomeCommand,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        const action: PlannedSessionAction = "completed";
        return this.mutate(id, expectedVersion, action, metadata, transaction, () =>
            Promise.resolve({
                apply: (session: PlannedSession) => session.complete({ partial: command.partial ?? false }, now),
                prescription: null,
            }),
        );
    }

    skip(
        id: string,
        expectedVersion: number | undefined,
        command: PlannedSessionOutcomeCommand,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "skipped", metadata, transaction, () =>
            Promise.resolve({
                apply: (session: PlannedSession) =>
                    session.skip({ reason: command.reason ?? null, notes: command.notes ?? null }, now),
                prescription: null,
            }),
        );
    }

    cancel(
        id: string,
        expectedVersion: number | undefined,
        command: PlannedSessionOutcomeCommand,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "cancelled", metadata, transaction, () =>
            Promise.resolve({
                apply: (session: PlannedSession) =>
                    session.cancel({ reason: command.reason ?? null, notes: command.notes ?? null }, now),
                prescription: null,
            }),
        );
    }

    reopen(
        id: string,
        expectedVersion: number | undefined,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "reopened", metadata, transaction, () =>
            Promise.resolve({ apply: (session: PlannedSession) => session.reopen(now), prescription: null }),
        );
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "archived", metadata, transaction, () =>
            Promise.resolve({ apply: (session: PlannedSession) => session.archive(now), prescription: null }),
        );
    }

    restore(
        id: string,
        expectedVersion: number | undefined,
        metadata: PlannedSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<PlannedSessionDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "restored", metadata, transaction, () =>
            Promise.resolve({ apply: (session: PlannedSession) => session.restore(now), prescription: null }),
        );
    }

    private async mutate(
        id: string,
        expectedVersion: number | undefined,
        action: PlannedSessionAction,
        metadata: PlannedSessionMutationMetadata,
        transaction: Transaction | undefined,
        prepare: (transaction: Transaction) => Promise<{
            apply: (session: PlannedSession) => PlannedSession;
            prescription: SessionPrescriptionState | null;
        }>,
    ): Promise<PlannedSessionDetail> {
        const sessionId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                PLANNED_SESSION_ENTITY_TYPE,
                sessionId,
                activeTransaction,
            );
            if (!stored) throw new PlannedSessionNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const prepared = await prepare(activeTransaction);
            const result = await this.runtime.mutations.mutate({
                entityType: PLANNED_SESSION_ENTITY_TYPE,
                entityId: sessionId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = prepared.apply(PlannedSession.rehydrate(state));
                    return {
                        state: next.state,
                        events: [this.event(action, next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, `${capitalize(action)} planned session`),
                transaction: activeTransaction,
            });
            const resource = await this.requiredResource(result.state.id, activeTransaction);
            const prescription =
                prepared.prescription ??
                (await this.requiredPrescription(result.state.currentPrescriptionId, activeTransaction));
            return { session: resource, prescription };
        });
    }

    private publish(
        draft: PlannedSessionDraft,
        metadata: PlannedSessionMutationMetadata,
        transaction: Transaction,
    ): Promise<SessionPrescriptionState> {
        return this.runtime.publisher.publish({ draft: { ...draft, kind: "planned" } }, metadata, transaction);
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<PlannedSessionResource> {
        const resource = await this.runtime.repository.readSession(entityId(id), transaction);
        if (!resource) throw new PlannedSessionNotFoundError(id);
        return resource;
    }

    private async requiredPrescription(id: string, transaction: Transaction): Promise<SessionPrescriptionState> {
        const prescription = await this.runtime.prescriptions.loadTree(id, transaction);
        if (!prescription)
            throw new ApplicationNotFoundError(`Prescription ${id} was not found`, { prescriptionId: id });
        return prescription;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: PlannedSessionAction,
        state: PlannedSessionState,
        aggregateRevision: number,
        metadata: PlannedSessionMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.planned-session.${action}`,
            version: 1,
            occurredAt,
            aggregateType: PLANNED_SESSION_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                plannedSessionId: state.id,
                profileId: state.profileId,
                status: state.status,
                currentPrescriptionId: state.currentPrescriptionId,
            },
        });
    }
}

const plannedSessionRevisionResourceMapper: SnapshotResourceMapper<PlannedSessionState, PlannedSessionResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class PlannedSessionRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<PlannedSessionResource> {
    readonly entityType = PLANNED_SESSION_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<PlannedSessionState, PlannedSessionResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<PlannedSessionState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Planned session event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            plannedSessionSerializer,
            plannedSessionRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<PlannedSessionResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: PlannedSessionResource }> {
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
                    name: "training.planned-session.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: { plannedSessionId: input.entityId, restoredVersion: input.restoreVersion },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: plannedSessionRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: plannedSessionSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: PlannedSessionMutationMetadata, summary: string): RevisionMetadata {
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
        throw new ApplicationValidationError("Planned session ID must be a UUID", {
            plannedSessionId: ["Planned session ID must be a UUID"],
        });
    }
}
