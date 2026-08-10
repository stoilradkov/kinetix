import { z } from "zod";

/**
 * Analytics derived-metric wire contracts (issue #43, A1; design §16.1–16.3; ADR 0006). Derived metrics are
 * reproducible projections over authoritative facts: raw session/plan/profile facts stay authoritative and
 * a projection may be recomputed and superseded. These schemas expose the low-level metric query surface
 * later analytics views build on plus the recalculation/rebuild command envelope — never the persistence
 * rows, the internal invalidation payloads, or a path that lets a controller invoke a calculator directly.
 */

/** The polymorphic coordinates a projected metric is about (design §16.2). */
export const metricScopeSchema = z
    .object({
        type: z.string().min(1).max(80),
        id: z.string().min(1).max(200),
    })
    .strict();
export type MetricScopeResource = z.infer<typeof metricScopeSchema>;

/** The time window a metric covers. */
export const metricPeriodSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all_time") }).strict(),
    z.object({ kind: z.literal("point"), at: z.string().min(1).max(40) }).strict(),
    z.object({ kind: z.literal("range"), start: z.string().min(1).max(40), end: z.string().min(1).max(40) }).strict(),
    z
        .object({ kind: z.literal("rolling"), days: z.number().int().positive(), end: z.string().min(1).max(40) })
        .strict(),
]);
export type MetricPeriodResource = z.infer<typeof metricPeriodSchema>;

export const metricDimensionsSchema = z.record(z.string().min(1).max(80), z.string().max(200));
export type MetricDimensionsResource = z.infer<typeof metricDimensionsSchema>;

export const metricStateSchema = z.enum(["current", "superseded"]);
export type MetricStateValue = z.infer<typeof metricStateSchema>;

/** One projected derived metric (design §16.2): its identity, coordinates, value, and lifecycle state. */
export const derivedMetricResourceSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid().nullable(),
        calculatorKey: z.string().min(1).max(180),
        calculatorVersion: z.number().int().positive(),
        scope: metricScopeSchema,
        period: metricPeriodSchema,
        dimensions: metricDimensionsSchema,
        numericValue: z.number().nullable(),
        textValue: z.string().nullable(),
        unit: z.string().max(40).nullable(),
        details: z.record(z.string(), z.unknown()),
        sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        state: metricStateSchema,
        stale: z.boolean(),
        calculatedAt: z.string().datetime(),
        supersededAt: z.string().datetime().nullable(),
    })
    .strict();
export type DerivedMetricResource = z.infer<typeof derivedMetricResourceSchema>;

export const metricQueryResponseSchema = z
    .object({
        items: z.array(derivedMetricResourceSchema),
    })
    .strict();
export type MetricQueryResponse = z.infer<typeof metricQueryResponseSchema>;

/**
 * A rebuild command (design §16.3, acceptance criterion 5). `mode: "targeted"` drains the coalesced pending
 * invalidations; `mode: "scope"` rebuilds one explicit dependency scope; `mode: "full"` sweeps every current
 * projection. All three run through the same idempotent calculators; a rebuild never scores inline.
 */
export const metricRebuildRequestSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("targeted") }).strict(),
    z.object({ mode: z.literal("full") }).strict(),
    z
        .object({
            mode: z.literal("scope"),
            dependency: z.enum(["session", "exercise", "context", "zone", "plan"]),
            scopeType: z.string().min(1).max(80),
            scopeId: z.string().min(1).max(200),
        })
        .strict(),
]);
export type MetricRebuildRequest = z.infer<typeof metricRebuildRequestSchema>;

export const metricRebuildResponseSchema = z
    .object({
        recomputed: z.number().int().nonnegative(),
        drainedInvalidations: z.number().int().nonnegative(),
    })
    .strict();
export type MetricRebuildResponse = z.infer<typeof metricRebuildResponseSchema>;

/**
 * Stable, versioned display metadata for one registered metric calculator (issue #44, A2). It documents
 * what a `calculatorKey.vN` computes — its human label, scoring prose, canonical unit, the scope it is
 * about, and the dimensions each result is broken down by — so a client can label and explain the derived
 * metrics returned by the query surface without ever re-deriving a value. Evidence itself travels in each
 * metric's `details`; rich rendering remains A6.
 */
export const metricCalculatorMetadataSchema = z
    .object({
        key: z.string().min(1).max(180),
        version: z.number().int().positive(),
        label: z.string().min(1).max(120),
        description: z.string().min(1).max(600),
        unit: z.string().max(40).nullable(),
        scopeKind: z.enum(["session", "window"]),
        dimensions: z.array(z.string().min(1).max(80)),
    })
    .strict();
export type MetricCalculatorMetadata = z.infer<typeof metricCalculatorMetadataSchema>;

export const metricCalculatorCatalogResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        calculators: z.array(metricCalculatorMetadataSchema),
    })
    .strict();
export type MetricCalculatorCatalogResponse = z.infer<typeof metricCalculatorCatalogResponseSchema>;

/** The lifecycle status of a finding (design §16.8). */
export const findingStatusSchema = z.enum(["active", "acknowledged", "dismissed", "expired"]);
export type FindingStatusValue = z.infer<typeof findingStatusSchema>;

/**
 * One qualitative finding (issue #45, A3; design §16.2, §16.8) — a personal record and, later, trends. Like
 * a derived metric it carries its identity, polymorphic scope, dimensions, comparison value, and lifecycle
 * state; unlike a metric it also carries a review/feedback status and its evidence (the exact source set,
 * session revision, and — for a personal record — the per-formula estimates and family labelling).
 */
export const findingResourceSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid().nullable(),
        findingKey: z.string().min(1).max(180),
        findingVersion: z.number().int().positive(),
        scope: metricScopeSchema,
        dimensions: metricDimensionsSchema,
        numericValue: z.number().nullable(),
        unit: z.string().max(40).nullable(),
        status: findingStatusSchema,
        evidence: z.record(z.string(), z.unknown()),
        sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        state: metricStateSchema,
        calculatedAt: z.string().datetime(),
        supersededAt: z.string().datetime().nullable(),
    })
    .strict();
export type FindingResource = z.infer<typeof findingResourceSchema>;

export const findingQueryResponseSchema = z
    .object({
        items: z.array(findingResourceSchema),
    })
    .strict();
export type FindingQueryResponse = z.infer<typeof findingQueryResponseSchema>;

/**
 * Stable, versioned display metadata for one personal-record type (issue #45, A3). It documents what a
 * `record.*.vN` finding asserts — its label, prose, canonical unit, and the dimensions each record is broken
 * down by — so a client can label and explain a record without re-deriving any value. Formulas and source
 * evidence travel in each finding's `evidence`; rich rendering remains A6.
 */
export const personalRecordMetadataSchema = z
    .object({
        key: z.string().min(1).max(180),
        version: z.number().int().positive(),
        label: z.string().min(1).max(120),
        description: z.string().min(1).max(600),
        unit: z.string().min(1).max(40),
        dimensions: z.array(z.string().min(1).max(80)),
    })
    .strict();
export type PersonalRecordMetadata = z.infer<typeof personalRecordMetadataSchema>;

export const personalRecordCatalogResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        records: z.array(personalRecordMetadataSchema),
    })
    .strict();
export type PersonalRecordCatalogResponse = z.infer<typeof personalRecordCatalogResponseSchema>;
