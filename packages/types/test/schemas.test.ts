import { describe, expect, it } from "vitest";

import {
    apiErrorSchema,
    createExerciseRequestSchema,
    distanceSchema,
    durationSchema,
    exerciseCatalogListResponseSchema,
    exerciseSnapshotV1Schema,
    jobResourceSchema,
    massSchema,
    paceSchema,
    restoreRevisionRequestSchema,
    revisionHistoryResponseSchema,
    rpeSchema,
} from "#src/index";

describe("measurement schemas", () => {
    it("accepts every public unit", () => {
        expect(massSchema.parse({ value: 10, unit: "lb" })).toEqual({ value: 10, unit: "lb" });
        for (const unit of ["m", "cm", "km", "mi"] as const)
            expect(distanceSchema.safeParse({ value: 1, unit }).success).toBe(true);
        for (const unit of ["ms", "s", "min", "h"] as const)
            expect(durationSchema.safeParse({ value: 1, unit }).success).toBe(true);
        expect(paceSchema.safeParse({ value: 5, unit: "min/km" }).success).toBe(true);
    });

    it("rejects invalid values and effort increments", () => {
        expect(massSchema.safeParse({ value: Number.NaN, unit: "kg" }).success).toBe(false);
        expect(distanceSchema.safeParse({ value: -1, unit: "m" }).success).toBe(false);
        expect(rpeSchema.safeParse(7.25).success).toBe(false);
        expect(rpeSchema.safeParse(7.5).success).toBe(true);
    });
});

describe("revision schemas", () => {
    it("requires a public resource and ETag for every history item", () => {
        expect(
            revisionHistoryResponseSchema.parse({
                items: [
                    {
                        version: 2,
                        etag: '"2"',
                        schemaVersion: 1,
                        source: "user",
                        actorId: null,
                        reason: null,
                        summary: "Renamed program",
                        correlationId: "request-1",
                        createdAt: "2026-07-26T12:00:00.000Z",
                        resource: { name: "Base" },
                    },
                ],
                nextCursor: null,
            }),
        ).toMatchObject({ items: [{ etag: '"2"', resource: { name: "Base" } }] });
        expect(
            revisionHistoryResponseSchema.safeParse({
                items: [
                    {
                        version: 2,
                        etag: '"2"',
                        schemaVersion: 1,
                        source: "user",
                        actorId: null,
                        reason: null,
                        summary: "Missing public resource",
                        correlationId: "request-1",
                        createdAt: "2026-07-26T12:00:00.000Z",
                    },
                ],
                nextCursor: null,
            }).success,
        ).toBe(false);
    });

    it("accepts only restore metadata because the target version is in the route", () => {
        expect(restoreRevisionRequestSchema.parse({ reason: " undo " })).toEqual({ reason: "undo" });
        expect(restoreRevisionRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    });
});

describe("API error schemas", () => {
    it("accepts stable version and validation envelopes", () => {
        expect(
            apiErrorSchema.parse({
                code: "VERSION_CONFLICT",
                message: "Expected version 2, current version 3",
                correlationId: "request-1",
                currentVersion: 3,
                etag: '"3"',
            }),
        ).toMatchObject({ code: "VERSION_CONFLICT", currentVersion: 3 });
        expect(
            apiErrorSchema.parse({
                code: "VALIDATION_FAILED",
                message: "Request validation failed",
                correlationId: "request-2",
                fieldErrors: { name: ["Name is required"] },
            }),
        ).toMatchObject({ fieldErrors: { name: ["Name is required"] } });
    });
});

describe("job resource schemas", () => {
    it("accepts safe status resources and rejects queue payloads", () => {
        const resource = {
            id: "0198a4db-d8da-7000-8000-000000000001",
            type: "training.analytics.recalculate",
            version: 1,
            state: "running",
            attempts: 1,
            maxAttempts: 5,
            progress: { completed: 2, total: 4, percentage: 50 },
            error: null,
            correlationId: "request-1",
            createdAt: "2026-07-26T12:00:00.000Z",
            startedAt: "2026-07-26T12:00:01.000Z",
            nextAttemptAt: "2026-07-26T12:00:00.000Z",
            completedAt: null,
            updatedAt: "2026-07-26T12:00:02.000Z",
        };

        expect(jobResourceSchema.parse(resource)).toEqual(resource);
        expect(jobResourceSchema.safeParse({ ...resource, payload: { secret: true } }).success).toBe(false);
    });
});

describe("Training catalog schemas", () => {
    it("requires schema versions and structured exercise metadata", () => {
        const taxonomy = {
            schemaVersion: 1,
            id: "0198a4db-d8da-7000-8000-000000000001",
            slug: "barbell",
            name: "Barbell",
            position: 0,
            ownership: "seeded",
            analyticsMappingStatus: "standard",
        } as const;
        expect(
            exerciseCatalogListResponseSchema.safeParse({
                schemaVersion: 1,
                items: [
                    {
                        schemaVersion: 1,
                        id: "0198a4db-d8da-7000-8000-000000000002",
                        slug: "barbell-bench-press",
                        name: "Barbell Bench Press",
                        aliases: ["Bench Press"],
                        status: "active",
                        ownership: "seeded",
                        equipment: taxonomy,
                        movementPattern: { ...taxonomy, slug: "horizontal-push", name: "Horizontal Push" },
                        classification: "compound",
                        laterality: "bilateral",
                        bodyPosition: "supine",
                        repetitionSemantics: "total",
                        loadModel: "external_only",
                        supportedMeasurements: ["repetitions", "external_load"],
                        muscles: [],
                        tags: [],
                        notes: null,
                        version: 1,
                        position: 0,
                    },
                ],
            }).success,
        ).toBe(true);
        expect(exerciseCatalogListResponseSchema.safeParse({ items: [] }).success).toBe(false);
    });

    it("validates editable exercise definitions and versioned snapshots", () => {
        const input = {
            slug: "bench-press",
            name: "Bench Press",
            aliases: ["Flat Bench"],
            equipmentTypeId: "0198a4db-d8da-7000-8000-000000000001",
            movementPatternId: "0198a4db-d8da-7000-8000-000000000002",
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "supine",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            muscles: [
                {
                    muscleGroupId: "0198a4db-d8da-7000-8000-000000000003",
                    role: "primary",
                },
            ],
            tagIds: [],
            relationships: [
                {
                    targetExerciseId: "0198a4db-d8da-7000-8000-000000000004",
                    type: "analytics_family",
                },
            ],
            notes: null,
            position: 0,
        } as const;
        expect(createExerciseRequestSchema.safeParse(input).success).toBe(true);
        expect(
            createExerciseRequestSchema.safeParse({
                ...input,
                aliases: [" BENCH PRESS "],
            }).success,
        ).toBe(false);
        expect(
            createExerciseRequestSchema.safeParse({
                ...input,
                supportedMeasurements: ["repetitions"],
            }).success,
        ).toBe(false);

        expect(
            exerciseSnapshotV1Schema.safeParse({
                schemaVersion: 1,
                exerciseId: "0198a4db-d8da-7000-8000-000000000005",
                exerciseVersion: 2,
                name: input.name,
                equipmentTypeId: input.equipmentTypeId,
                movementPatternId: input.movementPatternId,
                classification: input.classification,
                laterality: input.laterality,
                bodyPosition: input.bodyPosition,
                repetitionSemantics: input.repetitionSemantics,
                loadModel: input.loadModel,
                supportedMeasurements: input.supportedMeasurements,
                muscles: input.muscles,
                tagIds: [],
                analyticsFamilyExerciseIds: [input.relationships[0].targetExerciseId],
            }).success,
        ).toBe(true);
    });
});

import { healthResponseSchema } from "#src/index";

describe("healthResponseSchema", () => {
    it("preserves the health wire contract", () => {
        expect(
            healthResponseSchema.parse({
                status: "ok",
                service: "kinetix-api",
                timestamp: "2026-07-12T12:00:00.000Z",
            }),
        ).toMatchObject({ status: "ok", service: "kinetix-api" });
    });
});
