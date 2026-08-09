import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { derivedMetricInputs, derivedMetrics, type Database, type DerivedMetricRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    AffectedMetric,
    DerivedMetricRecord,
    DerivedMetricRepository,
    DerivedMetricView,
    MetricQuery,
} from "#src/modules/training/application/index";
import type { InvalidationScope, MetricPeriod } from "#src/modules/training/domain/index";

/**
 * Drizzle projection store for derived metrics (issue #43, A1; design §16.2). Writes are supersede-and-
 * insert, never in-place mutation: `supersedeAndInsert` marks the current row for a natural key
 * `superseded` and inserts the freshly computed `current` row plus its input references in the caller's
 * transaction, so a partial unique index keeps at most one live row per natural key. Invalidation matching
 * spans both the projection scope and the recorded source-input references (the source-revision lookup).
 */
@Injectable()
export class DrizzleDerivedMetricRepository implements DerivedMetricRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async currentByNaturalKey(naturalKey: string, transaction?: unknown): Promise<DerivedMetricView | null> {
        const executor = this.executor(transaction);
        const [row] = await executor
            .select()
            .from(derivedMetrics)
            .where(and(eq(derivedMetrics.naturalKey, naturalKey), eq(derivedMetrics.state, "current")))
            .limit(1);
        return row ? hydrate(row) : null;
    }

    async supersedeAndInsert(
        naturalKey: string,
        record: DerivedMetricRecord | null,
        transaction: unknown,
    ): Promise<DerivedMetricView | null> {
        const executor = this.executor(transaction);
        await executor
            .update(derivedMetrics)
            .set({ state: "superseded", supersededAt: sql`now()`, stale: false })
            .where(and(eq(derivedMetrics.naturalKey, naturalKey), eq(derivedMetrics.state, "current")));

        if (record === null) return null;
        await executor.insert(derivedMetrics).values(metricInsert(record));
        if (record.inputs.length > 0)
            await executor.insert(derivedMetricInputs).values(
                record.inputs.map(input => ({
                    metricId: record.id,
                    entityType: input.entityType,
                    entityId: input.entityId,
                    revision: input.revision,
                })),
            );
        return this.currentByNaturalKey(naturalKey, transaction);
    }

    async clearStale(naturalKey: string, transaction: unknown): Promise<void> {
        const executor = this.executor(transaction);
        await executor
            .update(derivedMetrics)
            .set({ stale: false })
            .where(and(eq(derivedMetrics.naturalKey, naturalKey), eq(derivedMetrics.state, "current")));
    }

    async markStale(scopes: readonly InvalidationScope[], transaction: unknown): Promise<number> {
        const executor = this.executor(transaction);
        const scopeMatch = scopeCondition(scopes);
        if (scopeMatch === undefined) return 0;
        const inputMetricIds = await this.inputMatchedIds(scopes, transaction);
        const rows = await executor
            .update(derivedMetrics)
            .set({ stale: true })
            .where(and(eq(derivedMetrics.state, "current"), affectedCondition(scopeMatch, inputMetricIds)))
            .returning({ id: derivedMetrics.id });
        return rows.length;
    }

    async findAffected(
        scopes: readonly InvalidationScope[],
        transaction?: unknown,
    ): Promise<readonly AffectedMetric[]> {
        const executor = this.executor(transaction);
        const scopeMatch = scopeCondition(scopes);
        if (scopeMatch === undefined) return [];
        const inputMetricIds = await this.inputMatchedIds(scopes, transaction);
        const rows = await executor
            .select()
            .from(derivedMetrics)
            .where(and(eq(derivedMetrics.state, "current"), affectedCondition(scopeMatch, inputMetricIds)));
        return rows.map(toTarget);
    }

    async listCurrentTargets(transaction?: unknown): Promise<readonly AffectedMetric[]> {
        const executor = this.executor(transaction);
        const rows = await executor.select().from(derivedMetrics).where(eq(derivedMetrics.state, "current"));
        return rows.map(toTarget);
    }

    async query(query: MetricQuery, transaction?: unknown): Promise<readonly DerivedMetricView[]> {
        const executor = this.executor(transaction);
        const conditions: SQL[] = [];
        if (!query.includeSuperseded) conditions.push(eq(derivedMetrics.state, "current"));
        if (query.calculatorKey) conditions.push(eq(derivedMetrics.calculatorKey, query.calculatorKey));
        if (query.scopeType) conditions.push(eq(derivedMetrics.scopeType, query.scopeType));
        if (query.scopeId) conditions.push(eq(derivedMetrics.scopeId, query.scopeId));
        const rows = await executor
            .select()
            .from(derivedMetrics)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(derivedMetrics.calculatedAt), desc(derivedMetrics.id))
            .limit(query.limit);
        return rows.map(hydrate);
    }

    private async inputMatchedIds(scopes: readonly InvalidationScope[], transaction: unknown): Promise<string[]> {
        const executor = this.executor(transaction);
        const inputMatch = inputCondition(scopes);
        if (inputMatch === undefined) return [];
        const rows = await executor
            .selectDistinct({ metricId: derivedMetricInputs.metricId })
            .from(derivedMetricInputs)
            .where(inputMatch);
        return rows.map(row => row.metricId);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function scopeCondition(scopes: readonly InvalidationScope[]): SQL | undefined {
    const pairs = distinctPairs(scopes);
    if (pairs.length === 0) return undefined;
    return or(...pairs.map(pair => and(eq(derivedMetrics.scopeType, pair.type), eq(derivedMetrics.scopeId, pair.id))));
}

function inputCondition(scopes: readonly InvalidationScope[]): SQL | undefined {
    const pairs = distinctPairs(scopes);
    if (pairs.length === 0) return undefined;
    return or(
        ...pairs.map(pair =>
            and(eq(derivedMetricInputs.entityType, pair.type), eq(derivedMetricInputs.entityId, pair.id)),
        ),
    );
}

function affectedCondition(scopeMatch: SQL, inputMetricIds: readonly string[]): SQL {
    if (inputMetricIds.length === 0) return scopeMatch;
    return or(scopeMatch, inArray(derivedMetrics.id, [...inputMetricIds])) as SQL;
}

function distinctPairs(scopes: readonly InvalidationScope[]): { type: string; id: string }[] {
    const seen = new Map<string, { type: string; id: string }>();
    for (const scope of scopes)
        seen.set(`${scope.scopeType}|${scope.scopeId}`, { type: scope.scopeType, id: scope.scopeId });
    return [...seen.values()];
}

function metricInsert(record: DerivedMetricRecord) {
    return {
        id: record.id,
        profileId: record.profileId,
        calculatorKey: record.calculatorKey,
        calculatorVersion: record.calculatorVersion,
        scopeType: record.scope.type,
        scopeId: record.scope.id,
        period: record.period,
        dimensions: record.dimensions as Record<string, string>,
        naturalKey: record.naturalKey,
        numericValue: record.numericValue === null ? null : String(record.numericValue),
        textValue: record.textValue,
        unit: record.unit,
        details: record.details as Record<string, unknown>,
        sourceFingerprint: record.sourceFingerprint,
        state: "current",
        stale: false,
        calculatedAt: record.calculatedAt,
        supersededAt: null,
    };
}

/** Narrow the untyped `period` jsonb column back to the domain union it always holds. */
function asMetricPeriod(value: unknown): MetricPeriod {
    return value as MetricPeriod;
}

function toTarget(row: DerivedMetricRow): AffectedMetric {
    return {
        calculatorKey: row.calculatorKey,
        scope: { type: row.scopeType, id: row.scopeId },
        period: asMetricPeriod(row.period),
        dimensions: row.dimensions ?? {},
    };
}

function hydrate(row: DerivedMetricRow): DerivedMetricView {
    return {
        id: row.id,
        profileId: row.profileId,
        calculatorKey: row.calculatorKey,
        calculatorVersion: row.calculatorVersion,
        scope: { type: row.scopeType, id: row.scopeId },
        period: asMetricPeriod(row.period),
        dimensions: row.dimensions ?? {},
        numericValue: row.numericValue === null ? null : Number(row.numericValue),
        textValue: row.textValue,
        unit: row.unit,
        details: row.details ?? {},
        sourceFingerprint: row.sourceFingerprint,
        state: row.state as "current" | "superseded",
        stale: row.stale,
        calculatedAt: row.calculatedAt,
        supersededAt: row.supersededAt,
    };
}
