import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { zoneDefinitions, zoneRanges, type Database, type ZoneDefinitionRow, type ZoneRangeRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { ZoneDefinitionRepository } from "#src/modules/training/application/index";
import {
    DecimalValue,
    ZoneDefinition,
    zoneFamilies,
    zoneMethodsByFamily,
    zoneSources,
    type ZoneDefinitionState,
    type ZoneFamily,
    type ZoneMethod,
    type ZoneRangeState,
    type ZoneSource,
} from "#src/modules/training/domain/index";

@Injectable()
export class DrizzleZoneDefinitionRepository implements ZoneDefinitionRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async insert(state: ZoneDefinitionState, transaction: unknown): Promise<void> {
        ZoneDefinition.rehydrate(state);
        const executor = this.executor(transaction);
        await executor.insert(zoneDefinitions).values(definitionValues(state));
        await executor.insert(zoneRanges).values(state.ranges.map(range => rangeValues(state.id, range)));
    }

    async findOpenForUpdate(
        profileId: string,
        family: ZoneFamily,
        transaction: unknown,
    ): Promise<ZoneDefinitionState | null> {
        const executor = this.executor(transaction);
        const row = (
            await executor
                .select()
                .from(zoneDefinitions)
                .where(
                    and(
                        eq(zoneDefinitions.profileId, profileId),
                        eq(zoneDefinitions.family, family),
                        isNull(zoneDefinitions.effectiveTo),
                    ),
                )
                .limit(1)
                .for("update")
        )[0];
        if (!row) return null;
        const ranges = await this.readRanges(executor, [row.id]);
        return hydrate(row, ranges.get(row.id) ?? []);
    }

    async close(id: string, effectiveTo: string, updatedAt: string, transaction: unknown): Promise<void> {
        const updated = await this.executor(transaction)
            .update(zoneDefinitions)
            .set({ effectiveTo: new Date(effectiveTo), updatedAt: new Date(updatedAt) })
            .where(and(eq(zoneDefinitions.id, id), isNull(zoneDefinitions.effectiveTo)))
            .returning({ id: zoneDefinitions.id });
        if (updated.length !== 1) throw new Error(`Failed to close open zone definition ${id}`);
    }

    async listCurrent(profileId: string): Promise<readonly ZoneDefinitionState[]> {
        const rows = await this.database.db
            .select()
            .from(zoneDefinitions)
            .where(and(eq(zoneDefinitions.profileId, profileId), isNull(zoneDefinitions.effectiveTo)))
            .orderBy(asc(zoneDefinitions.family));
        return this.hydrateAll(rows);
    }

    async listSeries(profileId: string, family: ZoneFamily): Promise<readonly ZoneDefinitionState[]> {
        const rows = await this.database.db
            .select()
            .from(zoneDefinitions)
            .where(and(eq(zoneDefinitions.profileId, profileId), eq(zoneDefinitions.family, family)))
            .orderBy(asc(zoneDefinitions.effectiveFrom), asc(zoneDefinitions.createdAt));
        return this.hydrateAll(rows);
    }

    private async hydrateAll(rows: readonly ZoneDefinitionRow[]): Promise<ZoneDefinitionState[]> {
        if (rows.length === 0) return [];
        const ranges = await this.readRanges(
            this.database.db,
            rows.map(row => row.id),
        );
        return rows.map(row => hydrate(row, ranges.get(row.id) ?? []));
    }

    private async readRanges(
        executor: Database,
        definitionIds: readonly string[],
    ): Promise<Map<string, ZoneRangeRow[]>> {
        const map = new Map<string, ZoneRangeRow[]>();
        if (definitionIds.length === 0) return map;
        const rows = await executor
            .select()
            .from(zoneRanges)
            .where(inArray(zoneRanges.zoneDefinitionId, [...definitionIds]))
            .orderBy(asc(zoneRanges.position));
        for (const row of rows) {
            const existing = map.get(row.zoneDefinitionId);
            if (existing) existing.push(row);
            else map.set(row.zoneDefinitionId, [row]);
        }
        return map;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function definitionValues(state: ZoneDefinitionState) {
    return {
        id: state.id,
        profileId: state.profileId,
        family: state.family,
        method: state.method,
        config: state.config as Record<string, number>,
        source: state.source,
        note: state.note,
        effectiveFrom: new Date(state.effectiveFrom),
        effectiveTo: state.effectiveTo === null ? null : new Date(state.effectiveTo),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rangeValues(zoneDefinitionId: string, range: ZoneRangeState) {
    return {
        id: range.id,
        zoneDefinitionId,
        position: range.position,
        name: range.name,
        lowerBound: range.lowerBound,
        upperBound: range.upperBound,
        lowerInclusive: range.lowerInclusive,
        upperInclusive: range.upperInclusive,
    };
}

function hydrate(row: ZoneDefinitionRow, ranges: readonly ZoneRangeRow[]): ZoneDefinitionState {
    return ZoneDefinition.rehydrate({
        id: row.id,
        profileId: row.profileId,
        family: checkedFamily(row.family),
        method: checkedMethod(row.family, row.method),
        config: row.config,
        ranges: ranges.map(range => ({
            id: range.id,
            position: range.position,
            name: range.name,
            lowerBound: DecimalValue.from(range.lowerBound).toString(),
            upperBound: range.upperBound === null ? null : DecimalValue.from(range.upperBound).toString(),
            lowerInclusive: range.lowerInclusive,
            upperInclusive: range.upperInclusive,
        })),
        source: checkedSource(row.source),
        note: row.note,
        effectiveFrom: row.effectiveFrom.toISOString(),
        effectiveTo: row.effectiveTo === null ? null : row.effectiveTo.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function checkedFamily(value: string): ZoneFamily {
    return (zoneFamilies as readonly string[]).includes(value)
        ? (value as ZoneFamily)
        : invalidPersisted("zone family", value);
}

function checkedMethod(family: string, value: string): ZoneMethod {
    const allowed = (zoneMethodsByFamily[checkedFamily(family)] ?? []) as readonly string[];
    return allowed.includes(value) ? (value as ZoneMethod) : invalidPersisted("zone method", value);
}

function checkedSource(value: string): ZoneSource {
    return (zoneSources as readonly string[]).includes(value)
        ? (value as ZoneSource)
        : invalidPersisted("zone source", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
