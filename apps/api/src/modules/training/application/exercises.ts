import type { DomainEvent } from "#src/platform/domain/index";
import { DomainEvent as TrainingDomainEvent, entityId, type Clock, type EntityId } from "#src/platform/domain/index";

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
    ExerciseDefinition,
    createExerciseSnapshot,
    type CreateExerciseDefinitionInput,
    type ExerciseDefinitionState,
    type ExerciseMuscleAssignment,
    type ExerciseRelationship,
    type ExerciseRelationshipType,
    type ExerciseSnapshotV1,
    type UpdateExerciseDefinitionInput,
} from "#src/modules/training/domain/index";

import type { ExerciseCatalogItem } from "#src/modules/training/application/catalog";
import type { ExerciseMergeRepository } from "#src/modules/training/application/exercise-merges";

export const EXERCISE_REPOSITORY = Symbol("EXERCISE_REPOSITORY");
export const EXERCISE_MUTATION_SERVICE = Symbol("EXERCISE_MUTATION_SERVICE");
export const EXERCISE_CATALOG_COMMANDS = Symbol("EXERCISE_CATALOG_COMMANDS");
export const TRAINING_EXERCISE_CATALOG = Symbol("TRAINING_EXERCISE_CATALOG");
export const EXERCISE_REVISION_HANDLER = Symbol("EXERCISE_REVISION_HANDLER");
export const EXERCISE_DEFINITION_ENTITY_TYPE = "training.exercise";

export interface StoredExerciseDefinition {
    readonly definition: ExerciseDefinition;
    readonly version: number;
}

export interface ExerciseListFilter {
    readonly status?: "active" | "archived" | "all";
    readonly ownership?: "seeded" | "user";
    readonly equipmentTypeId?: string;
    readonly movementPatternId?: string;
    readonly muscleGroupId?: string;
    readonly tagId?: string;
    readonly relationshipType?: ExerciseRelationshipType;
    readonly search?: string;
    readonly limit: number;
    readonly cursor?: number;
}

export interface ExerciseCatalogPage {
    readonly items: readonly ExerciseCatalogItem[];
    readonly nextCursor: number | null;
}

export interface ExerciseRepository<Transaction = unknown> extends CurrentStateStore<
    ExerciseDefinitionState,
    Transaction
> {
    findDefinition(id: EntityId, transaction?: Transaction): Promise<StoredExerciseDefinition | null>;
    findUserOverride(seedExerciseId: EntityId, transaction: Transaction): Promise<StoredExerciseDefinition | null>;
    readExercise(id: EntityId, transaction?: Transaction): Promise<ExerciseCatalogItem | null>;
    pageExercises(filter: ExerciseListFilter): Promise<ExerciseCatalogPage>;
    resolveAlias(normalizedAlias: string): Promise<ExerciseCatalogItem | null>;
    areInAnalyticsFamily(leftId: EntityId, rightId: EntityId): Promise<boolean>;
}

export interface ExerciseMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateExerciseCommand extends Omit<
    CreateExerciseDefinitionInput,
    "id" | "ownership" | "forkedFromExerciseId"
> {
    readonly id?: string;
}

export class ExerciseNotFoundError extends ApplicationNotFoundError {
    constructor(readonly exerciseId: string) {
        super(`Exercise ${exerciseId} was not found`, { exerciseId });
        this.name = "ExerciseNotFoundError";
    }
}

export class ExerciseAliasConflictError extends ApplicationValidationError {
    constructor(readonly normalizedAlias: string) {
        super(
            `Exercise alias '${normalizedAlias}' is already assigned to another active exercise`,
            { aliases: [`Normalized alias '${normalizedAlias}' must be unique`] },
            { normalizedAlias },
        );
        this.name = "ExerciseAliasConflictError";
    }
}

export class ExerciseRelationshipCycleError extends ApplicationValidationError {
    constructor(readonly relationshipType: ExerciseRelationshipType) {
        super(
            `The ${relationshipType} relationship would create a cycle`,
            { relationships: [`${relationshipType} relationships must remain acyclic`] },
            { relationshipType },
        );
        this.name = "ExerciseRelationshipCycleError";
    }
}

export class SeedExerciseAlreadyForkedError extends ApplicationValidationError {
    constructor(
        readonly seedExerciseId: string,
        readonly overrideExerciseId: string,
    ) {
        super("This seeded exercise already has a user-owned definition", undefined, {
            seedExerciseId,
            overrideExerciseId,
        });
        this.name = "SeedExerciseAlreadyForkedError";
    }
}

export const exerciseDefinitionSerializer = new MigratingSnapshotSerializer<ExerciseDefinitionState>(
    1,
    state => structuredClone(state),
    value => ExerciseDefinition.rehydrate(value as ExerciseDefinitionState).state,
    [],
);

interface ExerciseCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: ExerciseRepository<Transaction>;
    readonly mutations: RevisionMutationService<ExerciseDefinitionState, DomainEvent, Transaction>;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class ExerciseCatalogCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: ExerciseCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Exercise ID generation is not configured");
            });
    }

    async create(
        input: CreateExerciseCommand,
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseCatalogItem> {
        const now = this.clock.now();
        const definition = ExerciseDefinition.create(
            {
                ...input,
                id: input.id ?? this.generateId(),
                ownership: "user",
                forkedFromExerciseId: null,
            },
            now,
        );
        return this.inTransaction(transaction, async activeTransaction => {
            await this.runtime.mutations.create({
                entityType: EXERCISE_DEFINITION_ENTITY_TYPE,
                entityId: entityId(definition.state.id),
                state: definition.state,
                metadata: revisionMetadata(metadata, `Created exercise ${definition.state.name}`),
                events: [this.event("created", definition, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(definition.state.id, activeTransaction);
        });
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        input: UpdateExerciseDefinitionInput,
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseCatalogItem> {
        return this.mutateOrFork(
            id,
            expectedVersion,
            definition => definition.update(input, this.clock.now()),
            "updated",
            metadata,
            transaction,
            input.slug,
        );
    }

    replaceAliases(
        id: string,
        expectedVersion: number | undefined,
        aliases: readonly string[],
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseCatalogItem> {
        return this.mutateOrFork(
            id,
            expectedVersion,
            definition => definition.renameAliases(aliases, this.clock.now()),
            "aliases-updated",
            metadata,
            transaction,
        );
    }

    replaceMuscles(
        id: string,
        expectedVersion: number | undefined,
        muscles: readonly ExerciseMuscleAssignment[],
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseCatalogItem> {
        return this.mutateOrFork(
            id,
            expectedVersion,
            definition => definition.assignMuscles(muscles, this.clock.now()),
            "muscles-updated",
            metadata,
            transaction,
        );
    }

    replaceTags(
        id: string,
        expectedVersion: number | undefined,
        tagIds: readonly string[],
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseCatalogItem> {
        return this.mutateOrFork(
            id,
            expectedVersion,
            definition => definition.assignTags(tagIds, this.clock.now()),
            "tags-updated",
            metadata,
            transaction,
        );
    }

    replaceRelationships(
        id: string,
        expectedVersion: number | undefined,
        relationships: readonly ExerciseRelationship[],
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseCatalogItem> {
        return this.mutateOrFork(
            id,
            expectedVersion,
            definition => definition.relate(relationships, this.clock.now()),
            "relationships-updated",
            metadata,
            transaction,
        );
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseCatalogItem> {
        return this.mutateOrFork(
            id,
            expectedVersion,
            definition => definition.archive(this.clock.now()),
            "archived",
            metadata,
            transaction,
        );
    }

    async restore(
        id: string,
        expectedVersion: number | undefined,
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseCatalogItem> {
        const exerciseId = validEntityId(id);
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                EXERCISE_DEFINITION_ENTITY_TYPE,
                exerciseId,
                activeTransaction,
            );
            if (!stored) throw new ExerciseNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            if (stored.state.ownership === "seeded")
                throw new ApplicationValidationError("A seeded exercise is already active and cannot be restored");
            const now = this.clock.now();
            const result = await this.runtime.mutations.mutate({
                entityType: EXERCISE_DEFINITION_ENTITY_TYPE,
                entityId: exerciseId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const definition = ExerciseDefinition.rehydrate(state).restore(now);
                    return {
                        state: definition.state,
                        events: [this.event("restored", definition, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Restored exercise definition"),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async mutateOrFork(
        rawId: string,
        expectedVersion: number | undefined,
        change: (definition: ExerciseDefinition) => ExerciseDefinition,
        action: ExerciseEventAction,
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
        forkSlug?: string,
    ): Promise<ExerciseCatalogItem> {
        const id = validEntityId(rawId);
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                EXERCISE_DEFINITION_ENTITY_TYPE,
                id,
                activeTransaction,
            );
            if (!stored) throw new ExerciseNotFoundError(rawId);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const now = this.clock.now();
            if (stored.state.ownership === "seeded") {
                const existingOverride = await this.runtime.repository.findUserOverride(id, activeTransaction);
                if (existingOverride)
                    throw new SeedExerciseAlreadyForkedError(rawId, existingOverride.definition.state.id);
                const fork = change(
                    ExerciseDefinition.rehydrate(stored.state).fork(
                        { id: this.generateId(), ...(forkSlug !== undefined ? { slug: forkSlug } : {}) },
                        now,
                    ),
                );
                await this.runtime.mutations.create({
                    entityType: EXERCISE_DEFINITION_ENTITY_TYPE,
                    entityId: entityId(fork.state.id),
                    state: fork.state,
                    metadata: revisionMetadata(metadata, `Forked seeded exercise and ${action}`),
                    events: [this.event("forked", fork, 1, metadata, now)],
                    transaction: activeTransaction,
                });
                return this.requiredResource(fork.state.id, activeTransaction);
            }

            const result = await this.runtime.mutations.mutate({
                entityType: EXERCISE_DEFINITION_ENTITY_TYPE,
                entityId: id,
                expectedVersion: expectedVersion!,
                change: state => {
                    const changed = change(ExerciseDefinition.rehydrate(state));
                    return {
                        state: changed.state,
                        events: [this.event(action, changed, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, `${actionSummary(action)} exercise definition`),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<ExerciseCatalogItem> {
        const resource = await this.runtime.repository.readExercise(entityId(id), transaction);
        if (!resource) throw new ExerciseNotFoundError(id);
        return resource;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: ExerciseEventAction,
        definition: ExerciseDefinition,
        aggregateRevision: number,
        metadata: ExerciseMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new TrainingDomainEvent({
            id: this.generateId(),
            name: `training.exercise.${action}`,
            version: 1,
            occurredAt,
            aggregateType: EXERCISE_DEFINITION_ENTITY_TYPE,
            aggregateId: definition.state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                exerciseId: definition.state.id,
                exerciseVersion: aggregateRevision,
                ownership: definition.state.ownership,
                status: definition.state.status,
                forkedFromExerciseId: definition.state.forkedFromExerciseId,
            },
        });
    }
}

type ExerciseEventAction =
    | "created"
    | "updated"
    | "aliases-updated"
    | "muscles-updated"
    | "tags-updated"
    | "relationships-updated"
    | "archived"
    | "restored"
    | "forked";

export interface TrainingExerciseCatalogPort {
    getExercise(id: string): Promise<ExerciseCatalogItem>;
    resolveCurrentExercise(id: string): Promise<{
        readonly requestedExerciseId: string;
        readonly resolvedExerciseId: string;
        readonly redirected: boolean;
        readonly exercise: ExerciseCatalogItem;
    }>;
    listExercises(filter: ExerciseListFilter): Promise<ExerciseCatalogPage>;
    resolveAlias(alias: string): Promise<ExerciseCatalogItem | null>;
    currentSnapshot(exerciseId: string): Promise<ExerciseSnapshotV1>;
    historicalSnapshot(exerciseId: string, version: number): Promise<ExerciseSnapshotV1>;
    areInAnalyticsFamily(leftExerciseId: string, rightExerciseId: string): Promise<boolean>;
}

export class TrainingExerciseCatalog<Transaction = unknown> implements TrainingExerciseCatalogPort {
    constructor(
        private readonly repository: ExerciseRepository<Transaction>,
        private readonly revisions: RevisionStore<Transaction>,
        private readonly merges?: Pick<ExerciseMergeRepository<Transaction>, "resolveCanonicalId">,
    ) {}

    async getExercise(id: string): Promise<ExerciseCatalogItem> {
        const item = await this.repository.readExercise(validEntityId(id));
        if (!item) throw new ExerciseNotFoundError(id);
        return item;
    }

    async resolveCurrentExercise(id: string) {
        const requestedId = validEntityId(id);
        const resolvedId = this.merges ? await this.merges.resolveCanonicalId(requestedId) : requestedId;
        const exercise = await this.repository.readExercise(resolvedId);
        if (!exercise) throw new ExerciseNotFoundError(id);
        return {
            requestedExerciseId: requestedId,
            resolvedExerciseId: resolvedId,
            redirected: requestedId !== resolvedId,
            exercise,
        };
    }

    listExercises(filter: ExerciseListFilter): Promise<ExerciseCatalogPage> {
        return this.repository.pageExercises(filter);
    }

    resolveAlias(alias: string): Promise<ExerciseCatalogItem | null> {
        const normalized = alias.trim().normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ");
        if (normalized.length === 0) throw new ApplicationValidationError("Exercise alias cannot be empty");
        return this.repository.resolveAlias(normalized);
    }

    async currentSnapshot(exerciseId: string): Promise<ExerciseSnapshotV1> {
        const requestedId = validEntityId(exerciseId);
        const resolvedId = this.merges ? await this.merges.resolveCanonicalId(requestedId) : requestedId;
        const stored = await this.repository.findDefinition(resolvedId);
        if (!stored) throw new ExerciseNotFoundError(exerciseId);
        return createExerciseSnapshot(stored.definition, stored.version);
    }

    async historicalSnapshot(exerciseId: string, version: number): Promise<ExerciseSnapshotV1> {
        const id = validEntityId(exerciseId);
        if (!Number.isSafeInteger(version) || version < 1)
            throw new ApplicationValidationError("Exercise version must be a positive integer");
        const current = await this.repository.findDefinition(id);
        if (!current) throw new ExerciseNotFoundError(exerciseId);
        if (current.version === version) return createExerciseSnapshot(current.definition, version);
        const revision = await this.revisions.find(EXERCISE_DEFINITION_ENTITY_TYPE, id, version);
        if (!revision)
            throw new ApplicationNotFoundError(`Exercise snapshot version ${version} was not found for ${exerciseId}`, {
                exerciseId,
                version,
            });
        const state = exerciseDefinitionSerializer.deserialize({
            schemaVersion: revision.schemaVersion,
            value: revision.snapshot,
        });
        return createExerciseSnapshot(ExerciseDefinition.rehydrate(state), version);
    }

    async areInAnalyticsFamily(leftExerciseId: string, rightExerciseId: string): Promise<boolean> {
        const rawLeft = validEntityId(leftExerciseId);
        const rawRight = validEntityId(rightExerciseId);
        const [leftId, rightId] = this.merges
            ? await Promise.all([this.merges.resolveCanonicalId(rawLeft), this.merges.resolveCanonicalId(rawRight)])
            : [rawLeft, rawRight];
        if (leftId === rightId) return true;
        return this.repository.areInAnalyticsFamily(leftId, rightId);
    }
}

export interface ExerciseRevisionResource {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly status: "active" | "archived";
    readonly ownership: "seeded" | "user";
    readonly forkedFromExerciseId: string | null;
    readonly equipmentTypeId: string;
    readonly movementPatternId: string;
    readonly classification: "compound" | "isolation";
    readonly laterality: "bilateral" | "unilateral";
    readonly bodyPosition: string;
    readonly repetitionSemantics: "total" | "per_side" | "alternating";
    readonly loadModel:
        "external_only" | "full_bodyweight_plus_added_minus_assistance" | "manual_effective_load" | "none";
    readonly supportedMeasurements: readonly string[];
    readonly muscles: readonly ExerciseMuscleAssignment[];
    readonly tagIds: readonly string[];
    readonly relationships: readonly ExerciseRelationship[];
    readonly notes: string | null;
    readonly position: number;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly version: number;
}

const exerciseRevisionResourceMapper: SnapshotResourceMapper<ExerciseDefinitionState, ExerciseRevisionResource> = {
    toResource: (state, revision) => ({
        ...state,
        aliases: state.aliases.map(alias => alias.value),
        supportedMeasurements: [...state.supportedMeasurements],
        muscles: [...state.muscles],
        tagIds: [...state.tagIds],
        relationships: [...state.relationships],
        version: revision.version,
    }),
};

export class ExerciseRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<ExerciseRevisionResource> {
    readonly entityType = EXERCISE_DEFINITION_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<
        ExerciseDefinitionState,
        ExerciseRevisionResource,
        Transaction
    >;

    constructor(
        private readonly mutations: RevisionMutationService<ExerciseDefinitionState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Exercise event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            exerciseDefinitionSerializer,
            exerciseRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<ExerciseRevisionResource>> {
        return this.historyService.history({
            entityType: this.entityType,
            entityId: entity,
            ...pagination,
        });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: ExerciseRevisionResource }> {
        const now = this.clock.now();
        const result = await this.mutations.restore({
            entityType: this.entityType,
            entityId: input.entityId,
            restoreVersion: input.restoreVersion,
            expectedVersion: input.expectedVersion,
            metadata: input.metadata,
            events: [
                new TrainingDomainEvent({
                    id: this.generateId(),
                    name: "training.exercise.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: {
                        exerciseId: input.entityId,
                        exerciseVersion: input.expectedVersion + 1,
                        restoredVersion: input.restoreVersion,
                    },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: exerciseRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: exerciseDefinitionSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: ExerciseMutationMetadata, summary: string): RevisionMetadata {
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
        throw new ApplicationValidationError("Exercise ID must be a UUID", {
            exerciseId: ["Exercise ID must be a UUID"],
        });
    }
}

function actionSummary(action: ExerciseEventAction): string {
    return action.replaceAll("-", " ");
}
