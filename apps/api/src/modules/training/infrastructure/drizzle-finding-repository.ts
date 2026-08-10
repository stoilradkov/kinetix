import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { findings, type Database, type FindingRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    FindingQuery,
    FindingRecord,
    FindingRepository,
    FindingView,
} from "#src/modules/training/application/index";
import type { FindingStatus, MetricDimensions } from "#src/modules/training/domain/index";

/**
 * Drizzle projection store for qualitative findings (issue #45, A3; design §16.2, §16.8). Personal-record
 * findings are supersede-and-insert like derived metrics: `supersedeAndInsert` marks the current row for a
 * natural key `superseded` and inserts the freshly computed `current` row in the caller's transaction, so a
 * partial unique index keeps at most one live finding per natural key and superseded history is preserved.
 *
 * The `findings` table stores a finding's value and dimensions inside its `evidence` jsonb (the schema is
 * value-agnostic — findings carry no numeric column), so this adapter reads them back out when it hydrates a
 * view. Drizzle rows never escape here.
 */
@Injectable()
export class DrizzleFindingRepository implements FindingRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async currentByNaturalKey(naturalKey: string, transaction?: unknown): Promise<FindingView | null> {
        const [row] = await this.executor(transaction)
            .select()
            .from(findings)
            .where(and(eq(findings.naturalKey, naturalKey), eq(findings.state, "current")))
            .limit(1);
        return row ? hydrate(row) : null;
    }

    async supersedeAndInsert(
        naturalKey: string,
        record: FindingRecord | null,
        transaction: unknown,
    ): Promise<FindingView | null> {
        const executor = this.executor(transaction);
        await executor
            .update(findings)
            .set({ state: "superseded", supersededAt: sql`now()` })
            .where(and(eq(findings.naturalKey, naturalKey), eq(findings.state, "current")));

        if (record === null) return null;
        await executor.insert(findings).values(findingInsert(record));
        return this.currentByNaturalKey(naturalKey, transaction);
    }

    async query(query: FindingQuery, transaction?: unknown): Promise<readonly FindingView[]> {
        const conditions: SQL[] = [];
        if (!query.includeSuperseded) conditions.push(eq(findings.state, "current"));
        if (query.findingKey) conditions.push(eq(findings.findingKey, query.findingKey));
        if (query.scopeType) conditions.push(eq(findings.scopeType, query.scopeType));
        if (query.scopeId) conditions.push(eq(findings.scopeId, query.scopeId));
        if (query.profileId) conditions.push(eq(findings.profileId, query.profileId));
        const rows = await this.executor(transaction)
            .select()
            .from(findings)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(findings.calculatedAt), desc(findings.id))
            .limit(query.limit);
        return rows.map(hydrate);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function findingInsert(record: FindingRecord) {
    return {
        id: record.id,
        profileId: record.profileId,
        findingKey: record.findingKey,
        findingVersion: record.findingVersion,
        scopeType: record.scope.type,
        scopeId: record.scope.id,
        naturalKey: record.naturalKey,
        status: record.status,
        evidence: record.evidence as Record<string, unknown>,
        reviewAt: record.reviewAt,
        expiresAt: record.expiresAt,
        feedback: null,
        sourceFingerprint: record.sourceFingerprint,
        state: "current",
        calculatedAt: record.calculatedAt,
        supersededAt: null,
    };
}

/** Narrow a finding's `evidence` jsonb to the value and dimensions the record projection embedded in it. */
function hydrate(row: FindingRow): FindingView {
    const evidence = row.evidence ?? {};
    return {
        id: row.id,
        profileId: row.profileId,
        findingKey: row.findingKey,
        findingVersion: row.findingVersion,
        scope: { type: row.scopeType, id: row.scopeId },
        dimensions: (evidence.dimensions ?? {}) as MetricDimensions,
        numericValue: typeof evidence.numericValue === "number" ? evidence.numericValue : null,
        unit: typeof evidence.unit === "string" ? evidence.unit : null,
        status: row.status as FindingStatus,
        evidence,
        sourceFingerprint: row.sourceFingerprint,
        state: row.state as "current" | "superseded",
        reviewAt: row.reviewAt,
        expiresAt: row.expiresAt,
        calculatedAt: row.calculatedAt,
        supersededAt: row.supersededAt,
    };
}
