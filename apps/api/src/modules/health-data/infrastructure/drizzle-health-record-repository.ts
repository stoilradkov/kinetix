import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, isNull, lte, type SQL } from "drizzle-orm";

import { healthRecords, type Database, type HealthRecordRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    HEALTH_RECORD_ENTITY_TYPE,
    type HealthRecordListFilter,
    type HealthRecordRepository,
    type ManualHealthRecordResource,
} from "#src/modules/health-data/application/index";
import {
    ManualHealthRecord,
    healthRecordTypes,
    promoteHealthRecord,
    type HealthRecordBody,
    type HealthRecordType,
    type ManualHealthRecordState,
} from "#src/modules/health-data/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleHealthRecordRepository implements HealthRecordRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readRecord(id: EntityId, transaction?: unknown): Promise<ManualHealthRecordResource | null> {
        const executor = this.executor(transaction);
        const row = (await executor.select().from(healthRecords).where(eq(healthRecords.id, id)).limit(1))[0];
        return row ? toResource(row) : null;
    }

    async listRecords(filter?: HealthRecordListFilter): Promise<readonly ManualHealthRecordResource[]> {
        const conditions: SQL[] = [];
        if (filter?.type !== undefined) conditions.push(eq(healthRecords.type, filter.type));
        if (filter?.includeArchived !== true) conditions.push(isNull(healthRecords.archivedAt));
        if (filter?.from !== undefined) conditions.push(gte(healthRecords.effectiveAt, new Date(filter.from)));
        if (filter?.to !== undefined) conditions.push(lte(healthRecords.effectiveAt, new Date(filter.to)));
        const rows = await this.database.db
            .select()
            .from(healthRecords)
            .where(conditions.length === 0 ? undefined : and(...conditions))
            .orderBy(asc(healthRecords.effectiveAt), asc(healthRecords.createdAt), asc(healthRecords.id));
        return rows.map(toResource);
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: ManualHealthRecordState; version: number } | null> {
        assertEntityType(entityType);
        const executor = this.executor(transaction);
        const row = (
            await executor.select().from(healthRecords).where(eq(healthRecords.id, id)).limit(1).for("update")
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async create(
        entityType: string,
        id: EntityId,
        state: ManualHealthRecordState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Health record state ID does not match its aggregate ID");
        ManualHealthRecord.rehydrate(state);
        await this.executor(transaction).insert(healthRecords).values(rootValues(state, version));
    }

    async save(
        entityType: string,
        id: EntityId,
        state: ManualHealthRecordState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Health record state ID does not match its aggregate ID");
        ManualHealthRecord.rehydrate(state);
        const updated = await this.executor(transaction)
            .update(healthRecords)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(healthRecords.id, id), eq(healthRecords.version, expectedVersion)))
            .returning({ id: healthRecords.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function toResource(row: HealthRecordRow): ManualHealthRecordResource {
    return { ...hydrate(row), version: row.version, bodySchemaVersion: row.dataSchemaVersion };
}

function hydrate(row: HealthRecordRow): ManualHealthRecordState {
    return ManualHealthRecord.rehydrate({
        id: row.id,
        profileId: row.profileId,
        type: checkedType(row.type),
        source: "manual",
        effectiveAt: row.effectiveAt.toISOString(),
        timeZone: row.timeZone,
        notes: row.notes,
        body: row.data as unknown as HealthRecordBody,
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: ManualHealthRecordState, version: number) {
    const promotion = promoteHealthRecord(state);
    return {
        id: state.id,
        profileId: state.profileId,
        type: state.type,
        source: state.source,
        effectiveAt: new Date(state.effectiveAt),
        timeZone: state.timeZone,
        notes: state.notes,
        massKg: promotion.massKg === null ? null : promotion.massKg.toString(),
        restingHeartRateBpm: promotion.restingHeartRateBpm,
        sleepStartAt: promotion.sleepStartAt === null ? null : new Date(promotion.sleepStartAt),
        sleepEndAt: promotion.sleepEndAt === null ? null : new Date(promotion.sleepEndAt),
        sleepDurationMinutes: promotion.sleepDurationMinutes,
        readinessScore: promotion.readinessScore,
        dataSchemaVersion: 1,
        data: state.body as unknown as Record<string, unknown>,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: ManualHealthRecordState, version: number) {
    const promotion = promoteHealthRecord(state);
    return {
        effectiveAt: new Date(state.effectiveAt),
        timeZone: state.timeZone,
        notes: state.notes,
        massKg: promotion.massKg === null ? null : promotion.massKg.toString(),
        restingHeartRateBpm: promotion.restingHeartRateBpm,
        sleepStartAt: promotion.sleepStartAt === null ? null : new Date(promotion.sleepStartAt),
        sleepEndAt: promotion.sleepEndAt === null ? null : new Date(promotion.sleepEndAt),
        sleepDurationMinutes: promotion.sleepDurationMinutes,
        readinessScore: promotion.readinessScore,
        data: state.body as unknown as Record<string, unknown>,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== HEALTH_RECORD_ENTITY_TYPE)
        throw new Error(`Unsupported health record entity type '${entityType}'`);
}

function checkedType(value: string): HealthRecordType {
    return (healthRecordTypes as readonly string[]).includes(value)
        ? (value as HealthRecordType)
        : invalidPersisted("health record type", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
