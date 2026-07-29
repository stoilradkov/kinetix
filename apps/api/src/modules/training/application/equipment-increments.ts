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
    EquipmentIncrement,
    roundLoadToIncrement,
    type CreateEquipmentIncrementInput,
    type EquipmentIncrementScope,
    type EquipmentIncrementState,
    type UpdateEquipmentIncrementInput,
} from "#src/modules/training/domain/index";
import type { ExerciseCatalogItem, ExtensibleCatalogItem } from "#src/modules/training/application/catalog";
import type { ProfileReader } from "#src/modules/profile/index";

export const EQUIPMENT_INCREMENT_REPOSITORY = Symbol("EQUIPMENT_INCREMENT_REPOSITORY");
export const EQUIPMENT_INCREMENT_MUTATION_SERVICE = Symbol("EQUIPMENT_INCREMENT_MUTATION_SERVICE");
export const EQUIPMENT_INCREMENT_COMMANDS = Symbol("EQUIPMENT_INCREMENT_COMMANDS");
export const EQUIPMENT_INCREMENT_QUERIES = Symbol("EQUIPMENT_INCREMENT_QUERIES");
export const EQUIPMENT_INCREMENT_REVISION_HANDLER = Symbol("EQUIPMENT_INCREMENT_REVISION_HANDLER");
export const EQUIPMENT_INCREMENT_ENTITY_TYPE = "training.equipment-increment";

export interface EquipmentIncrementResource extends EquipmentIncrementState {
    readonly version: number;
}

export interface EquipmentIncrementRepository<Transaction = unknown> extends CurrentStateStore<
    EquipmentIncrementState,
    Transaction
> {
    read(id: EntityId, transaction?: Transaction): Promise<EquipmentIncrementResource | null>;
    list(profileId: string): Promise<readonly EquipmentIncrementResource[]>;
}

export interface EquipmentIncrementCatalogReader {
    listExercises(): Promise<readonly ExerciseCatalogItem[]>;
    listEquipment(): Promise<readonly ExtensibleCatalogItem[]>;
}

export interface EquipmentIncrementMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateEquipmentIncrementCommand extends Omit<CreateEquipmentIncrementInput, "id" | "profileId"> {
    readonly id?: string;
}

export class EquipmentIncrementNotFoundError extends ApplicationNotFoundError {
    constructor(readonly incrementId: string) {
        super(`Equipment increment ${incrementId} was not found`, { incrementId });
        this.name = "EquipmentIncrementNotFoundError";
    }
}

export class UnknownIncrementTargetError extends ApplicationValidationError {
    constructor(kind: "exercise" | "equipment type", id: string) {
        super(`Unknown ${kind}: ${id}`, { target: [`This ${kind} does not exist`] });
        this.name = "UnknownIncrementTargetError";
    }
}

export const equipmentIncrementSerializer = new MigratingSnapshotSerializer<EquipmentIncrementState>(
    1,
    state => structuredClone(state),
    value => EquipmentIncrement.rehydrate(value as EquipmentIncrementState).state,
    [],
);

interface EquipmentIncrementCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: EquipmentIncrementRepository<Transaction>;
    readonly mutations: RevisionMutationService<EquipmentIncrementState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly catalog: EquipmentIncrementCatalogReader;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class EquipmentIncrementCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: EquipmentIncrementCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Equipment increment ID generation is not configured");
            });
    }

    async create(
        input: CreateEquipmentIncrementCommand,
        metadata: EquipmentIncrementMutationMetadata,
        transaction?: Transaction,
    ): Promise<EquipmentIncrementResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        await this.assertTargetExists(input.scope, input.exerciseId ?? null, input.equipmentTypeId ?? null);
        const increment = EquipmentIncrement.create({ ...input, id: input.id ?? this.generateId(), profileId }, now);
        return this.inTransaction(transaction, async activeTransaction => {
            await this.runtime.mutations.create({
                entityType: EQUIPMENT_INCREMENT_ENTITY_TYPE,
                entityId: entityId(increment.state.id),
                state: increment.state,
                metadata: revisionMetadata(metadata, "Created equipment increment"),
                events: [this.event("created", increment.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(increment.state.id, activeTransaction);
        });
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        input: UpdateEquipmentIncrementInput,
        metadata: EquipmentIncrementMutationMetadata,
        transaction?: Transaction,
    ): Promise<EquipmentIncrementResource> {
        const incrementId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                EQUIPMENT_INCREMENT_ENTITY_TYPE,
                incrementId,
                activeTransaction,
            );
            if (!stored) throw new EquipmentIncrementNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const result = await this.runtime.mutations.mutate({
                entityType: EQUIPMENT_INCREMENT_ENTITY_TYPE,
                entityId: incrementId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = EquipmentIncrement.rehydrate(state).update(input, now);
                    return {
                        state: next.state,
                        events: [this.event("updated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Updated equipment increment"),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async assertTargetExists(
        scope: EquipmentIncrementScope,
        exerciseId: string | null,
        equipmentTypeId: string | null,
    ): Promise<void> {
        if (scope === "exercise" && exerciseId) {
            const exercises = await this.runtime.catalog.listExercises();
            if (!exercises.some(exercise => exercise.id === exerciseId))
                throw new UnknownIncrementTargetError("exercise", exerciseId);
        }
        if (scope === "equipment" && equipmentTypeId) {
            const equipment = await this.runtime.catalog.listEquipment();
            if (!equipment.some(item => item.id === equipmentTypeId))
                throw new UnknownIncrementTargetError("equipment type", equipmentTypeId);
        }
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<EquipmentIncrementResource> {
        const resource = await this.runtime.repository.read(entityId(id), transaction);
        if (!resource) throw new EquipmentIncrementNotFoundError(id);
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
        state: EquipmentIncrementState,
        aggregateRevision: number,
        metadata: EquipmentIncrementMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.equipment-increment.${action}`,
            version: 1,
            occurredAt,
            aggregateType: EQUIPMENT_INCREMENT_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: { incrementId: state.id, profileId: state.profileId, scope: state.scope },
        });
    }
}

/** Rounded result for a resolved percentage load (design 10.2). */
export interface RoundedLoad {
    readonly valueKg: string;
    readonly incrementId: string | null;
    readonly scope: EquipmentIncrementScope | null;
}

export class EquipmentIncrementQueries<Transaction = unknown> {
    constructor(
        private readonly repository: EquipmentIncrementRepository<Transaction>,
        private readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">,
        private readonly catalog: Pick<EquipmentIncrementCatalogReader, "listExercises">,
    ) {}

    async list(): Promise<readonly EquipmentIncrementResource[]> {
        const profileId = await this.profileReader.requireActiveProfileId();
        return this.repository.list(profileId);
    }

    /** The most specific increment for an exercise: exercise > equipment > default. */
    async resolveForExercise(exerciseId: string): Promise<EquipmentIncrementResource | null> {
        const profileId = await this.profileReader.requireActiveProfileId();
        const increments = await this.repository.list(profileId);
        const byExercise = increments.find(item => item.scope === "exercise" && item.exerciseId === exerciseId);
        if (byExercise) return byExercise;
        const exercise = (await this.catalog.listExercises()).find(item => item.id === exerciseId);
        if (exercise) {
            const byEquipment = increments.find(
                item => item.scope === "equipment" && item.equipmentTypeId === exercise.equipment.id,
            );
            if (byEquipment) return byEquipment;
        }
        return increments.find(item => item.scope === "default") ?? null;
    }

    /** Resolve and round a load for an exercise, defaulting to the load unchanged. */
    async roundForExercise(exerciseId: string, loadKg: string): Promise<RoundedLoad> {
        const increment = await this.resolveForExercise(exerciseId);
        if (!increment) return { valueKg: loadKg, incrementId: null, scope: null };
        return {
            valueKg: roundLoadToIncrement(loadKg, increment),
            incrementId: increment.id,
            scope: increment.scope,
        };
    }
}

const equipmentIncrementRevisionResourceMapper: SnapshotResourceMapper<
    EquipmentIncrementState,
    EquipmentIncrementResource
> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class EquipmentIncrementRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<EquipmentIncrementResource> {
    readonly entityType = EQUIPMENT_INCREMENT_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<
        EquipmentIncrementState,
        EquipmentIncrementResource,
        Transaction
    >;

    constructor(
        private readonly mutations: RevisionMutationService<EquipmentIncrementState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Equipment increment event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            equipmentIncrementSerializer,
            equipmentIncrementRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<EquipmentIncrementResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: EquipmentIncrementResource }> {
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
                    name: "training.equipment-increment.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: {
                        incrementId: input.entityId,
                        restoredVersion: input.restoreVersion,
                    },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: equipmentIncrementRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: equipmentIncrementSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: EquipmentIncrementMutationMetadata, summary: string): RevisionMetadata {
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
        throw new ApplicationValidationError("Equipment increment ID must be a UUID", {
            incrementId: ["Equipment increment ID must be a UUID"],
        });
    }
}
