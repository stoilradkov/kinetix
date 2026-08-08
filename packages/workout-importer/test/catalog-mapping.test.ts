import { describe, expect, it } from "vitest";

import { buildExerciseMappingReview, normalizeGeneralExerciseName } from "#src/catalog-mapping";
import type { ExerciseCatalogSnapshot, SourceExercise } from "#src/model";

describe("catalog mapping review", () => {
    it("normalizes common historical abbreviations", () => {
        expect(normalizeGeneralExerciseName("DB OHP")).toBe("dumbbell overhead press");
        expect(normalizeGeneralExerciseName("RDL")).toBe("romanian deadlift");
        expect(normalizeGeneralExerciseName("Chest push mashine")).toBe("chest push machine");
    });

    it("recommends the unique standard seeded exercise when exact catalog duplicates exist", () => {
        const catalog: ExerciseCatalogSnapshot = {
            schemaVersion: 1,
            items: [
                exercise("seed", "barbell-bench-press", "Barbell Bench Press", "seeded", ["Bench Press"], "standard"),
                exercise("user", "bench-user", "Bench Press", "user", [], "unmapped"),
            ],
        };
        const review = buildExerciseMappingReview([sourceExercise("Bench press")], catalog);
        expect(review[0]).toMatchObject({ status: "ambiguous", recommendedExerciseId: "seed" });
    });
});

function exercise(
    id: string,
    slug: string,
    name: string,
    ownership: "seeded" | "user",
    aliases: string[],
    analyticsMappingStatus: string,
) {
    return {
        id,
        slug,
        name,
        aliases,
        ownership,
        equipment: { name: "Barbell", analyticsMappingStatus },
        movementPattern: { name: "Push", analyticsMappingStatus },
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
    };
}

function sourceExercise(rawName: string): SourceExercise {
    return {
        sheet: "Program",
        row: 1,
        blockColumn: 1,
        nameCell: "A1",
        performanceCell: "F1",
        rawName,
        muscleTags: null,
        prescribedSets: 3,
        prescribedReps: "6-8",
        rawPerformance: "50 x 6 6 6",
        rawEffort: 2,
        mappedRpe: 6,
        effortNeedsMaxReview: false,
        excludedByPolicy: false,
        exclusionReason: null,
        parsedPerformance: null,
    };
}
