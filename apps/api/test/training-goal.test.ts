import { describe, expect, it } from "vitest";

import { TrainingGoal, type CreateTrainingGoalInput } from "#src/modules/training/domain/index";

const ids = {
    goal: "0198a4db-d8da-7000-8000-0000000000d1",
    profile: "0198a4db-d8da-7000-8000-0000000000d2",
    program: "0198a4db-d8da-7000-8000-0000000000d3",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function input(overrides: Partial<CreateTrainingGoalInput> = {}): CreateTrainingGoalInput {
    return { id: ids.goal, profileId: ids.profile, type: "strength", ...overrides };
}

describe("TrainingGoal", () => {
    it("creates an active goal defaulting the start date to today", () => {
        expect(TrainingGoal.create(input(), now).state).toMatchObject({
            id: ids.goal,
            profileId: ids.profile,
            type: "strength",
            status: "active",
            startDate: "2026-07-28",
            priority: 1,
            targetValue: null,
            targetUnit: null,
            targetDate: null,
            programId: null,
        });
    });

    it("keeps target value/unit and an optional program link", () => {
        expect(
            TrainingGoal.create(
                input({
                    targetValue: "100",
                    targetUnit: "kg",
                    targetDate: "2026-12-31",
                    priority: 2,
                    programId: ids.program,
                }),
                now,
            ).state,
        ).toMatchObject({
            targetValue: "100",
            targetUnit: "kg",
            targetDate: "2026-12-31",
            priority: 2,
            programId: ids.program,
        });
    });

    it("enforces goal invariants", () => {
        expect(() => TrainingGoal.create(input({ targetValue: "100" }), now)).toThrow(/set together/i);
        expect(() => TrainingGoal.create(input({ targetDate: "2026-07-01", startDate: "2026-07-15" }), now)).toThrow(
            /before the start date/i,
        );
        expect(() => TrainingGoal.create(input({ priority: 0 }), now)).toThrow(/between 1 and 1000/i);
        expect(() => TrainingGoal.create(input({ type: "cardio" as never }), now)).toThrow(/goal type/i);
        expect(() => TrainingGoal.create(input({ targetDate: "2026-02-30" }), now)).toThrow(/real calendar date/i);
    });

    it("patches fields, transitions status, and clears optionals with null", () => {
        const later = new Date("2026-07-29T09:00:00.000Z");
        const goal = TrainingGoal.create(input({ targetValue: "100", targetUnit: "kg" }), now).update(
            { status: "achieved", targetValue: null, targetUnit: null, notes: "done" },
            later,
        );

        expect(goal.state).toMatchObject({
            status: "achieved",
            targetValue: null,
            targetUnit: null,
            notes: "done",
            updatedAt: later.toISOString(),
        });
    });

    it("rehydrates persisted state and re-validates invariants", () => {
        const state = TrainingGoal.create(input(), now).state;
        expect(TrainingGoal.rehydrate(state).state).toEqual(state);
        expect(() => TrainingGoal.rehydrate({ ...state, targetValue: "50", targetUnit: null })).toThrow(
            /set together/i,
        );
    });
});
