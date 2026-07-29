import { describe, expect, it } from "vitest";

import { createWorkoutTemplateRequestSchema, type ExerciseSnapshotV1Response } from "@kinetix/types";

import {
    emptyRunStep,
    emptySet,
    workoutTemplateCreateInput,
    workoutTemplateFormSchema,
    type WorkoutTemplateFormValues,
} from "@/lib/workout-template-form";

const snapshot: ExerciseSnapshotV1Response = {
    schemaVersion: 1,
    exerciseId: "0198a4db-d8da-7000-8000-0000000000a1",
    exerciseVersion: 1,
    name: "Back Squat",
    equipmentTypeId: "0198a4db-d8da-7000-8000-0000000000b1",
    movementPatternId: "0198a4db-d8da-7000-8000-0000000000c1",
    classification: "compound",
    laterality: "bilateral",
    bodyPosition: "standing",
    repetitionSemantics: "total",
    loadModel: "external_only",
    supportedMeasurements: ["repetitions", "external_load"],
    muscles: [],
    tagIds: [],
    analyticsFamilyExerciseIds: [],
};

function mixedValues(overrides: Partial<WorkoutTemplateFormValues> = {}): WorkoutTemplateFormValues {
    return {
        name: "Upper + Run",
        description: "",
        activities: [
            {
                type: "strength",
                notes: "",
                groupMode: "superset",
                groupRounds: "3",
                runTags: "",
                steps: [],
                exercises: [
                    {
                        exerciseId: snapshot.exerciseId,
                        name: "Back Squat",
                        snapshot,
                        sets: [{ ...emptySet(), repsMin: "5", repsMax: "5", loadKg: "100", restSec: "120" }],
                    },
                ],
            },
            {
                type: "running",
                notes: "",
                groupMode: "none",
                groupRounds: "",
                exercises: [],
                runTags: "intervals, tempo",
                steps: [{ ...emptyRunStep(), type: "work", distanceM: "400" }],
            },
        ],
        ...overrides,
    };
}

describe("workout template form mappers", () => {
    it("builds a valid mixed prescription draft with ordered activities, a superset group, sets, and run steps", () => {
        const input = workoutTemplateCreateInput(mixedValues());
        expect(createWorkoutTemplateRequestSchema.safeParse(input).success).toBe(true);

        const [strength, running] = input.prescription.activities;
        if (strength?.type !== "strength" || running?.type !== "running") throw new Error("unexpected activity order");
        expect(strength).toMatchObject({ type: "strength", position: 0 });
        expect(strength.strength.setGroups?.[0]).toMatchObject({ type: "superset", rounds: 3 });
        const set = strength.strength.exercises[0]!.sets[0]!;
        expect(set.targets).toMatchObject({ repsMin: 5, repsMax: 5, loadKgMin: "100", restMsMin: 120_000 });
        expect(set.setGroupRef).toBe("a0-grp");

        expect(running).toMatchObject({ type: "running", position: 1 });
        expect(running.running.runTags).toEqual(["intervals", "tempo"]);
        expect(running.running.steps[0]!.targets).toMatchObject({ distanceMMin: "400" });
    });

    it("omits the set group when ungrouped", () => {
        const input = workoutTemplateCreateInput(
            mixedValues({
                activities: [
                    {
                        type: "strength",
                        notes: "",
                        groupMode: "none",
                        groupRounds: "",
                        runTags: "",
                        steps: [],
                        exercises: [
                            { exerciseId: snapshot.exerciseId, name: "Back Squat", snapshot, sets: [emptySet()] },
                        ],
                    },
                ],
            }),
        );
        const activity = input.prescription.activities[0];
        if (activity?.type !== "strength") throw new Error("expected a strength activity");
        expect(activity.strength).not.toHaveProperty("setGroups");
        expect(activity.strength.exercises[0]!.sets[0]).not.toHaveProperty("setGroupRef");
    });

    it("rejects a set with both an absolute load and a percent of 1RM", () => {
        const values = mixedValues({
            activities: [
                {
                    type: "strength",
                    notes: "",
                    groupMode: "none",
                    groupRounds: "",
                    runTags: "",
                    steps: [],
                    exercises: [
                        {
                            exerciseId: snapshot.exerciseId,
                            name: "Back Squat",
                            snapshot,
                            sets: [{ ...emptySet(), loadKg: "100", percent1rm: "75" }],
                        },
                    ],
                },
            ],
        });
        expect(workoutTemplateFormSchema.safeParse(values).success).toBe(false);
    });
});
