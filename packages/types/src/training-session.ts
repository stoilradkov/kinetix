import { z } from "zod";

import { exerciseSnapshotV1Schema } from "#src/training-catalog";
import { sessionPrescriptionResponseSchema } from "#src/session-prescription";
import { zoneFamilySchema } from "#src/zone";

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

// ---------------------------------------------------------------------------------------------
// Manual running summary (design 11.3; PRD R1). Every metric is optional and nullable so a partial
// summary is valid and a recorded `0` stays distinct from an absent value. Average pace is never
// accepted or stored — the response returns it as a derived projection with provenance/exclusions.
// ---------------------------------------------------------------------------------------------

const heartRateSchema = z.number().int().min(0).max(999);
const cadenceSchema = z.number().int().min(0).max(999);
const caloriesSchema = z.number().int().min(0).max(100_000);
const runTagSchema = z.string().trim().min(1).max(80);
const temperatureSchema = z.number().min(-100).max(100);

const runEnvironmentRequestSchema = z
    .object({
        surface: z.string().max(80).nullable().optional(),
        terrain: z.string().max(80).nullable().optional(),
        weather: z.string().max(200).nullable().optional(),
        temperatureCelsius: temperatureSchema.nullable().optional(),
    })
    .strict();

const runEnvironmentResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        surface: z.string().nullable(),
        terrain: z.string().nullable(),
        weather: z.string().nullable(),
        temperatureCelsius: z.number().nullable(),
    })
    .strict();

/** Structured-running enum for performed run steps; zone families reuse {@link zoneFamilySchema}. */
export const runStepTypeSchema = z.enum(["warm_up", "work", "recovery", "repeat", "cool_down", "open"]);

const runStepMeasurementsRequestSchema = z
    .object({
        distance: distanceValueSchema.nullable().optional(),
        duration: durationValueSchema.nullable().optional(),
        averageHeartRate: heartRateSchema.nullable().optional(),
        maxHeartRate: heartRateSchema.nullable().optional(),
        averageCadence: cadenceSchema.nullable().optional(),
        maxCadence: cadenceSchema.nullable().optional(),
        averagePower: z.number().nonnegative().nullable().optional(),
        maxPower: z.number().nonnegative().nullable().optional(),
        elevationGain: distanceValueSchema.nullable().optional(),
        elevationLoss: distanceValueSchema.nullable().optional(),
        rpe: rpeSchema.nullable().optional(),
    })
    .strict();

const performedRunStepRequestSchema = z
    .object({
        id: z.string().uuid(),
        parentStepId: z.string().uuid().nullable().optional(),
        type: runStepTypeSchema,
        position: z.number().int().nonnegative(),
        repeatCount: z.number().int().min(1).max(10_000).nullable().optional(),
        measurements: runStepMeasurementsRequestSchema.optional(),
        notes: z.string().max(500).nullable().optional(),
    })
    .strict();

const runSplitRequestSchema = z
    .object({
        id: z.string().uuid(),
        position: z.number().int().nonnegative(),
        distance: distanceValueSchema.nullable().optional(),
        movingTime: durationValueSchema.nullable().optional(),
        elapsedTime: durationValueSchema.nullable().optional(),
        averageHeartRate: heartRateSchema.nullable().optional(),
        maxHeartRate: heartRateSchema.nullable().optional(),
        averageCadence: cadenceSchema.nullable().optional(),
        averagePower: z.number().nonnegative().nullable().optional(),
        elevationGain: distanceValueSchema.nullable().optional(),
        elevationLoss: distanceValueSchema.nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
    })
    .strict();

const runZoneTimeRequestSchema = z
    .object({
        id: z.string().uuid(),
        position: z.number().int().nonnegative(),
        family: zoneFamilySchema,
        zoneDefinitionId: z.string().uuid().nullable().optional(),
        zoneRangeId: z.string().uuid().nullable().optional(),
        zoneName: z.string().max(120).nullable().optional(),
        duration: durationValueSchema,
    })
    .strict();

/** A `[longitude, latitude]` coordinate pair; the route stays PostGIS-free and bounded (design 11.3). */
const routeCoordinateSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const runRouteGeometryRequestSchema = z
    .object({
        type: z.literal("line_string"),
        coordinates: z.array(routeCoordinateSchema).min(2).max(5_000),
    })
    .strict();

const runRouteRequestSchema = z
    .object({
        ref: z.string().max(200).nullable().optional(),
        geometry: runRouteGeometryRequestSchema.nullable().optional(),
    })
    .strict();

export const runningActivityRequestSchema = z
    .object({
        distance: distanceValueSchema.nullable().optional(),
        movingTime: durationValueSchema.nullable().optional(),
        elapsedTime: durationValueSchema.nullable().optional(),
        averageHeartRate: heartRateSchema.nullable().optional(),
        maxHeartRate: heartRateSchema.nullable().optional(),
        averageCadence: cadenceSchema.nullable().optional(),
        maxCadence: cadenceSchema.nullable().optional(),
        averagePower: z.number().nonnegative().nullable().optional(),
        maxPower: z.number().nonnegative().nullable().optional(),
        elevationGain: distanceValueSchema.nullable().optional(),
        elevationLoss: distanceValueSchema.nullable().optional(),
        calories: caloriesSchema.nullable().optional(),
        strideLength: distanceValueSchema.nullable().optional(),
        groundContactTime: durationValueSchema.nullable().optional(),
        verticalOscillation: distanceValueSchema.nullable().optional(),
        vo2Max: z.number().nonnegative().nullable().optional(),
        rpe: rpeSchema.nullable().optional(),
        indoor: z.boolean().optional(),
        treadmill: z.boolean().optional(),
        runTags: z.array(runTagSchema).optional(),
        environment: runEnvironmentRequestSchema.nullable().optional(),
        steps: z.array(performedRunStepRequestSchema).optional(),
        splits: z.array(runSplitRequestSchema).optional(),
        zoneTimes: z.array(runZoneTimeRequestSchema).optional(),
        route: runRouteRequestSchema.nullable().optional(),
        gearItemId: z.string().uuid().nullable().optional(),
    })
    .strict();

/** Reasons the derived average pace could not be computed (missing/zero distance or moving time). */
export const paceExclusionReasonSchema = z.enum([
    "missing_distance",
    "zero_distance",
    "missing_moving_time",
    "zero_moving_time",
]);

/** Query-only average-pace projection: derived from distance/moving time, never authoritative storage. */
const derivedRunPaceResponseSchema = z
    .object({
        source: z.literal("distance_and_moving_time"),
        speedMetresPerSecond: z.string().nullable(),
        secondsPerKilometre: z.number().nullable(),
        secondsPerMile: z.number().nullable(),
        exclusions: z.array(paceExclusionReasonSchema),
    })
    .strict();

const runStepMeasurementsResponseSchema = z
    .object({
        distance: distanceValueSchema.nullable(),
        duration: durationValueSchema.nullable(),
        averageHeartRate: z.number().int().nullable(),
        maxHeartRate: z.number().int().nullable(),
        averageCadence: z.number().int().nullable(),
        maxCadence: z.number().int().nullable(),
        averagePower: z.number().nullable(),
        maxPower: z.number().nullable(),
        elevationGain: distanceValueSchema.nullable(),
        elevationLoss: distanceValueSchema.nullable(),
        rpe: rpeSchema.nullable(),
    })
    .strict();

const performedRunStepResponseSchema = z
    .object({
        id: z.string().uuid(),
        parentStepId: z.string().uuid().nullable(),
        type: runStepTypeSchema,
        position: z.number().int().nonnegative(),
        repeatCount: z.number().int().nullable(),
        measurements: runStepMeasurementsResponseSchema,
        notes: z.string().nullable(),
    })
    .strict();

const runSplitResponseSchema = z
    .object({
        id: z.string().uuid(),
        position: z.number().int().nonnegative(),
        distance: distanceValueSchema.nullable(),
        movingTime: durationValueSchema.nullable(),
        elapsedTime: durationValueSchema.nullable(),
        averageHeartRate: z.number().int().nullable(),
        maxHeartRate: z.number().int().nullable(),
        averageCadence: z.number().int().nullable(),
        averagePower: z.number().nullable(),
        elevationGain: distanceValueSchema.nullable(),
        elevationLoss: distanceValueSchema.nullable(),
        notes: z.string().nullable(),
    })
    .strict();

const runZoneTimeResponseSchema = z
    .object({
        id: z.string().uuid(),
        position: z.number().int().nonnegative(),
        family: zoneFamilySchema,
        zoneDefinitionId: z.string().uuid().nullable(),
        zoneRangeId: z.string().uuid().nullable(),
        zoneName: z.string().nullable(),
        duration: durationValueSchema,
    })
    .strict();

const runRouteResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        ref: z.string().nullable(),
        geometry: runRouteGeometryRequestSchema.nullable(),
    })
    .strict();

const runningActivityResponseSchema = z
    .object({
        distance: distanceValueSchema.nullable(),
        movingTime: durationValueSchema.nullable(),
        elapsedTime: durationValueSchema.nullable(),
        averageHeartRate: z.number().int().nullable(),
        maxHeartRate: z.number().int().nullable(),
        averageCadence: z.number().int().nullable(),
        maxCadence: z.number().int().nullable(),
        averagePower: z.number().nullable(),
        maxPower: z.number().nullable(),
        elevationGain: distanceValueSchema.nullable(),
        elevationLoss: distanceValueSchema.nullable(),
        calories: z.number().int().nullable(),
        strideLength: distanceValueSchema.nullable(),
        groundContactTime: durationValueSchema.nullable(),
        verticalOscillation: distanceValueSchema.nullable(),
        vo2Max: z.number().nullable(),
        rpe: rpeSchema.nullable(),
        indoor: z.boolean(),
        treadmill: z.boolean(),
        runTags: z.array(z.string()),
        environment: runEnvironmentResponseSchema.nullable(),
        steps: z.array(performedRunStepResponseSchema),
        splits: z.array(runSplitResponseSchema),
        zoneTimes: z.array(runZoneTimeResponseSchema),
        route: runRouteResponseSchema.nullable(),
        gearItemId: z.string().uuid().nullable(),
        derivedPace: derivedRunPaceResponseSchema,
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
        running: runningActivityRequestSchema.nullable().optional(),
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
        running: runningActivityResponseSchema.nullable(),
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
        plannedSessionId: z.string().uuid().nullable(),
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
        // Read-only linkage resolved through the planned-session mapping tables (design 11.4): the
        // originating program, so list rows differentiate without opening the session. Null when the
        // session has no planned link or the link is not part of a program.
        programId: z.string().uuid().nullable(),
        programName: z.string().nullable(),
        // Bounded content summary — the distinct activity kinds present plus the total performed-set
        // count — so a row conveys "what happened" without embedding the activity/set trees.
        activityKinds: z.array(sessionActivityTypeSchema),
        totalSetCount: z.number().int().nonnegative(),
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

export const trainingSessionListResponseSchema = z
    .object({
        items: z.array(trainingSessionSummarySchema),
        // Opaque keyset cursor for the next page, or null when the current page is the last one.
        nextCursor: z.string().nullable().default(null),
    })
    .strict();

const listLocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date");

/**
 * Query contract for the bounded, newest-first sessions list (design 11.6; UX1). Everything arrives
 * as strings on the wire, so `limit` coerces and clamps to a sane page size and `includeArchived`
 * accepts the `"true"` flag. The `cursor` is an opaque keyset token minted by a previous page; the
 * server decodes it and rejects a malformed one with the standard validation envelope.
 */
export const trainingSessionListQuerySchema = z
    .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().trim().min(1).optional(),
        status: trainingSessionStatusSchema.optional(),
        from: listLocalDateSchema.optional(),
        to: listLocalDateSchema.optional(),
        search: z.string().trim().min(1).max(200).optional(),
        includeArchived: z
            .union([z.boolean(), z.string()])
            .optional()
            .transform(value => value === true || value === "true"),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Active-workout read projection (design 18.3; PRD UX-3) — the session tree plus the frozen
// prescription(s) it maps against, so the live UI can render planned-versus-actual in one query.
// ---------------------------------------------------------------------------------------------

const activeSessionPlanSchema = z
    .object({
        referencePrescriptionId: z.string().uuid(),
        plannedSessionId: z.string().uuid().nullable(),
        prescription: sessionPrescriptionResponseSchema,
    })
    .strict();

export const activeTrainingSessionResponseSchema = trainingSessionResponseSchema
    .extend({ plans: z.array(activeSessionPlanSchema) })
    .strict();

/** Projected planned-session outcome once this session's mappings are applied (design 11.6). */
export const plannedActualOutcomeSchema = z.enum(["planned", "completed", "partially_completed"]);

const completionIssueSeveritySchema = z.enum(["warning", "blocker"]);

const completionPreviewIssueSchema = z
    .object({
        code: z.string(),
        severity: completionIssueSeveritySchema,
        message: z.string(),
        activityId: z.string().uuid().nullable(),
        occurrenceId: z.string().uuid().nullable(),
    })
    .strict();

const completionPreviewOutcomeSchema = z
    .object({
        plannedSessionId: z.string().uuid(),
        currentStatus: z.string().nullable(),
        projectedStatus: plannedActualOutcomeSchema,
        prescribedSetCount: z.number().int().nonnegative(),
        coveredSetCount: z.number().int().nonnegative(),
    })
    .strict();

export const completionPreviewResponseSchema = z
    .object({
        issues: z.array(completionPreviewIssueSchema),
        plannedOutcomes: z.array(completionPreviewOutcomeSchema),
    })
    .strict();

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

// ---------------------------------------------------------------------------------------------
// Live-entry start sources (PRD UX-3) and granular child mutations (design 18.2). Each granular
// endpoint is a convenience over the aggregate: it still requires the session If-Match and bumps
// the session root version.
// ---------------------------------------------------------------------------------------------

/** Metadata overrides shared by every start-from source. */
const sessionStartOverridesShape = {
    localDate: localDateSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    title: titleSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
    tags: z.array(tagSchema).optional(),
    readiness: preWorkoutReadinessRequestSchema.optional(),
} as const;

/** Start an empty in-progress session (no plan/template) — create + start in one call. */
export const startEmptyTrainingSessionRequestSchema = z.object({ ...sessionStartOverridesShape }).strict();

/** Start an in-progress session from a published workout template, freezing its resolved targets. */
export const startTemplateTrainingSessionRequestSchema = z
    .object({ templateId: z.string().uuid(), ...sessionStartOverridesShape })
    .strict();

/** Start an in-progress session by repeating a previous session's performed structure as the plan. */
export const startPreviousTrainingSessionRequestSchema = z
    .object({ sourceSessionId: z.string().uuid(), ...sessionStartOverridesShape })
    .strict();

/** Append one activity to a session (strength occurrences omit the snapshot; the server resolves it). */
export const addSessionActivityRequestSchema = z.object({ activity: sessionActivityRequestSchema }).strict();

/** Reorder a session's activities by supplying the complete ordered list of activity IDs. */
export const reorderSessionActivitiesRequestSchema = z
    .object({ activityIds: z.array(z.string().uuid()).min(1) })
    .strict();

/** Substitute the exercise of an existing occurrence, recording a `substituted` occurrence mapping. */
export const substituteOccurrenceRequestSchema = z
    .object({
        activityId: z.string().uuid(),
        occurrenceId: z.string().uuid(),
        newExerciseId: z.string().uuid(),
        prescribedExerciseId: z.string().uuid().nullable().optional(),
        reason: z.string().max(500).nullable().optional(),
    })
    .strict();

/** A planned/actual mapping to attach to a recorded set; the server fills in the performed set ID. */
const performedSetMappingDraftSchema = z
    .object({
        id: z.string().uuid().optional(),
        prescribedSetId: z.string().uuid().nullable().optional(),
        relation: mappingRelationSchema,
        portion: z.string().nullable().optional(),
        reason: z.string().max(500).nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

/** Record (create or replace) one performed set inside an occurrence, with an optional mapping. */
export const recordPerformedSetRequestSchema = z
    .object({
        activityId: z.string().uuid(),
        occurrenceId: z.string().uuid(),
        set: performedSetRequestSchema,
        mapping: performedSetMappingDraftSchema.nullable().optional(),
    })
    .strict();

/** Patch an existing performed set (partial fields), optionally updating its mapping. */
export const updatePerformedSetRequestSchema = z
    .object({
        setType: performedSetTypeSchema.optional(),
        status: performedSetStatusSchema.optional(),
        round: z.number().int().positive().nullable().optional(),
        position: z.number().int().nonnegative().optional(),
        measurements: performedSetMeasurementsRequestSchema.optional(),
        failureReason: setFailureReasonSchema.nullable().optional(),
        technique: scale1to5.nullable().optional(),
        discomfort: scale1to5.nullable().optional(),
        pump: scale1to5.nullable().optional(),
        notes: notesSchema.nullable().optional(),
        mapping: performedSetMappingDraftSchema.nullable().optional(),
    })
    .strict();

/** Upsert (create or replace) the manual running summary of a running-type activity (PRD R1). */
export const setRunningActivityRequestSchema = z
    .object({ activityId: z.string().uuid(), running: runningActivityRequestSchema })
    .strict();

/** Bounded running-summary read projection: the summary plus its derived pace for one activity. */
export const runningActivitySummaryResponseSchema = z
    .object({ activityId: z.string().uuid(), running: runningActivityResponseSchema })
    .strict();

// ---------------------------------------------------------------------------------------------
// Run-centric surface (design §11.3–11.4, §18–19; PRD R3) — an ergonomic adapter over the
// TrainingSession root for manual and mixed run/strength workouts. `kin run` and the web
// `/training/runs` page speak these contracts; the server records them through the very same
// TrainingSession commands (no parallel running backend).
// ---------------------------------------------------------------------------------------------

/** Activity-level fields a run may carry independently of its running summary (AC-2 durations/effort). */
const runActivityFieldsShape = {
    durationSeconds: z.number().int().nonnegative().nullable().optional(),
    rpe: scale0to10.nullable().optional(),
    feeling: z.string().max(2_000).nullable().optional(),
    notes: notesSchema.nullable().optional(),
    tags: z.array(tagSchema).optional(),
} as const;

/** Create and complete a manual run (a session with one running activity) in one call (design §19). */
export const addRunRequestSchema = z
    .object({
        localDate: localDateSchema.optional(),
        timeZone: timeZoneSchema.optional(),
        title: titleSchema.nullable().optional(),
        readiness: preWorkoutReadinessRequestSchema.optional(),
        postWorkout: postWorkoutRatingsRequestSchema.optional(),
        activityId: z.string().uuid().optional(),
        ...runActivityFieldsShape,
        running: runningActivityRequestSchema,
        painRecords: z.array(painRecordRequestSchema).optional(),
        mappings: recordSessionMappingsRequestSchema.optional(),
    })
    .strict();

/** Replace a run's summary/structured detail (and optionally its plan mappings) for one activity. */
export const updateRunRequestSchema = z
    .object({
        running: runningActivityRequestSchema,
        mappings: recordSessionMappingsRequestSchema.optional(),
    })
    .strict();

/** Full run-centric detail read: the enclosing session's metadata plus this run activity and its mappings. */
export const runViewResponseSchema = z
    .object({
        sessionId: z.string().uuid(),
        version: z.number().int().positive(),
        activityId: z.string().uuid(),
        localDate: z.string(),
        timeZone: z.string(),
        status: trainingSessionStatusSchema,
        title: z.string().nullable(),
        archivedAt: z.string().datetime().nullable(),
        durationSeconds: z.number().int().nonnegative().nullable(),
        rpe: scale0to10.nullable(),
        feeling: z.string().nullable(),
        notes: z.string().nullable(),
        tags: z.array(z.string()),
        running: runningActivityResponseSchema,
        activityMapping: activityMappingResponseSchema.nullable(),
        runStepMappings: z.array(runStepMappingResponseSchema),
        plannedLinks: z.array(sessionPlannedLinkResponseSchema),
    })
    .strict();

/** Bounded run-list projection (design §18.3 query separation): scalar metadata + derived pace. */
export const runListItemResponseSchema = z
    .object({
        sessionId: z.string().uuid(),
        activityId: z.string().uuid(),
        version: z.number().int().positive(),
        localDate: z.string(),
        status: trainingSessionStatusSchema,
        title: z.string().nullable(),
        archivedAt: z.string().datetime().nullable(),
        distanceMetres: z.string().nullable(),
        movingTimeMs: z.string().nullable(),
        derivedPaceSecondsPerKm: z.number().nullable(),
        runTags: z.array(z.string()),
    })
    .strict();

export const runListResponseSchema = z.object({ items: z.array(runListItemResponseSchema) }).strict();

export type TrainingSessionStatusValue = z.infer<typeof trainingSessionStatusSchema>;
export type SessionActivityTypeValue = z.infer<typeof sessionActivityTypeSchema>;
export type PainSideValue = z.infer<typeof painSideSchema>;
export type TrainingSessionSummary = z.infer<typeof trainingSessionSummarySchema>;
export type TrainingSessionResponse = z.infer<typeof trainingSessionResponseSchema>;
export type TrainingSessionListResponse = z.infer<typeof trainingSessionListResponseSchema>;
export type TrainingSessionListQuery = z.infer<typeof trainingSessionListQuerySchema>;
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
export type RunningActivityRequest = z.infer<typeof runningActivityRequestSchema>;
export type RunStepType = z.infer<typeof runStepTypeSchema>;
export type PerformedRunStepRequest = z.infer<typeof performedRunStepRequestSchema>;
export type PerformedRunStepResponse = z.infer<typeof performedRunStepResponseSchema>;
export type RunSplitRequest = z.infer<typeof runSplitRequestSchema>;
export type RunSplitResponse = z.infer<typeof runSplitResponseSchema>;
export type RunZoneTimeRequest = z.infer<typeof runZoneTimeRequestSchema>;
export type RunZoneTimeResponse = z.infer<typeof runZoneTimeResponseSchema>;
export type RunRouteRequest = z.infer<typeof runRouteRequestSchema>;
export type RunRouteResponse = z.infer<typeof runRouteResponseSchema>;
export type PaceExclusionReasonValue = z.infer<typeof paceExclusionReasonSchema>;
export type SetRunningActivityRequest = z.infer<typeof setRunningActivityRequestSchema>;
export type RunningActivitySummaryResponse = z.infer<typeof runningActivitySummaryResponseSchema>;
export type CreateTrainingSessionRequest = z.infer<typeof createTrainingSessionRequestSchema>;
export type UpdateTrainingSessionRequest = z.infer<typeof updateTrainingSessionRequestSchema>;
export type StartTrainingSessionRequest = z.infer<typeof startTrainingSessionRequestSchema>;
export type StartPlannedTrainingSessionRequest = z.infer<typeof startPlannedTrainingSessionRequestSchema>;
export type RecordSessionMappingsRequest = z.infer<typeof recordSessionMappingsRequestSchema>;
export type MappingRelationValue = z.infer<typeof mappingRelationSchema>;
export type CompleteTrainingSessionRequest = z.infer<typeof completeTrainingSessionRequestSchema>;
export type ActiveTrainingSessionResponse = z.infer<typeof activeTrainingSessionResponseSchema>;
export type CompletionPreviewResponse = z.infer<typeof completionPreviewResponseSchema>;
export type PlannedActualOutcomeValue = z.infer<typeof plannedActualOutcomeSchema>;
export type StartEmptyTrainingSessionRequest = z.infer<typeof startEmptyTrainingSessionRequestSchema>;
export type StartTemplateTrainingSessionRequest = z.infer<typeof startTemplateTrainingSessionRequestSchema>;
export type StartPreviousTrainingSessionRequest = z.infer<typeof startPreviousTrainingSessionRequestSchema>;
export type AddSessionActivityRequest = z.infer<typeof addSessionActivityRequestSchema>;
export type ReorderSessionActivitiesRequest = z.infer<typeof reorderSessionActivitiesRequestSchema>;
export type SubstituteOccurrenceRequest = z.infer<typeof substituteOccurrenceRequestSchema>;
export type RecordPerformedSetRequest = z.infer<typeof recordPerformedSetRequestSchema>;
export type UpdatePerformedSetRequest = z.infer<typeof updatePerformedSetRequestSchema>;
export type AddRunRequest = z.infer<typeof addRunRequestSchema>;
export type UpdateRunRequest = z.infer<typeof updateRunRequestSchema>;
export type RunViewResponse = z.infer<typeof runViewResponseSchema>;
export type RunListItemResponse = z.infer<typeof runListItemResponseSchema>;
export type RunListResponse = z.infer<typeof runListResponseSchema>;
