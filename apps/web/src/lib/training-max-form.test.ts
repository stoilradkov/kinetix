import { describe, expect, it } from "vitest";

import { recordTrainingMaxRequestSchema } from "@kinetix/types";

import {
    trainingMaxFormDefaults,
    trainingMaxFormSchema,
    trainingMaxRecordInput,
    type TrainingMaxFormValues,
} from "@/lib/training-max-form";

const exerciseId = "0198a4db-d8da-7000-8000-0000000000a1";

function values(overrides: Partial<TrainingMaxFormValues> = {}): TrainingMaxFormValues {
    return { ...trainingMaxFormDefaults(exerciseId), loadValue: "100", ...overrides };
}

describe("training max form mappers", () => {
    it("maps a training max into a valid record request", () => {
        const input = trainingMaxRecordInput(values());
        expect(input).toMatchObject({ exerciseId, maxType: "training_max", load: { value: 100, unit: "kg" } });
        expect(recordTrainingMaxRequestSchema.safeParse(input).success).toBe(true);
    });

    it("includes the custom label only for custom maxima and an ISO instant for a date", () => {
        const input = trainingMaxRecordInput(
            values({ maxType: "custom", customLabel: "Opener", effectiveFrom: "2026-06-01", note: "meet" }),
        );
        expect(input).toMatchObject({
            maxType: "custom",
            customLabel: "Opener",
            effectiveFrom: "2026-06-01T00:00:00.000Z",
            note: "meet",
        });
        expect(recordTrainingMaxRequestSchema.safeParse(input).success).toBe(true);
        expect(trainingMaxRecordInput(values())).not.toHaveProperty("customLabel");
    });

    it("rejects a missing custom label and a non-positive load", () => {
        expect(trainingMaxFormSchema.safeParse(values({ maxType: "custom", customLabel: "" })).success).toBe(false);
        expect(trainingMaxFormSchema.safeParse(values({ loadValue: "0" })).success).toBe(false);
    });
});
