import { describe, expect, it, vi } from "vitest";

import {
    type ExerciseCatalogCommands,
    type ExerciseCatalogItem,
    type TrainingExerciseCatalogPort,
} from "#src/modules/training/application/index";
import { ExerciseDefinitionController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const exerciseId = "0198a4db-d8da-7000-8000-000000000001";
const equipmentId = "0198a4db-d8da-7000-8000-000000000002";
const movementId = "0198a4db-d8da-7000-8000-000000000003";
const muscleId = "0198a4db-d8da-7000-8000-000000000004";

describe("ExerciseDefinitionController", () => {
    it("validates creation, maps the resource, and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new ExerciseDefinitionController(
            { create } as unknown as ExerciseCatalogCommands,
            catalog(),
        );

        const result = await controller.create(request(), "request-1", undefined, response);

        expect(result).toMatchObject({
            schemaVersion: 1,
            id: exerciseId,
            relationships: [],
            version: 1,
        });
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ name: "Bench Press" }),
            expect.objectContaining({ correlationId: "request-1", source: "user" }),
            undefined,
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("requires optimistic concurrency for updates", () => {
        const controller = new ExerciseDefinitionController({} as ExerciseCatalogCommands, catalog());
        expect(() =>
            controller.update(exerciseId, { notes: "changed" }, undefined, "request-2", undefined, {
                setHeader: vi.fn(),
            }),
        ).toThrow(ExpectedVersionRequiredError);
    });

    it("exposes current and historical snapshots through the public catalog port", async () => {
        const currentSnapshot = vi.fn(async () => snapshot(2, "Current"));
        const historicalSnapshot = vi.fn(async () => snapshot(1, "Original"));
        const controller = new ExerciseDefinitionController({} as ExerciseCatalogCommands, {
            ...catalog(),
            currentSnapshot,
            historicalSnapshot,
        });

        await expect(controller.currentSnapshot(exerciseId)).resolves.toMatchObject({
            exerciseVersion: 2,
            name: "Current",
        });
        await expect(controller.historicalSnapshot(exerciseId, "1")).resolves.toMatchObject({
            exerciseVersion: 1,
            name: "Original",
        });
    });
});

function catalog(): TrainingExerciseCatalogPort {
    return {
        getExercise: async () => resource(),
        resolveCurrentExercise: async () => ({
            requestedExerciseId: exerciseId,
            resolvedExerciseId: exerciseId,
            redirected: false,
            exercise: resource(),
        }),
        listExercises: async () => ({ items: [resource()], nextCursor: null }),
        resolveAlias: async () => resource(),
        currentSnapshot: async () => snapshot(1, "Bench Press"),
        historicalSnapshot: async (_id, version) => snapshot(version, "Bench Press"),
        areInAnalyticsFamily: async () => false,
    };
}

function request() {
    return {
        slug: "bench-press",
        name: "Bench Press",
        aliases: ["Flat Bench"],
        equipmentTypeId: equipmentId,
        movementPatternId: movementId,
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "supine",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [{ muscleGroupId: muscleId, role: "primary" }],
        tagIds: [],
        relationships: [],
        notes: null,
        position: 0,
    };
}

function resource(): ExerciseCatalogItem {
    const taxonomy = {
        id: equipmentId,
        slug: "barbell",
        name: "Barbell",
        position: 0,
        ownership: "seeded" as const,
        analyticsMappingStatus: "standard" as const,
    };
    return {
        id: exerciseId,
        slug: "bench-press",
        name: "Bench Press",
        aliases: ["Flat Bench"],
        status: "active",
        ownership: "user",
        forkedFromExerciseId: null,
        equipment: taxonomy,
        movementPattern: { ...taxonomy, id: movementId, slug: "horizontal-push" },
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "supine",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [
            {
                muscle: { id: muscleId, slug: "chest", name: "Chest", position: 0 },
                role: "primary",
            },
        ],
        tags: [],
        relationships: [],
        notes: null,
        version: 1,
        position: 0,
    };
}

function snapshot(version: number, name: string) {
    return {
        schemaVersion: 1 as const,
        exerciseId,
        exerciseVersion: version,
        name,
        equipmentTypeId: equipmentId,
        movementPatternId: movementId,
        classification: "compound" as const,
        laterality: "bilateral" as const,
        bodyPosition: "supine",
        repetitionSemantics: "total" as const,
        loadModel: "external_only" as const,
        supportedMeasurements: ["external_load", "repetitions"] as const,
        muscles: [{ muscleGroupId: muscleId, role: "primary" as const }],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
    };
}
