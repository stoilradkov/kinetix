import { describe, expect, it } from "vitest";

import {
    exerciseCreateInput,
    exerciseFormDefaults,
    exerciseFormSchema,
    exerciseMetadataInput,
    type ExerciseFormCatalogs,
} from "@/lib/exercise-form";

const ids = {
    equipment: "0198a4db-d8da-7000-8000-000000000001",
    movement: "0198a4db-d8da-7000-8000-000000000002",
    muscle: "0198a4db-d8da-7000-8000-000000000003",
} as const;

const catalogs: ExerciseFormCatalogs = {
    equipment: [
        {
            schemaVersion: 1,
            id: ids.equipment,
            slug: "dumbbell",
            name: "Dumbbell",
            position: 0,
            ownership: "seeded",
            analyticsMappingStatus: "standard",
        },
    ],
    movementPatterns: [
        {
            schemaVersion: 1,
            id: ids.movement,
            slug: "squat",
            name: "Squat",
            position: 0,
            ownership: "seeded",
            analyticsMappingStatus: "standard",
        },
    ],
    muscles: [
        {
            schemaVersion: 1,
            id: ids.muscle,
            slug: "quadriceps",
            name: "Quadriceps",
            position: 0,
        },
    ],
};

describe("exercise form schema", () => {
    it("validates and maps a complete create form through the shared contract", () => {
        const values = {
            ...exerciseFormDefaults(undefined, catalogs),
            slug: "tempo-goblet-squat",
            name: "Tempo Goblet Squat",
            aliases: "Goblet Tempo Squat, Slow Goblet Squat",
            notes: "Three-second eccentric",
            position: 4,
        };

        expect(exerciseFormSchema.safeParse(values).success).toBe(true);
        expect(exerciseCreateInput(values)).toEqual({
            slug: "tempo-goblet-squat",
            name: "Tempo Goblet Squat",
            aliases: ["Goblet Tempo Squat", "Slow Goblet Squat"],
            equipmentTypeId: ids.equipment,
            movementPatternId: ids.movement,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "standing",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            muscles: [{ muscleGroupId: ids.muscle, role: "primary" }],
            tagIds: [],
            relationships: [],
            notes: "Three-second eccentric",
            position: 4,
        });
    });

    it("surfaces field errors for malformed and contract-incompatible values", () => {
        const result = exerciseFormSchema.safeParse({
            ...exerciseFormDefaults(undefined, catalogs),
            slug: "Tempo Squat",
            name: "Tempo Squat",
            aliases: " tempo   squat ",
            supportedMeasurements: "repetitions",
            position: -1,
        });

        expect(result.success).toBe(false);
        if (result.success) return;

        expect(result.error.issues.map(issue => issue.path[0])).toEqual(
            expect.arrayContaining(["slug", "aliases", "supportedMeasurements", "position"]),
        );
    });

    it("maps an empty notes field to null for version updates", () => {
        const values = {
            ...exerciseFormDefaults(undefined, catalogs),
            slug: "goblet-squat",
            name: "Goblet Squat",
            notes: "",
        };

        expect(exerciseMetadataInput(values).notes).toBeNull();
    });
});
