import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lt, lte, or, type SQL } from "drizzle-orm";

import {
    adherenceComponents,
    adherenceResults,
    plannedSessionBlocks,
    plannedSessions,
    programPlannedSessions,
    trainingSessions,
    type AdherenceComponentRow,
    type AdherenceResultRow,
    type Database,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    AdherenceComponentView,
    AdherenceResultQueryCriteria,
    AdherenceResultQueryPageRows,
    AdherenceResultQueryPort,
    AdherenceResultQueryRow,
} from "#src/modules/training/application/index";
import type {
    AdherenceComponentKey,
    AdherenceExclusionReason,
    AdherenceScope,
} from "#src/modules/training/domain/index";
import { ApplicationValidationError } from "#src/platform/application/index";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read-only, index-aware projection over `adherence_results` (issue #38, AD2; design §18.3). It powers the
 * cross-session adherence query and the per-session read, joining the planned session for its title and the
 * program/block membership tables only when those scopes are filtered — never recomputing a score. The
 * cross-session page is a `(calculated_at desc, id desc)` keyset scan backed by `adherence_results_query_idx`;
 * components load in one batched follow-up so a result stays fully explainable. Rows never escape this file.
 */
@Injectable()
export class DrizzleAdherenceResultQuery implements AdherenceResultQueryPort {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async query(criteria: AdherenceResultQueryCriteria, transaction?: unknown): Promise<AdherenceResultQueryPageRows> {
        const executor = this.executor(transaction);
        const limit = clampLimit(criteria.limit);

        const conditions: SQL[] = [eq(adherenceResults.state, "current")];
        if (criteria.trainingSessionId)
            conditions.push(eq(adherenceResults.trainingSessionId, criteria.trainingSessionId));
        if (criteria.plannedSessionId)
            conditions.push(eq(adherenceResults.plannedSessionId, criteria.plannedSessionId));
        if (criteria.scope) conditions.push(eq(adherenceResults.scope, criteria.scope));
        if (criteria.from) conditions.push(gte(trainingSessions.localDate, criteria.from));
        if (criteria.to) conditions.push(lte(trainingSessions.localDate, criteria.to));
        if (criteria.programId) conditions.push(eq(programPlannedSessions.programId, criteria.programId));
        if (criteria.blockId) conditions.push(eq(plannedSessionBlocks.blockId, criteria.blockId));
        if (criteria.cursor) {
            const { calculatedAt, id } = decodeCursor(criteria.cursor);
            conditions.push(
                or(
                    lt(adherenceResults.calculatedAt, calculatedAt),
                    and(eq(adherenceResults.calculatedAt, calculatedAt), lt(adherenceResults.id, id)),
                )!,
            );
        }

        let builder = executor
            .select({ result: adherenceResults, plannedSessionTitle: plannedSessions.title })
            .from(adherenceResults)
            .innerJoin(trainingSessions, eq(adherenceResults.trainingSessionId, trainingSessions.id))
            .leftJoin(plannedSessions, eq(adherenceResults.plannedSessionId, plannedSessions.id))
            .$dynamic();
        // Membership joins are inner and only added when their scope is filtered, so an unmapped result
        // never matches a program/block scope and a mapped one never fans out (both joins are unique).
        if (criteria.programId)
            builder = builder.innerJoin(
                programPlannedSessions,
                eq(programPlannedSessions.plannedSessionId, adherenceResults.plannedSessionId),
            );
        if (criteria.blockId)
            builder = builder.innerJoin(
                plannedSessionBlocks,
                eq(plannedSessionBlocks.plannedSessionId, adherenceResults.plannedSessionId),
            );

        const rows = await builder
            .where(and(...conditions))
            .orderBy(desc(adherenceResults.calculatedAt), desc(adherenceResults.id))
            .limit(limit + 1);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const components = await this.loadComponents(
            executor,
            page.map(row => row.result.id),
        );
        const items = page.map(row =>
            hydrate(row.result, row.plannedSessionTitle, components.get(row.result.id) ?? []),
        );
        const last = page.at(-1);
        return {
            items,
            nextCursor: hasMore && last ? encodeCursor(last.result.calculatedAt, last.result.id) : null,
        };
    }

    async readForSession(sessionId: string, transaction?: unknown): Promise<readonly AdherenceResultQueryRow[]> {
        const executor = this.executor(transaction);
        const rows = await executor
            .select({ result: adherenceResults, plannedSessionTitle: plannedSessions.title })
            .from(adherenceResults)
            .leftJoin(plannedSessions, eq(adherenceResults.plannedSessionId, plannedSessions.id))
            .where(and(eq(adherenceResults.trainingSessionId, sessionId), eq(adherenceResults.state, "current")))
            .orderBy(asc(adherenceResults.resolvedPrescriptionId));
        if (rows.length === 0) return [];
        const components = await this.loadComponents(
            executor,
            rows.map(row => row.result.id),
        );
        return rows.map(row => hydrate(row.result, row.plannedSessionTitle, components.get(row.result.id) ?? []));
    }

    private async loadComponents(
        executor: Database,
        resultIds: readonly string[],
    ): Promise<ReadonlyMap<string, AdherenceComponentRow[]>> {
        const byResult = new Map<string, AdherenceComponentRow[]>();
        if (resultIds.length === 0) return byResult;
        const rows = await executor
            .select()
            .from(adherenceComponents)
            .where(inArray(adherenceComponents.resultId, [...resultIds]))
            .orderBy(asc(adherenceComponents.position));
        for (const row of rows) {
            const bucket = byResult.get(row.resultId);
            if (bucket === undefined) byResult.set(row.resultId, [row]);
            else bucket.push(row);
        }
        return byResult;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(
    row: AdherenceResultRow,
    plannedSessionTitle: string | null,
    components: readonly AdherenceComponentRow[],
): AdherenceResultQueryRow {
    return {
        id: row.id,
        trainingSessionId: row.trainingSessionId,
        trainingSessionVersion: row.trainingSessionVersion,
        plannedSessionId: row.plannedSessionId,
        sourcePrescriptionId: row.sourcePrescriptionId,
        resolvedPrescriptionId: row.resolvedPrescriptionId,
        formula: row.formula,
        scope: row.scope as AdherenceScope,
        overall: row.overallScore === null ? null : Number(row.overallScore),
        sourceFingerprint: row.sourceFingerprint,
        components: components.map(hydrateComponent),
        exclusions: (row.exclusions ?? []) as AdherenceExclusionReason[],
        calculatedAt: row.calculatedAt,
        plannedSessionTitle,
    };
}

function hydrateComponent(row: AdherenceComponentRow): AdherenceComponentView {
    return {
        key: row.componentKey as AdherenceComponentKey,
        scope: row.scope as AdherenceScope,
        score: row.score === null ? null : Number(row.score),
        weight: Number(row.weight),
        included: row.included,
        exclusion: row.exclusionReason as AdherenceExclusionReason | null,
        inputs: row.inputs ?? {},
    };
}

function clampLimit(limit: number | undefined): number {
    if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIST_LIMIT;
    return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(limit)));
}

/** Opaque keyset cursor: base64url of `<calculatedAt ISO>|<id>`. */
function encodeCursor(calculatedAt: Date, id: string): string {
    return Buffer.from(`${calculatedAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { calculatedAt: Date; id: string } {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf("|");
    const timestamp = separator === -1 ? "" : decoded.slice(0, separator);
    const id = separator === -1 ? "" : decoded.slice(separator + 1);
    const calculatedAt = new Date(timestamp);
    if (Number.isNaN(calculatedAt.getTime()) || !UUID_PATTERN.test(id))
        throw new ApplicationValidationError("Invalid pagination cursor", {
            cursor: ["Cursor is malformed or was not issued by this endpoint"],
        });
    return { calculatedAt, id };
}
