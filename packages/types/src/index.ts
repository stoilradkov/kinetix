import { z } from "zod";

export * from "#src/measurements";
export * from "#src/jobs";
export * from "#src/revisions";
export * from "#src/training-catalog";

export const healthResponseSchema = z.object({
    status: z.enum(["ok", "error"]),
    service: z.literal("kinetix-api"),
    timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorCodeSchema = z.enum([
    "VALIDATION_FAILED",
    "NOT_FOUND",
    "PRECONDITION_REQUIRED",
    "VERSION_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "IDEMPOTENCY_IN_PROGRESS",
    "DRY_RUN_EXPIRED",
    "DRY_RUN_STALE",
    "CATALOG_MAPPING_REQUIRED",
    "PROGRESSION_CONFLICT",
    "PROGRESSION_STALE",
    "JOB_FAILED",
    "INTERNAL_ERROR",
]);

export const apiFieldErrorsSchema = z.record(z.string(), z.array(z.string()));

export const apiErrorSchema = z
    .object({
        code: apiErrorCodeSchema,
        message: z.string().min(1),
        fieldErrors: apiFieldErrorsSchema.optional(),
        correlationId: z.string().min(1),
        expectedVersion: z.number().int().positive().optional(),
        currentVersion: z.number().int().positive().optional(),
        etag: z
            .string()
            .regex(/^"[1-9]\d*"$/)
            .optional(),
        operation: z.string().min(1).optional(),
        key: z.string().min(1).optional(),
    })
    .catchall(z.unknown());

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
