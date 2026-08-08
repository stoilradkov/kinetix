import { z } from "zod";

export * from "#src/measurements";
export * from "#src/jobs";
export * from "#src/revisions";
export * from "#src/health-record";
export * from "#src/profile";
export * from "#src/training-catalog";
export * from "#src/training-goal";
export * from "#src/training-injury";
export * from "#src/training-max";
export * from "#src/training-profile";
export * from "#src/zone";
export * from "#src/equipment-increment";
export * from "#src/gear-item";
export * from "#src/session-prescription";
export * from "#src/workout-template";
export * from "#src/planned-session";
export * from "#src/training-session";
export * from "#src/program";
export * from "#src/bulk-program";
export * from "#src/historical-import";
export * from "#src/import-batch";
export * from "#src/storage-reconciliation";

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
    "DRY_RUN_CONSUMED",
    "DRY_RUN_TOKEN_INVALID",
    "EXTERNAL_ID_CONFLICT",
    "CATALOG_MAPPING_REQUIRED",
    "IMPORT_PAYLOAD_CONFLICT",
    "PAYLOAD_TOO_LARGE",
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
