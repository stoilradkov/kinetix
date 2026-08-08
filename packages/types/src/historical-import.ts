import { z } from "zod";

import {
    bulkAffectedVersionSchema,
    bulkCommittedExerciseSchema,
    bulkDryRunErrorSchema,
    bulkDryRunStateSchema,
    bulkExerciseMappingSchema,
    bulkNormalizedProgramSchema,
    bulkProgramInputSchema,
    bulkProposedExerciseSchema,
    bulkProposedExercisePreviewSchema,
} from "#src/bulk-program";
import { cadenceSchema, distanceSchema, durationSchema, heartRateSchema } from "#src/measurements";
import { planningWarningSchema } from "#src/program";
import { importEntityTypeSchema } from "#src/import-batch";
import { storagePlanCountsSchema, storageReconciliationPlanSchema } from "#src/storage-reconciliation";
import {
    mappingRelationSchema,
    painSideSchema,
    performedSetMeasurementsRequestSchema,
    performedSetStatusSchema,
    performedSetTypeSchema,
    postWorkoutRatingsRequestSchema,
    preWorkoutReadinessRequestSchema,
    runStepTypeSchema,
    setFailureReasonSchema,
    setGroupTypeSchema,
    trainingSessionResponseSchema,
} from "#src/training-session";

/**
 * Versioned canonical historical-import contract (issue #55, design §14; ADR 0001 and 0003). Where
 * {@link bulkProgramInputSchema} carries exactly one already-normalized program, this envelope is the
 * missing historical boundary: it carries **multiple** normalized program trees **together with**
 * completed {@link TrainingSession}s, so a multi-year archive commits as one deterministic payload.
 *
 * The caller has already resolved names, dates, units, RPE, bodyweight/load semantics, exclusions,
 * duplicates, and same-day session identity upstream. Kinetix therefore accepts an authoritative,
 * already-normalized payload and interprets nothing: no spreadsheet parsing, no fuzzy exercise
 * matching, no effort/load/date inference (all explicitly out of scope for #55). Every value is
 * treated as authoritative input subject only to normal domain validation.
 *
 * Design invariants preserved from the live contracts:
 *  - Plans and performances stay separate aggregates (design decision 2). Programs reuse the shipped
 *    {@link bulkProgramInputSchema}; completed sessions are an independent tree connected only through
 *    explicit optional {@link historicalProgramMappingSchema} mappings.
 *  - Canonical measurements are entered `{ value, unit }` objects normalized downstream to canonical
 *    columns (ADR 0001); JSON numbers appear only at this validated boundary.
 *  - The omitted / explicit-`null` / known-zero distinction is preserved everywhere: an omitted
 *    property means "no value / no update", explicit `null` clears, and `0` is a known zero.
 *  - Every import-addressable aggregate carries a stable string `externalId` so retries and later
 *    idempotent upserts address the same entity deterministically.
 *
 * Exercise references here are **canonical only** — a catalog `id`, `slug`, or provider `externalId`.
 * Unlike the plan-side bulk contract there is deliberately no alias/name variant: a name Kinetix would
 * have to resolve is an "unresolved name" and is rejected. A not-yet-catalogued exercise may be carried
 * only as an explicit, complete {@link bulkProposedExerciseSchema} definition.
 */

// ---------------------------------------------------------------------------------------------
// Shared leaves
// ---------------------------------------------------------------------------------------------

const externalIdSchema = z.string().trim().min(1).max(200);
const externalRefSchema = z.string().trim().min(1).max(200);
const titleSchema = z.string().trim().min(1).max(160);
const notesSchema = z.string().max(4_000);
const slugSchema = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be a lowercase kebab-case slug");
const timeZoneSchema = z.string().trim().min(1).max(80);
const tagSchema = z.string().trim().min(1).max(80);
const scale1to5 = z.number().int().min(1).max(5);
const painSeveritySchema = z.number().int().min(0).max(10);

/**
 * A calendar date with no time component. The pattern rejects date *ranges* ("2021-2022"),
 * placeholders ("TBD", "??"), and spreadsheet artifacts; the refinement additionally rejects
 * impossible calendar days ("2021-02-30") so a normalized archive cannot smuggle an invalid date.
 */
const localDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a single YYYY-MM-DD calendar date")
    .refine(value => {
        const year = Number(value.slice(0, 4));
        const month = Number(value.slice(5, 7));
        const day = Number(value.slice(8, 10));
        const date = new Date(Date.UTC(year, month - 1, day));
        return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    }, "Must be a real calendar date");

/**
 * An absolute UTC instant (matching the live session contract). `.datetime()` rejects date-only
 * values, date ranges, and placeholder strings; the session's IANA `timeZone` is carried separately.
 */
const instantSchema = z.string().datetime();

// ---------------------------------------------------------------------------------------------
// Canonical exercise reference (no fuzzy/name resolution)
// ---------------------------------------------------------------------------------------------

/**
 * A reference to an already-resolved catalog exercise. Only canonical selectors are accepted — a
 * catalog `id`, a stable `slug`, or a provider-scoped `externalId`. There is intentionally no
 * `alias`/name variant: an unresolved name is rejected at the contract boundary (#55: "Kinetix
 * provides no fuzzy mapping or naming suggestions").
 */
export const historicalExerciseReferenceSchema = z
    .discriminatedUnion("by", [
        z.object({ by: z.literal("id"), exerciseId: z.string().uuid() }).strict(),
        z.object({ by: z.literal("slug"), slug: slugSchema }).strict(),
        z
            .object({
                by: z.literal("externalId"),
                provider: z.string().trim().min(1).max(120),
                externalId: z.string().trim().min(1).max(500),
            })
            .strict(),
    ])
    .describe("A canonical, already-resolved reference to a catalog exercise");

// ---------------------------------------------------------------------------------------------
// Completed strength detail (performed occurrences, set groups, sets)
// ---------------------------------------------------------------------------------------------

/**
 * A performed set. `measurements` reuse the live session contract (entered `{ value, unit }` loads and
 * durations, scalar RPE in 0.5 increments), so an imported set is validated identically to one logged
 * in the app. Load fields keep the omitted/null/zero distinction: an omitted load is "not recorded",
 * explicit `null` clears, and `{ value: 0 }` is a known zero — there is no missing-load placeholder.
 */
export const historicalPerformedSetSchema = z
    .object({
        externalId: externalIdSchema,
        setGroupRef: externalRefSchema.nullable().optional(),
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

export const historicalExerciseOccurrenceSchema = z
    .object({
        externalId: externalIdSchema,
        reference: historicalExerciseReferenceSchema,
        proposed: bulkProposedExerciseSchema.optional(),
        position: z.number().int().nonnegative(),
        purpose: z.string().max(200).nullable().optional(),
        technique: scale1to5.nullable().optional(),
        discomfort: scale1to5.nullable().optional(),
        pump: scale1to5.nullable().optional(),
        notes: notesSchema.nullable().optional(),
        performedSets: z.array(historicalPerformedSetSchema),
    })
    .strict();

export const historicalSetGroupSchema = z
    .object({
        externalId: externalIdSchema,
        parentGroupRef: externalRefSchema.nullable().optional(),
        type: setGroupTypeSchema,
        position: z.number().int().nonnegative(),
        rounds: z.number().int().positive().nullable().optional(),
        restMs: z.number().int().nonnegative().nullable().optional(),
        members: z
            .array(z.object({ occurrenceRef: externalRefSchema, position: z.number().int().nonnegative() }).strict())
            .optional(),
    })
    .strict();

export const historicalStrengthActivitySchema = z
    .object({
        occurrences: z.array(historicalExerciseOccurrenceSchema).min(1),
        setGroups: z.array(historicalSetGroupSchema).optional(),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Completed running detail (performed steps + splits)
// ---------------------------------------------------------------------------------------------

/** Achieved measurements for a performed run step, in entered units normalized downstream (ADR 0001). */
const historicalRunStepMeasurementsSchema = z
    .object({
        distance: distanceSchema.nullable().optional(),
        duration: durationSchema.nullable().optional(),
        averageHeartRate: heartRateSchema.nullable().optional(),
        maxHeartRate: heartRateSchema.nullable().optional(),
        averageCadence: cadenceSchema.nullable().optional(),
        maxCadence: cadenceSchema.nullable().optional(),
        elevationGain: distanceSchema.nullable().optional(),
        elevationLoss: distanceSchema.nullable().optional(),
    })
    .strict();

export const historicalRunStepSchema = z
    .object({
        externalId: externalIdSchema,
        parentStepRef: externalRefSchema.nullable().optional(),
        type: runStepTypeSchema,
        position: z.number().int().nonnegative(),
        repeatCount: z.number().int().min(1).max(10_000).nullable().optional(),
        measurements: historicalRunStepMeasurementsSchema.optional(),
        notes: z.string().max(500).nullable().optional(),
    })
    .strict();

export const historicalRunSplitSchema = z
    .object({
        externalId: externalIdSchema,
        position: z.number().int().nonnegative(),
        distance: distanceSchema.nullable().optional(),
        movingTime: durationSchema.nullable().optional(),
        elapsedTime: durationSchema.nullable().optional(),
        averageHeartRate: heartRateSchema.nullable().optional(),
        maxHeartRate: heartRateSchema.nullable().optional(),
    })
    .strict();

/**
 * A completed running activity: canonical summary metrics plus the performed step/split trees keyed by
 * `externalId`. This is a bounded first-version subset of the live running contract (zones, routes, and
 * gear are deferred to a later schema version); strength — the primary #55 surface — is carried in full.
 */
export const historicalRunningActivitySchema = z
    .object({
        distance: distanceSchema.nullable().optional(),
        movingTime: durationSchema.nullable().optional(),
        elapsedTime: durationSchema.nullable().optional(),
        averageHeartRate: heartRateSchema.nullable().optional(),
        maxHeartRate: heartRateSchema.nullable().optional(),
        averageCadence: cadenceSchema.nullable().optional(),
        maxCadence: cadenceSchema.nullable().optional(),
        elevationGain: distanceSchema.nullable().optional(),
        elevationLoss: distanceSchema.nullable().optional(),
        indoor: z.boolean().optional(),
        treadmill: z.boolean().optional(),
        runTags: z.array(slugSchema).optional(),
        steps: z.array(historicalRunStepSchema).optional(),
        splits: z.array(historicalRunSplitSchema).optional(),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Completed session activity envelope
// ---------------------------------------------------------------------------------------------

/** One typed activity within a completed session: a strength block or a running block. */
export const historicalSessionActivitySchema = z.discriminatedUnion("type", [
    z
        .object({
            type: z.literal("strength"),
            externalId: externalIdSchema,
            position: z.number().int().nonnegative(),
            startedAt: instantSchema.nullable().optional(),
            endedAt: instantSchema.nullable().optional(),
            durationSeconds: z.number().int().nonnegative().nullable().optional(),
            rpe: z.number().int().min(0).max(10).nullable().optional(),
            feeling: z.string().max(2_000).nullable().optional(),
            notes: notesSchema.nullable().optional(),
            tags: z.array(tagSchema).optional(),
            strength: historicalStrengthActivitySchema,
        })
        .strict(),
    z
        .object({
            type: z.literal("running"),
            externalId: externalIdSchema,
            position: z.number().int().nonnegative(),
            startedAt: instantSchema.nullable().optional(),
            endedAt: instantSchema.nullable().optional(),
            durationSeconds: z.number().int().nonnegative().nullable().optional(),
            rpe: z.number().int().min(0).max(10).nullable().optional(),
            feeling: z.string().max(2_000).nullable().optional(),
            notes: notesSchema.nullable().optional(),
            tags: z.array(tagSchema).optional(),
            running: historicalRunningActivitySchema,
        })
        .strict(),
]);

export const historicalPainRecordSchema = z
    .object({
        externalId: externalIdSchema,
        activityRef: externalRefSchema.nullable().optional(),
        occurrenceRef: externalRefSchema.nullable().optional(),
        performedSetRef: externalRefSchema.nullable().optional(),
        bodyArea: z.string().trim().min(1).max(120),
        side: painSideSchema,
        severity: painSeveritySchema,
        painType: z.string().max(120).nullable().optional(),
        onsetDuringSession: z.boolean().optional(),
        stoppedActivity: z.boolean().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Completed-session → imported-program mappings (explicit, optional)
// ---------------------------------------------------------------------------------------------

/**
 * Optional link from a completed session to the imported program/planned-session it was performed
 * against, by their payload `externalId`s. Plans and performances stay separate aggregates (design
 * decision 2); this mapping is the only connection, and it is always optional — a historical session
 * with no surviving plan is fully valid.
 */
export const historicalSessionPlannedLinkSchema = z
    .object({
        programExternalId: externalRefSchema,
        plannedSessionExternalId: externalRefSchema,
    })
    .strict();

const historicalActivityMappingSchema = z
    .object({
        prescribedActivityExternalId: externalRefSchema.nullable().optional(),
        actualActivityRef: externalRefSchema,
        relation: mappingRelationSchema,
        reason: z.string().max(500).nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

const historicalOccurrenceMappingSchema = z
    .object({
        prescribedExerciseExternalId: externalRefSchema.nullable().optional(),
        occurrenceRef: externalRefSchema,
        relation: mappingRelationSchema,
        reason: z.string().max(500).nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

const historicalSetMappingSchema = z
    .object({
        prescribedSetExternalId: externalRefSchema.nullable().optional(),
        performedSetRef: externalRefSchema,
        relation: mappingRelationSchema,
        portion: z.string().max(120).nullable().optional(),
        reason: z.string().max(500).nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

/** Explicit planned/actual mappings for one completed session (design §11.4). Every part is optional. */
export const historicalProgramMappingSchema = z
    .object({
        plannedLink: historicalSessionPlannedLinkSchema.nullable().optional(),
        activities: z.array(historicalActivityMappingSchema).optional(),
        occurrences: z.array(historicalOccurrenceMappingSchema).optional(),
        sets: z.array(historicalSetMappingSchema).optional(),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Completed session
// ---------------------------------------------------------------------------------------------

/**
 * A completed historical TrainingSession. Identity is the payload `externalId`, never the timestamp, so
 * two distinct sessions on the same `localDate`/`startedAt` remain distinct (#55 acceptance: "Completed
 * sessions may remain distinct on the same timestamp/date"). `status` is fixed to `completed`; draft and
 * in-progress placeholders are not a historical import concern.
 */
export const historicalCompletedSessionSchema = z
    .object({
        externalId: externalIdSchema,
        status: z.literal("completed").optional(),
        title: titleSchema.nullable().optional(),
        localDate: localDateSchema,
        timeZone: timeZoneSchema,
        startedAt: instantSchema.nullable().optional(),
        endedAt: instantSchema.nullable().optional(),
        durationMinutes: z.number().int().nonnegative().nullable().optional(),
        readiness: preWorkoutReadinessRequestSchema.optional(),
        postWorkout: postWorkoutRatingsRequestSchema.optional(),
        notes: notesSchema.nullable().optional(),
        tags: z.array(tagSchema).optional(),
        activities: z.array(historicalSessionActivitySchema).min(1),
        painRecords: z.array(historicalPainRecordSchema).optional(),
        programMapping: historicalProgramMappingSchema.nullable().optional(),
    })
    .strict();

// ---------------------------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------------------------

/**
 * Payload identity for deterministic retries (#55: "payload ID/checksum ... for deterministic
 * retries"). `payloadId` is the caller's stable identifier for this exact archive; `checksum` is the
 * SHA-256 hex digest the caller computed over the canonical payload, which the ingestion boundary
 * re-verifies so a retried or resumed import is provably the same bytes.
 */
export const historicalImportSourceSchema = z
    .object({
        namespace: z.string().trim().min(1).max(120),
        generatedBy: z.string().trim().min(1).max(200).optional(),
        payloadId: z.string().trim().min(1).max(200),
        checksum: z.string().regex(/^[0-9a-f]{64}$/, "Must be a lowercase hex SHA-256 digest"),
    })
    .strict();

/**
 * Top-level versioned historical-import envelope (design §14). Carries any number of already-normalized
 * program trees and completed sessions in one payload; at least one aggregate of either kind must be
 * present. `mode` mirrors the bulk contract: `create` refuses to touch existing external IDs, `upsert`
 * addresses them by `(namespace, externalId)`.
 */
export const historicalImportEnvelopeSchema = z
    .object({
        schemaVersion: z.literal(1),
        source: historicalImportSourceSchema,
        mode: z.enum(["create", "upsert"]),
        createMissingExercises: z.boolean().optional(),
        programs: z.array(bulkProgramInputSchema).max(200).optional(),
        completedSessions: z.array(historicalCompletedSessionSchema).max(20_000).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        const programCount = value.programs?.length ?? 0;
        const sessionCount = value.completedSessions?.length ?? 0;
        if (programCount + sessionCount === 0)
            ctx.addIssue({
                code: "custom",
                message: "A historical import must contain at least one program or completed session",
                path: [],
            });
    });

export type HistoricalExerciseReference = z.infer<typeof historicalExerciseReferenceSchema>;
export type HistoricalPerformedSet = z.infer<typeof historicalPerformedSetSchema>;
export type HistoricalExerciseOccurrence = z.infer<typeof historicalExerciseOccurrenceSchema>;
export type HistoricalSetGroup = z.infer<typeof historicalSetGroupSchema>;
export type HistoricalStrengthActivity = z.infer<typeof historicalStrengthActivitySchema>;
export type HistoricalRunStep = z.infer<typeof historicalRunStepSchema>;
export type HistoricalRunSplit = z.infer<typeof historicalRunSplitSchema>;
export type HistoricalRunningActivity = z.infer<typeof historicalRunningActivitySchema>;
export type HistoricalSessionActivity = z.infer<typeof historicalSessionActivitySchema>;
export type HistoricalPainRecord = z.infer<typeof historicalPainRecordSchema>;
export type HistoricalSessionPlannedLink = z.infer<typeof historicalSessionPlannedLinkSchema>;
export type HistoricalProgramMapping = z.infer<typeof historicalProgramMappingSchema>;
export type HistoricalCompletedSession = z.infer<typeof historicalCompletedSessionSchema>;
export type HistoricalImportSource = z.infer<typeof historicalImportSourceSchema>;
export type HistoricalImportEnvelope = z.infer<typeof historicalImportEnvelopeSchema>;

// ---------------------------------------------------------------------------------------------
// Dry-run response (issue #58, HI4; design §14.2)
// ---------------------------------------------------------------------------------------------

/**
 * The normalized authoritative tree a commit would store for one completed historical session. It is
 * the live {@link trainingSessionResponseSchema} tree (activities, pain records, and planned/actual
 * mappings, all with minted UUIDs) minus the aggregate `version` — a dry-run has not persisted anything,
 * so no version exists yet — plus the caller's stable `externalId` so the preview stays addressable.
 */
export const historicalNormalizedSessionSchema = trainingSessionResponseSchema
    .omit({ version: true })
    .extend({ externalId: externalIdSchema })
    .strict();

/**
 * A concise entity/count summary of the whole import (design §14.2). `operations` totals the storage
 * plan by resolved operation; `entityTypeCounts` lists how many addressable entities of each kind the
 * payload carries, in a deterministic sorted order so the summary is stable across retries.
 */
export const historicalImportSummarySchema = z
    .object({
        programs: z.number().int().nonnegative(),
        completedSessions: z.number().int().nonnegative(),
        entities: z.number().int().nonnegative(),
        operations: storagePlanCountsSchema,
        entityTypeCounts: z.array(
            z.object({ entityType: importEntityTypeSchema, count: z.number().int().nonnegative() }).strict(),
        ),
    })
    .strict();

/**
 * The result of previewing an already-normalized historical import (design §14.2; issue #58, HI4).
 * Mirrors the single-program {@link bulkDryRunResponseSchema} but carries **many** normalized program
 * trees together with completed-session trees, plus the deterministic {@link storageReconciliationPlan}
 * (#57) stating a create / update / skip-identical / conflict outcome for every import-addressable
 * entity. No authoritative catalog, program, or session state is written; only the expiring artifact is
 * stored, keyed by `dryRunId` and guarded by `approvalToken` + `referenceHash` for a later commit.
 */
export const historicalImportDryRunResponseSchema = z
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
        programs: z.array(bulkNormalizedProgramSchema),
        completedSessions: z.array(historicalNormalizedSessionSchema),
        storagePlan: storageReconciliationPlanSchema,
        summary: historicalImportSummarySchema,
        warnings: z.array(planningWarningSchema),
        errors: z.array(bulkDryRunErrorSchema),
        mappings: z.array(bulkExerciseMappingSchema),
        proposedExercises: z.array(bulkProposedExercisePreviewSchema),
        affectedVersions: z.array(bulkAffectedVersionSchema),
    })
    .strict();

export type HistoricalNormalizedSession = z.infer<typeof historicalNormalizedSessionSchema>;
export type HistoricalImportSummary = z.infer<typeof historicalImportSummarySchema>;
export type HistoricalImportDryRunResponse = z.infer<typeof historicalImportDryRunResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Commit (issue #59, HI5; design §14.3, §14.7)
// ---------------------------------------------------------------------------------------------

/**
 * Start a commit of an approved historical dry-run (design §14.7). Like the single-program bulk commit
 * (14.3) it accepts only the dry-run identity and the approval token — never a replacement body, so a
 * caller cannot smuggle a payload that differs from what was previewed. The `Idempotency-Key` header
 * carries safe-retry semantics; the durable commit run additionally resumes deterministically from its
 * own checkpoint, so an interrupted commit never duplicates a program, session, activity, or set.
 */
export const historicalImportCommitRequestSchema = z
    .object({
        dryRunId: z.string().uuid(),
        approvalToken: z.string().trim().min(1).max(200),
    })
    .strict();

/**
 * Lifecycle of a durable historical-import commit run. `pending` is created but not yet applied,
 * `running` is mid-flight, `succeeded` applied every aggregate and consumed the dry-run, and `failed`
 * stopped on a batch error with a path-anchored {@link historicalImportCommitFailureSchema} — a `failed`
 * run is resumable by retry from its last committed checkpoint.
 */
export const historicalImportCommitStateSchema = z.enum(["pending", "running", "succeeded", "failed"]);

/**
 * Entity-level totals across every import-addressable entity (design §14.7). `created` and `skipped`
 * (already committed on a resumed run, or byte-identical) are the create-mode outcomes; `updated` and
 * `conflicted` are reserved for a later upsert increment and are `0` here.
 */
export const historicalImportCommitCountsSchema = z
    .object({
        created: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        conflicted: z.number().int().nonnegative(),
    })
    .strict();

/** One committed external-ID → Kinetix-ID binding, so any imported entity is traceable to its caller ID. */
export const historicalImportCommitEntitySchema = z
    .object({
        entityType: importEntityTypeSchema,
        externalId: externalIdSchema,
        entityId: z.string().uuid(),
    })
    .strict();

/**
 * Why a commit run stopped, anchored to the exact offending node in the canonical payload (`path`) so a
 * failed batch always identifies its source location. `entityType`/`externalId` name the aggregate that
 * failed when the failure is entity-scoped.
 */
export const historicalImportCommitFailureSchema = z
    .object({
        path: z.array(z.union([z.string(), z.number()])),
        code: z.string(),
        message: z.string(),
        entityType: importEntityTypeSchema.nullable(),
        externalId: externalIdSchema.nullable(),
    })
    .strict();

/**
 * The durable commit run resource (design §14.7). It is the result of `POST …/commits`, the body of
 * `GET …/commits/:id`, and the result of `POST …/commits/:id/retries`, so start, status, and retry all
 * share one shape. It carries the resolved import-batch identity, the entity counts, the deterministic
 * external-ID → Kinetix-ID mappings, the catalog exercises created for proposed definitions, the
 * affected catalog versions, and — on a `failed` run — the path-anchored failure. A byte-for-byte replay
 * (same dry-run/idempotency key) returns the identical resource.
 */
export const historicalImportCommitResponseSchema = z
    .object({
        commitId: z.string().uuid(),
        dryRunId: z.string().uuid(),
        importBatchId: z.string().uuid().nullable(),
        state: historicalImportCommitStateSchema,
        mode: z.enum(["create", "upsert"]),
        source: z.object({ namespace: z.string(), generatedBy: z.string().nullable() }).strict(),
        programs: z.number().int().nonnegative(),
        completedSessions: z.number().int().nonnegative(),
        counts: historicalImportCommitCountsSchema,
        entities: z.array(historicalImportCommitEntitySchema),
        createdExercises: z.array(bulkCommittedExerciseSchema),
        affectedVersions: z.array(bulkAffectedVersionSchema),
        warnings: z.array(planningWarningSchema),
        failure: historicalImportCommitFailureSchema.nullable(),
        createdAt: z.string(),
        startedAt: z.string().nullable(),
        completedAt: z.string().nullable(),
    })
    .strict();

export type HistoricalImportCommitRequest = z.infer<typeof historicalImportCommitRequestSchema>;
export type HistoricalImportCommitState = z.infer<typeof historicalImportCommitStateSchema>;
export type HistoricalImportCommitCounts = z.infer<typeof historicalImportCommitCountsSchema>;
export type HistoricalImportCommitEntity = z.infer<typeof historicalImportCommitEntitySchema>;
export type HistoricalImportCommitFailure = z.infer<typeof historicalImportCommitFailureSchema>;
export type HistoricalImportCommitResponse = z.infer<typeof historicalImportCommitResponseSchema>;

// ---------------------------------------------------------------------------------------------
// List and audit report (issue #60, HI6; design §14.7)
// ---------------------------------------------------------------------------------------------

/**
 * Lifecycle of a durable revert run (hoisted so the audit report can embed it). `pending`/`running` are
 * in-flight, `succeeded` archived every import-owned aggregate, `failed` stopped on an archive error
 * (resumable from its checkpoint), and `blocked` refused the whole revert because an aggregate was edited
 * after the import — the safe, history-preserving outcome that archives nothing.
 */
export const historicalImportRevertStateSchema = z.enum(["pending", "running", "succeeded", "failed", "blocked"]);

/**
 * One row in the active profile's historical-import list. Projected from the durable commit-run record
 * (never a live re-derivation), so listing is a cheap profile-scoped read: `programs`/`completedSessions`
 * are counted from the run's committed checkpoint, and `reverted` reflects whether a succeeded revert run
 * exists for the commit.
 */
export const historicalImportListItemSchema = z
    .object({
        commitId: z.string().uuid(),
        dryRunId: z.string().uuid(),
        importBatchId: z.string().uuid().nullable(),
        state: historicalImportCommitStateSchema,
        mode: z.enum(["create", "upsert"]),
        source: z.object({ namespace: z.string(), generatedBy: z.string().nullable() }).strict(),
        programs: z.number().int().nonnegative(),
        completedSessions: z.number().int().nonnegative(),
        attempts: z.number().int().nonnegative(),
        reverted: z.boolean(),
        createdAt: z.string(),
        startedAt: z.string().nullable(),
        completedAt: z.string().nullable(),
    })
    .strict();

/** The active profile's historical imports, newest first (design §14.7; issue #60, HI6). */
export const historicalImportListResponseSchema = z
    .object({
        items: z.array(historicalImportListItemSchema),
        count: z.number().int().nonnegative(),
    })
    .strict();

/**
 * One audited import-owned entity: its caller `externalId` bound to the stored Kinetix `entityId`, plus
 * the entity's current aggregate version and whether it is archived. `currentVersion` is `null` when the
 * entity no longer resolves (deleted out-of-band). This is the external-ID → Kinetix-ID → revision trace
 * the acceptance criteria require.
 */
export const historicalImportAuditEntitySchema = z
    .object({
        entityType: importEntityTypeSchema,
        externalId: externalIdSchema,
        entityId: z.string().uuid(),
        currentVersion: z.number().int().positive().nullable(),
        archived: z.boolean(),
    })
    .strict();

/** A compact revert summary embedded in the audit report so `report` shows whether an import was reverted. */
export const historicalImportRevertSummarySchema = z
    .object({
        revertId: z.string().uuid(),
        state: historicalImportRevertStateSchema,
        archived: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
        completedAt: z.string().nullable(),
    })
    .strict();

/**
 * The immutable storage audit for one committed historical import (design §14.7; issue #60, HI6). It is a
 * deterministic on-demand projection over already-immutable durable records — the commit run, the dry-run
 * artifact (payload checksum, storage plan, warnings, affected versions), and the append-only external-ID
 * registry — so it never mutates state and re-reads identically. It traces the canonical payload
 * (`checksum`, `payloadId`) through the storage plan to every stored Kinetix entity and its current
 * revision, records the created/updated/skipped/conflicted counts and any batch failure, and surfaces
 * whether the import was later reverted.
 */
export const historicalImportReportResponseSchema = z
    .object({
        commitId: z.string().uuid(),
        dryRunId: z.string().uuid(),
        importBatchId: z.string().uuid().nullable(),
        schemaVersion: z.literal(1),
        source: z.object({ namespace: z.string(), generatedBy: z.string().nullable() }).strict(),
        payloadId: z.string(),
        checksum: z.string(),
        mode: z.enum(["create", "upsert"]),
        state: historicalImportCommitStateSchema,
        programs: z.number().int().nonnegative(),
        completedSessions: z.number().int().nonnegative(),
        counts: historicalImportCommitCountsSchema,
        storagePlan: storageReconciliationPlanSchema,
        entities: z.array(historicalImportAuditEntitySchema),
        affectedVersions: z.array(bulkAffectedVersionSchema),
        warnings: z.array(planningWarningSchema),
        failure: historicalImportCommitFailureSchema.nullable(),
        revert: historicalImportRevertSummarySchema.nullable(),
        createdAt: z.string(),
        startedAt: z.string().nullable(),
        completedAt: z.string().nullable(),
    })
    .strict();

export type HistoricalImportListItem = z.infer<typeof historicalImportListItemSchema>;
export type HistoricalImportListResponse = z.infer<typeof historicalImportListResponseSchema>;
export type HistoricalImportAuditEntity = z.infer<typeof historicalImportAuditEntitySchema>;
export type HistoricalImportRevertSummary = z.infer<typeof historicalImportRevertSummarySchema>;
export type HistoricalImportReportResponse = z.infer<typeof historicalImportReportResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Revert (issue #60, HI6; design §14.7)
// ---------------------------------------------------------------------------------------------

/** One aggregate the revert archived, with the version it was at when archived (history-preserving). */
export const historicalImportRevertedEntitySchema = z
    .object({
        entityType: importEntityTypeSchema,
        entityId: z.string().uuid(),
        externalId: externalIdSchema,
        version: z.number().int().positive(),
    })
    .strict();

/**
 * One aggregate that blocked the revert because it was edited (or restored) after the import — archiving
 * it would overwrite a later user edit. `currentVersion` is its version now (`> 1`, or `null` if it no
 * longer resolves); `reason` names why it is unsafe.
 */
export const historicalImportBlockedEntitySchema = z
    .object({
        entityType: importEntityTypeSchema,
        entityId: z.string().uuid(),
        externalId: externalIdSchema,
        currentVersion: z.number().int().positive().nullable(),
        reason: z.string(),
    })
    .strict();

export const historicalImportRevertCountsSchema = z
    .object({
        archived: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
    })
    .strict();

/**
 * The durable revert run resource (design §14.7; issue #60, HI6). It is the result of
 * `POST …/commits/:id/reverts` and the body of `GET …/commits/:id/reverts`, so start, resume, and status
 * share one shape. A revert is keyed uniquely by its commit, so re-posting resumes or replays the same
 * run rather than starting a second. On a `blocked` state `archivedEntities` is empty and
 * `blockedEntities` lists what must be resolved first; on `failed` the path-anchored `failure` names the
 * aggregate that stopped the compensation.
 */
export const historicalImportRevertResponseSchema = z
    .object({
        revertId: z.string().uuid(),
        commitId: z.string().uuid(),
        importBatchId: z.string().uuid().nullable(),
        state: historicalImportRevertStateSchema,
        counts: historicalImportRevertCountsSchema,
        archivedEntities: z.array(historicalImportRevertedEntitySchema),
        blockedEntities: z.array(historicalImportBlockedEntitySchema),
        failure: historicalImportCommitFailureSchema.nullable(),
        createdAt: z.string(),
        startedAt: z.string().nullable(),
        completedAt: z.string().nullable(),
    })
    .strict();

export type HistoricalImportRevertState = z.infer<typeof historicalImportRevertStateSchema>;
export type HistoricalImportRevertedEntity = z.infer<typeof historicalImportRevertedEntitySchema>;
export type HistoricalImportBlockedEntity = z.infer<typeof historicalImportBlockedEntitySchema>;
export type HistoricalImportRevertCounts = z.infer<typeof historicalImportRevertCountsSchema>;
export type HistoricalImportRevertResponse = z.infer<typeof historicalImportRevertResponseSchema>;
