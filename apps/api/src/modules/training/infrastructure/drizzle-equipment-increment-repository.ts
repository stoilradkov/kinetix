import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { equipmentIncrements, type Database, type EquipmentIncrementRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    EQUIPMENT_INCREMENT_ENTITY_TYPE,
    type EquipmentIncrementRepository,
    type EquipmentIncrementResource,
} from "#src/modules/training/application/index";
import {
    DecimalValue,
    EquipmentIncrement,
    equipmentIncrementScopes,
    type EquipmentIncrementScope,
    type EquipmentIncrementState,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleEquipmentIncrementRepository implements EquipmentIncrementRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async read(id: EntityId, transaction?: unknown): Promise<EquipmentIncrementResource | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(equipmentIncrements)
                .where(eq(equipmentIncrements.id, id))
                .limit(1)
        )[0];
        return row ? { ...hydrate(row), version: row.version } : null;
    }

    async list(profileId: string): Promise<readonly EquipmentIncrementResource[]> {
        const rows = await this.database.db
            .select()
            .from(equipmentIncrements)
            .where(eq(equipmentIncrements.profileId, profileId))
            .orderBy(asc(equipmentIncrements.scope), asc(equipmentIncrements.createdAt), asc(equipmentIncrements.id));
        return rows.map(row => ({ ...hydrate(row), version: row.version }));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: EquipmentIncrementState; version: number } | null> {
        assertEntityType(entityType);
        const row = (
            await this.executor(transaction)
                .select()
                .from(equipmentIncrements)
                .where(eq(equipmentIncrements.id, id))
                .limit(1)
                .for("update")
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async create(
        entityType: string,
        id: EntityId,
        state: EquipmentIncrementState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Equipment increment state ID does not match its aggregate ID");
        EquipmentIncrement.rehydrate(state);
        await this.executor(transaction).insert(equipmentIncrements).values(rootValues(state, version));
    }

    async save(
        entityType: string,
        id: EntityId,
        state: EquipmentIncrementState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Equipment increment state ID does not match its aggregate ID");
        EquipmentIncrement.rehydrate(state);
        const updated = await this.executor(transaction)
            .update(equipmentIncrements)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(equipmentIncrements.id, id), eq(equipmentIncrements.version, expectedVersion)))
            .returning({ id: equipmentIncrements.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: EquipmentIncrementRow): EquipmentIncrementState {
    return EquipmentIncrement.rehydrate({
        id: row.id,
        profileId: row.profileId,
        scope: checkedScope(row.scope),
        exerciseId: row.exerciseId,
        equipmentTypeId: row.equipmentTypeId,
        incrementKg: DecimalValue.from(row.incrementKg).toString(),
        minimumKg: row.minimumKg === null ? null : DecimalValue.from(row.minimumKg).toString(),
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: EquipmentIncrementState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        scope: state.scope,
        exerciseId: state.exerciseId,
        equipmentTypeId: state.equipmentTypeId,
        incrementKg: state.incrementKg,
        minimumKg: state.minimumKg,
        label: state.label,
        version,
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: EquipmentIncrementState, version: number) {
    return {
        incrementKg: state.incrementKg,
        minimumKg: state.minimumKg,
        label: state.label,
        version,
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== EQUIPMENT_INCREMENT_ENTITY_TYPE)
        throw new Error(`Unsupported equipment increment entity type '${entityType}'`);
}

function checkedScope(value: string): EquipmentIncrementScope {
    return (equipmentIncrementScopes as readonly string[]).includes(value)
        ? (value as EquipmentIncrementScope)
        : invalidPersisted("equipment increment scope", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
