import { z } from "zod";

import { distanceSchema, durationSchema, massSchema, speedOrPaceSchema } from "#src/measurements";
import { planningWarningSchema, programBlockTypeSchema, programScheduleModeSchema } from "#src/program";
import {
    prescribedRunStepTypeSchema,
    prescribedSetGroupTypeSchema,
    prescribedSetTypeSchema,
    sessionPrescriptionResponseSchema,
    substitutionPolicySchema,
} from "#src/session-prescription";
import {
    exerciseClassificationSchema,
    exerciseLateralitySchema,
    exerciseLoadModelSchema,
    exerciseMeasurementTypeSchema,
    repetitionSemanticsSchema,
} from "#src/training-catalog";

/**
 * Versioned bulk JSON contract (PRD BI-1–5, design 14.1–14.2). An agent cleans source data
 * upstream and submits a complete normalized program through the dry-run boundary. Every payload
 * carries a required `schemaVersion` and a `source` namespace, and every bulk-addressable element
 * may carry a stable `externalId` for safe retries and later idempotent upserts.
 *
 * Dry-run is the safety and compatibility boundary: it resolves catalog references, normalizes
 * measurements to canonical units, expands relative schedules, runs every domain invariant, and
 * returns exactly what would be committed — with zero program/catalog side effects beyond storing
 * the preview artifact itself.
 */

const externalIdSchema = z.string().trim().min(1).max(200);
const nameSchema = z.string().trim().min(1).max(160);
const descriptionSchema = z.string().max(4_000);
const focusSchema = z.string().max(500);
const slugSchema = z.string().trim().min(1).max(80);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date");
const preferredTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be an HH:MM time");
const nonNegativeInt = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();
const ms = z.number().int().nonnegative();
const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal");

// ---------------------------------------------------------------------------------------------
// Exercise references and proposed custom exercises
// ---------------------------------------------------------------------------------------------

/**
 * A reference to a catalog exercise. Dry-run resolves it to a concrete exercise id + snapshot,
 * or reports it as missing/ambiguous requiring caller mapping (BI-5). `by: "alias"` resolves a
 * unique alias first, then falls back to a name search so multiple matches surface as ambiguous.
 */
export const bulkExerciseReferenceSchema = z
    .discriminatedUnion("by", [
        z.object({ by: z.literal("id"), exerciseId: z.string().uuid() }).strict(),
        z
            .object({
                by: z.literal("externalId"),
                provider: z.string().trim().min(1).max(120),
                externalId: z.string().trim().min(1).max(500),
            })
            .strict(),
        z.object({ by: z.literal("alias"), alias: z.string().trim().min(1).max(200) }).strict(),
    ])
    .describe("A reference to an exercise resolved against the catalog during dry-run");

/**
 * Definition metadata for a proposed custom exercise. Trusted callers request creation of missing
 * exercises via `createMissingExercises`; the proposed definition is validated and previewed in
 * dry-run but never persisted (BI-5).
 */
export const bulkProposedExerciseSchema = z
    .object({
        name: nameSchema,
        slug: slugSchema.optional(),
        equipmentTypeId: z.string().uuid(),
        movementPatternId: z.string().uuid(),
        classification: exerciseClassificationSchema,
        laterality: exerciseLateralitySchema,
        bodyPosition: z.string().trim().min(1).max(120),
        repetitionSemantics: repetitionSemanticsSchema,
        loadModel: exerciseLoadModelSchema,
        supportedMeasurements: z.array(exerciseMeasurementTypeSchema).min(1),
        muscles: z
            .array(z.object({ muscleGroupId: z.string().uuid(), role: z.enum(["primary", "secondary"]) }).strict())
            .optional(),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Entered-unit targets (normalized to canonical measurements during dry-run)
// ---------------------------------------------------------------------------------------------

const tempoSchema = z
    .object({
        eccentricMs: ms.nullable().optional(),
        bottomPauseMs: ms.nullable().optional(),
        concentricMs: ms.nullable().optional(),
        topPauseMs: ms.nullable().optional(),
    })
    .strict();

/**
 * Strength set targets in entered units. Load is a `{ value, unit }` mass (kg/lb) and rest is a
 * duration; both are normalized to canonical kg/ms during dry-run. Reps/effort/percentages are
 * already-canonical scalars. Load modes (absolute load, percent 1RM, percent training max) are
 * mutually exclusive — enforced by the domain, surfaced as a path error in dry-run.
 */
export const bulkStrengthSetTargetsSchema = z
    .object({
        repsMin: nonNegativeInt.nullable().optional(),
        repsMax: nonNegativeInt.nullable().optional(),
        loadMin: massSchema.nullable().optional(),
        loadMax: massSchema.nullable().optional(),
        percent1rm: decimalString.nullable().optional(),
        percentTrainingMax: decimalString.nullable().optional(),
        rpeMin: decimalString.nullable().optional(),
        rpeMax: decimalString.nullable().optional(),
        rirMin: nonNegativeInt.nullable().optional(),
        rirMax: nonNegativeInt.nullable().optional(),
        restMin: durationSchema.nullable().optional(),
        restMax: durationSchema.nullable().optional(),
        tempo: tempoSchema.nullable().optional(),
    })
    .strict();

/** Running step targets in entered units; distance/duration/speed(pace) are normalized. */
export const bulkRunStepTargetsSchema = z
    .object({
        durationMin: durationSchema.nullable().optional(),
        durationMax: durationSchema.nullable().optional(),
        distanceMin: distanceSchema.nullable().optional(),
        distanceMax: distanceSchema.nullable().optional(),
        speedMin: speedOrPaceSchema.nullable().optional(),
        speedMax: speedOrPaceSchema.nullable().optional(),
        hrMin: nonNegativeInt.nullable().optional(),
        hrMax: nonNegativeInt.nullable().optional(),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Prescription (inline per session)
// ---------------------------------------------------------------------------------------------

const bulkSetSchema = z
    .object({
        externalId: externalIdSchema.optional(),
        ref: z.string().min(1).max(120).optional(),
        setGroupRef: z.string().min(1).max(120).nullable().optional(),
        position: nonNegativeInt,
        round: positiveInt.nullable().optional(),
        setType: prescribedSetTypeSchema,
        targets: bulkStrengthSetTargetsSchema.optional(),
        notes: z.string().max(2_000).nullable().optional(),
    })
    .strict();

const bulkStrengthExerciseSchema = z
    .object({
        externalId: externalIdSchema.optional(),
        ref: z.string().min(1).max(120),
        reference: bulkExerciseReferenceSchema,
        proposed: bulkProposedExerciseSchema.optional(),
        position: nonNegativeInt,
        purpose: z.string().max(500).nullable().optional(),
        substitutionPolicy: substitutionPolicySchema.nullable().optional(),
        sets: z.array(bulkSetSchema),
    })
    .strict();

const bulkSetGroupSchema = z
    .object({
        externalId: externalIdSchema.optional(),
        ref: z.string().min(1).max(120),
        parentGroupRef: z.string().min(1).max(120).nullable().optional(),
        type: prescribedSetGroupTypeSchema,
        position: nonNegativeInt,
        rounds: positiveInt.nullable().optional(),
        restMs: ms.nullable().optional(),
        members: z.array(z.object({ exerciseRef: z.string().min(1).max(120), position: nonNegativeInt }).strict()),
    })
    .strict();

const bulkRunStepSchema = z
    .object({
        externalId: externalIdSchema.optional(),
        ref: z.string().min(1).max(120),
        parentStepRef: z.string().min(1).max(120).nullable().optional(),
        type: prescribedRunStepTypeSchema,
        position: nonNegativeInt,
        repeatCount: positiveInt.nullable().optional(),
        targets: bulkRunStepTargetsSchema.optional(),
        notes: z.string().max(2_000).nullable().optional(),
    })
    .strict();

/** One activity within a session prescription: a strength block or a running block. */
export const bulkActivitySchema = z.discriminatedUnion("type", [
    z
        .object({
            type: z.literal("strength"),
            externalId: externalIdSchema.optional(),
            position: nonNegativeInt,
            expectedDurationMs: ms.nullable().optional(),
            rpeTarget: decimalString.nullable().optional(),
            notes: z.string().max(2_000).nullable().optional(),
            exercises: z.array(bulkStrengthExerciseSchema).min(1),
            setGroups: z.array(bulkSetGroupSchema).optional(),
        })
        .strict(),
    z
        .object({
            type: z.literal("running"),
            externalId: externalIdSchema.optional(),
            position: nonNegativeInt,
            expectedDurationMs: ms.nullable().optional(),
            rpeTarget: decimalString.nullable().optional(),
            notes: z.string().max(2_000).nullable().optional(),
            runTags: z.array(slugSchema).optional(),
            overallTargets: bulkRunStepTargetsSchema.optional(),
            steps: z.array(bulkRunStepSchema).min(1),
        })
        .strict(),
]);

export const bulkPrescriptionSchema = z
    .object({
        expectedDurationMs: ms.nullable().optional(),
        notes: descriptionSchema.nullable().optional(),
        activities: z.array(bulkActivitySchema).min(1),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Program tree
// ---------------------------------------------------------------------------------------------

/** Blocks reference parents by stable `externalId`; dry-run mints UUIDs and resolves the tree. */
export const bulkProgramBlockSchema = z
    .object({
        externalId: externalIdSchema,
        parentExternalId: externalIdSchema.nullable().optional(),
        type: programBlockTypeSchema,
        label: z.string().trim().min(1).max(160).nullable().optional(),
        position: nonNegativeInt,
        startDate: localDateSchema.nullable().optional(),
        endDate: localDateSchema.nullable().optional(),
        relativeStartWeek: nonNegativeInt.nullable().optional(),
        relativeEndWeek: nonNegativeInt.nullable().optional(),
        focus: focusSchema.nullable().optional(),
        targetMuscles: z.array(slugSchema).optional(),
        targetVolume: z.string().max(120).nullable().optional(),
        targetIntensity: z.string().max(120).nullable().optional(),
        deload: z.boolean().optional(),
        expectedAdaptations: z.string().max(2_000).nullable().optional(),
        notes: z.string().max(2_000).nullable().optional(),
        tags: z.array(slugSchema).optional(),
    })
    .strict();

export const bulkProgramSessionSchema = z
    .object({
        externalId: externalIdSchema,
        title: nameSchema.nullable().optional(),
        sequence: nonNegativeInt,
        relativeWeek: nonNegativeInt.nullable().optional(),
        relativeDay: nonNegativeInt.nullable().optional(),
        preferredTime: preferredTimeSchema.nullable().optional(),
        timeZone: z.string().max(80).nullable().optional(),
        expectedDurationMinutes: positiveInt.nullable().optional(),
        notes: z.string().max(2_000).nullable().optional(),
        tags: z.array(slugSchema).optional(),
        blockExternalIds: z.array(externalIdSchema).optional(),
        prescription: bulkPrescriptionSchema,
    })
    .strict();

export const bulkProgramInputSchema = z
    .object({
        externalId: externalIdSchema.optional(),
        name: nameSchema,
        description: descriptionSchema.nullable().optional(),
        scheduleMode: programScheduleModeSchema.optional(),
        startDate: localDateSchema.nullable().optional(),
        endDate: localDateSchema.nullable().optional(),
        focus: focusSchema.nullable().optional(),
        goalIds: z.array(z.string().uuid()).optional(),
        blocks: z.array(bulkProgramBlockSchema).optional(),
        sessions: z.array(bulkProgramSessionSchema).optional(),
    })
    .strict();

/** Top-level versioned envelope (design 14.1). */
export const bulkProgramEnvelopeSchema = z
    .object({
        schemaVersion: z.literal(1),
        source: z
            .object({
                namespace: z.string().trim().min(1).max(120),
                generatedBy: z.string().trim().min(1).max(200).optional(),
            })
            .strict(),
        mode: z.enum(["create", "upsert"]),
        createMissingExercises: z.boolean().optional(),
        program: bulkProgramInputSchema,
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Dry-run response
// ---------------------------------------------------------------------------------------------

export const bulkDryRunStateSchema = z.enum(["ready", "needs_mapping"]);

/** A path-anchored validation error (design 14.2: "validation errors with paths"). */
export const bulkDryRunErrorSchema = z
    .object({
        path: z.array(z.union([z.string(), z.number()])),
        code: z.string(),
        message: z.string(),
    })
    .strict();

export const bulkExerciseMappingStatusSchema = z.enum(["missing", "ambiguous"]);

/** A resolution requirement for an unresolved exercise, with suggested candidates when ambiguous. */
export const bulkExerciseMappingSchema = z
    .object({
        path: z.array(z.union([z.string(), z.number()])),
        sessionExternalId: externalIdSchema,
        exerciseRef: z.string(),
        status: bulkExerciseMappingStatusSchema,
        requested: bulkExerciseReferenceSchema,
        candidates: z
            .array(z.object({ exerciseId: z.string().uuid(), slug: z.string(), name: z.string() }).strict())
            .optional(),
    })
    .strict();

/** A custom exercise that would be created on commit when `createMissingExercises` is set (BI-5). */
export const bulkProposedExercisePreviewSchema = z
    .object({
        exerciseId: z.string().uuid(),
        exerciseRef: z.string(),
        sessionExternalId: externalIdSchema,
        definition: bulkProposedExerciseSchema,
    })
    .strict();

export const bulkAffectedVersionSchema = z
    .object({
        entityType: z.string(),
        entityId: z.string(),
        version: z.number().int().positive(),
    })
    .strict();

const bulkNormalizedBlockSchema = z
    .object({
        id: z.string().uuid(),
        externalId: externalIdSchema,
        parentBlockId: z.string().uuid().nullable(),
        type: programBlockTypeSchema,
        label: z.string().nullable(),
        position: nonNegativeInt,
        startDate: z.string().nullable(),
        endDate: z.string().nullable(),
        relativeStartWeek: nonNegativeInt.nullable(),
        relativeEndWeek: nonNegativeInt.nullable(),
        focus: z.string().nullable(),
        targetMuscles: z.array(z.string()),
        targetVolume: z.string().nullable(),
        targetIntensity: z.string().nullable(),
        deload: z.boolean(),
        expectedAdaptations: z.string().nullable(),
        notes: z.string().nullable(),
        tags: z.array(z.string()),
    })
    .strict();

const bulkNormalizedSessionSchema = z
    .object({
        id: z.string().uuid(),
        externalId: externalIdSchema,
        title: z.string().nullable(),
        sequence: nonNegativeInt,
        relativeWeek: nonNegativeInt.nullable(),
        relativeDay: nonNegativeInt.nullable(),
        localDate: z.string().nullable(),
        preferredTime: z.string().nullable(),
        timeZone: z.string().nullable(),
        expectedDurationMinutes: positiveInt.nullable(),
        notes: z.string().nullable(),
        tags: z.array(z.string()),
        blockIds: z.array(z.string().uuid()),
        prescription: sessionPrescriptionResponseSchema.nullable(),
    })
    .strict();

/** The complete normalized program tree that would be committed (design 14.2 step 8). */
export const bulkNormalizedProgramSchema = z
    .object({
        id: z.string().uuid(),
        externalId: externalIdSchema.nullable(),
        profileId: z.string().uuid(),
        name: z.string(),
        description: z.string().nullable(),
        scheduleMode: programScheduleModeSchema,
        startDate: z.string().nullable(),
        endDate: z.string().nullable(),
        focus: z.string().nullable(),
        goalIds: z.array(z.string().uuid()),
        blocks: z.array(bulkNormalizedBlockSchema),
        sessions: z.array(bulkNormalizedSessionSchema),
    })
    .strict();

export const bulkDryRunResponseSchema = z
    .object({
        dryRunId: z.string().uuid(),
        approvalToken: z.string(),
        referenceHash: z.string(),
        schemaVersion: z.literal(1),
        mode: z.enum(["create", "upsert"]),
        source: z.object({ namespace: z.string(), generatedBy: z.string().nullable() }).strict(),
        state: bulkDryRunStateSchema,
        createdAt: z.string(),
        expiresAt: z.string(),
        program: bulkNormalizedProgramSchema,
        generatedSessionCount: z.number().int().nonnegative(),
        warnings: z.array(planningWarningSchema),
        errors: z.array(bulkDryRunErrorSchema),
        mappings: z.array(bulkExerciseMappingSchema),
        proposedExercises: z.array(bulkProposedExercisePreviewSchema),
        affectedVersions: z.array(bulkAffectedVersionSchema),
    })
    .strict();

export type BulkExerciseReference = z.infer<typeof bulkExerciseReferenceSchema>;
export type BulkProposedExercise = z.infer<typeof bulkProposedExerciseSchema>;
export type BulkStrengthSetTargets = z.infer<typeof bulkStrengthSetTargetsSchema>;
export type BulkRunStepTargets = z.infer<typeof bulkRunStepTargetsSchema>;
export type BulkActivity = z.infer<typeof bulkActivitySchema>;
export type BulkPrescription = z.infer<typeof bulkPrescriptionSchema>;
export type BulkProgramBlock = z.infer<typeof bulkProgramBlockSchema>;
export type BulkProgramSession = z.infer<typeof bulkProgramSessionSchema>;
export type BulkProgramInput = z.infer<typeof bulkProgramInputSchema>;
export type BulkProgramEnvelope = z.infer<typeof bulkProgramEnvelopeSchema>;
export type BulkDryRunState = z.infer<typeof bulkDryRunStateSchema>;
export type BulkDryRunError = z.infer<typeof bulkDryRunErrorSchema>;
export type BulkExerciseMapping = z.infer<typeof bulkExerciseMappingSchema>;
export type BulkProposedExercisePreview = z.infer<typeof bulkProposedExercisePreviewSchema>;
export type BulkAffectedVersion = z.infer<typeof bulkAffectedVersionSchema>;
export type BulkNormalizedProgram = z.infer<typeof bulkNormalizedProgramSchema>;
export type BulkDryRunResponse = z.infer<typeof bulkDryRunResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Commit (design 14.3)
// ---------------------------------------------------------------------------------------------

/**
 * Commit request (design 14.3). Commit accepts only the dry-run identity plus its approval token
 * — never a replacement program body. Retries carry an `Idempotency-Key` header. The approved
 * normalized tree stored under `dryRunId` is what commits; a caller cannot smuggle in a modified
 * payload here.
 */
export const bulkCommitRequestSchema = z
    .object({
        dryRunId: z.string().uuid(),
        approvalToken: z.string().trim().min(1).max(200),
    })
    .strict();

/** A catalog exercise created on commit because it was proposed in the dry-run (BI-5). */
export const bulkCommittedExerciseSchema = z
    .object({
        exerciseId: z.string().uuid(),
        exerciseRef: z.string(),
        sessionExternalId: externalIdSchema,
    })
    .strict();

/** A planned session created on commit, with its immutable prescription id. */
export const bulkCommittedSessionSchema = z
    .object({
        id: z.string().uuid(),
        externalId: externalIdSchema,
        prescriptionId: z.string().uuid().nullable(),
    })
    .strict();

/** Result of a successful commit: the authoritative identities that entered Training state. */
export const bulkCommitResponseSchema = z
    .object({
        dryRunId: z.string().uuid(),
        programId: z.string().uuid(),
        programVersion: z.number().int().positive(),
        mode: z.enum(["create", "upsert"]),
        source: z.object({ namespace: z.string(), generatedBy: z.string().nullable() }).strict(),
        committedAt: z.string(),
        sessions: z.array(bulkCommittedSessionSchema),
        createdExercises: z.array(bulkCommittedExerciseSchema),
        affectedVersions: z.array(bulkAffectedVersionSchema),
        warnings: z.array(planningWarningSchema),
    })
    .strict();

export type BulkCommitRequest = z.infer<typeof bulkCommitRequestSchema>;
export type BulkCommittedExercise = z.infer<typeof bulkCommittedExerciseSchema>;
export type BulkCommittedSession = z.infer<typeof bulkCommittedSessionSchema>;
export type BulkCommitResponse = z.infer<typeof bulkCommitResponseSchema>;
