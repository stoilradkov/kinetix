import { z } from "zod";

export const healthRecordTypeSchema = z.enum(["body_weight", "sleep", "resting_heart_rate", "daily_readiness"]);
export const healthRecordSourceSchema = z.enum(["manual"]);

const isoDateTimeSchema = z.string().datetime({ offset: true });
const notesSchema = z.string().max(2_000);

export const bodyWeightBodySchema = z
    .object({
        type: z.literal("body_weight"),
        massKg: z.number().positive().max(1_000),
    })
    .strict();

export const sleepBodySchema = z
    .object({
        type: z.literal("sleep"),
        startAt: isoDateTimeSchema,
        endAt: isoDateTimeSchema,
    })
    .strict();

export const restingHeartRateBodySchema = z
    .object({
        type: z.literal("resting_heart_rate"),
        beatsPerMinute: z.number().int().min(20).max(250),
    })
    .strict();

export const dailyReadinessBodySchema = z
    .object({
        type: z.literal("daily_readiness"),
        score: z.number().int(),
        scaleMin: z.number().int().optional(),
        scaleMax: z.number().int().optional(),
    })
    .strict();

/** Versioned discriminated union over the manual health record body variants. */
export const healthRecordBodySchema = z.discriminatedUnion("type", [
    bodyWeightBodySchema,
    sleepBodySchema,
    restingHeartRateBodySchema,
    dailyReadinessBodySchema,
]);

export const manualHealthRecordResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        type: healthRecordTypeSchema,
        source: healthRecordSourceSchema,
        effectiveAt: isoDateTimeSchema,
        timeZone: z.string().nullable(),
        notes: z.string().nullable(),
        body: healthRecordBodySchema,
        bodySchemaVersion: z.number().int().positive(),
        archivedAt: isoDateTimeSchema.nullable(),
        version: z.number().int().positive(),
        createdAt: isoDateTimeSchema,
        updatedAt: isoDateTimeSchema,
    })
    .strict();

export const manualHealthRecordListResponseSchema = z
    .object({ items: z.array(manualHealthRecordResponseSchema) })
    .strict();

export const createManualHealthRecordRequestSchema = z
    .object({
        effectiveAt: isoDateTimeSchema,
        timeZone: z.string().trim().min(1).max(120).nullable().optional(),
        notes: notesSchema.nullable().optional(),
        body: healthRecordBodySchema,
    })
    .strict();

export const updateManualHealthRecordRequestSchema = z
    .object({
        effectiveAt: isoDateTimeSchema.optional(),
        timeZone: z.string().trim().min(1).max(120).nullable().optional(),
        notes: notesSchema.nullable().optional(),
        body: healthRecordBodySchema.optional(),
    })
    .strict();

export type HealthRecordTypeValue = z.infer<typeof healthRecordTypeSchema>;
export type HealthRecordSourceValue = z.infer<typeof healthRecordSourceSchema>;
export type HealthRecordBodyValue = z.infer<typeof healthRecordBodySchema>;
export type ManualHealthRecordResponse = z.infer<typeof manualHealthRecordResponseSchema>;
export type ManualHealthRecordListResponse = z.infer<typeof manualHealthRecordListResponseSchema>;
export type CreateManualHealthRecordRequest = z.infer<typeof createManualHealthRecordRequestSchema>;
export type UpdateManualHealthRecordRequest = z.infer<typeof updateManualHealthRecordRequestSchema>;
