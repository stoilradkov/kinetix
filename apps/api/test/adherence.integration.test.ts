import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import {
    adherenceResults,
    createDatabase,
    plannedSessions,
    sessionMappings,
    sessionPrescriptions,
    trainingSessions,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import type { AdherenceResultRecord } from "#src/modules/training/application/index";
import { DrizzleAdherenceInputReader } from "#src/modules/training/infrastructure/drizzle-adherence-input-reader";
import { DrizzleAdherenceResultRepository } from "#src/modules/training/infrastructure/drizzle-adherence-result-repository";
import { DrizzleTrainingSessionRepository } from "#src/modules/training/infrastructure/drizzle-training-session-repository";
import { DrizzleSessionPrescriptionRepository } from "#src/modules/training/infrastructure/drizzle-session-prescription-repository";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-08-09T09:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000ad001";
const sessionId = "0198a4db-d8da-7000-8000-0000000ad002";
const otherSessionId = "0198a4db-d8da-7000-8000-0000000ad003";
const sourcePrescriptionId = "0198a4db-d8da-7000-8000-0000000ad004";
const resolvedPrescriptionId = "0198a4db-d8da-7000-8000-0000000ad005";
const plannedSessionId = "0198a4db-d8da-7000-8000-0000000ad006";
const fpA = "a".repeat(64);
const fpB = "b".repeat(64);

function record(id: string, fingerprint: string, overall: number): AdherenceResultRecord {
    return {
        id,
        profileId,
        trainingSessionId: sessionId,
        trainingSessionVersion: 2,
        plannedSessionId,
        sourcePrescriptionId,
        resolvedPrescriptionId,
        formula: "adherence.overall.v1",
        scope: "strength",
        overall,
        sourceFingerprint: fingerprint,
        exclusions: ["missing_target"],
        calculatedAt: now,
        components: [
            {
                key: "reps",
                scope: "strength",
                score: 80,
                weight: 20,
                included: true,
                exclusion: null,
                inputs: { actualTotal: 8, targetLow: 10, targetHigh: 10 },
                position: 0,
            },
            {
                key: "load",
                scope: "strength",
                score: null,
                weight: 15,
                included: false,
                exclusion: "missing_target",
                inputs: {},
                position: 1,
            },
        ],
    };
}

describe.runIf(testDatabaseUrl)("adherence PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleAdherenceResultRepository(connection as unknown as DatabaseService);
    const reader = new DrizzleAdherenceInputReader(
        connection as unknown as DatabaseService,
        new DrizzleTrainingSessionRepository(connection as unknown as DatabaseService),
        new DrizzleSessionPrescriptionRepository(connection as unknown as DatabaseService),
    );

    beforeAll(async () => {
        // Prescriptions are immutable (a DB trigger forbids UPDATE/DELETE), so seed idempotently and
        // never delete them — a repeated run reuses the same rows.
        await connection.db
            .insert(sessionPrescriptions)
            .values([
                { id: sourcePrescriptionId, kind: "planned" },
                { id: resolvedPrescriptionId, kind: "resolved_execution" },
            ])
            .onConflictDoNothing();
        await connection.db
            .insert(plannedSessions)
            .values({ id: plannedSessionId, profileId, currentPrescriptionId: sourcePrescriptionId })
            .onConflictDoNothing();
        await connection.db
            .insert(trainingSessions)
            .values([
                { id: sessionId, profileId, localDate: "2026-08-09", timeZone: "UTC" },
                { id: otherSessionId, profileId, localDate: "2026-08-09", timeZone: "UTC" },
            ])
            .onConflictDoNothing();
        await connection.db
            .insert(sessionMappings)
            .values({ sessionId, plannedSessionId, sourcePrescriptionId, resolvedPrescriptionId })
            .onConflictDoNothing();
    });

    afterEach(async () => {
        await connection.db.delete(adherenceResults).where(eq(adherenceResults.trainingSessionId, sessionId));
    });

    afterAll(async () => {
        await connection.db.delete(sessionMappings).where(eq(sessionMappings.sessionId, sessionId));
        await connection.db.delete(trainingSessions).where(eq(trainingSessions.profileId, profileId));
        await connection.db.delete(plannedSessions).where(eq(plannedSessions.id, plannedSessionId));
    });

    it("persists a result with its components, inputs, and exclusions", async () => {
        await connection.db.transaction(async tx => {
            await repository.replaceForSession(
                sessionId,
                [record("0198a4db-d8da-7000-8000-0000000ad101", fpA, 92.5)],
                tx,
            );
        });
        const results = await repository.readForSession(sessionId);
        expect(results).toHaveLength(1);
        expect(results[0]!.overall).toBe(92.5);
        expect(results[0]!.sourceFingerprint).toBe(fpA);
        expect(results[0]!.exclusions).toEqual(["missing_target"]);
        expect(results[0]!.components).toHaveLength(2);
        const load = results[0]!.components.find(c => c.key === "load")!;
        expect(load.included).toBe(false);
        expect(load.score).toBeNull();
        expect(results[0]!.components.find(c => c.key === "reps")!.inputs).toMatchObject({ actualTotal: 8 });
    });

    it("supersedes the current result and keeps at most one current row per resolved prescription", async () => {
        await connection.db.transaction(async tx => {
            await repository.replaceForSession(
                sessionId,
                [record("0198a4db-d8da-7000-8000-0000000ad111", fpA, 90)],
                tx,
            );
        });
        await connection.db.transaction(async tx => {
            await repository.replaceForSession(
                sessionId,
                [record("0198a4db-d8da-7000-8000-0000000ad112", fpB, 70)],
                tx,
            );
        });

        const current = await repository.readForSession(sessionId);
        expect(current).toHaveLength(1);
        expect(current[0]!.overall).toBe(70);
        expect(current[0]!.sourceFingerprint).toBe(fpB);

        const allRows = await connection.db
            .select({ state: adherenceResults.state })
            .from(adherenceResults)
            .where(eq(adherenceResults.trainingSessionId, sessionId));
        expect(allRows).toHaveLength(2); // one superseded + one current
        expect(allRows.filter(row => row.state === "current")).toHaveLength(1);
        expect(allRows.filter(row => row.state === "superseded")).toHaveLength(1);
    });

    it("reports the current fingerprint keyed by resolved prescription", async () => {
        await connection.db.transaction(async tx => {
            await repository.replaceForSession(
                sessionId,
                [record("0198a4db-d8da-7000-8000-0000000ad121", fpA, 88)],
                tx,
            );
        });
        const fingerprints = await repository.currentFingerprints(sessionId);
        expect(fingerprints.get(resolvedPrescriptionId)).toBe(fpA);
    });

    it("finds the actual sessions mapped to a planned session via the read adapter", async () => {
        const sessions = await reader.findSessionIdsForPlan(plannedSessionId);
        expect(sessions).toEqual([sessionId]);
    });

    it("loads bounded inputs (session, mappings, resolved trees) for a session", async () => {
        const inputs = await reader.loadInputs(sessionId);
        expect(inputs).not.toBeNull();
        expect(inputs!.plannedLinks).toHaveLength(1);
        expect(inputs!.plannedLinks[0]!.resolvedPrescriptionId).toBe(resolvedPrescriptionId);
        expect(inputs!.resolvedPrescriptions.get(resolvedPrescriptionId)?.kind).toBe("resolved_execution");
    });
});
