import type {
    ActionV1,
    ProgressionActionType,
    RuleScope,
    RuleTarget,
    RuleTargetMode,
    SafetyPolicyConfig,
} from "#src/modules/training/domain/progression-rule";

/**
 * Progression safety — the pure, side-effect-free checks that decide whether a matched rule's proposed
 * actions may progress automatically or must stop for human approval (design §15.4, PRD PG-5). It runs a
 * set of code-registered policy evaluators (max load/volume increase, minimum recovery interval, active
 * pain, poor readiness/sleep, missing safety inputs, and template-mutation prohibition), detects
 * overlapping target fields across proposed actions with no hidden priority, and derives auto-apply
 * eligibility only after every check clears.
 *
 * These are explainable policy checks, never medical injury predictions: each finding carries structured
 * evidence and names the inputs it could not read. Nothing here mutates a target — applying a proposal is
 * G4 and lives outside the domain.
 */

// -------------------------------------------------------------------------------------------------
// Safety outcomes and findings
// -------------------------------------------------------------------------------------------------

/** Worst-to-best safety outcomes; a set of findings aggregates to the most severe present. */
export const safetyOutcomes = ["block", "requires_approval", "pass"] as const;
export type SafetyOutcome = (typeof safetyOutcomes)[number];

const SAFETY_SEVERITY: Record<SafetyOutcome, number> = { block: 2, requires_approval: 1, pass: 0 };

/** One policy's explainable verdict against the proposed actions and context. */
export interface SafetyFinding {
    /** Stable code identifying the policy that produced this finding. */
    readonly policyKey: SafetyPolicyKey;
    readonly outcome: SafetyOutcome;
    /** Human-readable explanation of the facts behind the verdict; never a medical claim. */
    readonly message: string;
    /** Structured facts (limits, observed values) supporting the message. */
    readonly evidence: Readonly<Record<string, number | string | boolean>>;
    /** Inputs the policy needed but could not read; empty when everything required was available. */
    readonly missingInputs: readonly string[];
}

/** The combined safety verdict retained with an evaluation. */
export interface SafetyAssessment {
    readonly outcome: SafetyOutcome;
    readonly findings: readonly SafetyFinding[];
    /** De-duplicated, sorted union of every finding's missing inputs. */
    readonly missingInputs: readonly string[];
}

// -------------------------------------------------------------------------------------------------
// Safety context — the immutable inputs a policy reads (assembled by the application layer)
// -------------------------------------------------------------------------------------------------

export interface SafetyPainArea {
    readonly bodyArea: string;
    readonly severity: number;
    readonly onsetDuringSession: boolean;
    readonly stoppedActivity: boolean;
}

/**
 * Everything the safety policies read, resolved once per evaluation from public application readers.
 * `null` for a numeric input means "not recorded / unavailable" — never a fabricated zero — so policies
 * can distinguish a genuine measurement from missing context.
 */
export interface SafetyContext {
    readonly targetMode: RuleTargetMode;
    readonly config: SafetyPolicyConfig;
    /** Max reported pain severity (0–10) for the completed session; `null` when pain was never assessed. */
    readonly reportedPainSeverity: number | null;
    readonly painAreas: readonly SafetyPainArea[];
    /** Mean pre-workout readiness (1–5); `null` when no readiness was recorded. */
    readonly readiness: number | null;
    /** Sleep hours read from Health Data around the session; `null` when unavailable. */
    readonly sleepHours: number | null;
    /** Hours since the previous completed session; `null` when it cannot be resolved. */
    readonly recoveryIntervalHours: number | null;
    /** Baseline weekly training volume; `null` when analytics context is unavailable (MVP). */
    readonly weeklyVolume: number | null;
}

// -------------------------------------------------------------------------------------------------
// Action classification
// -------------------------------------------------------------------------------------------------

/** Actions that raise mechanical load, volume, or effort demand — the ones the physical policies guard. */
const DEMAND_INCREASING_TYPES: ReadonlySet<ProgressionActionType> = new Set([
    "adjust_load",
    "adjust_reps",
    "adjust_sets",
    "set_effort_target",
    "adjust_run_target",
    "substitute_exercise",
    "repeat_block",
]);

/** Whether an action raises the physical demand of the next prescription (so safety context matters). */
export function increasesDemand(action: ActionV1): boolean {
    switch (action.type) {
        case "adjust_load":
        case "adjust_reps":
        case "adjust_sets":
        case "adjust_run_target":
            return action.value > 0;
        case "set_effort_target":
        case "substitute_exercise":
        case "repeat_block":
            return true;
        default:
            return DEMAND_INCREASING_TYPES.has(action.type);
    }
}

function hasDemandIncreasingAction(actions: readonly ActionV1[]): boolean {
    return actions.some(increasesDemand);
}

function increasesVolume(action: ActionV1): boolean {
    return (action.type === "adjust_sets" || action.type === "adjust_reps") && action.value > 0;
}

// -------------------------------------------------------------------------------------------------
// Policy registry — each policy inspects the actions and context and returns one finding, or null
// -------------------------------------------------------------------------------------------------

export const safetyPolicyKeys = [
    "max_load_increase",
    "max_weekly_volume_increase",
    "min_recovery_interval",
    "active_pain",
    "poor_readiness",
    "poor_sleep",
    "missing_inputs",
    "template_auto_change_prohibition",
] as const;
export type SafetyPolicyKey = (typeof safetyPolicyKeys)[number];

interface SafetyPolicy {
    readonly key: SafetyPolicyKey;
    evaluate(actions: readonly ActionV1[], context: SafetyContext): SafetyFinding | null;
}

function finding(
    policyKey: SafetyPolicyKey,
    outcome: SafetyOutcome,
    message: string,
    evidence: Readonly<Record<string, number | string | boolean>> = {},
    missingInputs: readonly string[] = [],
): SafetyFinding {
    return { policyKey, outcome, message, evidence, missingInputs };
}

/** Block when a proposed load increase exceeds the configured percentage or absolute ceiling. */
const maxLoadIncreasePolicy: SafetyPolicy = {
    key: "max_load_increase",
    evaluate(actions, context) {
        const { maxLoadIncreasePercent, maxLoadIncreaseAbsolute } = context.config;
        const increases = actions.filter(
            (action): action is Extract<ActionV1, { type: "adjust_load" }> =>
                action.type === "adjust_load" && action.value > 0,
        );
        if (increases.length === 0) return null;
        if (maxLoadIncreasePercent === undefined && maxLoadIncreaseAbsolute === undefined) return null;
        for (const action of increases) {
            if (
                action.mode === "percent" &&
                maxLoadIncreasePercent !== undefined &&
                action.value > maxLoadIncreasePercent
            )
                return finding(
                    "max_load_increase",
                    "block",
                    `Proposed load increase of ${action.value}% exceeds the ${maxLoadIncreasePercent}% limit`,
                    { proposedPercent: action.value, limitPercent: maxLoadIncreasePercent },
                );
            if (
                action.mode === "absolute" &&
                maxLoadIncreaseAbsolute !== undefined &&
                action.value > maxLoadIncreaseAbsolute
            )
                return finding(
                    "max_load_increase",
                    "block",
                    `Proposed load increase of ${action.value} exceeds the ${maxLoadIncreaseAbsolute} limit`,
                    { proposedAbsolute: action.value, limitAbsolute: maxLoadIncreaseAbsolute },
                );
        }
        return finding("max_load_increase", "pass", "Proposed load increase is within the configured limit");
    },
};

/**
 * Guard volume-increasing actions against the configured weekly-volume ceiling. Certifying the increase
 * needs the baseline weekly volume; when that analytics input is unavailable (MVP), the change cannot be
 * certified automatically and stops for approval with the missing input named.
 */
const maxWeeklyVolumeIncreasePolicy: SafetyPolicy = {
    key: "max_weekly_volume_increase",
    evaluate(actions, context) {
        const limit = context.config.maxWeeklyVolumeIncreasePercent;
        if (limit === undefined) return null;
        if (!actions.some(increasesVolume)) return null;
        if (context.weeklyVolume === null)
            return finding(
                "max_weekly_volume_increase",
                "requires_approval",
                "Baseline weekly volume is unavailable, so the increase cannot be certified against the limit",
                { limitPercent: limit },
                ["weekly_volume"],
            );
        return finding(
            "max_weekly_volume_increase",
            "pass",
            "Proposed volume increase is within the configured limit",
            {
                limitPercent: limit,
                weeklyVolume: context.weeklyVolume,
            },
        );
    },
};

/** Block a demand-increasing change when the recovery interval is below the configured minimum. */
const minRecoveryIntervalPolicy: SafetyPolicy = {
    key: "min_recovery_interval",
    evaluate(actions, context) {
        const minHours = context.config.minRecoveryHours;
        if (minHours === undefined) return null;
        if (!hasDemandIncreasingAction(actions)) return null;
        if (context.recoveryIntervalHours === null)
            return finding(
                "min_recovery_interval",
                "requires_approval",
                "Recovery interval is unavailable, so the minimum-recovery limit cannot be checked",
                { minHours },
                ["recovery_interval_hours"],
            );
        if (context.recoveryIntervalHours < minHours)
            return finding(
                "min_recovery_interval",
                "block",
                `Only ${context.recoveryIntervalHours}h since the last session is below the ${minHours}h minimum`,
                { recoveryIntervalHours: context.recoveryIntervalHours, minHours },
            );
        return finding("min_recovery_interval", "pass", "Recovery interval meets the configured minimum", {
            recoveryIntervalHours: context.recoveryIntervalHours,
            minHours,
        });
    },
};

/** Block a demand-increasing change when the session reported active pain. */
const activePainPolicy: SafetyPolicy = {
    key: "active_pain",
    evaluate(actions, context) {
        if (!hasDemandIncreasingAction(actions)) return null;
        if (context.reportedPainSeverity === null)
            return finding(
                "active_pain",
                "requires_approval",
                "No pain assessment is recorded, so a demand increase cannot be certified as pain-free",
                {},
                ["reported_pain"],
            );
        if (context.reportedPainSeverity > 0) {
            const areas = context.painAreas
                .filter(area => area.severity > 0)
                .map(area => area.bodyArea)
                .sort();
            return finding(
                "active_pain",
                "block",
                `Active pain (severity ${context.reportedPainSeverity}) rules out an automatic demand increase`,
                {
                    severity: context.reportedPainSeverity,
                    ...(areas.length > 0 ? { areas: areas.join(", ") } : {}),
                },
            );
        }
        return finding("active_pain", "pass", "No active pain was reported for the session");
    },
};

/** Block a demand-increasing change when recorded readiness is below the configured minimum. */
const poorReadinessPolicy: SafetyPolicy = {
    key: "poor_readiness",
    evaluate(actions, context) {
        const minReadiness = context.config.minReadiness;
        if (minReadiness === undefined) return null;
        if (!hasDemandIncreasingAction(actions)) return null;
        if (context.readiness === null)
            return finding(
                "poor_readiness",
                "requires_approval",
                "Readiness is unavailable, so the minimum-readiness limit cannot be checked",
                { minReadiness },
                ["readiness"],
            );
        if (context.readiness < minReadiness)
            return finding(
                "poor_readiness",
                "block",
                `Readiness ${context.readiness} is below the ${minReadiness} minimum`,
                { readiness: context.readiness, minReadiness },
            );
        return finding("poor_readiness", "pass", "Readiness meets the configured minimum", {
            readiness: context.readiness,
            minReadiness,
        });
    },
};

/** Block a demand-increasing change when Health-Data sleep is below the configured minimum. */
const poorSleepPolicy: SafetyPolicy = {
    key: "poor_sleep",
    evaluate(actions, context) {
        const minSleepHours = context.config.minSleepHours;
        if (minSleepHours === undefined) return null;
        if (!hasDemandIncreasingAction(actions)) return null;
        if (context.sleepHours === null)
            return finding(
                "poor_sleep",
                "requires_approval",
                "Sleep is unavailable, so the minimum-sleep limit cannot be checked",
                { minSleepHours },
                ["sleep_hours"],
            );
        if (context.sleepHours < minSleepHours)
            return finding(
                "poor_sleep",
                "block",
                `Sleep ${context.sleepHours}h is below the ${minSleepHours}h minimum`,
                { sleepHours: context.sleepHours, minSleepHours },
            );
        return finding("poor_sleep", "pass", "Sleep meets the configured minimum", {
            sleepHours: context.sleepHours,
            minSleepHours,
        });
    },
};

/**
 * Require approval when a demand-increasing change lacks the baseline safety context (readiness) needed
 * to certify it automatically. Independent of any configured threshold: absent context cannot be
 * auto-certified, so the proposal enters the approval queue with the missing input named.
 */
const missingInputsPolicy: SafetyPolicy = {
    key: "missing_inputs",
    evaluate(actions, context) {
        if (!hasDemandIncreasingAction(actions)) return null;
        const missing: string[] = [];
        if (context.readiness === null) missing.push("readiness");
        if (context.reportedPainSeverity === null) missing.push("reported_pain");
        if (missing.length === 0) return null;
        return finding(
            "missing_inputs",
            "requires_approval",
            `Required safety context is unavailable: ${missing.join(", ")}`,
            {},
            missing,
        );
    },
};

/** Template mutations always require approval and can never auto-apply (design §15.4, PRD PG-5). */
const templateAutoChangeProhibitionPolicy: SafetyPolicy = {
    key: "template_auto_change_prohibition",
    evaluate(_actions, context) {
        if (context.targetMode !== "template") return null;
        return finding(
            "template_auto_change_prohibition",
            "requires_approval",
            "Template changes always require approval and never auto-apply",
        );
    },
};

/** The code-registered safety policies, evaluated in a fixed order (design §15.4). */
export const SAFETY_POLICIES: readonly SafetyPolicy[] = [
    maxLoadIncreasePolicy,
    maxWeeklyVolumeIncreasePolicy,
    minRecoveryIntervalPolicy,
    activePainPolicy,
    poorReadinessPolicy,
    poorSleepPolicy,
    missingInputsPolicy,
    templateAutoChangeProhibitionPolicy,
];

/**
 * Run every registered safety policy over the proposed actions and context, returning each engaged
 * policy's finding plus the aggregate outcome (the most severe present) and the union of missing inputs.
 * Pure and deterministic; policies never mutate targets.
 */
export function assessSafety(actions: readonly ActionV1[], context: SafetyContext): SafetyAssessment {
    const findings: SafetyFinding[] = [];
    for (const policy of SAFETY_POLICIES) {
        const result = policy.evaluate(actions, context);
        if (result !== null) findings.push(result);
    }
    const outcome = findings.reduce<SafetyOutcome>(
        (worst, current) => (SAFETY_SEVERITY[current.outcome] > SAFETY_SEVERITY[worst] ? current.outcome : worst),
        "pass",
    );
    const missing = new Set<string>();
    for (const item of findings) for (const input of item.missingInputs) missing.add(input);
    return { outcome, findings, missingInputs: [...missing].sort() };
}

// -------------------------------------------------------------------------------------------------
// Conflict detection — overlapping target fields across proposed actions, no hidden priority
// -------------------------------------------------------------------------------------------------

/** A rule's proposed actions bound to the logical target/scope they would change. */
export interface ConflictCandidate {
    /** Stable reference for the participant (an evaluation id, or the rule id before persistence). */
    readonly ref: string;
    readonly ruleId: string;
    readonly scope: RuleScope;
    readonly target: RuleTarget;
    readonly actions: readonly ActionV1[];
}

/** The overlap a candidate has with others in the pending set. */
export interface ConflictResult {
    readonly ref: string;
    readonly ruleId: string;
    /** Refs of other candidates that touch the same target field(s). Empty when non-conflicting. */
    readonly conflictsWith: readonly string[];
    /** Distinct target-field keys that overlap, sorted for stable evidence. */
    readonly fields: readonly string[];
}

/** The prescription field an action changes; `null` for advisory actions that never conflict. */
function actionField(action: ActionV1): string | null {
    switch (action.type) {
        case "adjust_load":
            return "load";
        case "adjust_reps":
            return "reps";
        case "adjust_sets":
            return "sets";
        case "set_effort_target":
            return "effort";
        case "adjust_run_target":
            return `run:${action.field}`;
        case "substitute_exercise":
            return "exercise";
        case "repeat_block":
        case "insert_deload":
            return "block_structure";
        case "reschedule_session":
        case "skip_session":
            return "schedule";
        case "recommendation":
            return null;
    }
}

/** Canonical identity of the logical target an action's field applies to (mode + selector + scope). */
function selectorKey(scope: RuleScope, target: RuleTarget): string {
    const selector = target.selector;
    if (selector.kind === "scope") return `scope:${scope.type}:${scope.id}`;
    return `${selector.kind}:${selector.logicalKey}`;
}

/**
 * Canonical target-field key an action would write, or `null` for advisory actions. Two candidates
 * conflict when they share a key (design §15.4).
 */
export function targetFieldKey(scope: RuleScope, target: RuleTarget, action: ActionV1): string | null {
    const field = actionField(action);
    if (field === null) return null;
    return `${target.mode}|${selectorKey(scope, target)}|${field}`;
}

function fieldKeysFor(candidate: ConflictCandidate): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const action of candidate.actions) {
        const key = targetFieldKey(candidate.scope, candidate.target, action);
        if (key !== null) keys.add(key);
    }
    return keys;
}

/**
 * Detect overlapping target fields across a set of proposed changes, treating every participant
 * symmetrically — no rule wins by hidden priority. Two candidates conflict only when they belong to
 * different rules and write the same target field; a rule's own actions never conflict with themselves.
 */
export function detectConflicts(candidates: readonly ConflictCandidate[]): readonly ConflictResult[] {
    const keyed = candidates.map(candidate => ({ candidate, keys: fieldKeysFor(candidate) }));
    return keyed.map(({ candidate, keys }) => {
        const conflictsWith = new Set<string>();
        const fields = new Set<string>();
        for (const other of keyed) {
            if (other.candidate.ref === candidate.ref) continue;
            if (other.candidate.ruleId === candidate.ruleId) continue;
            for (const key of keys)
                if (other.keys.has(key)) {
                    conflictsWith.add(other.candidate.ref);
                    fields.add(key);
                }
        }
        return {
            ref: candidate.ref,
            ruleId: candidate.ruleId,
            conflictsWith: [...conflictsWith].sort(),
            fields: [...fields].sort(),
        };
    });
}

// -------------------------------------------------------------------------------------------------
// Auto-apply eligibility — only after every check clears (design §15.3 step 8)
// -------------------------------------------------------------------------------------------------

export interface AutoApplyDecisionInput {
    readonly matched: boolean;
    readonly autoApply: boolean;
    readonly targetMode: RuleTargetMode;
    readonly safetyOutcome: SafetyOutcome;
    readonly hasConflict: boolean;
}

export interface AutoApplyDecision {
    readonly eligible: boolean;
    /** The first gate that disqualified auto-application, or `null` when eligible. */
    readonly reason: string | null;
}

/**
 * Decide whether a matched proposal qualifies for automatic application: it must match, be explicitly
 * enabled for auto-apply, not target a template, pass every safety policy, and not conflict. Any failing
 * gate returns its reason; nothing is applied here (G4 owns application).
 */
export function autoApplyDecision(input: AutoApplyDecisionInput): AutoApplyDecision {
    if (!input.matched) return { eligible: false, reason: "Rule did not match" };
    if (!input.autoApply) return { eligible: false, reason: "Rule is not enabled for automatic application" };
    if (input.targetMode === "template") return { eligible: false, reason: "Template changes always require approval" };
    if (input.safetyOutcome === "block") return { eligible: false, reason: "A safety policy blocked the change" };
    if (input.safetyOutcome === "requires_approval")
        return { eligible: false, reason: "A safety policy requires approval" };
    if (input.hasConflict) return { eligible: false, reason: "The change conflicts with another proposed change" };
    return { eligible: true, reason: null };
}
