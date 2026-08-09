import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
    adherenceComponents,
    adherenceResults,
    type AdherenceComponentRow,
    type AdherenceResultRow,
    type Database,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    AdherenceComponentView,
    AdherenceResultRecord,
    AdherenceResultRepository,
    AdherenceResultView,
} from "#src/modules/training/application/index";
import type {
    AdherenceComponentKey,
    AdherenceExclusionReason,
    AdherenceScope,
} from "#src/modules/training/domain/index";

/**
 * Drizzle projection store for adherence results (issue #37, AD1; design §16.2). Writes are supersede-
 * and-insert, never in-place mutation: `replaceForSession` marks the session's current results
 * `superseded` and inserts the freshly computed `current` results + components in the caller's
 * transaction, so a partial unique index guarantees at most one live result per resolved prescription.
 */
@Injectable()
export class DrizzleAdherenceResultRepository implements AdherenceResultRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readForSession(sessionId: string, transaction?: unknown): Promise<readonly AdherenceResultView[]> {
        const executor = this.executor(transaction);
        const results = await executor
            .select()
            .from(adherenceResults)
            .where(and(eq(adherenceResults.trainingSessionId, sessionId), eq(adherenceResults.state, "current")))
            .orderBy(asc(adherenceResults.resolvedPrescriptionId));
        if (results.length === 0) return [];

        const componentRows = await executor
            .select()
            .from(adherenceComponents)
            .where(
                inArray(
                    adherenceComponents.resultId,
                    results.map(row => row.id),
                ),
            )
            .orderBy(asc(adherenceComponents.position));
        const componentsByResult = new Map<string, AdherenceComponentRow[]>();
        for (const row of componentRows) {
            const bucket = componentsByResult.get(row.resultId);
            if (bucket === undefined) componentsByResult.set(row.resultId, [row]);
            else bucket.push(row);
        }
        return results.map(row => hydrateResult(row, componentsByResult.get(row.id) ?? []));
    }

    async currentFingerprints(sessionId: string, transaction?: unknown): Promise<ReadonlyMap<string, string>> {
        const executor = this.executor(transaction);
        const rows = await executor
            .select({
                resolvedPrescriptionId: adherenceResults.resolvedPrescriptionId,
                sourceFingerprint: adherenceResults.sourceFingerprint,
            })
            .from(adherenceResults)
            .where(and(eq(adherenceResults.trainingSessionId, sessionId), eq(adherenceResults.state, "current")));
        return new Map(rows.map(row => [row.resolvedPrescriptionId, row.sourceFingerprint]));
    }

    async replaceForSession(
        sessionId: string,
        results: readonly AdherenceResultRecord[],
        transaction: unknown,
    ): Promise<readonly AdherenceResultView[]> {
        const executor = this.executor(transaction);
        await executor
            .update(adherenceResults)
            .set({ state: "superseded", supersededAt: sql`now()` })
            .where(and(eq(adherenceResults.trainingSessionId, sessionId), eq(adherenceResults.state, "current")));

        if (results.length > 0) {
            await executor.insert(adherenceResults).values(results.map(resultInsert));
            const components = results.flatMap(result =>
                result.components.map(component => componentInsert(result.id, component)),
            );
            if (components.length > 0) await executor.insert(adherenceComponents).values(components);
        }
        return this.readForSession(sessionId, transaction);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function resultInsert(record: AdherenceResultRecord) {
    return {
        id: record.id,
        profileId: record.profileId,
        trainingSessionId: record.trainingSessionId,
        trainingSessionVersion: record.trainingSessionVersion,
        plannedSessionId: record.plannedSessionId,
        sourcePrescriptionId: record.sourcePrescriptionId,
        resolvedPrescriptionId: record.resolvedPrescriptionId,
        formula: record.formula,
        scope: record.scope,
        overallScore: record.overall === null ? null : String(record.overall),
        sourceFingerprint: record.sourceFingerprint,
        exclusions: [...record.exclusions],
        state: "current",
        calculatedAt: record.calculatedAt,
        supersededAt: null,
    };
}

function componentInsert(resultId: string, component: AdherenceResultRecord["components"][number]) {
    return {
        resultId,
        componentKey: component.key,
        scope: component.scope,
        score: component.score === null ? null : String(component.score),
        weight: String(component.weight),
        included: component.included,
        exclusionReason: component.exclusion,
        inputs: component.inputs as Record<string, unknown>,
        position: component.position,
    };
}

function hydrateResult(row: AdherenceResultRow, components: readonly AdherenceComponentRow[]): AdherenceResultView {
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
