import { DomainValidationError } from "#src/platform/domain/index";

/**
 * ProgressionRule — a versioned, archivable rule aggregate holding a bounded condition AST,
 * an allowlisted action list, a scope/logical-target selector, triggers, flags, and a
 * safety-policy reference (design 15.1–15.2, ADR 0007).
 *
 * The aggregate is pure: it enforces the language's structural and registry invariants but
 * never queries plans. Scope/target existence is resolved in the application layer through a
 * planning-reader port. Condition/action payloads carry explicit schema versions; only the
 * current version is accepted, on the wire and again on every hydration.
 */

export const CONDITION_SCHEMA_VERSION = 1;
export const ACTION_SCHEMA_VERSION = 1;
export const MAX_CONDITION_DEPTH = 6;
export const MAX_GROUP_CHILDREN = 20;
export const MAX_RULE_ACTIONS = 20;

export const progressionRuleStatuses = ["active", "archived"] as const;
export type ProgressionRuleStatus = (typeof progressionRuleStatuses)[number];

export const progressionMetricScopes = ["session", "exercise", "block", "program"] as const;
export type ProgressionMetricScope = (typeof progressionMetricScopes)[number];

export const progressionWindowKinds = ["sessions", "days", "weeks"] as const;
export type ProgressionWindowKind = (typeof progressionWindowKinds)[number];

export const progressionComparisonOperators = ["eq", "neq", "gt", "gte", "lt", "lte", "between"] as const;
export type ProgressionComparisonOperator = (typeof progressionComparisonOperators)[number];

export const progressionFilterKeys = ["exerciseId", "muscleGroupId", "tag", "equipmentTypeId"] as const;
export type ProgressionFilterKey = (typeof progressionFilterKeys)[number];

export const ruleScopeTypes = ["program", "block", "template", "exercise", "set"] as const;
export type RuleScopeType = (typeof ruleScopeTypes)[number];

export const ruleTargetModes = ["next", "block_future", "template"] as const;
export type RuleTargetMode = (typeof ruleTargetModes)[number];

export const ruleTargetSelectorKinds = ["scope", "exercise", "set", "run_step"] as const;
export type RuleTargetSelectorKind = (typeof ruleTargetSelectorKinds)[number];

export const ruleTriggers = ["session_completed", "scheduled", "manual"] as const;
export type RuleTrigger = (typeof ruleTriggers)[number];

export const progressionAdjustModes = ["absolute", "percent"] as const;
export type ProgressionAdjustMode = (typeof progressionAdjustModes)[number];

export const progressionLoadUnits = ["kg", "lb"] as const;
export type ProgressionLoadUnit = (typeof progressionLoadUnits)[number];

export const progressionRunFields = ["duration", "distance", "pace", "power"] as const;
export type ProgressionRunField = (typeof progressionRunFields)[number];

/** Metric code registry: the value type each key compares against (design 15.1). */
interface MetricDefinition {
    readonly valueType: "number" | "boolean";
}

export const progressionMetricRegistry = {
    completed_all_sets: { valueType: "boolean" },
    sets_completed: { valueType: "number" },
    rep_range_position: { valueType: "number" },
    rpe: { valueType: "number" },
    rir: { valueType: "number" },
    estimated_1rm_change: { valueType: "number" },
    consecutive_successful_sessions: { valueType: "number" },
    consecutive_failed_sessions: { valueType: "number" },
    skipped_sessions: { valueType: "number" },
    reported_pain: { valueType: "number" },
    readiness: { valueType: "number" },
    sleep_hours: { valueType: "number" },
    weekly_volume: { valueType: "number" },
    weekly_load: { valueType: "number" },
    week_number: { valueType: "number" },
    block_boundary: { valueType: "boolean" },
} as const satisfies Record<string, MetricDefinition>;

export type ProgressionMetricKey = keyof typeof progressionMetricRegistry;
export const progressionMetricKeys = Object.keys(progressionMetricRegistry) as readonly ProgressionMetricKey[];

/** Action code registry: every PRD PG-3 action, with the discriminant tag. */
export const progressionActionTypes = [
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
] as const;
export type ProgressionActionType = (typeof progressionActionTypes)[number];

export interface MetricSelector {
    readonly key: ProgressionMetricKey;
    readonly scope: ProgressionMetricScope;
    readonly window?: { readonly kind: ProgressionWindowKind; readonly value: number };
    readonly filters?: Readonly<Record<string, string | number | boolean>>;
}

export type ConditionV1 =
    | { readonly kind: "all"; readonly conditions: readonly ConditionV1[] }
    | { readonly kind: "any"; readonly conditions: readonly ConditionV1[] }
    | { readonly kind: "not"; readonly condition: ConditionV1 }
    | {
          readonly kind: "metric";
          readonly metric: MetricSelector;
          readonly operator: ProgressionComparisonOperator;
          readonly value: number | readonly [number, number] | boolean;
      };

export type ActionV1 =
    | {
          readonly type: "adjust_load";
          readonly mode: ProgressionAdjustMode;
          readonly value: number;
          readonly unit?: ProgressionLoadUnit;
      }
    | { readonly type: "adjust_reps"; readonly value: number }
    | { readonly type: "adjust_sets"; readonly value: number }
    | { readonly type: "set_effort_target"; readonly rpe?: number; readonly rir?: number }
    | {
          readonly type: "adjust_run_target";
          readonly field: ProgressionRunField;
          readonly mode: ProgressionAdjustMode;
          readonly value: number;
      }
    | { readonly type: "substitute_exercise"; readonly exerciseId: string }
    | { readonly type: "repeat_block" }
    | { readonly type: "insert_deload" }
    | { readonly type: "reschedule_session"; readonly offsetDays: number }
    | { readonly type: "skip_session"; readonly reason: string }
    | { readonly type: "recommendation"; readonly messageTemplate: string };

export interface RuleScope {
    readonly type: RuleScopeType;
    readonly id: string;
}

export type RuleTargetSelector =
    | { readonly kind: "scope" }
    | { readonly kind: "exercise"; readonly logicalKey: string }
    | { readonly kind: "set"; readonly logicalKey: string }
    | { readonly kind: "run_step"; readonly logicalKey: string };

export interface RuleTarget {
    readonly mode: RuleTargetMode;
    readonly selector: RuleTargetSelector;
}

export interface SafetyPolicyConfig {
    readonly maxLoadIncreasePercent?: number;
    readonly maxLoadIncreaseAbsolute?: number;
    readonly maxWeeklyVolumeIncreasePercent?: number;
    readonly minRecoveryHours?: number;
    readonly minReadiness?: number;
}

export interface SafetyPolicy {
    readonly policyKey: string | null;
    readonly config: SafetyPolicyConfig;
}

export interface ProgressionRuleState {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly description: string | null;
    readonly scope: RuleScope;
    readonly target: RuleTarget;
    readonly conditionSchemaVersion: number;
    readonly condition: ConditionV1;
    readonly actionSchemaVersion: number;
    readonly actions: readonly ActionV1[];
    readonly triggers: readonly RuleTrigger[];
    readonly enabled: boolean;
    readonly autoApply: boolean;
    readonly safetyPolicy: SafetyPolicy;
    readonly status: ProgressionRuleStatus;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateProgressionRuleInput {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly description?: string | null;
    readonly scope: RuleScope;
    readonly target: RuleTarget;
    readonly conditionSchemaVersion?: number;
    readonly condition: ConditionV1;
    readonly actionSchemaVersion?: number;
    readonly actions: readonly ActionV1[];
    readonly triggers?: readonly RuleTrigger[];
    readonly enabled?: boolean;
    readonly autoApply?: boolean;
    readonly safetyPolicy?: SafetyPolicy;
}

export interface UpdateProgressionRuleInput {
    readonly name?: string;
    readonly description?: string | null;
    readonly scope?: RuleScope;
    readonly target?: RuleTarget;
    readonly condition?: ConditionV1;
    readonly actions?: readonly ActionV1[];
    readonly triggers?: readonly RuleTrigger[];
    readonly enabled?: boolean;
    readonly autoApply?: boolean;
    readonly safetyPolicy?: SafetyPolicy;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProgressionRule {
    private constructor(private current: ProgressionRuleState) {}

    static create(input: CreateProgressionRuleInput, now: Date): ProgressionRule {
        const timestamp = isoTimestamp(now, "Progression rule creation time");
        const state: ProgressionRuleState = {
            id: requiredUuid(input.id, "Progression rule ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            name: requiredText(input.name, "Name", 160),
            description: optionalText(input.description, "Description", 2_000),
            scope: normalizeScope(input.scope),
            target: normalizeTarget(input.target),
            conditionSchemaVersion: normalizeSchemaVersion(
                input.conditionSchemaVersion ?? CONDITION_SCHEMA_VERSION,
                CONDITION_SCHEMA_VERSION,
                "condition",
            ),
            condition: normalizeCondition(input.condition, 1),
            actionSchemaVersion: normalizeSchemaVersion(
                input.actionSchemaVersion ?? ACTION_SCHEMA_VERSION,
                ACTION_SCHEMA_VERSION,
                "action",
            ),
            actions: normalizeActions(input.actions),
            triggers: normalizeTriggers(input.triggers ?? ["session_completed"]),
            enabled: input.enabled ?? true,
            autoApply: input.autoApply ?? false,
            safetyPolicy: normalizeSafetyPolicy(input.safetyPolicy),
            status: "active",
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new ProgressionRule(immutableCopy(state));
    }

    static rehydrate(state: ProgressionRuleState): ProgressionRule {
        const copied = immutableCopy(state);
        validateState(copied);
        return new ProgressionRule(copied);
    }

    get state(): ProgressionRuleState {
        return immutableCopy(this.current);
    }

    update(input: UpdateProgressionRuleInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.name !== undefined ? { name: requiredText(input.name, "Name", 160) } : {}),
            ...(input.description !== undefined
                ? { description: optionalText(input.description, "Description", 2_000) }
                : {}),
            ...(input.scope !== undefined ? { scope: normalizeScope(input.scope) } : {}),
            ...(input.target !== undefined ? { target: normalizeTarget(input.target) } : {}),
            ...(input.condition !== undefined ? { condition: normalizeCondition(input.condition, 1) } : {}),
            ...(input.actions !== undefined ? { actions: normalizeActions(input.actions) } : {}),
            ...(input.triggers !== undefined ? { triggers: normalizeTriggers(input.triggers) } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.autoApply !== undefined ? { autoApply: input.autoApply } : {}),
            ...(input.safetyPolicy !== undefined ? { safetyPolicy: normalizeSafetyPolicy(input.safetyPolicy) } : {}),
            updatedAt: isoTimestamp(now, "Progression rule update time"),
        });
    }

    archive(now: Date): this {
        if (this.current.status === "archived") return this;
        return this.replace({
            ...this.current,
            status: "archived",
            archivedAt: isoTimestamp(now, "Progression rule archive time"),
            updatedAt: isoTimestamp(now, "Progression rule update time"),
        });
    }

    restore(now: Date): this {
        if (this.current.status === "active") return this;
        return this.replace({
            ...this.current,
            status: "active",
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Progression rule update time"),
        });
    }

    private replace(state: ProgressionRuleState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: ProgressionRuleState): void {
    requiredUuid(state.id, "Progression rule ID");
    requiredUuid(state.profileId, "Profile ID");
    requiredText(state.name, "Name", 160);
    optionalText(state.description, "Description", 2_000);
    normalizeScope(state.scope);
    normalizeTarget(state.target);
    normalizeSchemaVersion(state.conditionSchemaVersion, CONDITION_SCHEMA_VERSION, "condition");
    normalizeCondition(state.condition, 1);
    normalizeSchemaVersion(state.actionSchemaVersion, ACTION_SCHEMA_VERSION, "action");
    normalizeActions(state.actions);
    normalizeTriggers(state.triggers);
    normalizeSafetyPolicy(state.safetyPolicy);
    if (typeof state.enabled !== "boolean" || typeof state.autoApply !== "boolean")
        throw new DomainValidationError("Enabled and auto-apply must be booleans");
    if (state.autoApply && state.target.mode === "template")
        throw new DomainValidationError(
            "Template-targeted rules cannot auto-apply; template changes require approval",
            { autoApply: ["Template changes always require approval"] },
        );
    if (!(progressionRuleStatuses as readonly string[]).includes(state.status))
        throw new DomainValidationError(`Unknown progression rule status '${state.status}'`, {
            status: ["Unknown progression rule status"],
        });
    if ((state.status === "archived") !== (state.archivedAt !== null))
        throw new DomainValidationError("Archived rules must carry an archive timestamp", {
            status: ["Archived rules must carry an archive timestamp"],
        });
    isoTimestamp(new Date(state.createdAt), "Progression rule creation time");
    isoTimestamp(new Date(state.updatedAt), "Progression rule update time");
}

function normalizeSchemaVersion(value: number, current: number, kind: "condition" | "action"): number {
    if (value !== current)
        throw new DomainValidationError(`Unsupported ${kind} schema version ${value}`, {
            [`${kind}SchemaVersion`]: [`Only ${kind} schema version ${current} is supported`],
        });
    return value;
}

function normalizeScope(scope: RuleScope): RuleScope {
    if (!scope || typeof scope !== "object")
        throw new DomainValidationError("Scope is required", { scope: ["Scope is required"] });
    if (!(ruleScopeTypes as readonly string[]).includes(scope.type))
        throw new DomainValidationError(`Unknown scope type '${scope.type}'`, { scope: ["Unknown scope type"] });
    return { type: scope.type, id: requiredUuid(scope.id, "Scope ID") };
}

function normalizeTarget(target: RuleTarget): RuleTarget {
    if (!target || typeof target !== "object")
        throw new DomainValidationError("Target is required", { target: ["Target is required"] });
    if (!(ruleTargetModes as readonly string[]).includes(target.mode))
        throw new DomainValidationError(`Unknown target mode '${target.mode}'`, { target: ["Unknown target mode"] });
    return { mode: target.mode, selector: normalizeSelector(target.selector) };
}

function normalizeSelector(selector: RuleTargetSelector): RuleTargetSelector {
    if (
        !selector ||
        typeof selector !== "object" ||
        !(ruleTargetSelectorKinds as readonly string[]).includes(selector.kind)
    )
        throw new DomainValidationError("Unknown target selector", { target: ["Unknown target selector"] });
    if (selector.kind === "scope") return { kind: "scope" };
    return { kind: selector.kind, logicalKey: requiredUuid(selector.logicalKey, "Target logical key") };
}

function normalizeCondition(condition: ConditionV1, depth: number): ConditionV1 {
    if (depth > MAX_CONDITION_DEPTH)
        throw new DomainValidationError(`Condition nesting cannot exceed depth ${MAX_CONDITION_DEPTH}`, {
            condition: [`Condition nesting cannot exceed depth ${MAX_CONDITION_DEPTH}`],
        });
    if (!condition || typeof condition !== "object")
        throw new DomainValidationError("Condition node is required", { condition: ["Condition node is required"] });
    switch (condition.kind) {
        case "all":
        case "any": {
            const children = condition.conditions;
            if (!Array.isArray(children) || children.length < 1)
                throw new DomainValidationError(`${condition.kind} groups cannot be empty`, {
                    condition: [`${condition.kind} groups need at least one child`],
                });
            if (children.length > MAX_GROUP_CHILDREN)
                throw new DomainValidationError(
                    `${condition.kind} groups cannot exceed ${MAX_GROUP_CHILDREN} children`,
                    {
                        condition: [`Groups cannot exceed ${MAX_GROUP_CHILDREN} children`],
                    },
                );
            return {
                kind: condition.kind,
                conditions: condition.conditions.map(child => normalizeCondition(child, depth + 1)),
            };
        }
        case "not":
            return { kind: "not", condition: normalizeCondition(condition.condition, depth + 1) };
        case "metric":
            return normalizeMetricCondition(condition);
        default:
            throw new DomainValidationError(`Unknown condition kind '${(condition as { kind?: string }).kind}'`, {
                condition: ["Unknown condition kind"],
            });
    }
}

function normalizeMetricCondition(
    node: Extract<ConditionV1, { kind: "metric" }>,
): Extract<ConditionV1, { kind: "metric" }> {
    const metric = normalizeMetricSelector(node.metric);
    if (!(progressionComparisonOperators as readonly string[]).includes(node.operator))
        throw new DomainValidationError(`Unknown operator '${node.operator}'`, { operator: ["Unknown operator"] });
    const definition = progressionMetricRegistry[metric.key];
    const value = normalizeComparisonValue(metric.key, definition.valueType, node.operator, node.value);
    return { kind: "metric", metric, operator: node.operator, value };
}

function normalizeMetricSelector(metric: MetricSelector): MetricSelector {
    if (!metric || typeof metric !== "object")
        throw new DomainValidationError("Metric selector is required", { metric: ["Metric selector is required"] });
    if (!(progressionMetricKeys as readonly string[]).includes(metric.key))
        throw new DomainValidationError(`Unknown metric key '${metric.key}'`, { "metric.key": ["Unknown metric key"] });
    if (!(progressionMetricScopes as readonly string[]).includes(metric.scope))
        throw new DomainValidationError(`Unknown metric scope '${metric.scope}'`, {
            "metric.scope": ["Unknown metric scope"],
        });
    const normalized: {
        key: ProgressionMetricKey;
        scope: ProgressionMetricScope;
        window?: { kind: ProgressionWindowKind; value: number };
        filters?: Record<string, string | number | boolean>;
    } = { key: metric.key, scope: metric.scope };
    if (metric.window !== undefined) {
        if (!(progressionWindowKinds as readonly string[]).includes(metric.window.kind))
            throw new DomainValidationError(`Unknown window kind '${metric.window.kind}'`, {
                "metric.window": ["Unknown window kind"],
            });
        if (!Number.isInteger(metric.window.value) || metric.window.value < 1 || metric.window.value > 520)
            throw new DomainValidationError("Window value must be a positive integer up to 520", {
                "metric.window": ["Window value must be a positive integer up to 520"],
            });
        normalized.window = { kind: metric.window.kind, value: metric.window.value };
    }
    if (metric.filters !== undefined) {
        const filters: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(metric.filters)) {
            if (!(progressionFilterKeys as readonly string[]).includes(key))
                throw new DomainValidationError(`Unknown filter '${key}'`, {
                    "metric.filters": [`Unknown filter '${key}'`],
                });
            if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
                throw new DomainValidationError(`Filter '${key}' must be a string, number, or boolean`);
            filters[key] = value;
        }
        normalized.filters = filters;
    }
    return normalized;
}

function normalizeComparisonValue(
    key: ProgressionMetricKey,
    valueType: "number" | "boolean",
    operator: ProgressionComparisonOperator,
    value: number | readonly [number, number] | boolean,
): number | readonly [number, number] | boolean {
    if (operator === "between") {
        if (valueType !== "number")
            throw new DomainValidationError(`Metric '${key}' does not support the between operator`, {
                operator: ["between is only valid for numeric metrics"],
            });
        if (!Array.isArray(value) || value.length !== 2 || !value.every(entry => Number.isFinite(entry)))
            throw new DomainValidationError("between requires a [min, max] pair of numbers", {
                value: ["between requires a [min, max] pair of numbers"],
            });
        const [min, max] = value as [number, number];
        if (min > max)
            throw new DomainValidationError("between min cannot exceed max", {
                value: ["between min cannot exceed max"],
            });
        return [min, max];
    }
    if (Array.isArray(value))
        throw new DomainValidationError("a pair is only valid with the between operator", {
            value: ["a pair is only valid with the between operator"],
        });
    if (valueType === "boolean") {
        if (typeof value !== "boolean")
            throw new DomainValidationError(`Metric '${key}' compares against a boolean`, {
                value: [`Metric '${key}' compares against a boolean`],
            });
        if (operator !== "eq" && operator !== "neq")
            throw new DomainValidationError(`Metric '${key}' only supports eq/neq`, {
                operator: [`Metric '${key}' only supports eq/neq`],
            });
        return value;
    }
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new DomainValidationError(`Metric '${key}' compares against a number`, {
            value: [`Metric '${key}' compares against a number`],
        });
    return value;
}

function normalizeActions(actions: readonly ActionV1[]): readonly ActionV1[] {
    if (!Array.isArray(actions) || actions.length < 1)
        throw new DomainValidationError("A rule needs at least one action", {
            actions: ["At least one action is required"],
        });
    if (actions.length > MAX_RULE_ACTIONS)
        throw new DomainValidationError(`A rule cannot exceed ${MAX_RULE_ACTIONS} actions`, {
            actions: [`A rule cannot exceed ${MAX_RULE_ACTIONS} actions`],
        });
    return actions.map(normalizeAction);
}

function normalizeAction(action: ActionV1): ActionV1 {
    if (!action || typeof action !== "object" || !(progressionActionTypes as readonly string[]).includes(action.type))
        throw new DomainValidationError(`Unknown action type '${(action as { type?: string })?.type}'`, {
            actions: ["Unknown action type"],
        });
    switch (action.type) {
        case "adjust_load": {
            const mode = normalizeAdjustMode(action.mode);
            requireFinite(action.value, "adjust_load value");
            if (mode === "absolute") {
                if (!(progressionLoadUnits as readonly string[]).includes(action.unit as string))
                    throw new DomainValidationError("absolute load changes require a kg or lb unit", {
                        actions: ["absolute load changes require a unit"],
                    });
                return { type: "adjust_load", mode, value: action.value, unit: action.unit };
            }
            if (action.unit !== undefined)
                throw new DomainValidationError("percent load changes must not carry a unit", {
                    actions: ["percent load changes must not carry a unit"],
                });
            return { type: "adjust_load", mode, value: action.value };
        }
        case "adjust_reps":
            return { type: "adjust_reps", value: requireInteger(action.value, "adjust_reps value") };
        case "adjust_sets":
            return { type: "adjust_sets", value: requireInteger(action.value, "adjust_sets value") };
        case "set_effort_target": {
            if (action.rpe === undefined && action.rir === undefined)
                throw new DomainValidationError("set_effort_target requires an rpe or rir target", {
                    actions: ["set_effort_target requires an rpe or rir target"],
                });
            const result: { type: "set_effort_target"; rpe?: number; rir?: number } = { type: "set_effort_target" };
            if (action.rpe !== undefined) result.rpe = requireBounded(action.rpe, 0, 10, "rpe");
            if (action.rir !== undefined) result.rir = requireBounded(action.rir, 0, 20, "rir");
            return result;
        }
        case "adjust_run_target": {
            if (!(progressionRunFields as readonly string[]).includes(action.field))
                throw new DomainValidationError(`Unknown run target field '${action.field}'`, {
                    actions: ["Unknown run target field"],
                });
            return {
                type: "adjust_run_target",
                field: action.field,
                mode: normalizeAdjustMode(action.mode),
                value: requireFinite(action.value, "adjust_run_target value"),
            };
        }
        case "substitute_exercise":
            return {
                type: "substitute_exercise",
                exerciseId: requiredUuid(action.exerciseId, "Substitute exercise ID"),
            };
        case "repeat_block":
            return { type: "repeat_block" };
        case "insert_deload":
            return { type: "insert_deload" };
        case "reschedule_session":
            return { type: "reschedule_session", offsetDays: requireInteger(action.offsetDays, "offsetDays") };
        case "skip_session":
            return { type: "skip_session", reason: requiredText(action.reason, "skip reason", 500) };
        case "recommendation":
            return {
                type: "recommendation",
                messageTemplate: requiredText(action.messageTemplate, "recommendation message", 2_000),
            };
        default:
            throw new DomainValidationError("Unknown action type", { actions: ["Unknown action type"] });
    }
}

function normalizeAdjustMode(mode: ProgressionAdjustMode): ProgressionAdjustMode {
    if (!(progressionAdjustModes as readonly string[]).includes(mode))
        throw new DomainValidationError(`Unknown adjust mode '${mode}'`, { actions: ["Unknown adjust mode"] });
    return mode;
}

function normalizeTriggers(triggers: readonly RuleTrigger[]): readonly RuleTrigger[] {
    if (!Array.isArray(triggers) || triggers.length < 1)
        throw new DomainValidationError("A rule needs at least one trigger", {
            triggers: ["At least one trigger is required"],
        });
    const normalized = (triggers as readonly RuleTrigger[]).map(trigger => {
        if (!(ruleTriggers as readonly string[]).includes(trigger))
            throw new DomainValidationError(`Unknown trigger '${trigger}'`, { triggers: ["Unknown trigger"] });
        return trigger;
    });
    if (new Set(normalized).size !== normalized.length)
        throw new DomainValidationError("Triggers must be unique", { triggers: ["Triggers must be unique"] });
    return normalized;
}

function normalizeSafetyPolicy(policy: SafetyPolicy | undefined): SafetyPolicy {
    if (policy === undefined) return { policyKey: null, config: {} };
    if (typeof policy !== "object")
        throw new DomainValidationError("Safety policy must be an object", {
            safetyPolicy: ["Safety policy is invalid"],
        });
    const policyKey = policy.policyKey == null ? null : requiredText(policy.policyKey, "Safety policy key", 120);
    const rawConfig = policy.config ?? {};
    const config: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawConfig)) {
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
            throw new DomainValidationError(`Safety limit '${key}' must be a non-negative number`, {
                safetyPolicy: [`Safety limit '${key}' must be a non-negative number`],
            });
        config[key] = value;
    }
    return { policyKey, config };
}

function requireFinite(value: number, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new DomainValidationError(`${name} must be a finite number`, {
            actions: [`${name} must be a finite number`],
        });
    return value;
}

function requireInteger(value: number, name: string): number {
    if (!Number.isInteger(value))
        throw new DomainValidationError(`${name} must be an integer`, { actions: [`${name} must be an integer`] });
    return value;
}

function requireBounded(value: number, min: number, max: number, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
        throw new DomainValidationError(`${name} must be between ${min} and ${max}`, {
            actions: [`${name} must be between ${min} and ${max}`],
        });
    return value;
}

function requiredText(value: string, name: string, maximumLength: number): string {
    const normalized = (value ?? "").trim().normalize("NFKC");
    if (normalized.length === 0) throw new DomainValidationError(`${name} is required`);
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function requiredUuid(value: string, name: string): string {
    const normalized = (value ?? "").trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) return null;
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}
