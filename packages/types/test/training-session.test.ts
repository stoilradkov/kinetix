import { describe, expect, it } from "vitest";

import {
    addRunRequestSchema,
    addSessionActivityRequestSchema,
    completeTrainingSessionRequestSchema,
    completionPreviewResponseSchema,
    createTrainingSessionRequestSchema,
    painRecordRequestSchema,
    recordPerformedSetRequestSchema,
    reorderSessionActivitiesRequestSchema,
    runListResponseSchema,
    runningActivitySummaryResponseSchema,
    runViewResponseSchema,
    setRunningActivityRequestSchema,
    startTemplateTrainingSessionRequestSchema,
    substituteOccurrenceRequestSchema,
    trainingSessionListQuerySchema,
    trainingSessionListResponseSchema,
    trainingSessionResponseSchema,
    updatePerformedSetRequestSchema,
    updateRunRequestSchema,
    updateTrainingSessionRequestSchema,
} from "#src/index";

const uuid = "0198a4db-d8da-7000-8000-000000007001";
const activityId = "0198a4db-d8da-7000-8000-0000000070a1";

describe("training session contracts", () => {
    it("accepts a create request with readiness and activity placeholders", () => {
        const parsed = createTrainingSessionRequestSchema.parse({
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
            tags: ["Push"],
            readiness: { energy: 4, motivation: 5 },
            activities: [{ id: activityId, type: "strength", position: 0 }],
        });
        expect(parsed.readiness?.energy).toBe(4);
        expect(parsed.activities?.[0]?.type).toBe("strength");
    });

    it("rejects a readiness value outside 1-5", () => {
        expect(createTrainingSessionRequestSchema.safeParse({ readiness: { energy: 6 } }).success).toBe(false);
    });

    it("rejects unknown fields (strict envelope)", () => {
        expect(createTrainingSessionRequestSchema.safeParse({ startedAt: "2026-08-02T10:00:00.000Z" }).success).toBe(
            false,
        );
    });

    it("accepts a complete request with an explicit end and post ratings", () => {
        const parsed = completeTrainingSessionRequestSchema.parse({
            endedAt: "2026-08-02T11:30:00.000Z",
            durationMinutes: 60,
            postWorkout: { enjoyment: 5, notes: "great" },
        });
        expect(parsed.durationMinutes).toBe(60);
    });

    it("validates pain record severity range and side enum", () => {
        expect(
            painRecordRequestSchema.safeParse({ id: uuid, bodyArea: "Knee", side: "left", severity: 3 }).success,
        ).toBe(true);
        expect(
            painRecordRequestSchema.safeParse({ id: uuid, bodyArea: "Knee", side: "left", severity: 11 }).success,
        ).toBe(false);
        expect(
            painRecordRequestSchema.safeParse({ id: uuid, bodyArea: "Knee", side: "middle", severity: 3 }).success,
        ).toBe(false);
    });

    it("allows an empty update patch", () => {
        expect(updateTrainingSessionRequestSchema.parse({})).toEqual({});
    });

    it("round-trips a full detail response", () => {
        const response = {
            id: uuid,
            profileId: "0198a4db-d8da-7000-8000-0000000000d9",
            status: "completed",
            title: null,
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
            startedAt: "2026-08-02T10:00:00.000Z",
            endedAt: "2026-08-02T11:00:00.000Z",
            durationMinutes: 60,
            readiness: { energy: 4, motivation: null, fatigue: null, soreness: null, stress: null, recovery: null },
            postWorkout: {
                energy: null,
                motivation: null,
                enjoyment: 5,
                difficulty: null,
                fatigue: null,
                notes: null,
            },
            notes: null,
            tags: ["Push"],
            sourcePlannedSessionId: null,
            version: 3,
            archivedAt: null,
            createdAt: "2026-08-02T09:00:00.000Z",
            updatedAt: "2026-08-02T11:00:00.000Z",
            activities: [
                {
                    id: activityId,
                    type: "strength",
                    position: 0,
                    startedAt: null,
                    endedAt: null,
                    durationSeconds: null,
                    rpe: 8,
                    feeling: null,
                    notes: null,
                    tags: [],
                    strength: { occurrences: [], setGroups: [] },
                    running: null,
                },
            ],
            painRecords: [],
            plannedLinks: [],
            activityMappings: [],
            occurrenceMappings: [],
            setMappings: [],
            runStepMappings: [],
        };
        expect(trainingSessionResponseSchema.parse(response)).toEqual(response);
    });

    it("accepts a partial running summary and rejects an unknown metric", () => {
        const parsed = setRunningActivityRequestSchema.parse({
            activityId,
            running: { distance: { value: 5, unit: "km" }, runTags: ["easy"], indoor: true },
        });
        expect(parsed.running.distance).toEqual({ value: 5, unit: "km" });
        expect(setRunningActivityRequestSchema.safeParse({ activityId, running: { averagePace: 300 } }).success).toBe(
            false,
        );
    });

    it("round-trips a running summary response carrying a derived pace projection", () => {
        const summary = {
            activityId,
            running: {
                distance: { value: 5, unit: "km" },
                movingTime: { value: 25, unit: "min" },
                elapsedTime: null,
                averageHeartRate: 150,
                maxHeartRate: null,
                averageCadence: null,
                maxCadence: null,
                averagePower: null,
                maxPower: null,
                elevationGain: null,
                elevationLoss: null,
                calories: 0,
                strideLength: null,
                groundContactTime: null,
                verticalOscillation: null,
                vo2Max: null,
                rpe: null,
                indoor: false,
                treadmill: false,
                runTags: ["easy"],
                environment: null,
                steps: [],
                splits: [],
                zoneTimes: [],
                route: null,
                gearItemId: null,
                derivedPace: {
                    source: "distance_and_moving_time",
                    speedMetresPerSecond: "3.333333333333",
                    secondsPerKilometre: 300,
                    secondsPerMile: 482.803,
                    exclusions: [],
                },
            },
        };
        expect(runningActivitySummaryResponseSchema.parse(summary)).toEqual(summary);
    });

    it("round-trips structured running detail: steps, splits, zone times, route, and gear", () => {
        const running = {
            distance: { value: 8, unit: "km" },
            movingTime: { value: 40, unit: "min" },
            elapsedTime: null,
            averageHeartRate: null,
            maxHeartRate: null,
            averageCadence: null,
            maxCadence: null,
            averagePower: null,
            maxPower: null,
            elevationGain: null,
            elevationLoss: null,
            calories: null,
            strideLength: null,
            groundContactTime: null,
            verticalOscillation: null,
            vo2Max: null,
            rpe: null,
            indoor: false,
            treadmill: false,
            runTags: [],
            environment: null,
            steps: [
                {
                    id: uuid,
                    parentStepId: null,
                    type: "repeat",
                    position: 0,
                    repeatCount: 4,
                    measurements: {
                        distance: null,
                        duration: null,
                        averageHeartRate: null,
                        maxHeartRate: null,
                        averageCadence: null,
                        maxCadence: null,
                        averagePower: null,
                        maxPower: null,
                        elevationGain: null,
                        elevationLoss: null,
                        rpe: null,
                    },
                    notes: null,
                },
            ],
            splits: [
                {
                    id: uuid,
                    position: 0,
                    distance: { value: 1, unit: "km" },
                    movingTime: null,
                    elapsedTime: null,
                    averageHeartRate: null,
                    maxHeartRate: null,
                    averageCadence: null,
                    averagePower: null,
                    elevationGain: null,
                    elevationLoss: null,
                    notes: null,
                },
            ],
            zoneTimes: [
                {
                    id: uuid,
                    position: 0,
                    family: "heart_rate",
                    zoneDefinitionId: uuid,
                    zoneRangeId: null,
                    zoneName: "Zone 2",
                    duration: { value: 20, unit: "min" },
                },
            ],
            route: {
                schemaVersion: 1,
                ref: "strava:1",
                geometry: {
                    type: "line_string",
                    coordinates: [
                        [13.4, 52.5],
                        [13.41, 52.51],
                    ],
                },
            },
            gearItemId: uuid,
            derivedPace: {
                source: "distance_and_moving_time",
                speedMetresPerSecond: null,
                secondsPerKilometre: null,
                secondsPerMile: null,
                exclusions: [],
            },
        };
        expect(runningActivitySummaryResponseSchema.parse({ activityId, running })).toEqual({ activityId, running });
    });

    it("rejects a route geometry with fewer than two coordinates", () => {
        const request = {
            activityId,
            running: { route: { geometry: { type: "line_string", coordinates: [[13.4, 52.5]] } } },
        };
        expect(setRunningActivityRequestSchema.safeParse(request).success).toBe(false);
    });

    it("accepts start-from-template with metadata overrides", () => {
        const parsed = startTemplateTrainingSessionRequestSchema.parse({
            templateId: uuid,
            title: "Upper A",
            readiness: { energy: 4 },
        });
        expect(parsed.templateId).toBe(uuid);
    });

    it("accepts an add-activity request", () => {
        const parsed = addSessionActivityRequestSchema.parse({
            activity: { id: activityId, type: "strength", position: 2 },
        });
        expect(parsed.activity.position).toBe(2);
    });

    it("accepts a reorder request and rejects an empty list", () => {
        expect(reorderSessionActivitiesRequestSchema.parse({ activityIds: [activityId] }).activityIds).toHaveLength(1);
        expect(reorderSessionActivitiesRequestSchema.safeParse({ activityIds: [] }).success).toBe(false);
    });

    it("accepts a substitution request with a reason", () => {
        const parsed = substituteOccurrenceRequestSchema.parse({
            activityId,
            occurrenceId: uuid,
            newExerciseId: activityId,
            reason: "Left knee pain",
        });
        expect(parsed.reason).toBe("Left knee pain");
    });

    it("accepts a record-set request with an inline mapping", () => {
        const parsed = recordPerformedSetRequestSchema.parse({
            activityId,
            occurrenceId: uuid,
            set: { id: activityId, position: 0, setType: "working", status: "completed", measurements: { reps: 5 } },
            mapping: { prescribedSetId: uuid, relation: "partial", portion: "0.6" },
        });
        expect(parsed.mapping?.relation).toBe("partial");
    });

    it("accepts a partial update-set request", () => {
        const parsed = updatePerformedSetRequestSchema.parse({ status: "skipped" });
        expect(parsed.status).toBe("skipped");
    });

    it("accepts a completion-preview response", () => {
        const preview = {
            issues: [
                {
                    code: "empty_activity",
                    severity: "warning",
                    message: "No sets logged",
                    activityId,
                    occurrenceId: null,
                },
            ],
            plannedOutcomes: [
                {
                    plannedSessionId: uuid,
                    currentStatus: "planned",
                    projectedStatus: "partially_completed",
                    prescribedSetCount: 3,
                    coveredSetCount: 2,
                },
            ],
        };
        expect(completionPreviewResponseSchema.parse(preview)).toEqual(preview);
    });

    it("accepts an add-run request with structured detail and a run-step split mapping", () => {
        const stepA = "0198a4db-d8da-7000-8000-0000000070b1";
        const stepB = "0198a4db-d8da-7000-8000-0000000070b2";
        const parsed = addRunRequestSchema.parse({
            localDate: "2026-08-07",
            timeZone: "Europe/Sofia",
            title: "Tempo run",
            durationSeconds: 2_400,
            rpe: 7,
            tags: ["Long run"],
            running: {
                distance: { value: 10, unit: "km" },
                movingTime: { value: 45, unit: "min" },
                indoor: false,
                runTags: ["tempo"],
                steps: [{ id: stepA, type: "work", position: 0 }],
                splits: [{ id: stepB, position: 0, distance: { value: 1, unit: "km" } }],
            },
            mappings: {
                runStepMappings: [
                    { id: uuid, performedRunStepId: stepA, prescribedRunStepId: activityId, relation: "split" },
                ],
            },
        });
        expect(parsed.running.steps?.[0]?.type).toBe("work");
        expect(parsed.mappings?.runStepMappings?.[0]?.relation).toBe("split");
    });

    it("rejects an add-run request without a running payload", () => {
        expect(addRunRequestSchema.safeParse({ title: "No run" }).success).toBe(false);
    });

    it("accepts an update-run request replacing the running summary and mappings", () => {
        const parsed = updateRunRequestSchema.parse({
            running: { distance: { value: 5, unit: "km" } },
            mappings: {
                runStepMappings: [{ id: uuid, performedRunStepId: activityId, relation: "added" }],
            },
        });
        expect(parsed.mappings?.runStepMappings?.[0]?.relation).toBe("added");
    });

    it("accepts a run-view response with a derived pace and run-step mapping", () => {
        const view = runViewResponseSchema.parse({
            sessionId: uuid,
            version: 3,
            activityId,
            localDate: "2026-08-07",
            timeZone: "Europe/Sofia",
            status: "completed",
            title: "Tempo run",
            archivedAt: null,
            durationSeconds: 2_400,
            rpe: 7,
            feeling: null,
            notes: null,
            tags: ["Long run"],
            running: {
                distance: { value: 10, unit: "km" },
                movingTime: { value: 45, unit: "min" },
                elapsedTime: null,
                averageHeartRate: null,
                maxHeartRate: null,
                averageCadence: null,
                maxCadence: null,
                averagePower: null,
                maxPower: null,
                elevationGain: null,
                elevationLoss: null,
                calories: null,
                strideLength: null,
                groundContactTime: null,
                verticalOscillation: null,
                vo2Max: null,
                rpe: null,
                indoor: false,
                treadmill: false,
                runTags: [],
                environment: null,
                steps: [],
                splits: [],
                zoneTimes: [],
                route: null,
                gearItemId: null,
                derivedPace: {
                    source: "distance_and_moving_time",
                    speedMetresPerSecond: "3.704",
                    secondsPerKilometre: 270,
                    secondsPerMile: 435,
                    exclusions: [],
                },
            },
            activityMapping: null,
            runStepMappings: [],
            plannedLinks: [],
        });
        expect(view.running.derivedPace.secondsPerKilometre).toBe(270);
    });

    it("accepts a bounded run-list response", () => {
        const parsed = runListResponseSchema.parse({
            items: [
                {
                    sessionId: uuid,
                    activityId,
                    version: 3,
                    localDate: "2026-08-07",
                    status: "completed",
                    title: "Tempo run",
                    archivedAt: null,
                    distanceMetres: "10000.000",
                    movingTimeMs: "2700000",
                    derivedPaceSecondsPerKm: 270,
                    runTags: ["tempo"],
                },
            ],
        });
        expect(parsed.items[0]?.derivedPaceSecondsPerKm).toBe(270);
    });

    it("coerces and defaults the sessions list query params", () => {
        const parsed = trainingSessionListQuerySchema.parse({
            limit: "25",
            status: "completed",
            from: "2026-08-01",
            to: "2026-08-31",
            search: "  squat  ",
            includeArchived: "true",
        });
        expect(parsed.limit).toBe(25);
        expect(parsed.status).toBe("completed");
        expect(parsed.from).toBe("2026-08-01");
        expect(parsed.search).toBe("squat");
        expect(parsed.includeArchived).toBe(true);
    });

    it("defaults limit and treats a missing includeArchived as false", () => {
        const parsed = trainingSessionListQuerySchema.parse({});
        expect(parsed.limit).toBe(50);
        expect(parsed.includeArchived).toBe(false);
        expect(parsed.cursor).toBeUndefined();
    });

    it("rejects an out-of-range limit, an unknown status, a bad date, and unknown fields", () => {
        expect(trainingSessionListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
        expect(trainingSessionListQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
        expect(trainingSessionListQuerySchema.safeParse({ status: "archived" }).success).toBe(false);
        expect(trainingSessionListQuerySchema.safeParse({ from: "08-2026-01" }).success).toBe(false);
        expect(trainingSessionListQuerySchema.safeParse({ unexpected: "x" }).success).toBe(false);
    });

    it("carries linkage and content summary fields on list items with a nextCursor", () => {
        const parsed = trainingSessionListResponseSchema.parse({
            items: [
                {
                    id: uuid,
                    profileId: uuid,
                    status: "completed",
                    title: "Upper A",
                    localDate: "2026-08-07",
                    timeZone: "Europe/Sofia",
                    startedAt: null,
                    endedAt: null,
                    durationMinutes: null,
                    readiness: {
                        energy: null,
                        motivation: null,
                        fatigue: null,
                        soreness: null,
                        stress: null,
                        recovery: null,
                    },
                    postWorkout: {
                        energy: null,
                        motivation: null,
                        enjoyment: null,
                        difficulty: null,
                        fatigue: null,
                        notes: null,
                    },
                    notes: null,
                    tags: [],
                    sourcePlannedSessionId: null,
                    version: 2,
                    archivedAt: null,
                    createdAt: "2026-08-07T09:00:00.000Z",
                    updatedAt: "2026-08-07T10:00:00.000Z",
                    activityCount: 2,
                    painRecordCount: 0,
                    programId: uuid,
                    programName: "Hypertrophy Block",
                    activityKinds: ["strength"],
                    totalSetCount: 12,
                },
            ],
            nextCursor: "b3BhcXVl",
        });
        expect(parsed.items[0]?.programName).toBe("Hypertrophy Block");
        expect(parsed.items[0]?.totalSetCount).toBe(12);
        expect(parsed.nextCursor).toBe("b3BhcXVl");
    });

    it("defaults nextCursor to null when omitted", () => {
        const parsed = trainingSessionListResponseSchema.parse({ items: [] });
        expect(parsed.nextCursor).toBeNull();
    });
});
