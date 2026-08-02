import { z } from "zod";

import { exerciseSnapshotV1Schema } from "#src/training-catalog";

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

// ---------------------------------------------------------------------------------------------
// Structured strength detail (design 11.2; PRD ST-1–7)
// ---------------------------------------------------------------------------------------------

export const setGroupTypeSchema = z.enum(["straight", "superset", "circuit", "drop", "cluster", "rest_pause"]);
export const performedSetTypeSchema = z.enum([
    "warm_up",
    "working",
    "back_off",
    "drop",
    "failure_amrap",
    "superset_circuit",
    "rest_pause",
    "technique",
    "cluster",
    "other",
]);
export const performedSetStatusSchema = z.enum(["completed", "partial", "skipped", "added"]);
export const setFailureReasonSchema = z.enum([
    "muscular",
    "technical",
    "cardiovascular",
    "pain",
    "equipment",
    "time",
    "other",
]);

const massUnitSchema = z.enum(["kg", "lb"]);
const distanceUnitSchema = z.enum(["m", "cm", "km", "mi"]);
const durationUnitSchema = z.enum(["ms", "s", "min", "h"]);

const massValueSchema = z.object({ value: z.number().nonnegative(), unit: massUnitSchema }).strict();
const distanceValueSchema = z.object({ value: z.number().nonnegative(), unit: distanceUnitSchema }).strict();
const durationValueSchema = z.object({ value: z.number().nonnegative(), unit: durationUnitSchema }).strict();

/** RPE 1–10 in 0.5 increments (design 7.3). */
const rpeSchema = z
    .number()
    .min(1)
    .max(10)
    .refine(value => Number.isInteger(value * 2), { message: "RPE must use 0.5 increments" });
const rirSchema = z.number().int().min(0).max(10);

const tempoRequestSchema = z
    .object({
        eccentric: durationValueSchema.nullable().optional(),
        bottomPause: durationValueSchema.nullable().optional(),
        concentric: durationValueSchema.nullable().optional(),
        topPause: durationValueSchema.nullable().optional(),
    })
    .strict();

const tempoResponseSchema = z
    .object({
        eccentric: durationValueSchema.nullable(),
        bottomPause: durationValueSchema.nullable(),
        concentric: durationValueSchema.nullable(),
        topPause: durationValueSchema.nullable(),
    })
    .strict();

export const performedSetMeasurementsRequestSchema = z
    .object({
        reps: z.number().int().nonnegative().nullable().optional(),
        externalLoad: massValueSchema.nullable().optional(),
        bodyweight: massValueSchema.nullable().optional(),
        addedLoad: massValueSchema.nullable().optional(),
        assistanceLoad: massValueSchema.nullable().optional(),
        effectiveLoad: massValueSchema.nullable().optional(),
        duration: durationValueSchema.nullable().optional(),
        distance: distanceValueSchema.nullable().optional(),
        powerWatts: z.number().nonnegative().nullable().optional(),
        rpe: rpeSchema.nullable().optional(),
        rir: rirSchema.nullable().optional(),
        tempo: tempoRequestSchema.nullable().optional(),
        restBefore: durationValueSchema.nullable().optional(),
        restAfter: durationValueSchema.nullable().optional(),
    })
    .strict();

const performedSetMeasurementsResponseSchema = z
    .object({
        reps: z.number().int().nonnegative().nullable(),
        externalLoad: massValueSchema.nullable(),
        bodyweight: massValueSchema.nullable(),
        addedLoad: massValueSchema.nullable(),
        assistanceLoad: massValueSchema.nullable(),
        effectiveLoad: massValueSchema.nullable(),
        duration: durationValueSchema.nullable(),
        distance: distanceValueSchema.nullable(),
        powerWatts: z.number().nonnegative().nullable(),
        rpe: rpeSchema.nullable(),
        rir: rirSchema.nullable(),
        tempo: tempoResponseSchema.nullable(),
        restBefore: durationValueSchema.nullable(),
        restAfter: durationValueSchema.nullable(),
    })
    .strict();

const setGroupMemberSchema = z
    .object({ occurrenceId: z.string().uuid(), position: z.number().int().nonnegative() })
    .strict();

export const performedSetRequestSchema = z
    .object({
        id: z.string().uuid(),
        setGroupId: z.string().uuid().nullable().optional(),
        round: z.number().int().positive().nullable().optional(),
        position: z.number().int().nonnegative(),
        setType: performedSetTypeSchema,
        status: performedSetStatusSchema,
        measurements: performedSetMeasurementsRequestSchema.optional(),
        failureReason: setFailureReasonSchema.nullable().optional(),
        technique: scale1to5.nullable().optional(),
        discomfort: scale1to5.nullable().optional(),
        pump: scale1to5.nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

const performedSetResponseSchema = z
    .object({
        id: z.string().uuid(),
        setGroupId: z.string().uuid().nullable(),
        round: z.number().int().positive().nullable(),
        position: z.number().int().nonnegative(),
        setType: performedSetTypeSchema,
        status: performedSetStatusSchema,
        measurements: performedSetMeasurementsResponseSchema,
        failureReason: setFailureReasonSchema.nullable(),
        technique: scale1to5.nullable(),
        discomfort: scale1to5.nullable(),
        pump: scale1to5.nullable(),
        notes: z.string().nullable(),
    })
    .strict();

/** Request occurrences carry only the exercise id; the server resolves the immutable snapshot. */
export const exerciseOccurrenceRequestSchema = z
    .object({
        id: z.string().uuid(),
        exerciseId: z.string().uuid(),
        position: z.number().int().nonnegative(),
        purpose: z.string().max(200).nullable().optional(),
        technique: scale1to5.nullable().optional(),
        discomfort: scale1to5.nullable().optional(),
        pump: scale1to5.nullable().optional(),
        notes: notesSchema.nullable().optional(),
        performedSets: z.array(performedSetRequestSchema).optional(),
    })
    .strict();

const exerciseOccurrenceResponseSchema = z
    .object({
        id: z.string().uuid(),
        exerciseId: z.string().uuid(),
        snapshot: exerciseSnapshotV1Schema,
        position: z.number().int().nonnegative(),
        purpose: z.string().nullable(),
        technique: scale1to5.nullable(),
        discomfort: scale1to5.nullable(),
        pump: scale1to5.nullable(),
        notes: z.string().nullable(),
        performedSets: z.array(performedSetResponseSchema),
    })
    .strict();

export const setGroupRequestSchema = z
    .object({
        id: z.string().uuid(),
        parentGroupId: z.string().uuid().nullable().optional(),
        type: setGroupTypeSchema,
        position: z.number().int().nonnegative(),
        rounds: z.number().int().positive().nullable().optional(),
        restMs: z.number().int().nonnegative().nullable().optional(),
        members: z.array(setGroupMemberSchema).optional(),
    })
    .strict();

const setGroupResponseSchema = z
    .object({
        id: z.string().uuid(),
        parentGroupId: z.string().uuid().nullable(),
        type: setGroupTypeSchema,
        position: z.number().int().nonnegative(),
        rounds: z.number().int().positive().nullable(),
        restMs: z.number().int().nonnegative().nullable(),
        members: z.array(setGroupMemberSchema),
    })
    .strict();

export const strengthActivityRequestSchema = z
    .object({
        occurrences: z.array(exerciseOccurrenceRequestSchema).optional(),
        setGroups: z.array(setGroupRequestSchema).optional(),
    })
    .strict();

const strengthActivityResponseSchema = z
    .object({
        occurrences: z.array(exerciseOccurrenceResponseSchema),
        setGroups: z.array(setGroupResponseSchema),
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
        strength: strengthActivityRequestSchema.nullable().optional(),
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
        strength: strengthActivityResponseSchema.nullable(),
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

export const mappingRelationSchema = z.enum(["matched", "substituted", "added", "partial", "combined", "split"]);

const sessionPlannedLinkResponseSchema = z
    .object({
        plannedSessionId: z.string().uuid(),
        sourcePrescriptionId: z.string().uuid(),
        resolvedPrescriptionId: z.string().uuid(),
    })
    .strict();

const activityMappingResponseSchema = z
    .object({
        id: z.string().uuid(),
        prescribedActivityId: z.string().uuid().nullable(),
        actualActivityId: z.string().uuid(),
        relation: mappingRelationSchema,
        reason: z.string().nullable(),
        notes: z.string().nullable(),
    })
    .strict();

const occurrenceMappingResponseSchema = z
    .object({
        id: z.string().uuid(),
        prescribedExerciseId: z.string().uuid().nullable(),
        occurrenceId: z.string().uuid(),
        relation: mappingRelationSchema,
        reason: z.string().nullable(),
        notes: z.string().nullable(),
    })
    .strict();

const setMappingResponseSchema = z
    .object({
        id: z.string().uuid(),
        prescribedSetId: z.string().uuid().nullable(),
        performedSetId: z.string().uuid(),
        relation: mappingRelationSchema,
        portion: z.string().nullable(),
        reason: z.string().nullable(),
        notes: z.string().nullable(),
    })
    .strict();

const runStepMappingResponseSchema = z
    .object({
        id: z.string().uuid(),
        prescribedRunStepId: z.string().uuid().nullable(),
        performedRunStepId: z.string().uuid(),
        relation: mappingRelationSchema,
        reason: z.string().nullable(),
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
        plannedLinks: z.array(sessionPlannedLinkResponseSchema),
        activityMappings: z.array(activityMappingResponseSchema),
        occurrenceMappings: z.array(occurrenceMappingResponseSchema),
        setMappings: z.array(setMappingResponseSchema),
        runStepMappings: z.array(runStepMappingResponseSchema),
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

export const startPlannedTrainingSessionRequestSchema = z
    .object({
        plannedSessionId: z.string().uuid(),
        localDate: localDateSchema.optional(),
        timeZone: timeZoneSchema.optional(),
        title: titleSchema.nullable().optional(),
        notes: notesSchema.nullable().optional(),
        tags: z.array(tagSchema).optional(),
        readiness: preWorkoutReadinessRequestSchema.optional(),
    })
    .strict();

const activityMappingRequestSchema = z
    .object({
        id: z.string().uuid(),
        prescribedActivityId: z.string().uuid().nullable().optional(),
        actualActivityId: z.string().uuid(),
        relation: mappingRelationSchema,
        reason: z.string().max(500).nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

const occurrenceMappingRequestSchema = z
    .object({
        id: z.string().uuid(),
        prescribedExerciseId: z.string().uuid().nullable().optional(),
        occurrenceId: z.string().uuid(),
        relation: mappingRelationSchema,
        reason: z.string().max(500).nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

const setMappingRequestSchema = z
    .object({
        id: z.string().uuid(),
        prescribedSetId: z.string().uuid().nullable().optional(),
        performedSetId: z.string().uuid(),
        relation: mappingRelationSchema,
        portion: z.string().nullable().optional(),
        reason: z.string().max(500).nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

const runStepMappingRequestSchema = z
    .object({
        id: z.string().uuid(),
        prescribedRunStepId: z.string().uuid().nullable().optional(),
        performedRunStepId: z.string().uuid(),
        relation: mappingRelationSchema,
        reason: z.string().max(500).nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

export const recordSessionMappingsRequestSchema = z
    .object({
        activityMappings: z.array(activityMappingRequestSchema).optional(),
        occurrenceMappings: z.array(occurrenceMappingRequestSchema).optional(),
        setMappings: z.array(setMappingRequestSchema).optional(),
        runStepMappings: z.array(runStepMappingRequestSchema).optional(),
    })
    .strict();

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
export type SetGroupTypeValue = z.infer<typeof setGroupTypeSchema>;
export type PerformedSetTypeValue = z.infer<typeof performedSetTypeSchema>;
export type PerformedSetStatusValue = z.infer<typeof performedSetStatusSchema>;
export type SetFailureReasonValue = z.infer<typeof setFailureReasonSchema>;
export type PerformedSetMeasurementsRequest = z.infer<typeof performedSetMeasurementsRequestSchema>;
export type PerformedSetRequest = z.infer<typeof performedSetRequestSchema>;
export type ExerciseOccurrenceRequest = z.infer<typeof exerciseOccurrenceRequestSchema>;
export type SetGroupRequest = z.infer<typeof setGroupRequestSchema>;
export type StrengthActivityRequest = z.infer<typeof strengthActivityRequestSchema>;
export type CreateTrainingSessionRequest = z.infer<typeof createTrainingSessionRequestSchema>;
export type UpdateTrainingSessionRequest = z.infer<typeof updateTrainingSessionRequestSchema>;
export type StartTrainingSessionRequest = z.infer<typeof startTrainingSessionRequestSchema>;
export type StartPlannedTrainingSessionRequest = z.infer<typeof startPlannedTrainingSessionRequestSchema>;
export type RecordSessionMappingsRequest = z.infer<typeof recordSessionMappingsRequestSchema>;
export type MappingRelationValue = z.infer<typeof mappingRelationSchema>;
export type CompleteTrainingSessionRequest = z.infer<typeof completeTrainingSessionRequestSchema>;
