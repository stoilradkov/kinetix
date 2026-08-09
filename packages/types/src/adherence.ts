import { z } from "zod";

/**
 * Adherence wire contracts (issue #37, AD1; design §16.7). Adherence results are a derived analytics
 * projection: raw session/prescription facts stay authoritative and results may be recomputed and
 * superseded. These schemas expose read-only result/component/evidence projections plus the stable,
 * versioned formula-display metadata that AD2's UI depends on — never the persistence rows themselves.
 */

export const adherenceComponentKeySchema = z.enum([
    "session_completion",
    "activity_completion",
    "exercise_completion",
    "set_completion",
    "reps",
    "load",
    "volume",
    "duration",
    "distance",
    "pace",
    "step_completion",
    "intensity",
]);
export type AdherenceComponentKeyValue = z.infer<typeof adherenceComponentKeySchema>;

export const adherenceScopeSchema = z.enum(["session", "strength", "running", "mixed"]);
export type AdherenceScopeValue = z.infer<typeof adherenceScopeSchema>;

export const adherenceExclusionReasonSchema = z.enum([
    "missing_target",
    "missing_actual",
    "non_comparable",
    "cancelled",
    "no_load_model",
    "no_mapped_work",
]);
export type AdherenceExclusionReasonValue = z.infer<typeof adherenceExclusionReasonSchema>;

/**
 * Recalculation status of a stored adherence result (issue #38, AD2). Adherence is a derived projection
 * recomputed off session/mapping/plan changes by a durable worker, so a stored result can lag the facts.
 * `current` = up to date; `stale` = the session was revised after this result and no recompute is queued;
 * `pending` = a recompute job is queued or running; `failed` = the last recompute job ended in failure.
 */
export const adherenceStatusSchema = z.enum(["current", "stale", "pending", "failed"]);
export type AdherenceStatusValue = z.infer<typeof adherenceStatusSchema>;

/** The activity scope an adherence *result* can carry (never the session-only scope). */
export const adherenceResultScopeSchema = z.enum(["strength", "running", "mixed"]);
export type AdherenceResultScopeValue = z.infer<typeof adherenceResultScopeSchema>;

/** A 0–100 compliance percentage rounded to three decimals. */
const scoreSchema = z.number().min(0).max(100);

export const adherenceComponentResponseSchema = z
    .object({
        key: adherenceComponentKeySchema,
        scope: adherenceScopeSchema,
        score: scoreSchema.nullable(),
        weight: z.number().min(0),
        included: z.boolean(),
        exclusion: adherenceExclusionReasonSchema.nullable(),
        /** Inspectable evidence: the aggregated actual/planned quantities that produced the score. */
        inputs: z.record(z.string(), z.unknown()),
    })
    .strict();
export type AdherenceComponentResponse = z.infer<typeof adherenceComponentResponseSchema>;

export const adherenceResultResponseSchema = z
    .object({
        id: z.string().uuid(),
        trainingSessionId: z.string().uuid(),
        trainingSessionVersion: z.number().int().positive(),
        plannedSessionId: z.string().uuid().nullable(),
        sourcePrescriptionId: z.string().uuid(),
        resolvedPrescriptionId: z.string().uuid(),
        formula: z.string(),
        scope: adherenceScopeSchema,
        overall: scoreSchema.nullable(),
        sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        components: z.array(adherenceComponentResponseSchema),
        exclusions: z.array(adherenceExclusionReasonSchema),
        calculatedAt: z.string().datetime(),
        /** Whether this stored result still reflects the current session facts (AD2). */
        status: adherenceStatusSchema,
        /** Denormalised title of the planned session this result scores against, for direct links. */
        plannedSessionTitle: z.string().nullable(),
    })
    .strict();
export type AdherenceResultResponse = z.infer<typeof adherenceResultResponseSchema>;

/** All current adherence results for one actual session — one per linked planned prescription. */
export const sessionAdherenceResponseSchema = z
    .object({
        trainingSessionId: z.string().uuid(),
        results: z.array(adherenceResultResponseSchema),
    })
    .strict();
export type SessionAdherenceResponse = z.infer<typeof sessionAdherenceResponseSchema>;

/** An inclusive `YYYY-MM-DD` bound on the actual session's local date. */
const adherenceQueryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date");

/**
 * Cursor/filter query for adherence results (issue #38, AD2; design §18.2 `GET /training/adherence`).
 * Every parameter is optional and combines with AND; results are returned newest-computed first with a
 * stable `(calculatedAt, id)` keyset cursor. `programId`/`blockId` resolve through the planned session a
 * result scores, so unmapped results never match those scopes. `scope` selects the activity kind.
 */
export const adherenceQuerySchema = z
    .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().trim().min(1).optional(),
        trainingSessionId: z.string().uuid().optional(),
        plannedSessionId: z.string().uuid().optional(),
        programId: z.string().uuid().optional(),
        blockId: z.string().uuid().optional(),
        scope: adherenceResultScopeSchema.optional(),
        from: adherenceQueryDateSchema.optional(),
        to: adherenceQueryDateSchema.optional(),
    })
    .strict();
export type AdherenceQuery = z.infer<typeof adherenceQuerySchema>;

/** A page of adherence results across sessions, keyset-paginated newest-computed first (AD2). */
export const adherenceQueryResponseSchema = z
    .object({
        items: z.array(adherenceResultResponseSchema),
        nextCursor: z.string().nullable().default(null),
    })
    .strict();
export type AdherenceQueryResponse = z.infer<typeof adherenceQueryResponseSchema>;

/** One weighted component's display metadata within the versioned formula. */
export const adherenceFormulaComponentSchema = z
    .object({
        key: adherenceComponentKeySchema,
        scope: adherenceScopeSchema,
        weight: z.number().min(0),
        label: z.string(),
    })
    .strict();
export type AdherenceFormulaComponent = z.infer<typeof adherenceFormulaComponentSchema>;

/**
 * Stable, versioned formula-display metadata (design §16.7). Public and stable across releases for the
 * same `formula`; the weights/scoring text let a UI explain a result without reading persistence rows.
 */
export const adherenceFormulaResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        formula: z.literal("adherence.overall.v1"),
        scoring: z.string(),
        strengthComponents: z.array(adherenceFormulaComponentSchema),
        runningComponents: z.array(adherenceFormulaComponentSchema),
    })
    .strict();
export type AdherenceFormulaResponse = z.infer<typeof adherenceFormulaResponseSchema>;
