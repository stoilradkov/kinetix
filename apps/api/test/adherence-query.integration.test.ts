import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, inArray } from "drizzle-orm";

import {
    adherenceResults,
    createDatabase,
    jobs,
    plannedSessionBlocks,
    plannedSessions,
    programBlocks,
    programPlannedSessions,
    programs,
    sessionMappings,
    sessionPrescriptions,
    trainingSessions,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    ADHERENCE_RECALCULATE_JOB,
    ADHERENCE_RECALCULATE_JOB_VERSION,
    type AdherenceResultRecord,
} from "#src/modules/training/application/index";
import { DrizzleAdherenceResultRepository } from "#src/modules/training/infrastructure/drizzle-adherence-result-repository";
import { DrizzleAdherenceResultQuery } from "#src/modules/training/infrastructure/drizzle-adherence-result-query";
import { DrizzleAdherenceRecalcStateReader } from "#src/modules/training/infrastructure/drizzle-adherence-recalc-state-reader";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const profileId = "0198a4db-d8da-7000-8000-0000000ae001";
const sessionOne = "0198a4db-d8da-7000-8000-0000000ae002";
const sessionTwo = "0198a4db-d8da-7000-8000-0000000ae003";
const srcA = "0198a4db-d8da-7000-8000-0000000ae004";
const resA = "0198a4db-d8da-7000-8000-0000000ae005";
const srcB = "0198a4db-d8da-7000-8000-0000000ae006";
const resB = "0198a4db-d8da-7000-8000-0000000ae007";
const plannedOne = "0198a4db-d8da-7000-8000-0000000ae008";
const programId = "0198a4db-d8da-7000-8000-0000000ae009";
const blockId = "0198a4db-d8da-7000-8000-0000000ae00a";
const resultOne = "0198a4db-d8da-7000-8000-0000000ae101";
const resultTwo = "0198a4db-d8da-7000-8000-0000000ae102";
const sessionIds = [sessionOne, sessionTwo];

function record(overrides: Partial<AdherenceResultRecord>): AdherenceResultRecord {
    return {
        id: resultOne,
        profileId,
        trainingSessionId: sessionOne,
        trainingSessionVersion: 2,
        plannedSessionId: plannedOne,
        sourcePrescriptionId: srcA,
        resolvedPrescriptionId: resA,
        formula: "adherence.overall.v1",
        scope: "strength",
        overall: 90,
        sourceFingerprint: "a".repeat(64),
        exclusions: [],
        // A distinctive date window keeps this cross-session query isolated from other integration tests
        // that write adherence rows to the shared dev database (their rows fall outside 2031-03).
        calculatedAt: new Date("2031-03-01T09:00:00.000Z"),
        components: [
            {
                key: "reps",
                scope: "strength",
                score: 80,
                weight: 20,
                included: true,
                exclusion: null,
                inputs: { actualTotal: 8 },
                position: 0,
            },
        ],
        ...overrides,
    };
}

describe.runIf(testDatabaseUrl)("adherence query + recalc-state PostgreSQL projection", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleAdherenceResultRepository(connection as unknown as DatabaseService);
    const query = new DrizzleAdherenceResultQuery(connection as unknown as DatabaseService);
    const stateReader = new DrizzleAdherenceRecalcStateReader(connection as unknown as DatabaseService);

    beforeAll(async () => {
        await connection.db
            .insert(sessionPrescriptions)
            .values([
                { id: srcA, kind: "planned" },
                { id: resA, kind: "resolved_execution" },
                { id: srcB, kind: "planned" },
                { id: resB, kind: "resolved_execution" },
            ])
            .onConflictDoNothing();
        await connection.db
            .insert(plannedSessions)
            .values({ id: plannedOne, profileId, currentPrescriptionId: srcA, title: "Week 1 · Lower A" })
            .onConflictDoNothing();
        await connection.db
            .insert(programs)
            .values({ id: programId, profileId, name: "Test program" })
            .onConflictDoNothing();
        await connection.db
            .insert(programBlocks)
            .values({ id: blockId, programId, type: "mesocycle", position: 0 })
            .onConflictDoNothing();
        await connection.db
            .insert(programPlannedSessions)
            .values({ programId, plannedSessionId: plannedOne, sequence: 0 })
            .onConflictDoNothing();
        await connection.db
            .insert(plannedSessionBlocks)
            .values({ plannedSessionId: plannedOne, blockId })
            .onConflictDoNothing();
        await connection.db
            .insert(trainingSessions)
            .values([
                { id: sessionOne, profileId, localDate: "2031-03-01", timeZone: "UTC", version: 3 },
                { id: sessionTwo, profileId, localDate: "2031-03-02", timeZone: "UTC", version: 1 },
            ])
            .onConflictDoNothing();
        await connection.db
            .insert(sessionMappings)
            .values({
                sessionId: sessionOne,
                plannedSessionId: plannedOne,
                sourcePrescriptionId: srcA,
                resolvedPrescriptionId: resA,
            })
            .onConflictDoNothing();

        await connection.db.transaction(async tx => {
            await repository.replaceForSession(sessionOne, [record({})], tx);
            await repository.replaceForSession(
                sessionTwo,
                [
                    record({
                        id: resultTwo,
                        trainingSessionId: sessionTwo,
                        plannedSessionId: null,
                        sourcePrescriptionId: srcB,
                        resolvedPrescriptionId: resB,
                        scope: "running",
                        overall: 75,
                        sourceFingerprint: "b".repeat(64),
                        calculatedAt: new Date("2031-03-02T09:00:00.000Z"),
                    }),
                ],
                tx,
            );
        });

        await connection.db
            .insert(jobs)
            .values({
                type: ADHERENCE_RECALCULATE_JOB,
                version: ADHERENCE_RECALCULATE_JOB_VERSION,
                payload: { trainingSessionId: sessionOne },
                payloadFingerprint: "c".repeat(64),
                correlationId: "corr-adherence-query",
                idempotencyKey: `${ADHERENCE_RECALCULATE_JOB}:${sessionOne}`,
                status: "queued",
            })
            .onConflictDoNothing();
    });

    afterAll(async () => {
        await connection.db.delete(adherenceResults).where(inArray(adherenceResults.trainingSessionId, sessionIds));
        await connection.db.delete(jobs).where(eq(jobs.idempotencyKey, `${ADHERENCE_RECALCULATE_JOB}:${sessionOne}`));
        await connection.db.delete(sessionMappings).where(eq(sessionMappings.sessionId, sessionOne));
        await connection.db.delete(plannedSessionBlocks).where(eq(plannedSessionBlocks.blockId, blockId));
        await connection.db.delete(programPlannedSessions).where(eq(programPlannedSessions.programId, programId));
        await connection.db.delete(programBlocks).where(eq(programBlocks.id, blockId));
        await connection.db.delete(programs).where(eq(programs.id, programId));
        await connection.db.delete(trainingSessions).where(inArray(trainingSessions.id, sessionIds));
        await connection.db.delete(plannedSessions).where(eq(plannedSessions.id, plannedOne));
    });

    it("reads a session's results with the denormalised planned-session title", async () => {
        const rows = await query.readForSession(sessionOne);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.overall).toBe(90);
        expect(rows[0]!.plannedSessionTitle).toBe("Week 1 · Lower A");
        expect(rows[0]!.components).toHaveLength(1);
    });

    it("orders the cross-session query newest-computed first and paginates by keyset", async () => {
        // Bound to this test's own date window so concurrent integration tests can't interleave rows.
        const window = { from: "2031-03-01", to: "2031-03-02" } as const;
        const first = await query.query({ limit: 1, ...window });
        expect(first.items.map(item => item.id)).toEqual([resultTwo]);
        expect(first.nextCursor).not.toBeNull();

        const second = await query.query({ limit: 1, cursor: first.nextCursor!, ...window });
        expect(second.items.map(item => item.id)).toEqual([resultOne]);
        expect(second.nextCursor).toBeNull();
    });

    it("filters by session, scope, program, block, and local-date range", async () => {
        const window = { from: "2031-03-01", to: "2031-03-02" } as const;
        expect((await query.query({ limit: 50, trainingSessionId: sessionTwo })).items.map(i => i.id)).toEqual([
            resultTwo,
        ]);
        expect((await query.query({ limit: 50, scope: "running", ...window })).items.map(i => i.id)).toEqual([
            resultTwo,
        ]);
        expect((await query.query({ limit: 50, programId })).items.map(i => i.id)).toEqual([resultOne]);
        expect((await query.query({ limit: 50, blockId })).items.map(i => i.id)).toEqual([resultOne]);
        expect((await query.query({ limit: 50, from: "2031-03-02" })).items.map(i => i.id)).toEqual([resultTwo]);
        expect((await query.query({ limit: 50, from: "2031-03-01", to: "2031-03-01" })).items.map(i => i.id)).toEqual([
            resultOne,
        ]);
    });

    it("reads recompute state: the queued job for session one and the bare version for session two", async () => {
        const states = await stateReader.readStates(sessionIds);
        expect(states.get(sessionOne)).toEqual({ currentSessionVersion: 3, jobStatus: "queued" });
        expect(states.get(sessionTwo)).toEqual({ currentSessionVersion: 1, jobStatus: null });
    });
});
