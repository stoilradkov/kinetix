import type { DomainEvent } from "#src/platform/domain/index";
import { DomainEvent as PlatformDomainEvent, entityId, type Clock, type EntityId } from "#src/platform/domain/index";

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
    TrainingProfile,
    type CreateTrainingProfileInput,
    type TrainingProfileState,
    type UpdateTrainingProfileInput,
} from "#src/modules/training/domain/index";
import type { ProfileReader } from "#src/modules/profile/index";

export const TRAINING_PROFILE_REPOSITORY = Symbol("TRAINING_PROFILE_REPOSITORY");
export const TRAINING_PROFILE_MUTATION_SERVICE = Symbol("TRAINING_PROFILE_MUTATION_SERVICE");
export const TRAINING_PROFILE_COMMANDS = Symbol("TRAINING_PROFILE_COMMANDS");
export const TRAINING_PROFILE_REVISION_HANDLER = Symbol("TRAINING_PROFILE_REVISION_HANDLER");
export const TRAINING_PROFILE_ENTITY_TYPE = "training.profile";

export interface StoredTrainingProfile {
    readonly state: TrainingProfileState;
    readonly version: number;
}

export interface TrainingProfileResource extends TrainingProfileState {
    readonly version: number;
}

export interface TrainingProfileRepository<Transaction = unknown> extends CurrentStateStore<
    TrainingProfileState,
    Transaction
> {
    findActive(transaction?: Transaction): Promise<StoredTrainingProfile | null>;
    readActive(transaction?: Transaction): Promise<TrainingProfileResource | null>;
    readProfile(id: EntityId, transaction?: Transaction): Promise<TrainingProfileResource | null>;
}

export interface TrainingProfileMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateTrainingProfileCommand extends Omit<CreateTrainingProfileInput, "id" | "profileId"> {
    readonly id?: string;
}

export class ActiveTrainingProfileExistsError extends ApplicationValidationError {
    constructor() {
        super("An active training profile already exists; update it instead of creating another");
        this.name = "ActiveTrainingProfileExistsError";
    }
}

export class TrainingProfileNotFoundError extends ApplicationNotFoundError {
    constructor() {
        super("No active training profile exists");
        this.name = "TrainingProfileNotFoundError";
    }
}

export const trainingProfileSerializer = new MigratingSnapshotSerializer<TrainingProfileState>(
    1,
    state => structuredClone(state),
    value => TrainingProfile.rehydrate(value as TrainingProfileState).state,
    [],
);

interface TrainingProfileCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: TrainingProfileRepository<Transaction>;
    readonly mutations: RevisionMutationService<TrainingProfileState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class TrainingProfileCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: TrainingProfileCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Training profile ID generation is not configured");
            });
    }

    async create(
        input: CreateTrainingProfileCommand,
        metadata: TrainingProfileMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingProfileResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const profile = TrainingProfile.create({ ...input, id: input.id ?? this.generateId(), profileId }, now);
        return this.inTransaction(transaction, async activeTransaction => {
            if (await this.runtime.repository.findActive(activeTransaction))
                throw new ActiveTrainingProfileExistsError();
            await this.runtime.mutations.create({
                entityType: TRAINING_PROFILE_ENTITY_TYPE,
                entityId: entityId(profile.state.id),
                state: profile.state,
                metadata: revisionMetadata(metadata, "Created training profile"),
                events: [this.event("created", profile.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(profile.state.id, activeTransaction);
        });
    }

    update(
        expectedVersion: number | undefined,
        input: UpdateTrainingProfileInput,
        metadata: TrainingProfileMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingProfileResource> {
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.findActive(activeTransaction);
            if (!stored) throw new TrainingProfileNotFoundError();
            this.expectedVersions.verify(expectedVersion, stored.version);
            const result = await this.runtime.mutations.mutate({
                entityType: TRAINING_PROFILE_ENTITY_TYPE,
                entityId: entityId(stored.state.id),
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = TrainingProfile.rehydrate(state).update(input, now);
                    return {
                        state: next.state,
                        events: [this.event("updated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Updated training profile"),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<TrainingProfileResource> {
        const resource = await this.runtime.repository.readProfile(entityId(id), transaction);
        if (!resource) throw new TrainingProfileNotFoundError();
        return resource;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: "created" | "updated",
        state: TrainingProfileState,
        aggregateRevision: number,
        metadata: TrainingProfileMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.profile.${action}`,
            version: 1,
            occurredAt,
            aggregateType: TRAINING_PROFILE_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                trainingProfileId: state.id,
                profileId: state.profileId,
                trainingProfileVersion: aggregateRevision,
            },
        });
    }
}

const trainingProfileRevisionResourceMapper: SnapshotResourceMapper<TrainingProfileState, TrainingProfileResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class TrainingProfileRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<TrainingProfileResource> {
    readonly entityType = TRAINING_PROFILE_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<TrainingProfileState, TrainingProfileResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<TrainingProfileState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Training profile event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            trainingProfileSerializer,
            trainingProfileRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<TrainingProfileResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: TrainingProfileResource }> {
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
                    name: "training.profile.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: {
                        trainingProfileId: input.entityId,
                        trainingProfileVersion: input.expectedVersion + 1,
                        restoredVersion: input.restoreVersion,
                    },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: trainingProfileRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: trainingProfileSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: TrainingProfileMutationMetadata, summary: string): RevisionMetadata {
    return {
        source: metadata.source ?? "user",
        actorId: metadata.actorId ?? null,
        reason: metadata.reason ?? null,
        summary,
        correlationId: metadata.correlationId,
    };
}
