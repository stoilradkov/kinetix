import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, inArray } from "drizzle-orm";

import {
    createDatabase,
    derivedMetrics,
    equipmentTypes,
    exercises,
    exerciseOccurrences,
    findings,
    movementPatterns,
    performedSets,
    sessionActivities,
    trainingSessions,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { ProjectPersonalRecords, ProjectStrengthMetrics } from "#src/modules/training/application/index";
import {
    ESTIMATED_1RM_PRIMARY,
    RECORD_ESTIMATED_1RM,
    RECORD_EXERCISE_VOLUME,
    RECORD_MAX_LOAD,
    RECORD_REP_MAX_AT_LOAD,
    RECORD_SCOPE_EXERCISE,
    type ExerciseSnapshotV1,
} from "#src/modules/training/domain/index";
import { DrizzleDerivedMetricRepository } from "#src/modules/training/infrastructure/drizzle-derived-metric-repository";
import { DrizzleFindingRepository } from "#src/modules/training/infrastructure/drizzle-finding-repository";
import { DrizzlePersonalRecordsReader } from "#src/modules/training/infrastructure/drizzle-personal-records-reader";
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
const sessionLight = randomUUID(); // 100 kg × 5
const sessionHeavy = randomUUID(); // 140 kg × 3
const ctx: CommandContext = { correlationId: "a3-int", source: "user" };

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

describe.runIf(testDatabaseUrl)("estimated 1RM + personal records PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const sessionRepository = new DrizzleTrainingSessionRepository(db);
    const metricRepository = new DrizzleDerivedMetricRepository(db);
    const findingRepository = new DrizzleFindingRepository(db);
    const catalog = { currentSnapshot: async () => snapshot() };
    const metricReader = new DrizzleStrengthMetricReader(db, sessionRepository, catalog);
    const recordsReader = new DrizzlePersonalRecordsReader(db, sessionRepository);
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const projectMetrics = new ProjectStrengthMetrics({
        unitOfWork,
        reader: metricReader,
        repository: metricRepository,
        generateId: randomUUID,
    });
    const projectRecords = new ProjectPersonalRecords({
        unitOfWork,
        reader: recordsReader,
        repository: findingRepository,
        generateId: randomUUID,
    });

    async function seedSession(sessionId: string, localDate: string, loadKg: number, reps: number): Promise<void> {
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
            reps,
            externalLoadKg: String(loadKg),
            enteredMeasurements: { externalLoad: { value: loadKg, unit: "kg" } },
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
        await seedSession(sessionLight, "2026-08-07", 100, 5);
        await seedSession(sessionHeavy, "2026-08-09", 140, 3);
    });

    afterAll(async () => {
        try {
            await connection.db.delete(findings).where(eq(findings.profileId, profileId));
            await connection.db.delete(derivedMetrics).where(eq(derivedMetrics.profileId, profileId));
            await connection.db
                .delete(trainingSessions)
                .where(inArray(trainingSessions.id, [sessionLight, sessionHeavy]));
            await connection.db.delete(exercises).where(eq(exercises.id, exerciseId));
            await connection.db.delete(movementPatterns).where(eq(movementPatterns.id, movementId));
            await connection.db.delete(equipmentTypes).where(eq(equipmentTypes.id, equipmentId));
        } catch {
            // best-effort cleanup
        }
        await connection.client.end({ timeout: 5 });
    });

    it("projects the primary estimated 1RM per exercise with every formula in evidence", async () => {
        const summary = await projectMetrics.recalculateForSession(sessionHeavy, ctx);
        expect(summary.recomputed).toBeGreaterThan(0);

        const rows = await metricRepository.query({
            scopeType: "session",
            scopeId: sessionHeavy,
            calculatorKey: ESTIMATED_1RM_PRIMARY,
            limit: 50,
        });
        const historical = rows.find(row => row.dimensions.basis === "historical");
        expect(historical?.numericValue).toBe(153.29); // 140 kg × 3 primary median
        expect(historical?.unit).toBe("kg");
        expect(historical?.details.formulas).toMatchObject({ epley: 154, brzycki: 148.24 });
    });

    it("projects the four personal-record types over the profile history", async () => {
        const summary = await projectRecords.recalculateForSession(sessionHeavy, ctx);
        expect(summary.recomputed).toBeGreaterThan(0);

        const rows = await findingRepository.query({
            scopeType: RECORD_SCOPE_EXERCISE,
            scopeId: `${profileId}:${exerciseId}`,
            limit: 200,
        });
        expect(rows.find(row => row.findingKey === RECORD_MAX_LOAD)?.numericValue).toBe(140);
        expect(rows.find(row => row.findingKey === RECORD_ESTIMATED_1RM)?.numericValue).toBe(153.29);
        expect(rows.find(row => row.findingKey === RECORD_EXERCISE_VOLUME)?.numericValue).toBe(500); // 100 × 5 session
        const repMax100 = rows.find(
            row => row.findingKey === RECORD_REP_MAX_AT_LOAD && row.dimensions.load === "100.00",
        );
        expect(repMax100?.numericValue).toBe(5);
    });

    it("is deterministic on replay (unchanged records rewrite nothing)", async () => {
        await projectRecords.recalculateForSession(sessionHeavy, ctx);
        const replay = await projectRecords.recalculateForSession(sessionHeavy, ctx);
        expect(replay.recomputed).toBe(0);
        expect(replay.retired).toBe(0);
    });
});
