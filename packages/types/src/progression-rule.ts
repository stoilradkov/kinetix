import { z } from "zod";

/**
 * Progression rule contracts (design 15.1–15.2, ADR 0007).
 *
 * The rule language is bounded and versioned: a recursive condition AST built from
 * `all`/`any`/`not` groups and allowlisted metric comparisons, plus a discriminated
 * action union. Every leaf — metric key, operator, filter key, action type, unit — is
 * an explicit enum here, mirroring the domain code registries. Unknown keys, operators,
 * or schema versions are rejected at this boundary and again on hydration in the API.
 */

export const CONDITION_SCHEMA_VERSION = 1;
export const ACTION_SCHEMA_VERSION = 1;
export const MAX_CONDITION_DEPTH = 6;
export const MAX_GROUP_CHILDREN = 20;
export const MAX_RULE_ACTIONS = 20;

export const progressionRuleStatusSchema = z.enum(["active", "archived"]);

export const progressionMetricKeySchema = z.enum([
    "completed_all_sets",
    "sets_completed",
    "rep_range_position",
    "rpe",
    "rir",
    "estimated_1rm_change",
    "consecutive_successful_sessions",
    "consecutive_failed_sessions",
    "skipped_sessions",
    "reported_pain",
    "readiness",
    "sleep_hours",
    "weekly_volume",
    "weekly_load",
    "week_number",
    "block_boundary",
]);

/** Metric keys whose comparison value is a boolean flag rather than a number. */
export const booleanProgressionMetricKeys = ["completed_all_sets", "block_boundary"] as const;

export const progressionMetricScopeSchema = z.enum(["session", "exercise", "block", "program"]);
export const progressionWindowKindSchema = z.enum(["sessions", "days", "weeks"]);
export const progressionComparisonOperatorSchema = z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "between"]);
export const progressionFilterKeySchema = z.enum(["exerciseId", "muscleGroupId", "tag", "equipmentTypeId"]);

export const progressionActionTypeSchema = z.enum([
    "adjust_load",
    "adjust_reps",
    "adjust_sets",
    "set_effort_target",
    "adjust_run_target",
    "substitute_exercise",
    "repeat_block",
    "insert_deload",
    "reschedule_session",
    "skip_session",
    "recommendation",
]);

export const progressionAdjustModeSchema = z.enum(["absolute", "percent"]);
export const progressionLoadUnitSchema = z.enum(["kg", "lb"]);
export const progressionRunFieldSchema = z.enum(["duration", "distance", "pace", "power"]);

export const ruleScopeTypeSchema = z.enum(["program", "block", "template", "exercise", "set"]);
export const ruleTargetModeSchema = z.enum(["next", "block_future", "template"]);
export const ruleTargetSelectorKindSchema = z.enum(["scope", "exercise", "set", "run_step"]);
export const ruleTriggerSchema = z.enum(["session_completed", "scheduled", "manual"]);

const filterValueSchema = z.union([z.string().max(120), z.number().finite(), z.boolean()]);

export const progressionMetricSelectorSchema = z
    .object({
        key: progressionMetricKeySchema,
        scope: progressionMetricScopeSchema,
        window: z
            .object({ kind: progressionWindowKindSchema, value: z.number().int().positive().max(520) })
            .strict()
            .optional(),
        filters: z.record(z.string(), filterValueSchema).optional(),
    })
    .strict()
    .superRefine((selector, ctx) => {
        if (!selector.filters) return;
        const allowed = new Set(progressionFilterKeySchema.options);
        for (const key of Object.keys(selector.filters))
            if (!allowed.has(key as (typeof progressionFilterKeySchema.options)[number]))
                ctx.addIssue({
                    code: "custom",
                    path: ["filters", key],
                    message: `Unknown filter '${key}'. Allowed: ${progressionFilterKeySchema.options.join(", ")}`,
                });
    });

const metricConditionSchema = z
    .object({
        kind: z.literal("metric"),
        metric: progressionMetricSelectorSchema,
        operator: progressionComparisonOperatorSchema,
        value: z.union([z.number().finite(), z.tuple([z.number().finite(), z.number().finite()]), z.boolean()]),
    })
    .strict()
    .superRefine((node, ctx) => {
        const isBooleanMetric = (booleanProgressionMetricKeys as readonly string[]).includes(node.metric.key);
        if (node.operator === "between") {
            if (!Array.isArray(node.value)) {
                ctx.addIssue({ code: "custom", path: ["value"], message: "between requires a [min, max] pair" });
                return;
            }
            if (node.value[0] > node.value[1])
                ctx.addIssue({ code: "custom", path: ["value"], message: "between min cannot exceed max" });
            return;
        }
        if (Array.isArray(node.value)) {
            ctx.addIssue({
                code: "custom",
                path: ["value"],
                message: "a pair is only valid with the between operator",
            });
            return;
        }
        if (isBooleanMetric) {
            if (typeof node.value !== "boolean")
                ctx.addIssue({
                    code: "custom",
                    path: ["value"],
                    message: `${node.metric.key} compares against a boolean`,
                });
            if (node.operator !== "eq" && node.operator !== "neq")
                ctx.addIssue({ code: "custom", path: ["operator"], message: "boolean metrics only support eq/neq" });
            return;
        }
        if (typeof node.value !== "number")
            ctx.addIssue({ code: "custom", path: ["value"], message: `${node.metric.key} compares against a number` });
    });

export type ProgressionMetricCondition = z.infer<typeof metricConditionSchema>;

export type ProgressionCondition =
    | { readonly kind: "all"; readonly conditions: readonly ProgressionCondition[] }
    | { readonly kind: "any"; readonly conditions: readonly ProgressionCondition[] }
    | { readonly kind: "not"; readonly condition: ProgressionCondition }
    | ProgressionMetricCondition;

export const progressionConditionSchema: z.ZodType<ProgressionCondition> = z.lazy(() =>
    z.discriminatedUnion("kind", [
        z
            .object({
                kind: z.literal("all"),
                conditions: z.array(progressionConditionSchema).min(1).max(MAX_GROUP_CHILDREN),
            })
            .strict(),
        z
            .object({
                kind: z.literal("any"),
                conditions: z.array(progressionConditionSchema).min(1).max(MAX_GROUP_CHILDREN),
            })
            .strict(),
        z.object({ kind: z.literal("not"), condition: progressionConditionSchema }).strict(),
        metricConditionSchema,
    ]),
);

/** Maximum nesting depth of a condition tree; a lone metric leaf is depth 1. */
export function progressionConditionDepth(condition: ProgressionCondition): number {
    switch (condition.kind) {
        case "all":
        case "any":
            return 1 + Math.max(0, ...condition.conditions.map(progressionConditionDepth));
        case "not":
            return 1 + progressionConditionDepth(condition.condition);
        default:
            return 1;
    }
}

const conditionField = progressionConditionSchema.superRefine((condition, ctx) => {
    if (progressionConditionDepth(condition) > MAX_CONDITION_DEPTH)
        ctx.addIssue({ code: "custom", message: `Condition nesting cannot exceed depth ${MAX_CONDITION_DEPTH}` });
});

const adjustLoadActionSchema = z
    .object({
        type: z.literal("adjust_load"),
        mode: progressionAdjustModeSchema,
        value: z.number().finite(),
        unit: progressionLoadUnitSchema.optional(),
    })
    .strict()
    .superRefine((action, ctx) => {
        if (action.mode === "absolute" && action.unit === undefined)
            ctx.addIssue({ code: "custom", path: ["unit"], message: "absolute load changes require a unit" });
        if (action.mode === "percent" && action.unit !== undefined)
            ctx.addIssue({ code: "custom", path: ["unit"], message: "percent load changes must not carry a unit" });
    });

const adjustRunTargetActionSchema = z
    .object({
        type: z.literal("adjust_run_target"),
        field: progressionRunFieldSchema,
        mode: progressionAdjustModeSchema,
        value: z.number().finite(),
    })
    .strict();

const setEffortTargetActionSchema = z
    .object({
        type: z.literal("set_effort_target"),
        rpe: z.number().min(0).max(10).optional(),
        rir: z.number().min(0).max(20).optional(),
    })
    .strict()
    .superRefine((action, ctx) => {
        if (action.rpe === undefined && action.rir === undefined)
            ctx.addIssue({ code: "custom", message: "set_effort_target requires an rpe or rir target" });
    });

export const progressionActionSchema = z.discriminatedUnion("type", [
    adjustLoadActionSchema,
    z.object({ type: z.literal("adjust_reps"), value: z.number().int() }).strict(),
    z.object({ type: z.literal("adjust_sets"), value: z.number().int() }).strict(),
    setEffortTargetActionSchema,
    adjustRunTargetActionSchema,
    z.object({ type: z.literal("substitute_exercise"), exerciseId: z.string().uuid() }).strict(),
    z.object({ type: z.literal("repeat_block") }).strict(),
    z.object({ type: z.literal("insert_deload") }).strict(),
    z.object({ type: z.literal("reschedule_session"), offsetDays: z.number().int() }).strict(),
    z.object({ type: z.literal("skip_session"), reason: z.string().trim().min(1).max(500) }).strict(),
    z.object({ type: z.literal("recommendation"), messageTemplate: z.string().trim().min(1).max(2_000) }).strict(),
]);

export const ruleScopeSchema = z.object({ type: ruleScopeTypeSchema, id: z.string().uuid() }).strict();

export const ruleTargetSelectorSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("scope") }).strict(),
    z.object({ kind: z.literal("exercise"), logicalKey: z.string().uuid() }).strict(),
    z.object({ kind: z.literal("set"), logicalKey: z.string().uuid() }).strict(),
    z.object({ kind: z.literal("run_step"), logicalKey: z.string().uuid() }).strict(),
]);

export const ruleTargetSchema = z.object({ mode: ruleTargetModeSchema, selector: ruleTargetSelectorSchema }).strict();

const nonNegative = z.number().finite().nonnegative();
export const safetyPolicySchema = z
    .object({
        policyKey: z.string().trim().min(1).max(120).nullable(),
        config: z
            .object({
                maxLoadIncreasePercent: nonNegative.optional(),
                maxLoadIncreaseAbsolute: nonNegative.optional(),
                maxWeeklyVolumeIncreasePercent: nonNegative.optional(),
                minRecoveryHours: nonNegative.optional(),
                minReadiness: nonNegative.optional(),
                minSleepHours: nonNegative.optional(),
            })
            .strict(),
    })
    .strict();

const triggersSchema = z
    .array(ruleTriggerSchema)
    .min(1)
    .max(3)
    .superRefine((triggers, ctx) => {
        if (new Set(triggers).size !== triggers.length)
            ctx.addIssue({ code: "custom", message: "triggers must be unique" });
    });

const actionsSchema = z.array(progressionActionSchema).min(1).max(MAX_RULE_ACTIONS);
const nameSchema = z.string().trim().min(1).max(160);
const descriptionSchema = z.string().max(2_000);

export const progressionRuleResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        name: z.string(),
        description: z.string().nullable(),
        scope: ruleScopeSchema,
        target: ruleTargetSchema,
        conditionSchemaVersion: z.literal(CONDITION_SCHEMA_VERSION),
        condition: progressionConditionSchema,
        actionSchemaVersion: z.literal(ACTION_SCHEMA_VERSION),
        actions: actionsSchema,
        triggers: triggersSchema,
        enabled: z.boolean(),
        autoApply: z.boolean(),
        safetyPolicy: safetyPolicySchema,
        status: progressionRuleStatusSchema,
        archivedAt: z.string().datetime().nullable(),
        version: z.number().int().positive(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const progressionRuleListResponseSchema = z.object({ items: z.array(progressionRuleResponseSchema) }).strict();

export const createProgressionRuleRequestSchema = z
    .object({
        name: nameSchema,
        description: descriptionSchema.nullable().optional(),
        scope: ruleScopeSchema,
        target: ruleTargetSchema,
        conditionSchemaVersion: z.literal(CONDITION_SCHEMA_VERSION).optional(),
        condition: conditionField,
        actionSchemaVersion: z.literal(ACTION_SCHEMA_VERSION).optional(),
        actions: actionsSchema,
        triggers: triggersSchema.optional(),
        enabled: z.boolean().optional(),
        autoApply: z.boolean().optional(),
        safetyPolicy: safetyPolicySchema.optional(),
    })
    .strict()
    .superRefine((rule, ctx) => {
        if (rule.autoApply === true && rule.target.mode === "template")
            ctx.addIssue({
                code: "custom",
                path: ["autoApply"],
                message: "Template-targeted rules cannot auto-apply; template changes require approval",
            });
    });

export const updateProgressionRuleRequestSchema = z
    .object({
        name: nameSchema.optional(),
        description: descriptionSchema.nullable().optional(),
        scope: ruleScopeSchema.optional(),
        target: ruleTargetSchema.optional(),
        conditionSchemaVersion: z.literal(CONDITION_SCHEMA_VERSION).optional(),
        condition: conditionField.optional(),
        actionSchemaVersion: z.literal(ACTION_SCHEMA_VERSION).optional(),
        actions: actionsSchema.optional(),
        triggers: triggersSchema.optional(),
        enabled: z.boolean().optional(),
        autoApply: z.boolean().optional(),
        safetyPolicy: safetyPolicySchema.optional(),
    })
    .strict();

/** Query-string booleans arrive as text; parse "true"/"false" exactly (z.coerce.boolean treats "false" as true). */
const queryBooleanSchema = z.union([z.boolean(), z.enum(["true", "false"]).transform(value => value === "true")]);

export const progressionRuleListQuerySchema = z
    .object({
        includeArchived: queryBooleanSchema.optional(),
        scopeType: ruleScopeTypeSchema.optional(),
        enabled: queryBooleanSchema.optional(),
    })
    .strict();

export type ProgressionRuleStatusValue = z.infer<typeof progressionRuleStatusSchema>;
export type ProgressionMetricKeyValue = z.infer<typeof progressionMetricKeySchema>;
export type ProgressionComparisonOperatorValue = z.infer<typeof progressionComparisonOperatorSchema>;
export type ProgressionActionTypeValue = z.infer<typeof progressionActionTypeSchema>;
export type ProgressionMetricSelector = z.infer<typeof progressionMetricSelectorSchema>;
export type ProgressionAction = z.infer<typeof progressionActionSchema>;
export type RuleScopeTypeValue = z.infer<typeof ruleScopeTypeSchema>;
export type RuleScope = z.infer<typeof ruleScopeSchema>;
export type RuleTargetModeValue = z.infer<typeof ruleTargetModeSchema>;
export type RuleTargetSelector = z.infer<typeof ruleTargetSelectorSchema>;
export type RuleTarget = z.infer<typeof ruleTargetSchema>;
export type RuleTriggerValue = z.infer<typeof ruleTriggerSchema>;
export type SafetyPolicy = z.infer<typeof safetyPolicySchema>;
export type ProgressionRuleResponse = z.infer<typeof progressionRuleResponseSchema>;
export type ProgressionRuleListResponse = z.infer<typeof progressionRuleListResponseSchema>;
export type CreateProgressionRuleRequest = z.infer<typeof createProgressionRuleRequestSchema>;
export type UpdateProgressionRuleRequest = z.infer<typeof updateProgressionRuleRequestSchema>;
export type ProgressionRuleListQuery = z.infer<typeof progressionRuleListQuerySchema>;
