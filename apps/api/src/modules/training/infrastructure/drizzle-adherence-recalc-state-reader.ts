import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { jobs, trainingSessions, type Database } from "@kinetix/db";

import {
    ADHERENCE_RECALCULATE_JOB,
    ADHERENCE_RECALCULATE_JOB_VERSION,
    type AdherenceRecalcState,
    type AdherenceRecalcStateReader,
} from "#src/modules/training/application/index";
import { DatabaseService } from "#src/database/database.service";

type JobStatus = AdherenceRecalcState["jobStatus"];

/**
 * Sources the recompute state of many sessions in two bounded reads (issue #38, AD2): the session roots'
 * current versions and the status of each session's coalesced `adherence.recalculate:<sessionId>` job
 * (found through the jobs table's `(type, version, idempotency_key)` unique index). The application composes
 * these into a per-result stale/pending/failed label; this adapter never scores or mutates.
 */
@Injectable()
export class DrizzleAdherenceRecalcStateReader implements AdherenceRecalcStateReader {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readStates(
        sessionIds: readonly string[],
        transaction?: unknown,
    ): Promise<ReadonlyMap<string, AdherenceRecalcState>> {
        const states = new Map<string, AdherenceRecalcState>();
        const distinct = [...new Set(sessionIds)];
        if (distinct.length === 0) return states;
        const executor = this.executor(transaction);

        const versionRows = await executor
            .select({ id: trainingSessions.id, version: trainingSessions.version })
            .from(trainingSessions)
            .where(inArray(trainingSessions.id, distinct));
        const versionById = new Map(versionRows.map(row => [row.id, row.version]));

        const keyToSession = new Map(distinct.map(id => [recomputeJobKey(id), id]));
        const jobRows = await executor
            .select({ idempotencyKey: jobs.idempotencyKey, status: jobs.status })
            .from(jobs)
            .where(
                and(
                    eq(jobs.type, ADHERENCE_RECALCULATE_JOB),
                    eq(jobs.version, ADHERENCE_RECALCULATE_JOB_VERSION),
                    inArray(jobs.idempotencyKey, [...keyToSession.keys()]),
                ),
            );
        const jobBySession = new Map<string, JobStatus>();
        for (const row of jobRows) {
            const sessionId = row.idempotencyKey === null ? undefined : keyToSession.get(row.idempotencyKey);
            if (sessionId !== undefined) jobBySession.set(sessionId, row.status);
        }

        for (const id of distinct) {
            states.set(id, {
                currentSessionVersion: versionById.get(id) ?? null,
                jobStatus: jobBySession.get(id) ?? null,
            });
        }
        return states;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function recomputeJobKey(sessionId: string): string {
    return `${ADHERENCE_RECALCULATE_JOB}:${sessionId}`;
}
