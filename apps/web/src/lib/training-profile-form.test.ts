import { describe, expect, it } from "vitest";

import type { TrainingProfileResponse } from "@kinetix/types";

import {
    trainingProfileCreateInput,
    trainingProfileFormDefaults,
    trainingProfileFormSchema,
    type TrainingProfileFormValues,
} from "@/lib/training-profile-form";

const profile: TrainingProfileResponse = {
    id: "0198a4db-d8da-7000-8000-0000000000b1",
    profileId: "0198a4db-d8da-7000-8000-0000000000b2",
    status: "active",
    experience: "advanced",
    oneRepMaxRepCutoff: 10,
    hardSetRpeThreshold: 7.5,
    hardSetRirThreshold: 2,
    calculatorVersion: 1,
    ruleVersion: 1,
    version: 3,
    archivedAt: null,
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
};

function values(overrides: Partial<TrainingProfileFormValues> = {}): TrainingProfileFormValues {
    return {
        experience: "beginner",
        oneRepMaxRepCutoff: "12",
        hardSetRpeThreshold: "7",
        hardSetRirThreshold: "3",
        ...overrides,
    };
}

describe("training profile form mappers", () => {
    it("defaults an existing profile and a missing one", () => {
        expect(trainingProfileFormDefaults(profile)).toMatchObject({
            experience: "advanced",
            oneRepMaxRepCutoff: "10",
            hardSetRpeThreshold: "7.5",
            hardSetRirThreshold: "2",
        });
        expect(trainingProfileFormDefaults(null)).toMatchObject({ experience: "beginner", oneRepMaxRepCutoff: "12" });
    });

    it("converts form strings to typed numbers", () => {
        expect(trainingProfileCreateInput(values({ hardSetRpeThreshold: "7.5" }))).toEqual({
            experience: "beginner",
            oneRepMaxRepCutoff: 12,
            hardSetRpeThreshold: 7.5,
            hardSetRirThreshold: 3,
        });
    });

    it("rejects out-of-range analytics settings", () => {
        expect(trainingProfileFormSchema.safeParse(values({ oneRepMaxRepCutoff: "0" })).success).toBe(false);
        expect(trainingProfileFormSchema.safeParse(values({ hardSetRpeThreshold: "7.3" })).success).toBe(false);
        expect(trainingProfileFormSchema.safeParse(values({ hardSetRirThreshold: "11" })).success).toBe(false);
        expect(trainingProfileFormSchema.safeParse(values()).success).toBe(true);
    });
});
