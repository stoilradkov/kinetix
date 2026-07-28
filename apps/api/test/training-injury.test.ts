import { describe, expect, it } from "vitest";

import { TrainingInjury, type CreateTrainingInjuryInput } from "#src/modules/training/domain/index";

const ids = {
    injury: "0198a4db-d8da-7000-8000-0000000000e1",
    profile: "0198a4db-d8da-7000-8000-0000000000e2",
    muscle: "0198a4db-d8da-7000-8000-0000000000e3",
    exercise: "0198a4db-d8da-7000-8000-0000000000e4",
    muscle2: "0198a4db-d8da-7000-8000-0000000000e5",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function input(overrides: Partial<CreateTrainingInjuryInput> = {}): CreateTrainingInjuryInput {
    return { id: ids.injury, profileId: ids.profile, name: "Left shoulder strain", bodyArea: "shoulder", ...overrides };
}

describe("TrainingInjury", () => {
    it("creates an active injury with defaults and onset date today", () => {
        expect(TrainingInjury.create(input(), now).state).toMatchObject({
            id: ids.injury,
            profileId: ids.profile,
            name: "Left shoulder strain",
            bodyArea: "shoulder",
            side: null,
            severity: "moderate",
            status: "active",
            onsetDate: "2026-07-28",
            resolvedDate: null,
            muscleGroupIds: [],
            exerciseIds: [],
        });
    });

    it("keeps side, severity, and catalog links", () => {
        expect(
            TrainingInjury.create(
                input({
                    side: "left",
                    severity: "severe",
                    muscleGroupIds: [ids.muscle, ids.muscle2],
                    exerciseIds: [ids.exercise],
                }),
                now,
            ).state,
        ).toMatchObject({
            side: "left",
            severity: "severe",
            muscleGroupIds: [ids.muscle, ids.muscle2],
            exerciseIds: [ids.exercise],
        });
    });

    it("enforces injury invariants", () => {
        expect(() => TrainingInjury.create(input({ name: "  " }), now)).toThrow(/name is required/i);
        expect(() => TrainingInjury.create(input({ side: "top" as never }), now)).toThrow(/injury side/i);
        expect(() => TrainingInjury.create(input({ severity: "fatal" as never }), now)).toThrow(/injury severity/i);
        expect(() => TrainingInjury.create(input({ resolvedDate: "2026-08-01" }), now)).toThrow(
            /resolved date is required exactly/i,
        );
        expect(() =>
            TrainingInjury.create(
                input({ status: "resolved", onsetDate: "2026-07-10", resolvedDate: "2026-07-01" }),
                now,
            ),
        ).toThrow(/before the onset date/i);
        expect(() => TrainingInjury.create(input({ muscleGroupIds: ["not-a-uuid"] }), now)).toThrow(/UUID/i);
        expect(() => TrainingInjury.create(input({ muscleGroupIds: [ids.muscle, ids.muscle] }), now)).toThrow(
            /must be unique/i,
        );
    });

    it("resolves an injury, then reopens by clearing the resolved date", () => {
        const later = new Date("2026-08-05T09:00:00.000Z");
        const resolved = TrainingInjury.create(input(), now).update(
            { status: "resolved", resolvedDate: "2026-08-01" },
            later,
        );
        expect(resolved.state).toMatchObject({ status: "resolved", resolvedDate: "2026-08-01" });

        const reopened = resolved.update({ status: "recovering", resolvedDate: null }, later);
        expect(reopened.state).toMatchObject({ status: "recovering", resolvedDate: null });
    });

    it("rehydrates persisted state and re-validates invariants", () => {
        const state = TrainingInjury.create(input({ side: "bilateral" }), now).state;
        expect(TrainingInjury.rehydrate(state).state).toEqual(state);
        expect(() => TrainingInjury.rehydrate({ ...state, status: "resolved" })).toThrow(
            /resolved date is required exactly/i,
        );
    });
});
