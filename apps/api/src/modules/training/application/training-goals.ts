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
    TrainingGoal,
    type CreateTrainingGoalInput,
    type GoalStatus,
    type TrainingGoalState,
    type UpdateTrainingGoalInput,
} from "#src/modules/training/domain/index";
import type { ProfileReader } from "#src/modules/profile/index";

export const TRAINING_GOAL_REPOSITORY = Symbol("TRAINING_GOAL_REPOSITORY");
export const TRAINING_GOAL_MUTATION_SERVICE = Symbol("TRAINING_GOAL_MUTATION_SERVICE");
export const TRAINING_GOAL_COMMANDS = Symbol("TRAINING_GOAL_COMMANDS");
export const TRAINING_GOAL_REVISION_HANDLER = Symbol("TRAINING_GOAL_REVISION_HANDLER");
export const TRAINING_GOAL_ENTITY_TYPE = "training.goal";

export interface TrainingGoalResource extends TrainingGoalState {
    readonly version: number;
}

export interface TrainingGoalListFilter {
    readonly status?: GoalStatus;
}

export interface TrainingGoalRepository<Transaction = unknown> extends CurrentStateStore<
    TrainingGoalState,
    Transaction
> {
    readGoal(id: EntityId, transaction?: Transaction): Promise<TrainingGoalResource | null>;
    listGoals(filter?: TrainingGoalListFilter): Promise<readonly TrainingGoalResource[]>;
}

export interface TrainingGoalMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateTrainingGoalCommand extends Omit<CreateTrainingGoalInput, "id" | "profileId"> {
    readonly id?: string;
}

export class TrainingGoalNotFoundError extends ApplicationNotFoundError {
    constructor(readonly goalId: string) {
        super(`Training goal ${goalId} was not found`, { goalId });
        this.name = "TrainingGoalNotFoundError";
    }
}

export const trainingGoalSerializer = new MigratingSnapshotSerializer<TrainingGoalState>(
    1,
    state => structuredClone(state),
    value => TrainingGoal.rehydrate(value as TrainingGoalState).state,
    [],
);

interface TrainingGoalCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: TrainingGoalRepository<Transaction>;
    readonly mutations: RevisionMutationService<TrainingGoalState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class TrainingGoalCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: TrainingGoalCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Training goal ID generation is not configured");
            });
    }

    async create(
        input: CreateTrainingGoalCommand,
        metadata: TrainingGoalMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingGoalResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const goal = TrainingGoal.create({ ...input, id: input.id ?? this.generateId(), profileId }, now);
        return this.inTransaction(transaction, async activeTransaction => {
            await this.runtime.mutations.create({
                entityType: TRAINING_GOAL_ENTITY_TYPE,
                entityId: entityId(goal.state.id),
                state: goal.state,
                metadata: revisionMetadata(metadata, "Created training goal"),
                events: [this.event("created", goal.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(goal.state.id, activeTransaction);
        });
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        input: UpdateTrainingGoalInput,
        metadata: TrainingGoalMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingGoalResource> {
        const goalId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                TRAINING_GOAL_ENTITY_TYPE,
                goalId,
                activeTransaction,
            );
            if (!stored) throw new TrainingGoalNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const result = await this.runtime.mutations.mutate({
                entityType: TRAINING_GOAL_ENTITY_TYPE,
                entityId: goalId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = TrainingGoal.rehydrate(state).update(input, now);
                    return {
                        state: next.state,
                        events: [this.event("updated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Updated training goal"),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<TrainingGoalResource> {
        const resource = await this.runtime.repository.readGoal(entityId(id), transaction);
        if (!resource) throw new TrainingGoalNotFoundError(id);
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
        state: TrainingGoalState,
        aggregateRevision: number,
        metadata: TrainingGoalMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.goal.${action}`,
            version: 1,
            occurredAt,
            aggregateType: TRAINING_GOAL_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                goalId: state.id,
                profileId: state.profileId,
                goalVersion: aggregateRevision,
                status: state.status,
            },
        });
    }
}

const trainingGoalRevisionResourceMapper: SnapshotResourceMapper<TrainingGoalState, TrainingGoalResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class TrainingGoalRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<TrainingGoalResource> {
    readonly entityType = TRAINING_GOAL_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<TrainingGoalState, TrainingGoalResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<TrainingGoalState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Training goal event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            trainingGoalSerializer,
            trainingGoalRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<TrainingGoalResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: TrainingGoalResource }> {
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
                    name: "training.goal.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: {
                        goalId: input.entityId,
                        goalVersion: input.expectedVersion + 1,
                        restoredVersion: input.restoreVersion,
                    },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: trainingGoalRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: trainingGoalSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: TrainingGoalMutationMetadata, summary: string): RevisionMetadata {
    return {
        source: metadata.source ?? "user",
        actorId: metadata.actorId ?? null,
        reason: metadata.reason ?? null,
        summary,
        correlationId: metadata.correlationId,
    };
}

function validEntityId(value: string): EntityId {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Training goal ID must be a UUID", {
            goalId: ["Training goal ID must be a UUID"],
        });
    }
}
