import { describe, expect, it } from "vitest";

import { buildCanonicalExerciseReview, canonicalizeSourceExerciseName } from "#src/exercise-canonicalization";
import type { ExerciseCatalogSnapshot, SourceExercise } from "#src/model";

describe("exercise canonicalization", () => {
    it("consolidates spelling and equipment aliases", () => {
        expect(canonicalizeSourceExerciseName("DB incline bench")).toBe("dumbbell incline bench press");
        expect(canonicalizeSourceExerciseName("Pulldown wide grip")).toBe("cable lat pulldown");
        expect(canonicalizeSourceExerciseName("Overhead tricep extensions")).toBe("overhead triceps extension");
        expect(canonicalizeSourceExerciseName("Face pulls")).toBe("cable face pull");
        expect(canonicalizeSourceExerciseName("Rope Triceps pushdown")).toBe("cable triceps pushdown");
    });

    it("separates catalog resolutions from normalized custom proposals", () => {
        const catalog: ExerciseCatalogSnapshot = {
            schemaVersion: 1,
            items: [
                {
                    id: "cba43743-94cd-46e9-b104-67e130642dd8",
                    slug: "barbell-bench-press",
                    name: "Barbell Bench Press",
                    aliases: ["Bench Press"],
                    ownership: "seeded",
                    equipment: null,
                    movementPattern: null,
                    repetitionSemantics: "total",
                    loadModel: "external_only",
                    supportedMeasurements: ["repetitions", "external_load"],
                },
            ],
        };
        const result = buildCanonicalExerciseReview([exercise("Bench press"), exercise("DB incline bench")], catalog);

        expect(result.map(item => [item.canonicalName, item.status])).toEqual([
            ["barbell bench press", "catalog"],
            ["dumbbell incline bench press", "proposed"],
        ]);
    });
});

function exercise(rawName: string): SourceExercise {
    return {
        sheet: "Program",
        row: 1,
        blockColumn: 1,
        nameCell: "A1",
        performanceCell: "F1",
        rawName,
        muscleTags: null,
        prescribedSets: null,
        prescribedReps: null,
        rawPerformance: "10 x 5",
        rawEffort: 2,
        mappedRpe: 6,
        effortNeedsMaxReview: false,
        excludedByPolicy: false,
        exclusionReason: null,
        parsedPerformance: { raw: "10 x 5", sets: [], errors: [] },
    };
}
