import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, inArray } from "drizzle-orm";

import {
    createDatabase,
    derivedMetrics,
    equipmentTypes,
    exercises,
    exerciseOccurrences,
    movementPatterns,
    performedSets,
    sessionActivities,
    trainingSessions,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { ProjectStrengthMetrics } from "#src/modules/training/application/index";
import {
    STRENGTH_DIRECT_MUSCLE_SETS,
    STRENGTH_EXTERNAL_VOLUME,
    STRENGTH_HARD_SETS,
    STRENGTH_WINDOW_FREQUENCY,
    STRENGTH_WORK_REPS,
    type ExerciseSnapshotV1,
} from "#src/modules/training/domain/index";
import { DrizzleDerivedMetricRepository } from "#src/modules/training/infrastructure/drizzle-derived-metric-repository";
import { DrizzleStrengthMetricReader } from "#src/modules/training/infrastructure/drizzle-strength-metric-reader";
import { DrizzleTrainingSessionRepository } from "#src/modules/training/infrastructure/drizzle-training-session-repository";
import type { CommandContext, UnitOfWork } from "#src/platform/application/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;

const profileId = randomUUID();
const equipmentId = randomUUID();
const movementId = randomUUID();
const exerciseId = randomUUID();
const chestId = randomUUID();
const tricepsId = randomUUID();
const sessionA = randomUUID(); // earlier session inside the rolling-7 window
const sessionB = randomUUID(); // the completed session being projected
const ctx: CommandContext = { correlationId: "a2-int", source: "user" };

function snapshot(): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Bench Press",
        equipmentTypeId: equipmentId,
        movementPatternId: movementId,
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "supine",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [
            { muscleGroupId: chestId, role: "primary" },
            { muscleGroupId: tricepsId, role: "secondary" },
        ],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
    };
}

describe.runIf(testDatabaseUrl)("strength metric projection PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const sessionRepository = new DrizzleTrainingSessionRepository(db);
    const metricRepository = new DrizzleDerivedMetricRepository(db);
    const catalog = { currentSnapshot: async () => snapshot() };
    const reader = new DrizzleStrengthMetricReader(db, sessionRepository, catalog);
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const project = new ProjectStrengthMetrics({
        unitOfWork,
        reader,
        repository: metricRepository,
        generateId: randomUUID,
    });

    async function seedSession(sessionId: string, localDate: string): Promise<void> {
        await connection.db.insert(trainingSessions).values({
            id: sessionId,
            profileId,
            status: "completed",
            localDate,
            timeZone: "UTC",
            startedAt: new Date(`${localDate}T09:00:00Z`),
            endedAt: new Date(`${localDate}T10:00:00Z`),
            version: 1,
        });
        const activityId = randomUUID();
        await connection.db
            .insert(sessionActivities)
            .values({ id: activityId, sessionId, type: "strength", position: 0 });
        const occurrenceId = randomUUID();
        await connection.db.insert(exerciseOccurrences).values({
            id: occurrenceId,
            activityId,
            exerciseId,
            exerciseSnapshot: snapshot(),
            position: 0,
        });
        await connection.db.insert(performedSets).values({
            id: randomUUID(),
            occurrenceId,
            position: 0,
            setType: "working",
            status: "completed",
            reps: 5,
            rpe: "8",
            externalLoadKg: "100",
            enteredMeasurements: { externalLoad: { value: 100, unit: "kg" } },
        });
    }

    beforeAll(async () => {
        await connection.db.insert(equipmentTypes).values({
            id: equipmentId,
            slug: `eq-${equipmentId.slice(0, 8)}`,
            name: `Equip ${equipmentId.slice(0, 8)}`,
            position: 0,
        });
        await connection.db.insert(movementPatterns).values({
            id: movementId,
            slug: `mp-${movementId.slice(0, 8)}`,
            name: `Pattern ${movementId.slice(0, 8)}`,
            position: 0,
        });
        await connection.db.insert(exercises).values({
            id: exerciseId,
            slug: `ex-${exerciseId.slice(0, 8)}`,
            name: `Bench ${exerciseId.slice(0, 8)}`,
            status: "active",
            equipmentTypeId: equipmentId,
            movementPatternId: movementId,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "supine",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            position: 0,
        });
        // No training_profiles row is seeded: the profile-config table enforces a single active profile
        // globally in the local test DB, so the reader falls back to its documented default thresholds
        // (RPE ≥ 7 / RIR ≤ 3), which the assertions below rely on.
        await seedSession(sessionA, "2026-08-07");
        await seedSession(sessionB, "2026-08-09");
    });

    afterAll(async () => {
        try {
            await connection.db.delete(derivedMetrics).where(eq(derivedMetrics.profileId, profileId));
            await connection.db.delete(trainingSessions).where(inArray(trainingSessions.id, [sessionA, sessionB]));
            await connection.db.delete(exercises).where(eq(exercises.id, exerciseId));
            await connection.db.delete(movementPatterns).where(eq(movementPatterns.id, movementId));
            await connection.db.delete(equipmentTypes).where(eq(equipmentTypes.id, equipmentId));
        } catch {
            // best-effort cleanup
        }
        await connection.client.end({ timeout: 5 });
    });

    it("projects session-scope strength metrics with input references and evidence", async () => {
        const summary = await project.recalculateForSession(sessionB, ctx);
        expect(summary.recomputed).toBeGreaterThan(0);

        const rows = await metricRepository.query({ scopeType: "session", scopeId: sessionB, limit: 200 });
        const historical = rows.filter(row => row.dimensions.basis === "historical");

        const workReps = historical.find(row => row.calculatorKey === STRENGTH_WORK_REPS);
        expect(workReps?.numericValue).toBe(5);
        expect(workReps?.profileId).toBe(profileId);

        const volume = historical.find(row => row.calculatorKey === STRENGTH_EXTERNAL_VOLUME);
        expect(volume?.numericValue).toBe(500);
        expect(volume?.unit).toBe("kg");

        const direct = historical.find(
            row => row.calculatorKey === STRENGTH_DIRECT_MUSCLE_SETS && row.dimensions.muscle === chestId,
        );
        expect(direct?.numericValue).toBe(1);

        const hard = historical.find(row => row.calculatorKey === STRENGTH_HARD_SETS);
        expect(hard?.numericValue).toBe(1);
    });

    it("projects rolling-window frequency across both window sessions", async () => {
        await project.recalculateForSession(sessionB, ctx);
        const windows = await metricRepository.query({
            scopeType: "profile-rolling-7",
            scopeId: `${profileId}:2026-08-09`,
            calculatorKey: STRENGTH_WINDOW_FREQUENCY,
            limit: 50,
        });
        const chest = windows.find(row => row.dimensions.muscle === chestId && row.dimensions.basis === "historical");
        expect(chest?.numericValue).toBe(2);
        expect(chest?.unit).toBe("sessions");
    });

    it("is idempotent on replay (unchanged fingerprint rewrites nothing)", async () => {
        await project.recalculateForSession(sessionB, ctx);
        const replay = await project.recalculateForSession(sessionB, ctx);
        expect(replay.recomputed).toBe(0);
    });
});
