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
    TrainingInjury,
    type CreateTrainingInjuryInput,
    type InjuryStatus,
    type TrainingInjuryState,
    type UpdateTrainingInjuryInput,
} from "#src/modules/training/domain/index";
import type { ExerciseCatalogItem, MuscleCatalogItem } from "#src/modules/training/application/catalog";
import type { ProfileReader } from "#src/modules/profile/index";

export const TRAINING_INJURY_REPOSITORY = Symbol("TRAINING_INJURY_REPOSITORY");
export const TRAINING_INJURY_MUTATION_SERVICE = Symbol("TRAINING_INJURY_MUTATION_SERVICE");
export const TRAINING_INJURY_COMMANDS = Symbol("TRAINING_INJURY_COMMANDS");
export const TRAINING_INJURY_REVISION_HANDLER = Symbol("TRAINING_INJURY_REVISION_HANDLER");
export const TRAINING_INJURY_ENTITY_TYPE = "training.injury";

export interface TrainingInjuryResource extends TrainingInjuryState {
    readonly version: number;
}

export interface TrainingInjuryListFilter {
    readonly status?: InjuryStatus;
}

export interface TrainingInjuryRepository<Transaction = unknown> extends CurrentStateStore<
    TrainingInjuryState,
    Transaction
> {
    readInjury(id: EntityId, transaction?: Transaction): Promise<TrainingInjuryResource | null>;
    listInjuries(filter?: TrainingInjuryListFilter): Promise<readonly TrainingInjuryResource[]>;
}

/** Public catalog reads used to validate injury links without reaching into catalog tables. */
export interface InjuryCatalogReader {
    listMuscles(): Promise<readonly MuscleCatalogItem[]>;
    listExercises(): Promise<readonly ExerciseCatalogItem[]>;
}

export interface TrainingInjuryMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateTrainingInjuryCommand extends Omit<CreateTrainingInjuryInput, "id" | "profileId"> {
    readonly id?: string;
}

export class TrainingInjuryNotFoundError extends ApplicationNotFoundError {
    constructor(readonly injuryId: string) {
        super(`Training injury ${injuryId} was not found`, { injuryId });
        this.name = "TrainingInjuryNotFoundError";
    }
}

export class UnknownCatalogLinkError extends ApplicationValidationError {
    constructor(kind: "muscle group" | "exercise", missing: readonly string[]) {
        super(`Unknown ${kind} link(s): ${missing.join(", ")}`, {
            links: [`These ${kind} links do not exist: ${missing.join(", ")}`],
        });
        this.name = "UnknownCatalogLinkError";
    }
}

export const trainingInjurySerializer = new MigratingSnapshotSerializer<TrainingInjuryState>(
    1,
    state => structuredClone(state),
    value => TrainingInjury.rehydrate(value as TrainingInjuryState).state,
    [],
);

interface TrainingInjuryCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: TrainingInjuryRepository<Transaction>;
    readonly mutations: RevisionMutationService<TrainingInjuryState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly catalog: InjuryCatalogReader;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class TrainingInjuryCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: TrainingInjuryCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Training injury ID generation is not configured");
            });
    }

    async create(
        input: CreateTrainingInjuryCommand,
        metadata: TrainingInjuryMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingInjuryResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        await this.assertLinksExist(input.muscleGroupIds, input.exerciseIds);
        const injury = TrainingInjury.create({ ...input, id: input.id ?? this.generateId(), profileId }, now);
        return this.inTransaction(transaction, async activeTransaction => {
            await this.runtime.mutations.create({
                entityType: TRAINING_INJURY_ENTITY_TYPE,
                entityId: entityId(injury.state.id),
                state: injury.state,
                metadata: revisionMetadata(metadata, "Created training injury"),
                events: [this.event("created", injury.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(injury.state.id, activeTransaction);
        });
    }

    async update(
        id: string,
        expectedVersion: number | undefined,
        input: UpdateTrainingInjuryInput,
        metadata: TrainingInjuryMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingInjuryResource> {
        const injuryId = validEntityId(id);
        const now = this.clock.now();
        await this.assertLinksExist(input.muscleGroupIds, input.exerciseIds);
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                TRAINING_INJURY_ENTITY_TYPE,
                injuryId,
                activeTransaction,
            );
            if (!stored) throw new TrainingInjuryNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const result = await this.runtime.mutations.mutate({
                entityType: TRAINING_INJURY_ENTITY_TYPE,
                entityId: injuryId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = TrainingInjury.rehydrate(state).update(input, now);
                    return {
                        state: next.state,
                        events: [this.event("updated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Updated training injury"),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async assertLinksExist(
        muscleGroupIds: readonly string[] | undefined,
        exerciseIds: readonly string[] | undefined,
    ): Promise<void> {
        if (muscleGroupIds && muscleGroupIds.length > 0) {
            const existing = new Set((await this.runtime.catalog.listMuscles()).map(muscle => muscle.id));
            const missing = [...new Set(muscleGroupIds)].filter(muscleId => !existing.has(muscleId));
            if (missing.length > 0) throw new UnknownCatalogLinkError("muscle group", missing);
        }
        if (exerciseIds && exerciseIds.length > 0) {
            const existing = new Set((await this.runtime.catalog.listExercises()).map(exercise => exercise.id));
            const missing = [...new Set(exerciseIds)].filter(exerciseId => !existing.has(exerciseId));
            if (missing.length > 0) throw new UnknownCatalogLinkError("exercise", missing);
        }
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<TrainingInjuryResource> {
        const resource = await this.runtime.repository.readInjury(entityId(id), transaction);
        if (!resource) throw new TrainingInjuryNotFoundError(id);
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
        state: TrainingInjuryState,
        aggregateRevision: number,
        metadata: TrainingInjuryMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.injury.${action}`,
            version: 1,
            occurredAt,
            aggregateType: TRAINING_INJURY_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                injuryId: state.id,
                profileId: state.profileId,
                injuryVersion: aggregateRevision,
                status: state.status,
            },
        });
    }
}

const trainingInjuryRevisionResourceMapper: SnapshotResourceMapper<TrainingInjuryState, TrainingInjuryResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class TrainingInjuryRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<TrainingInjuryResource> {
    readonly entityType = TRAINING_INJURY_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<TrainingInjuryState, TrainingInjuryResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<TrainingInjuryState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Training injury event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            trainingInjurySerializer,
            trainingInjuryRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<TrainingInjuryResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: TrainingInjuryResource }> {
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
                    name: "training.injury.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: {
                        injuryId: input.entityId,
                        injuryVersion: input.expectedVersion + 1,
                        restoredVersion: input.restoreVersion,
                    },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: trainingInjuryRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: trainingInjurySerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: TrainingInjuryMutationMetadata, summary: string): RevisionMetadata {
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
        throw new ApplicationValidationError("Training injury ID must be a UUID", {
            injuryId: ["Training injury ID must be a UUID"],
        });
    }
}
