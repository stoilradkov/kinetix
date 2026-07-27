import { describe, expect, it } from "vitest";

import { TrainingProfile, type CreateTrainingProfileInput } from "#src/modules/training/domain/index";

const ids = {
    trainingProfile: "0198a4db-d8da-7000-8000-0000000000b1",
    coreProfile: "0198a4db-d8da-7000-8000-0000000000b2",
} as const;
const now = new Date("2026-07-27T12:00:00.000Z");

function input(overrides: Partial<CreateTrainingProfileInput> = {}): CreateTrainingProfileInput {
    return { id: ids.trainingProfile, profileId: ids.coreProfile, ...overrides };
}

describe("TrainingProfile", () => {
    it("creates an active profile with design defaults", () => {
        expect(TrainingProfile.create(input(), now).state).toMatchObject({
            id: ids.trainingProfile,
            profileId: ids.coreProfile,
            status: "active",
            experience: "beginner",
            oneRepMaxRepCutoff: 12,
            hardSetRpeThreshold: 7,
            hardSetRirThreshold: 3,
            calculatorVersion: 1,
            ruleVersion: 1,
        });
    });

    it("accepts overrides within range", () => {
        expect(
            TrainingProfile.create(
                input({ experience: "advanced", oneRepMaxRepCutoff: 10, hardSetRpeThreshold: 7.5 }),
                now,
            ).state,
        ).toMatchObject({ experience: "advanced", oneRepMaxRepCutoff: 10, hardSetRpeThreshold: 7.5 });
    });

    it("rejects out-of-range analytics settings", () => {
        expect(() => TrainingProfile.create(input({ oneRepMaxRepCutoff: 0 }), now)).toThrow(/between 1 and 20/i);
        expect(() => TrainingProfile.create(input({ hardSetRpeThreshold: 7.3 }), now)).toThrow(/0.5 steps/i);
        expect(() => TrainingProfile.create(input({ hardSetRirThreshold: 11 }), now)).toThrow(/between 0 and 10/i);
        expect(() => TrainingProfile.create(input({ experience: "expert" as never }), now)).toThrow(/experience/i);
    });

    it("patches provided fields and bumps versions independently", () => {
        const later = new Date("2026-07-28T09:00:00.000Z");
        const profile = TrainingProfile.create(input(), now).update(
            { calculatorVersion: 2, experience: "intermediate" },
            later,
        );

        expect(profile.state).toMatchObject({
            calculatorVersion: 2,
            ruleVersion: 1,
            experience: "intermediate",
            updatedAt: later.toISOString(),
        });
    });

    it("archives and restores consistently and rehydrates persisted state", () => {
        const active = TrainingProfile.create(input(), now);
        const archived = active.archive(now);
        expect(archived.state).toMatchObject({ status: "archived", archivedAt: now.toISOString() });
        expect(archived.restore(now).state).toMatchObject({ status: "active", archivedAt: null });

        expect(TrainingProfile.rehydrate(active.state).state).toEqual(active.state);
        expect(() => TrainingProfile.rehydrate({ ...active.state, status: "archived", archivedAt: null })).toThrow(
            /archive state is inconsistent/i,
        );
    });
});
