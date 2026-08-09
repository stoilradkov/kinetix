import { DomainValidationError } from "#src/platform/domain/index";

import {
    progressionMetricRegistry,
    type ActionV1,
    type ConditionV1,
    type MetricSelector,
    type ProgressionComparisonOperator,
    type ProgressionMetricKey,
    type RuleTargetSelector,
    type RuleTrigger,
} from "#src/modules/training/domain/progression-rule";

/**
 * ProgressionEvaluation domain — the pure, side-effect-free evaluator that runs a stored rule's
 * condition AST against an immutable, versioned fact snapshot and retains complete evidence
 * (design §15.3). It never reads databases, publishes jobs, or applies actions: it resolves a
 * supplied {@link MetricLookup}, produces a matched/unmatched explanation tree, materialises the
 * proposed actions, and derives a stable fingerprint the application hashes for idempotency.
 *
 * Applying proposals to target prescriptions (G4) and safety policies (G3) are out of scope here;
 * matched rules yield `pending` proposals that the approval queue owns.
 */

// -------------------------------------------------------------------------------------------------
// Immutable fact snapshot
// -------------------------------------------------------------------------------------------------

export type MetricValue = number | boolean;

/** One resolved fact plus the exact source revision it was read from (`null` when the fact is missing). */
export interface MetricFact {
    readonly value: MetricValue | null;
    readonly sourceRevision: number | null;
}

/** Facts keyed by {@link canonicalMetricKey}; the application builds this from versioned reads. */
export type MetricLookup = ReadonlyMap<string, MetricFact>;

/**
 * Canonical, deterministic key for a metric selector so identical selectors resolve the same fact
 * regardless of object key order. Windows and filters are folded in; filter keys are sorted.
 */
export function canonicalMetricKey(selector: MetricSelector): string {
    const parts: string[] = [selector.key, selector.scope];
    if (selector.window) parts.push(`w:${selector.window.kind}:${selector.window.value}`);
    else parts.push("w:-");
    if (selector.filters && Object.keys(selector.filters).length > 0) {
        const filters = Object.keys(selector.filters)
            .sort()
            .map(key => `${key}=${String(selector.filters![key])}`)
            .join(",");
        parts.push(`f:${filters}`);
    } else parts.push("f:-");
    return parts.join("|");
}

// -------------------------------------------------------------------------------------------------
// Explanation tree — the matched/unmatched evidence retained with every evaluation
// -------------------------------------------------------------------------------------------------

export interface GroupEvaluation {
    readonly kind: "all" | "any";
    readonly matched: boolean;
    readonly children: readonly ConditionEvaluation[];
}

export interface NotEvaluation {
    readonly kind: "not";
    readonly matched: boolean;
    readonly child: ConditionEvaluation;
}

export interface MetricEvaluation {
    readonly kind: "metric";
    readonly matched: boolean;
    readonly metricKey: ProgressionMetricKey;
    readonly canonicalKey: string;
    readonly operator: ProgressionComparisonOperator;
    readonly comparand: number | readonly [number, number] | boolean;
    /** The observed fact value, or `null` when the metric is missing from the context. */
    readonly observed: MetricValue | null;
    readonly missing: boolean;
    readonly sourceRevision: number | null;
}

export type ConditionEvaluation = GroupEvaluation | NotEvaluation | MetricEvaluation;

// -------------------------------------------------------------------------------------------------
// Proposed actions and outcome
// -------------------------------------------------------------------------------------------------

/** A rule action bound to a stable position; G2 proposes, it never applies (G4). */
export interface ProposedProgressionAction {
    readonly position: number;
    readonly action: ActionV1;
}

/** Statuses a G2 evaluation can settle into; `blocked`/`applied`/`rejected` are reserved for G3/G4. */
export const progressionEvaluationStatuses = ["unmatched", "pending", "blocked", "applied", "rejected"] as const;
export type ProgressionEvaluationStatus = (typeof progressionEvaluationStatuses)[number];

export interface ProgressionEvaluationOutcome {
    readonly matched: boolean;
    readonly status: ProgressionEvaluationStatus;
    readonly explanation: ConditionEvaluation;
    /** Canonical keys of every metric that was missing from the context (deterministic, sorted). */
    readonly missingMetrics: readonly string[];
    /** Proposed actions — populated only when the rule matched. */
    readonly proposedActions: readonly ProposedProgressionAction[];
}

/**
 * Evaluate a rule's condition against the fact snapshot and package the proposed actions. Pure and
 * deterministic: the same condition and facts always yield the same explanation, status, missing set,
 * and proposals. A matched rule is `pending` (awaiting approval); an unmatched rule proposes nothing.
 */
export function evaluateProgressionRule(input: {
    readonly condition: ConditionV1;
    readonly actions: readonly ActionV1[];
    readonly facts: MetricLookup;
}): ProgressionEvaluationOutcome {
    const explanation = evaluateCondition(input.condition, input.facts);
    const missing = new Set<string>();
    collectMissing(explanation, missing);
    const matched = explanation.matched;
    return {
        matched,
        status: matched ? "pending" : "unmatched",
        explanation,
        missingMetrics: [...missing].sort(),
        proposedActions: matched ? materializeActions(input.actions) : [],
    };
}

/** Recursively evaluate one condition node against the facts, returning its evidence sub-tree. */
export function evaluateCondition(condition: ConditionV1, facts: MetricLookup): ConditionEvaluation {
    switch (condition.kind) {
        case "all": {
            const children = condition.conditions.map(child => evaluateCondition(child, facts));
            return { kind: "all", matched: children.every(child => child.matched), children };
        }
        case "any": {
            const children = condition.conditions.map(child => evaluateCondition(child, facts));
            return { kind: "any", matched: children.some(child => child.matched), children };
        }
        case "not": {
            const child = evaluateCondition(condition.condition, facts);
            return { kind: "not", matched: !child.matched, child };
        }
        case "metric":
            return evaluateMetric(condition, facts);
        default:
            throw new DomainValidationError(`Unknown condition kind '${(condition as { kind?: string }).kind}'`);
    }
}

function evaluateMetric(node: Extract<ConditionV1, { kind: "metric" }>, facts: MetricLookup): MetricEvaluation {
    const canonicalKey = canonicalMetricKey(node.metric);
    const fact = facts.get(canonicalKey);
    const observed = fact?.value ?? null;
    const missing = observed === null;
    const matched = missing ? false : compareMetric(node.metric.key, node.operator, observed, node.value);
    return {
        kind: "metric",
        matched,
        metricKey: node.metric.key,
        canonicalKey,
        operator: node.operator,
        comparand: node.value,
        observed,
        missing,
        sourceRevision: fact?.sourceRevision ?? null,
    };
}

/** Deterministic comparison over the metric's declared value type; missing values never reach here. */
function compareMetric(
    key: ProgressionMetricKey,
    operator: ProgressionComparisonOperator,
    observed: MetricValue,
    comparand: number | readonly [number, number] | boolean,
): boolean {
    const valueType = progressionMetricRegistry[key].valueType;
    if (valueType === "boolean") {
        if (typeof observed !== "boolean" || typeof comparand !== "boolean") return false;
        return operator === "neq" ? observed !== comparand : observed === comparand;
    }
    if (typeof observed !== "number") return false;
    if (operator === "between") {
        if (!Array.isArray(comparand)) return false;
        const [min, max] = comparand as readonly [number, number];
        return observed >= min && observed <= max;
    }
    if (typeof comparand !== "number") return false;
    switch (operator) {
        case "eq":
            return observed === comparand;
        case "neq":
            return observed !== comparand;
        case "gt":
            return observed > comparand;
        case "gte":
            return observed >= comparand;
        case "lt":
            return observed < comparand;
        case "lte":
            return observed <= comparand;
        default:
            return false;
    }
}

function collectMissing(node: ConditionEvaluation, into: Set<string>): void {
    switch (node.kind) {
        case "all":
        case "any":
            for (const child of node.children) collectMissing(child, into);
            return;
        case "not":
            collectMissing(node.child, into);
            return;
        case "metric":
            if (node.missing) into.add(node.canonicalKey);
    }
}

/** Bind each rule action to a stable position. G2 proposes; applying to targets is G4. */
export function materializeActions(actions: readonly ActionV1[]): readonly ProposedProgressionAction[] {
    return actions.map((action, position) => ({ position, action }));
}

// -------------------------------------------------------------------------------------------------
// Evaluation fingerprint
// -------------------------------------------------------------------------------------------------

/**
 * The stable inputs an evaluation's identity is derived from (design §15.3): the rule version, the
 * trigger, the logical target, and the exact context revisions. The application hashes this seed to
 * a 64-hex fingerprint used for idempotent, replay-safe persistence — the same rule version against
 * the same context revisions on the same trigger always fingerprints identically.
 */
export interface EvaluationFingerprintSeed {
    readonly ruleId: string;
    readonly ruleVersion: number;
    readonly conditionSchemaVersion: number;
    readonly actionSchemaVersion: number;
    readonly trigger: RuleTrigger;
    readonly targetMode: string;
    readonly targetSelector: RuleTargetSelector;
    readonly scopeType: string;
    readonly scopeId: string;
    readonly subjectId: string;
    readonly contextRevisions: Readonly<Record<string, number>>;
}

/**
 * Build the fingerprint seed for one (rule, subject, trigger) evaluation. Returned as a plain,
 * order-normalised object so the application's canonical hasher produces a stable digest; context
 * revisions are copied into a fresh, key-sorted record.
 */
export function buildEvaluationFingerprintSeed(input: EvaluationFingerprintSeed): EvaluationFingerprintSeed {
    const contextRevisions: Record<string, number> = {};
    for (const key of Object.keys(input.contextRevisions).sort()) contextRevisions[key] = input.contextRevisions[key]!;
    return {
        ruleId: input.ruleId,
        ruleVersion: input.ruleVersion,
        conditionSchemaVersion: input.conditionSchemaVersion,
        actionSchemaVersion: input.actionSchemaVersion,
        trigger: input.trigger,
        targetMode: input.targetMode,
        targetSelector: input.targetSelector,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        subjectId: input.subjectId,
        contextRevisions,
    };
}
