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
