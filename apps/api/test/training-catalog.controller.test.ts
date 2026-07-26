import { describe, expect, it } from "vitest";

import { TrainingCatalogQueries, type TrainingCatalogReader } from "#src/modules/training/application/index";
import { TrainingCatalogController } from "#src/modules/training/presentation/index";

const muscle = {
    id: "0198a4db-d8da-7000-8000-000000000001",
    slug: "chest",
    name: "Chest",
    position: 0,
} as const;
const equipment = {
    id: "0198a4db-d8da-7000-8000-000000000002",
    slug: "barbell",
    name: "Barbell",
    position: 0,
    ownership: "seeded",
    analyticsMappingStatus: "standard",
} as const;
const movement = {
    ...equipment,
    id: "0198a4db-d8da-7000-8000-000000000003",
    slug: "horizontal-push",
    name: "Horizontal Push",
} as const;
const tag = {
    id: "0198a4db-d8da-7000-8000-000000000004",
    slug: "easy",
    name: "Easy",
    position: 0,
    ownership: "seeded",
    category: "run_classification",
} as const;

describe("TrainingCatalogController", () => {
    it("maps application read models to schema-versioned public contracts", async () => {
        const reader: TrainingCatalogReader = {
            listMuscles: async () => [muscle],
            listEquipment: async () => [equipment],
            listMovementPatterns: async () => [movement],
            listTags: async () => [tag],
            listExercises: async () => [
                {
                    id: "0198a4db-d8da-7000-8000-000000000005",
                    slug: "barbell-bench-press",
                    name: "Barbell Bench Press",
                    aliases: ["Bench Press"],
                    status: "active",
                    ownership: "seeded",
                    equipment,
                    movementPattern: movement,
                    classification: "compound",
                    laterality: "bilateral",
                    bodyPosition: "supine",
                    repetitionSemantics: "total",
                    loadModel: "external_only",
                    supportedMeasurements: ["repetitions", "external_load"],
                    muscles: [{ muscle, role: "primary" }],
                    tags: [],
                    notes: null,
                    version: 1,
                    position: 0,
                },
            ],
        };
        const controller = new TrainingCatalogController(new TrainingCatalogQueries(reader));

        await expect(controller.listMuscles()).resolves.toMatchObject({
            schemaVersion: 1,
            items: [{ schemaVersion: 1, slug: "chest" }],
        });
        await expect(controller.listEquipment()).resolves.toMatchObject({
            items: [{ schemaVersion: 1, ownership: "seeded" }],
        });
        await expect(controller.listTags()).resolves.toMatchObject({
            items: [{ schemaVersion: 1, category: "run_classification" }],
        });
        await expect(controller.listExercises()).resolves.toMatchObject({
            schemaVersion: 1,
            items: [
                {
                    schemaVersion: 1,
                    aliases: ["Bench Press"],
                    equipment: { schemaVersion: 1 },
                    muscles: [{ muscle: { schemaVersion: 1, slug: "chest" }, role: "primary" }],
                },
            ],
        });
    });
});
