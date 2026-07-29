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
    GearItem,
    type CreateGearItemInput,
    type GearItemState,
    type UpdateGearItemInput,
} from "#src/modules/training/domain/index";
import type { ProfileReader } from "#src/modules/profile/index";

export const GEAR_ITEM_REPOSITORY = Symbol("GEAR_ITEM_REPOSITORY");
export const GEAR_ITEM_MUTATION_SERVICE = Symbol("GEAR_ITEM_MUTATION_SERVICE");
export const GEAR_ITEM_COMMANDS = Symbol("GEAR_ITEM_COMMANDS");
export const GEAR_ITEM_REVISION_HANDLER = Symbol("GEAR_ITEM_REVISION_HANDLER");
export const GEAR_ITEM_ENTITY_TYPE = "training.gear-item";

export interface GearItemResource extends GearItemState {
    readonly version: number;
}

export interface GearItemListFilter {
    readonly includeArchived?: boolean;
}

export interface GearItemRepository<Transaction = unknown> extends CurrentStateStore<GearItemState, Transaction> {
    readGear(id: EntityId, transaction?: Transaction): Promise<GearItemResource | null>;
    listGear(filter?: GearItemListFilter): Promise<readonly GearItemResource[]>;
}

export interface GearItemMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateGearItemCommand extends Omit<CreateGearItemInput, "id" | "profileId"> {
    readonly id?: string;
}

export class GearItemNotFoundError extends ApplicationNotFoundError {
    constructor(readonly gearItemId: string) {
        super(`Gear item ${gearItemId} was not found`, { gearItemId });
        this.name = "GearItemNotFoundError";
    }
}

export const gearItemSerializer = new MigratingSnapshotSerializer<GearItemState>(
    1,
    state => structuredClone(state),
    value => GearItem.rehydrate(value as GearItemState).state,
    [],
);

interface GearItemCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: GearItemRepository<Transaction>;
    readonly mutations: RevisionMutationService<GearItemState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

type GearAction = "created" | "updated" | "archived" | "restored";

export class GearItemCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: GearItemCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Gear item ID generation is not configured");
            });
    }

    async create(
        input: CreateGearItemCommand,
        metadata: GearItemMutationMetadata,
        transaction?: Transaction,
    ): Promise<GearItemResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const gear = GearItem.create({ ...input, id: input.id ?? this.generateId(), profileId }, now);
        return this.inTransaction(transaction, async activeTransaction => {
            await this.runtime.mutations.create({
                entityType: GEAR_ITEM_ENTITY_TYPE,
                entityId: entityId(gear.state.id),
                state: gear.state,
                metadata: revisionMetadata(metadata, "Created gear item"),
                events: [this.event("created", gear.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(gear.state.id, activeTransaction);
        });
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        input: UpdateGearItemInput,
        metadata: GearItemMutationMetadata,
        transaction?: Transaction,
    ): Promise<GearItemResource> {
        return this.mutate(
            id,
            expectedVersion,
            gear => gear.update(input, this.clock.now()),
            "updated",
            metadata,
            transaction,
        );
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: GearItemMutationMetadata,
        transaction?: Transaction,
    ): Promise<GearItemResource> {
        return this.mutate(
            id,
            expectedVersion,
            gear => gear.archive(this.clock.now()),
            "archived",
            metadata,
            transaction,
        );
    }

    restore(
        id: string,
        expectedVersion: number | undefined,
        metadata: GearItemMutationMetadata,
        transaction?: Transaction,
    ): Promise<GearItemResource> {
        return this.mutate(
            id,
            expectedVersion,
            gear => gear.restore(this.clock.now()),
            "restored",
            metadata,
            transaction,
        );
    }

    private mutate(
        id: string,
        expectedVersion: number | undefined,
        apply: (gear: GearItem) => GearItem,
        action: GearAction,
        metadata: GearItemMutationMetadata,
        transaction?: Transaction,
    ): Promise<GearItemResource> {
        const gearItemId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                GEAR_ITEM_ENTITY_TYPE,
                gearItemId,
                activeTransaction,
            );
            if (!stored) throw new GearItemNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const result = await this.runtime.mutations.mutate({
                entityType: GEAR_ITEM_ENTITY_TYPE,
                entityId: gearItemId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = apply(GearItem.rehydrate(state));
                    return {
                        state: next.state,
                        events: [this.event(action, next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, `${capitalize(action)} gear item`),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<GearItemResource> {
        const resource = await this.runtime.repository.readGear(entityId(id), transaction);
        if (!resource) throw new GearItemNotFoundError(id);
        return resource;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: GearAction,
        state: GearItemState,
        aggregateRevision: number,
        metadata: GearItemMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.gear-item.${action}`,
            version: 1,
            occurredAt,
            aggregateType: GEAR_ITEM_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: { gearItemId: state.id, profileId: state.profileId, status: state.status },
        });
    }
}

const gearItemRevisionResourceMapper: SnapshotResourceMapper<GearItemState, GearItemResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class GearItemRevisionHandler<Transaction = unknown> implements RevisionResourceHandler<GearItemResource> {
    readonly entityType = GEAR_ITEM_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<GearItemState, GearItemResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<GearItemState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Gear item event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(revisions, gearItemSerializer, gearItemRevisionResourceMapper);
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<GearItemResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: GearItemResource }> {
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
                    name: "training.gear-item.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: { gearItemId: input.entityId, restoredVersion: input.restoreVersion },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: gearItemRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: gearItemSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: GearItemMutationMetadata, summary: string): RevisionMetadata {
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
        throw new ApplicationValidationError("Gear item ID must be a UUID", {
            gearItemId: ["Gear item ID must be a UUID"],
        });
    }
}
