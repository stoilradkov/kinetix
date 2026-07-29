import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { gearItems, type Database, type GearItemRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    GEAR_ITEM_ENTITY_TYPE,
    type GearItemListFilter,
    type GearItemRepository,
    type GearItemResource,
} from "#src/modules/training/application/index";
import {
    DecimalValue,
    GearItem,
    gearStatuses,
    gearTypes,
    type GearStatus,
    type GearType,
    type GearItemState,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleGearItemRepository implements GearItemRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readGear(id: EntityId, transaction?: unknown): Promise<GearItemResource | null> {
        const row = (await this.executor(transaction).select().from(gearItems).where(eq(gearItems.id, id)).limit(1))[0];
        return row ? { ...hydrate(row), version: row.version } : null;
    }

    async listGear(filter?: GearItemListFilter): Promise<readonly GearItemResource[]> {
        const rows = await this.database.db
            .select()
            .from(gearItems)
            .where(filter?.includeArchived ? undefined : eq(gearItems.status, "active"))
            .orderBy(asc(gearItems.status), asc(gearItems.name), asc(gearItems.id));
        return rows.map(row => ({ ...hydrate(row), version: row.version }));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: GearItemState; version: number } | null> {
        assertEntityType(entityType);
        const row = (
            await this.executor(transaction).select().from(gearItems).where(eq(gearItems.id, id)).limit(1).for("update")
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async create(
        entityType: string,
        id: EntityId,
        state: GearItemState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Gear item state ID does not match its aggregate ID");
        GearItem.rehydrate(state);
        await this.executor(transaction).insert(gearItems).values(rootValues(state, version));
    }

    async save(
        entityType: string,
        id: EntityId,
        state: GearItemState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Gear item state ID does not match its aggregate ID");
        GearItem.rehydrate(state);
        const updated = await this.executor(transaction)
            .update(gearItems)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(gearItems.id, id), eq(gearItems.version, expectedVersion)))
            .returning({ id: gearItems.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: GearItemRow): GearItemState {
    return GearItem.rehydrate({
        id: row.id,
        profileId: row.profileId,
        name: row.name,
        gearType: checkedType(row.gearType),
        acquiredOn: row.acquiredOn,
        retiredOn: row.retiredOn,
        distanceLimitM: row.distanceLimitM === null ? null : DecimalValue.from(row.distanceLimitM).toString(),
        notes: row.notes,
        status: checkedStatus(row.status),
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: GearItemState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        name: state.name,
        gearType: state.gearType,
        acquiredOn: state.acquiredOn,
        retiredOn: state.retiredOn,
        distanceLimitM: state.distanceLimitM,
        notes: state.notes,
        status: state.status,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        version,
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: GearItemState, version: number) {
    return {
        name: state.name,
        gearType: state.gearType,
        acquiredOn: state.acquiredOn,
        retiredOn: state.retiredOn,
        distanceLimitM: state.distanceLimitM,
        notes: state.notes,
        status: state.status,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        version,
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== GEAR_ITEM_ENTITY_TYPE) throw new Error(`Unsupported gear item entity type '${entityType}'`);
}

function checkedType(value: string): GearType {
    return (gearTypes as readonly string[]).includes(value)
        ? (value as GearType)
        : invalidPersisted("gear type", value);
}

function checkedStatus(value: string): GearStatus {
    return (gearStatuses as readonly string[]).includes(value)
        ? (value as GearStatus)
        : invalidPersisted("gear status", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
