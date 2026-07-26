import { z } from "zod";

export const jobIdSchema = z.string().uuid();
export const jobStateSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const jobProgressSchema = z
    .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().positive().optional(),
        percentage: z.number().min(0).max(100).optional(),
        message: z.string().min(1).max(240).optional(),
    })
    .strict();

export const jobErrorResourceSchema = z
    .object({
        code: z.string().min(1).max(80),
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
        failedAt: z.string().datetime(),
    })
    .strict();

export const jobResourceSchema = z
    .object({
        id: jobIdSchema,
        type: z.string().min(1).max(180),
        version: z.number().int().positive(),
        state: jobStateSchema,
        attempts: z.number().int().nonnegative(),
        maxAttempts: z.number().int().positive(),
        progress: jobProgressSchema.nullable(),
        error: jobErrorResourceSchema.nullable(),
        correlationId: z.string().min(1).max(128),
        createdAt: z.string().datetime(),
        startedAt: z.string().datetime().nullable(),
        nextAttemptAt: z.string().datetime(),
        completedAt: z.string().datetime().nullable(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export type JobState = z.infer<typeof jobStateSchema>;
export type JobProgress = z.infer<typeof jobProgressSchema>;
export type JobErrorResource = z.infer<typeof jobErrorResourceSchema>;
export type JobResource = z.infer<typeof jobResourceSchema>;
