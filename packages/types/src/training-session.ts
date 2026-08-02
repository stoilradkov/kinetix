import { z } from "zod";

/**
 * Wire contracts for TrainingSession (design 5.8, 11.1, 11.5–11.6; PRD TS-1–3, TS-5–7). A training
 * session is the versioned write boundary for live and retrospective workouts: lifecycle state,
 * local date + IANA time zone, optional server-backed start/end instants, an explicit duration,
 * pre/post subjective ratings, pain records, notes, case-insensitive tags, and ordered typed
 * activity placeholders. Detail responses embed the activity/pain trees; list responses stay
 * metadata + counts for bounded queries.
 */

export const trainingSessionStatusSchema = z.enum(["draft", "in_progress", "completed"]);
export const sessionActivityTypeSchema = z.enum(["strength", "running"]);
export const painSideSchema = z.enum(["left", "right", "bilateral"]);

const titleSchema = z.string().trim().min(1).max(160);
const notesSchema = z.string().max(4_000);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date");
const timeZoneSchema = z.string().trim().min(1).max(80);
const tagSchema = z.string().trim().min(1).max(80);
const scale1to5 = z.number().int().min(1).max(5);
const scale0to10 = z.number().int().min(0).max(10);

/** Pre-workout readiness (1–5). Every field is optional and nullable so missing values stay explicit. */
export const preWorkoutReadinessRequestSchema = z
    .object({
        energy: scale1to5.nullable().optional(),
        motivation: scale1to5.nullable().optional(),
        fatigue: scale1to5.nullable().optional(),
        soreness: scale1to5.nullable().optional(),
        stress: scale1to5.nullable().optional(),
        recovery: scale1to5.nullable().optional(),
    })
    .strict();

export const postWorkoutRatingsRequestSchema = z
    .object({
        energy: scale1to5.nullable().optional(),
        motivation: scale1to5.nullable().optional(),
        enjoyment: scale1to5.nullable().optional(),
        difficulty: scale1to5.nullable().optional(),
        fatigue: scale1to5.nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

const preWorkoutReadinessResponseSchema = z
    .object({
        energy: scale1to5.nullable(),
        motivation: scale1to5.nullable(),
        fatigue: scale1to5.nullable(),
        soreness: scale1to5.nullable(),
        stress: scale1to5.nullable(),
        recovery: scale1to5.nullable(),
    })
    .strict();

const postWorkoutRatingsResponseSchema = z
    .object({
        energy: scale1to5.nullable(),
        motivation: scale1to5.nullable(),
        enjoyment: scale1to5.nullable(),
        difficulty: scale1to5.nullable(),
        fatigue: scale1to5.nullable(),
        notes: z.string().nullable(),
    })
    .strict();

export const sessionActivityRequestSchema = z
    .object({
        id: z.string().uuid(),
        type: sessionActivityTypeSchema,
        position: z.number().int().nonnegative(),
        startedAt: z.string().datetime().nullable().optional(),
        endedAt: z.string().datetime().nullable().optional(),
        durationSeconds: z.number().int().nonnegative().nullable().optional(),
        rpe: scale0to10.nullable().optional(),
        feeling: z.string().max(2_000).nullable().optional(),
        notes: notesSchema.nullable().optional(),
        tags: z.array(tagSchema).optional(),
    })
    .strict();

export const painRecordRequestSchema = z
    .object({
        id: z.string().uuid(),
        activityId: z.string().uuid().nullable().optional(),
        exerciseOccurrenceId: z.string().uuid().nullable().optional(),
        performedSetId: z.string().uuid().nullable().optional(),
        bodyArea: z.string().trim().min(1).max(120),
        side: painSideSchema,
        severity: scale0to10,
        painType: z.string().max(120).nullable().optional(),
        onsetDuringSession: z.boolean().optional(),
        stoppedActivity: z.boolean().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

const sessionActivityResponseSchema = z
    .object({
        id: z.string().uuid(),
        type: sessionActivityTypeSchema,
        position: z.number().int().nonnegative(),
        startedAt: z.string().datetime().nullable(),
        endedAt: z.string().datetime().nullable(),
        durationSeconds: z.number().int().nonnegative().nullable(),
        rpe: scale0to10.nullable(),
        feeling: z.string().nullable(),
        notes: z.string().nullable(),
        tags: z.array(z.string()),
    })
    .strict();

const painRecordResponseSchema = z
    .object({
        id: z.string().uuid(),
        activityId: z.string().uuid().nullable(),
        exerciseOccurrenceId: z.string().uuid().nullable(),
        performedSetId: z.string().uuid().nullable(),
        bodyArea: z.string(),
        side: painSideSchema,
        severity: scale0to10,
        painType: z.string().nullable(),
        onsetDuringSession: z.boolean(),
        stoppedActivity: z.boolean(),
        notes: z.string().nullable(),
    })
    .strict();

const trainingSessionCoreShape = {
    id: z.string().uuid(),
    profileId: z.string().uuid(),
    status: trainingSessionStatusSchema,
    title: z.string().nullable(),
    localDate: z.string(),
    timeZone: z.string(),
    startedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
    durationMinutes: z.number().int().nonnegative().nullable(),
    readiness: preWorkoutReadinessResponseSchema,
    postWorkout: postWorkoutRatingsResponseSchema,
    notes: z.string().nullable(),
    tags: z.array(z.string()),
    sourcePlannedSessionId: z.string().uuid().nullable(),
    version: z.number().int().positive(),
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
} as const;

export const trainingSessionSummarySchema = z
    .object({
        ...trainingSessionCoreShape,
        activityCount: z.number().int().nonnegative(),
        painRecordCount: z.number().int().nonnegative(),
    })
    .strict();

export const trainingSessionResponseSchema = z
    .object({
        ...trainingSessionCoreShape,
        activities: z.array(sessionActivityResponseSchema),
        painRecords: z.array(painRecordResponseSchema),
    })
    .strict();

export const trainingSessionListResponseSchema = z.object({ items: z.array(trainingSessionSummarySchema) }).strict();

const sessionContentShape = {
    title: titleSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
    tags: z.array(tagSchema).optional(),
    readiness: preWorkoutReadinessRequestSchema.optional(),
    postWorkout: postWorkoutRatingsRequestSchema.optional(),
    activities: z.array(sessionActivityRequestSchema).optional(),
    painRecords: z.array(painRecordRequestSchema).optional(),
} as const;

export const createTrainingSessionRequestSchema = z
    .object({
        localDate: localDateSchema.optional(),
        timeZone: timeZoneSchema.optional(),
        sourcePlannedSessionId: z.string().uuid().nullable().optional(),
        ...sessionContentShape,
    })
    .strict();

export const updateTrainingSessionRequestSchema = z
    .object({
        localDate: localDateSchema.optional(),
        timeZone: timeZoneSchema.optional(),
        startedAt: z.string().datetime().nullable().optional(),
        endedAt: z.string().datetime().nullable().optional(),
        durationMinutes: z.number().int().nonnegative().nullable().optional(),
        ...sessionContentShape,
    })
    .strict();

export const startTrainingSessionRequestSchema = z.object({}).strict();

export const completeTrainingSessionRequestSchema = z
    .object({
        endedAt: z.string().datetime().nullable().optional(),
        durationMinutes: z.number().int().nonnegative().nullable().optional(),
        postWorkout: postWorkoutRatingsRequestSchema.optional(),
    })
    .strict();

export type TrainingSessionStatusValue = z.infer<typeof trainingSessionStatusSchema>;
export type SessionActivityTypeValue = z.infer<typeof sessionActivityTypeSchema>;
export type PainSideValue = z.infer<typeof painSideSchema>;
export type TrainingSessionSummary = z.infer<typeof trainingSessionSummarySchema>;
export type TrainingSessionResponse = z.infer<typeof trainingSessionResponseSchema>;
export type TrainingSessionListResponse = z.infer<typeof trainingSessionListResponseSchema>;
export type SessionActivityResponse = z.infer<typeof sessionActivityResponseSchema>;
export type PainRecordResponse = z.infer<typeof painRecordResponseSchema>;
export type CreateTrainingSessionRequest = z.infer<typeof createTrainingSessionRequestSchema>;
export type UpdateTrainingSessionRequest = z.infer<typeof updateTrainingSessionRequestSchema>;
export type StartTrainingSessionRequest = z.infer<typeof startTrainingSessionRequestSchema>;
export type CompleteTrainingSessionRequest = z.infer<typeof completeTrainingSessionRequestSchema>;
