import { z } from "zod";

import {
    progressionActionSchema,
    progressionActionTypeSchema,
    progressionComparisonOperatorSchema,
    progressionMetricKeySchema,
    ruleScopeTypeSchema,
    ruleTargetSchema,
    ruleTriggerSchema,
} from "#src/progression-rule";

/**
 * Progression evaluation wire contracts (issue #40, G2; design §15.3, §17). An evaluation is immutable
 * evidence that a rule ran against an exact, versioned context snapshot: it exposes the matched/unmatched
 * explanation tree, the resolved fact snapshot and its input revisions, the trigger and logical target,
 * the derived status, and the proposed actions. G2 only proposes actions; approval/application is G4.
 * These schemas are read/trigger surfaces — never the persistence rows themselves.
 */

/** A settled evaluation status. `blocked`/`applied`/`rejected` are reserved for G3/G4. */
export const progressionEvaluationStatusSchema = z.enum(["unmatched", "pending", "blocked", "applied", "rejected"]);
export type ProgressionEvaluationStatusValue = z.infer<typeof progressionEvaluationStatusSchema>;

/** The comparand a metric node compared against: scalar, `[min, max]` pair, or boolean. */
const comparandSchema = z.union([z.number(), z.tuple([z.number(), z.number()]), z.boolean()]);

/** One resolved fact in the retained context snapshot; `value === null` marks a missing metric. */
export const progressionMetricFactSchema = z
    .object({
        value: z.union([z.number(), z.boolean()]).nullable(),
        sourceRevision: z.number().int().nullable(),
    })
    .strict();
export type ProgressionMetricFact = z.infer<typeof progressionMetricFactSchema>;

/** The recursive matched/unmatched explanation tree retained with every evaluation. */
export type ProgressionEvaluationExplanation =
    | { kind: "all" | "any"; matched: boolean; children: ProgressionEvaluationExplanation[] }
    | { kind: "not"; matched: boolean; child: ProgressionEvaluationExplanation }
    | {
          kind: "metric";
          matched: boolean;
          metricKey: z.infer<typeof progressionMetricKeySchema>;
          canonicalKey: string;
          operator: z.infer<typeof progressionComparisonOperatorSchema>;
          comparand: number | [number, number] | boolean;
          observed: number | boolean | null;
          missing: boolean;
          sourceRevision: number | null;
      };

const metricExplanationSchema = z
    .object({
        kind: z.literal("metric"),
        matched: z.boolean(),
        metricKey: progressionMetricKeySchema,
        canonicalKey: z.string(),
        operator: progressionComparisonOperatorSchema,
        comparand: comparandSchema,
        observed: z.union([z.number(), z.boolean()]).nullable(),
        missing: z.boolean(),
        sourceRevision: z.number().int().nullable(),
    })
    .strict();

export const progressionEvaluationExplanationSchema: z.ZodType<ProgressionEvaluationExplanation> = z.lazy(() =>
    z.union([
        z
            .object({
                kind: z.enum(["all", "any"]),
                matched: z.boolean(),
                children: z.array(progressionEvaluationExplanationSchema),
            })
            .strict(),
        z
            .object({
                kind: z.literal("not"),
                matched: z.boolean(),
                child: progressionEvaluationExplanationSchema,
            })
            .strict(),
        metricExplanationSchema,
    ]),
);

export const progressionEvaluationActionResponseSchema = z
    .object({
        position: z.number().int().min(0),
        actionType: progressionActionTypeSchema,
        action: progressionActionSchema,
        status: z.enum(["proposed", "applied", "rejected"]),
    })
    .strict();
export type ProgressionEvaluationActionResponse = z.infer<typeof progressionEvaluationActionResponseSchema>;

export const progressionEvaluationResponseSchema = z
    .object({
        id: z.string().uuid(),
        ruleId: z.string().uuid(),
        ruleVersion: z.number().int().positive(),
        ruleName: z.string(),
        trainingSessionId: z.string().uuid(),
        trainingSessionVersion: z.number().int().positive(),
        trigger: ruleTriggerSchema,
        scopeType: ruleScopeTypeSchema,
        scopeId: z.string().uuid(),
        target: ruleTargetSchema,
        matched: z.boolean(),
        status: progressionEvaluationStatusSchema,
        explanation: progressionEvaluationExplanationSchema,
        missingMetrics: z.array(z.string()),
        contextRevisions: z.record(z.string(), z.number().int()),
        contextFacts: z.record(z.string(), progressionMetricFactSchema),
        contextFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        actions: z.array(progressionEvaluationActionResponseSchema),
        evaluatedAt: z.string().datetime(),
    })
    .strict();
export type ProgressionEvaluationResponse = z.infer<typeof progressionEvaluationResponseSchema>;

export const progressionEvaluationListResponseSchema = z
    .object({ items: z.array(progressionEvaluationResponseSchema) })
    .strict();
export type ProgressionEvaluationListResponse = z.infer<typeof progressionEvaluationListResponseSchema>;

/** Manually (or scheduled-) trigger evaluation of a completed session's applicable rules. */
export const evaluateProgressionRequestSchema = z
    .object({
        trigger: z.enum(["manual", "scheduled"]).default("manual"),
        ruleId: z.string().uuid().optional(),
    })
    .strict();
export type EvaluateProgressionRequest = z.infer<typeof evaluateProgressionRequestSchema>;

/** Cross-session evaluation query for the approval/status surface. */
export const progressionEvaluationListQuerySchema = z
    .object({
        status: progressionEvaluationStatusSchema.optional(),
        ruleId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
    })
    .strict();
export type ProgressionEvaluationListQuery = z.infer<typeof progressionEvaluationListQuerySchema>;
