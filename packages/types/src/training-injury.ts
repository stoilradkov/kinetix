import { z } from "zod";

export const injurySideSchema = z.enum(["left", "right", "bilateral"]);
export const injurySeveritySchema = z.enum(["mild", "moderate", "severe"]);
export const injuryStatusSchema = z.enum(["active", "recovering", "resolved"]);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format");
const nameSchema = z.string().trim().min(1).max(200);
const bodyAreaSchema = z.string().trim().min(1).max(120);
const notesSchema = z.string().max(2_000);
const linkListSchema = z.array(z.string().uuid()).max(100);

export const trainingInjuryResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        name: z.string(),
        bodyArea: z.string(),
        side: injurySideSchema.nullable(),
        severity: injurySeveritySchema,
        status: injuryStatusSchema,
        onsetDate: isoDateSchema,
        resolvedDate: isoDateSchema.nullable(),
        notes: z.string().nullable(),
        muscleGroupIds: z.array(z.string().uuid()),
        exerciseIds: z.array(z.string().uuid()),
        version: z.number().int().positive(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const trainingInjuryListResponseSchema = z.object({ items: z.array(trainingInjuryResponseSchema) }).strict();

export const createTrainingInjuryRequestSchema = z
    .object({
        name: nameSchema,
        bodyArea: bodyAreaSchema,
        side: injurySideSchema.nullable().optional(),
        severity: injurySeveritySchema.optional(),
        status: injuryStatusSchema.optional(),
        onsetDate: isoDateSchema.optional(),
        resolvedDate: isoDateSchema.nullable().optional(),
        notes: notesSchema.nullable().optional(),
        muscleGroupIds: linkListSchema.optional(),
        exerciseIds: linkListSchema.optional(),
    })
    .strict();

export const updateTrainingInjuryRequestSchema = z
    .object({
        name: nameSchema.optional(),
        bodyArea: bodyAreaSchema.optional(),
        side: injurySideSchema.nullable().optional(),
        severity: injurySeveritySchema.optional(),
        status: injuryStatusSchema.optional(),
        onsetDate: isoDateSchema.optional(),
        resolvedDate: isoDateSchema.nullable().optional(),
        notes: notesSchema.nullable().optional(),
        muscleGroupIds: linkListSchema.optional(),
        exerciseIds: linkListSchema.optional(),
    })
    .strict();

export type InjurySideValue = z.infer<typeof injurySideSchema>;
export type InjurySeverityValue = z.infer<typeof injurySeveritySchema>;
export type InjuryStatusValue = z.infer<typeof injuryStatusSchema>;
export type TrainingInjuryResponse = z.infer<typeof trainingInjuryResponseSchema>;
export type TrainingInjuryListResponse = z.infer<typeof trainingInjuryListResponseSchema>;
export type CreateTrainingInjuryRequest = z.infer<typeof createTrainingInjuryRequestSchema>;
export type UpdateTrainingInjuryRequest = z.infer<typeof updateTrainingInjuryRequestSchema>;
