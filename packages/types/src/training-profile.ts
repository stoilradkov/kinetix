import { z } from "zod";

export const trainingExperienceSchema = z.enum(["beginner", "intermediate", "advanced"]);

const oneRepMaxRepCutoffSchema = z.number().int().min(1).max(20);
const hardSetRpeThresholdSchema = z.number().min(0).max(10).multipleOf(0.5);
const hardSetRirThresholdSchema = z.number().int().min(0).max(10);
const positiveVersionSchema = z.number().int().positive();

export const trainingProfileResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        status: z.enum(["active", "archived"]),
        experience: trainingExperienceSchema,
        oneRepMaxRepCutoff: oneRepMaxRepCutoffSchema,
        hardSetRpeThreshold: hardSetRpeThresholdSchema,
        hardSetRirThreshold: hardSetRirThresholdSchema,
        calculatorVersion: positiveVersionSchema,
        ruleVersion: positiveVersionSchema,
        version: z.number().int().positive(),
        archivedAt: z.string().datetime().nullable(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

const trainingProfileFields = {
    experience: trainingExperienceSchema.optional(),
    oneRepMaxRepCutoff: oneRepMaxRepCutoffSchema.optional(),
    hardSetRpeThreshold: hardSetRpeThresholdSchema.optional(),
    hardSetRirThreshold: hardSetRirThresholdSchema.optional(),
    calculatorVersion: positiveVersionSchema.optional(),
    ruleVersion: positiveVersionSchema.optional(),
};

export const createTrainingProfileRequestSchema = z.object(trainingProfileFields).strict();
export const updateTrainingProfileRequestSchema = z.object(trainingProfileFields).strict();

export type TrainingExperienceValue = z.infer<typeof trainingExperienceSchema>;
export type TrainingProfileResponse = z.infer<typeof trainingProfileResponseSchema>;
export type CreateTrainingProfileRequest = z.infer<typeof createTrainingProfileRequestSchema>;
export type UpdateTrainingProfileRequest = z.infer<typeof updateTrainingProfileRequestSchema>;
