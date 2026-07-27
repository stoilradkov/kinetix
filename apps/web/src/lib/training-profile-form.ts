import {
    trainingExperienceSchema,
    type CreateTrainingProfileRequest,
    type TrainingProfileResponse,
    type UpdateTrainingProfileRequest,
} from "@kinetix/types";
import { z } from "zod";

function integerField(min: number, max: number, message: string) {
    return z
        .string()
        .trim()
        .refine(value => {
            const parsed = Number(value);
            return value !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max;
        }, message);
}

export const trainingProfileFormSchema = z.object({
    experience: trainingExperienceSchema,
    oneRepMaxRepCutoff: integerField(1, 20, "Enter a whole number between 1 and 20"),
    hardSetRpeThreshold: z
        .string()
        .trim()
        .refine(value => {
            const parsed = Number(value);
            return value !== "" && parsed >= 0 && parsed <= 10 && Math.round(parsed * 2) === parsed * 2;
        }, "Enter a value between 0 and 10 in 0.5 steps"),
    hardSetRirThreshold: integerField(0, 10, "Enter a whole number between 0 and 10"),
});

export type TrainingProfileFormValues = z.infer<typeof trainingProfileFormSchema>;

export function trainingProfileFormDefaults(profile?: TrainingProfileResponse | null): TrainingProfileFormValues {
    return {
        experience: profile?.experience ?? "beginner",
        oneRepMaxRepCutoff: String(profile?.oneRepMaxRepCutoff ?? 12),
        hardSetRpeThreshold: String(profile?.hardSetRpeThreshold ?? 7),
        hardSetRirThreshold: String(profile?.hardSetRirThreshold ?? 3),
    };
}

function toRequest(values: TrainingProfileFormValues) {
    return {
        experience: values.experience,
        oneRepMaxRepCutoff: Number(values.oneRepMaxRepCutoff),
        hardSetRpeThreshold: Number(values.hardSetRpeThreshold),
        hardSetRirThreshold: Number(values.hardSetRirThreshold),
    };
}

export function trainingProfileCreateInput(values: TrainingProfileFormValues): CreateTrainingProfileRequest {
    return toRequest(values);
}

export function trainingProfileUpdateInput(values: TrainingProfileFormValues): UpdateTrainingProfileRequest {
    return toRequest(values);
}
