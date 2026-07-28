import { z } from "zod";

export const goalTypeSchema = z.enum(["strength", "endurance", "body_composition", "skill", "other"]);
export const goalStatusSchema = z.enum(["active", "achieved", "abandoned"]);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format");
const targetValueSchema = z.string().regex(/^\d+(\.\d{1,3})?$/, "Enter a non-negative number");
const targetUnitSchema = z.string().trim().min(1).max(40);
const prioritySchema = z.number().int().min(1).max(1000);
const notesSchema = z.string().max(2_000);

export const trainingGoalResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        type: goalTypeSchema,
        targetValue: z.string().nullable(),
        targetUnit: z.string().nullable(),
        startDate: isoDateSchema,
        targetDate: isoDateSchema.nullable(),
        priority: prioritySchema,
        status: goalStatusSchema,
        notes: z.string().nullable(),
        programId: z.string().uuid().nullable(),
        version: z.number().int().positive(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const trainingGoalListResponseSchema = z.object({ items: z.array(trainingGoalResponseSchema) }).strict();

export const createTrainingGoalRequestSchema = z
    .object({
        type: goalTypeSchema,
        targetValue: targetValueSchema.nullable().optional(),
        targetUnit: targetUnitSchema.nullable().optional(),
        startDate: isoDateSchema.optional(),
        targetDate: isoDateSchema.nullable().optional(),
        priority: prioritySchema.optional(),
        notes: notesSchema.nullable().optional(),
        programId: z.string().uuid().nullable().optional(),
    })
    .strict();

export const updateTrainingGoalRequestSchema = z
    .object({
        type: goalTypeSchema.optional(),
        targetValue: targetValueSchema.nullable().optional(),
        targetUnit: targetUnitSchema.nullable().optional(),
        startDate: isoDateSchema.optional(),
        targetDate: isoDateSchema.nullable().optional(),
        priority: prioritySchema.optional(),
        status: goalStatusSchema.optional(),
        notes: notesSchema.nullable().optional(),
        programId: z.string().uuid().nullable().optional(),
    })
    .strict();

export type GoalTypeValue = z.infer<typeof goalTypeSchema>;
export type GoalStatusValue = z.infer<typeof goalStatusSchema>;
export type TrainingGoalResponse = z.infer<typeof trainingGoalResponseSchema>;
export type TrainingGoalListResponse = z.infer<typeof trainingGoalListResponseSchema>;
export type CreateTrainingGoalRequest = z.infer<typeof createTrainingGoalRequestSchema>;
export type UpdateTrainingGoalRequest = z.infer<typeof updateTrainingGoalRequestSchema>;
