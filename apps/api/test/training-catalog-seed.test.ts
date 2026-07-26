import { describe, expect, it } from "vitest";

import {
    CatalogSeedValidationError,
    validateTrainingCatalogSeed,
    type TrainingCatalogSeed,
} from "#src/modules/training/domain/index";
import {
    commonExerciseSeeds,
    runClassificationTagSeeds,
    trainingCatalogSeed,
} from "#src/modules/training/infrastructure/seed/training-catalog";

describe("Training catalog seed fixture", () => {
    it("contains the controlled PRD muscles, run tags, and a valid common exercise catalog", () => {
        expect(() => validateTrainingCatalogSeed(trainingCatalogSeed)).not.toThrow();
        expect(trainingCatalogSeed.muscles.map(item => item.slug)).toEqual([
            "chest",
            "back",
            "shoulders",
            "biceps",
            "triceps",
            "forearms-grip",
            "core",
            "glutes",
            "quadriceps",
            "hamstrings",
            "calves",
            "hip-flexors",
            "adductors-abductors",
            "full-body",
        ]);
        expect(runClassificationTagSeeds.map(item => item.slug)).toEqual([
            "easy",
            "recovery",
            "long",
            "tempo-threshold",
            "intervals",
            "fartlek",
            "race",
            "time-trial",
            "hill-repeats",
            "treadmill",
            "trail",
        ]);
        expect(commonExerciseSeeds.length).toBeGreaterThanOrEqual(20);
        expect(commonExerciseSeeds).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    slug: "barbell-back-squat",
                    loadModel: "external_only",
                    supportedMeasurements: ["repetitions", "external_load"],
                }),
                expect.objectContaining({
                    slug: "pull-up",
                    repetitionSemantics: "total",
                    loadModel: "full_bodyweight_plus_added_minus_assistance",
                }),
                expect.objectContaining({
                    slug: "side-plank",
                    repetitionSemantics: "per_side",
                    supportedMeasurements: ["duration"],
                }),
            ]),
        );
    });

    it("rejects normalized alias collisions and invalid load-model measurements", () => {
        const aliasCollision = {
            ...trainingCatalogSeed,
            exercises: trainingCatalogSeed.exercises.map((exercise, index) =>
                index === 1 ? { ...exercise, aliases: [" back squat "] } : exercise,
            ),
        } satisfies TrainingCatalogSeed;
        expect(() => validateTrainingCatalogSeed(aliasCollision)).toThrow(CatalogSeedValidationError);
        expect(() => validateTrainingCatalogSeed(aliasCollision)).toThrow(/normalized alias/);

        const invalidLoad = {
            ...trainingCatalogSeed,
            exercises: trainingCatalogSeed.exercises.map((exercise, index) =>
                index === 0 ? { ...exercise, supportedMeasurements: ["repetitions"] } : exercise,
            ),
        } as TrainingCatalogSeed;
        expect(() => validateTrainingCatalogSeed(invalidLoad)).toThrow(/external_only/);
    });

    it("rejects missing and overlapping muscle references", () => {
        const invalid = {
            ...trainingCatalogSeed,
            exercises: trainingCatalogSeed.exercises.map((exercise, index) =>
                index === 0
                    ? {
                          ...exercise,
                          primaryMuscleSlugs: ["quadriceps"],
                          secondaryMuscleSlugs: ["quadriceps", "not-a-muscle"],
                      }
                    : exercise,
            ),
        } as TrainingCatalogSeed;
        expect(() => validateTrainingCatalogSeed(invalid)).toThrow(/unknown secondary muscle/);
    });
});
