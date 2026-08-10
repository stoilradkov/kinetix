import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, inArray } from "drizzle-orm";

import {
    createDatabase,
    derivedMetrics,
    findings,
    runZoneTimes,
    runningActivities,
    sessionActivities,
    trainingSessions,
    zoneDefinitions,
    zoneRanges,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { ProjectRunningMetrics, ProjectRunningRecords } from "#src/modules/training/application/index";
import {
    RECORD_RUNNING_BEST_PACE,
    RECORD_RUNNING_HIGHEST_POWER,
    RECORD_RUNNING_LONGEST_DISTANCE,
    RECORD_RUNNING_STANDARD_DISTANCE,
    RUNNING_AVERAGE_PACE,
    RUNNING_DISTANCE,
    RUNNING_EDWARDS_HR_LOAD,
    RUNNING_SESSION_RPE_LOAD,
    RUNNING_WINDOW_FREQUENCY,
    RUNNING_ZONE_TIME,
} from "#src/modules/training/domain/index";
import { DrizzleDerivedMetricRepository } from "#src/modules/training/infrastructure/drizzle-derived-metric-repository";
import { DrizzleFindingRepository } from "#src/modules/training/infrastructure/drizzle-finding-repository";
import { DrizzleRunningMetricReader } from "#src/modules/training/infrastructure/drizzle-running-metric-reader";
import { DrizzleRunningRecordsReader } from "#src/modules/training/infrastructure/drizzle-running-records-reader";
import { DrizzleTrainingSessionRepository } from "#src/modules/training/infrastructure/drizzle-training-session-repository";
import type { CommandContext, UnitOfWork } from "#src/platform/application/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;

const profileId = randomUUID();
const zoneDefinitionId = randomUUID();
const range1 = randomUUID(); // position 0 → zone 1
const range2 = randomUUID(); // position 1 → zone 2
const range3 = randomUUID(); // position 2 → zone 3
const sessionA = randomUUID(); // earlier run inside the rolling-7 window
const sessionB = randomUUID(); // the completed run being projected
const ctx: CommandContext = { correlationId: "a4-int", source: "user" };

describe.runIf(testDatabaseUrl)("running metric projection PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const sessionRepository = new DrizzleTrainingSessionRepository(db);
    const metricRepository = new DrizzleDerivedMetricRepository(db);
    const findingRepository = new DrizzleFindingRepository(db);
    const metricReader = new DrizzleRunningMetricReader(db, sessionRepository);
    const recordsReader = new DrizzleRunningRecordsReader(db);
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const projectMetrics = new ProjectRunningMetrics({
        unitOfWork,
        reader: metricReader,
        repository: metricRepository,
        generateId: randomUUID,
    });
    const projectRecords = new ProjectRunningRecords({
        unitOfWork,
        reader: recordsReader,
        repository: findingRepository,
        generateId: randomUUID,
    });

    async function seedRun(
        sessionId: string,
        localDate: string,
        run: { distanceM: string; movingTimeMs: number; averagePowerW: string; rpe: string; durationSeconds: number },
        withZones: boolean,
    ): Promise<void> {
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
        await connection.db.insert(sessionActivities).values({
            id: activityId,
            sessionId,
            type: "running",
            position: 0,
            rpe: Number(run.rpe),
            durationSeconds: run.durationSeconds,
        });
        await connection.db.insert(runningActivities).values({
            activityId,
            distanceM: run.distanceM,
            movingTimeMs: run.movingTimeMs,
            averagePowerW: run.averagePowerW,
            rpe: run.rpe,
            // distance/movingTime hydrate from the entered value/unit blob (canonical columns drive queries).
            enteredMeasurements: {
                distance: { value: Number(run.distanceM), unit: "m" },
                movingTime: { value: run.movingTimeMs, unit: "ms" },
            },
        });
        if (withZones) {
            await connection.db.insert(runZoneTimes).values([
                {
                    id: randomUUID(),
                    activityId,
                    position: 0,
                    family: "heart_rate",
                    zoneDefinitionId,
                    zoneRangeId: range1,
                    durationMs: 300_000,
                },
                {
                    id: randomUUID(),
                    activityId,
                    position: 1,
                    family: "heart_rate",
                    zoneDefinitionId,
                    zoneRangeId: range2,
                    durationMs: 600_000,
                },
                {
                    id: randomUUID(),
                    activityId,
                    position: 2,
                    family: "heart_rate",
                    zoneDefinitionId,
                    zoneRangeId: range3,
                    durationMs: 600_000,
                },
            ]);
        }
    }

    beforeAll(async () => {
        await connection.db.insert(zoneDefinitions).values({
            id: zoneDefinitionId,
            profileId,
            family: "heart_rate",
            method: "manual",
            config: {},
            source: "web",
            effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        });
        await connection.db.insert(zoneRanges).values([
            { id: range1, zoneDefinitionId, position: 0, name: "Z1", lowerBound: "100", upperBound: "120" },
            { id: range2, zoneDefinitionId, position: 1, name: "Z2", lowerBound: "120", upperBound: "140" },
            { id: range3, zoneDefinitionId, position: 2, name: "Z3", lowerBound: "140", upperBound: "160" },
        ]);
        await seedRun(
            sessionA,
            "2026-08-07",
            { distanceM: "3000", movingTimeMs: 900_000, averagePowerW: "200", rpe: "6", durationSeconds: 900 },
            false,
        );
        await seedRun(
            sessionB,
            "2026-08-09",
            { distanceM: "5000", movingTimeMs: 1_200_000, averagePowerW: "250", rpe: "8", durationSeconds: 1500 },
            true,
        );
    });

    afterAll(async () => {
        try {
            await connection.db.delete(derivedMetrics).where(eq(derivedMetrics.profileId, profileId));
            await connection.db.delete(findings).where(eq(findings.profileId, profileId));
            await connection.db.delete(trainingSessions).where(inArray(trainingSessions.id, [sessionA, sessionB]));
            await connection.db.delete(zoneDefinitions).where(eq(zoneDefinitions.id, zoneDefinitionId));
        } catch {
            // best-effort cleanup
        }
        await connection.client.end({ timeout: 5 });
    });

    it("projects session-scope running metrics, two load models, and zone time", async () => {
        const summary = await projectMetrics.recalculateForSession(sessionB, ctx);
        expect(summary.recomputed).toBeGreaterThan(0);

        const rows = await metricRepository.query({ scopeType: "session", scopeId: sessionB, limit: 200 });

        expect(rows.find(row => row.calculatorKey === RUNNING_DISTANCE)?.numericValue).toBe(5000);
        expect(rows.find(row => row.calculatorKey === RUNNING_AVERAGE_PACE)?.numericValue).toBe(240); // 1.2M ms / 5km
        expect(rows.find(row => row.calculatorKey === RUNNING_SESSION_RPE_LOAD)?.numericValue).toBe(200); // 25 min × 8
        expect(rows.find(row => row.calculatorKey === RUNNING_EDWARDS_HR_LOAD)?.numericValue).toBe(55); // 5×1+10×2+10×3
        expect(rows.filter(row => row.calculatorKey === RUNNING_ZONE_TIME)).toHaveLength(3);
        expect(rows.find(row => row.calculatorKey === RUNNING_DISTANCE)?.profileId).toBe(profileId);
    });

    it("projects rolling-window run frequency across both window sessions", async () => {
        await projectMetrics.recalculateForSession(sessionB, ctx);
        const windows = await metricRepository.query({
            scopeType: "profile-rolling-7",
            scopeId: `${profileId}:2026-08-09`,
            calculatorKey: RUNNING_WINDOW_FREQUENCY,
            limit: 50,
        });
        expect(windows[0]?.numericValue).toBe(2);
        expect(windows[0]?.unit).toBe("runs");
    });

    it("is idempotent on replay (unchanged fingerprint rewrites nothing)", async () => {
        await projectMetrics.recalculateForSession(sessionB, ctx);
        const replay = await projectMetrics.recalculateForSession(sessionB, ctx);
        expect(replay.recomputed).toBe(0);
    });

    it("projects running-record findings from the run history", async () => {
        const summary = await projectRecords.recalculateForSession(sessionB, ctx);
        expect(summary.recomputed).toBeGreaterThan(0);

        const rows = await findingRepository.query({ scopeType: "profile-running", scopeId: profileId, limit: 50 });
        expect(rows.find(row => row.findingKey === RECORD_RUNNING_LONGEST_DISTANCE)?.numericValue).toBe(5000);
        expect(rows.find(row => row.findingKey === RECORD_RUNNING_BEST_PACE)?.numericValue).toBe(240);
        expect(rows.find(row => row.findingKey === RECORD_RUNNING_HIGHEST_POWER)?.numericValue).toBe(250);
        const standard = rows.filter(row => row.findingKey === RECORD_RUNNING_STANDARD_DISTANCE);
        expect(standard).toHaveLength(1);
        expect(standard[0]!.dimensions.distance).toBe("5km");
        expect(standard[0]!.numericValue).toBe(1_200_000);
    });
});
