import { DomainValidationError } from "#src/platform/domain/index";

import { DecimalValue, Mass } from "#src/modules/training/domain/measurement";
import {
    SessionPrescription,
    type PrescribedExerciseState,
    type PrescribedRunStepState,
    type PrescribedSetState,
    type SessionPrescriptionState,
    type TargetRanges,
} from "#src/modules/training/domain/session-prescription";
import type {
    ActionV1,
    ProgressionActionType,
    RuleScope,
    RuleTarget,
} from "#src/modules/training/domain/progression-rule";
import type { ProgressionEvaluationStatus } from "#src/modules/training/domain/progression-evaluation";
import type { SafetyOutcome } from "#src/modules/training/domain/progression-safety";

/**
 * Progression approval — the pure, side-effect-free decisions and prescription transforms that back
 * the G4 approval queue (design §15.3 steps 8–9, PRD PG-5, PG-7). Two concerns live here:
 *
 * 1. The approval/rejection state machine: which persisted evaluations a human may still act on, and
 *    why an action is refused (already resolved, not actionable, or blocked by a fresh safety policy).
 *    Staleness (a context revision that moved since evaluation) is surfaced separately so the
 *    application can enqueue a reevaluation instead of applying a proposal to changed state.
 *
 * 2. Applying a matched rule's proposed actions to an immutable target prescription: producing a new,
 *    validated {@link SessionPrescriptionState} whose unchanged and modified elements keep their
 *    logical keys, together with a structured before/after record of every field that changed. Nothing
 *    here persists, clones an owner, or advances a revision — the application layer owns that.
 *
 * Only the target-field actions the MVP can apply deterministically to a prescription tree are
 * supported: `adjust_load`, `adjust_reps`, `set_effort_target`, percentage `adjust_run_target`, and the
 * advisory `recommendation` (recorded, never mutating the tree). Structural and schedule actions
 * (`adjust_sets`, `substitute_exercise`, `repeat_block`, `insert_deload`, `reschedule_session`,
 * `skip_session`) and absolute run-target changes are rejected as not-yet-applicable rather than
 * applied partially, preserving the all-or-none guarantee.
 */

// -------------------------------------------------------------------------------------------------
// Approval / rejection state machine
// -------------------------------------------------------------------------------------------------

/** Why an approval or rejection was refused; the application maps each to a coded error. */
export type ProgressionDecisionRefusal = "already_resolved" | "not_actionable" | "safety_blocked";

export type ProgressionDecisionOutcome =
    { readonly allowed: true } | { readonly allowed: false; readonly refusal: ProgressionDecisionRefusal };

/** Statuses a human can still act on in the approval queue. */
function isActionable(status: ProgressionEvaluationStatus): boolean {
    return status === "pending" || status === "blocked";
}

/** Whether a decision has already been recorded (idempotent replays and double-approval guards). */
export function isResolved(status: ProgressionEvaluationStatus): boolean {
    return status === "applied" || status === "rejected";
}

/**
 * Decide whether a persisted evaluation may be approved. A resolved proposal refuses as
 * `already_resolved` (so a second approver cannot re-apply); an unmatched proposal is `not_actionable`;
 * a fresh safety `block` refuses as `safety_blocked` (a human cannot override a hard safety limit).
 * A `requires_approval` outcome, a conflict, and a template target are all approvable — that is exactly
 * what human approval resolves.
 */
export function planApproval(input: {
    readonly status: ProgressionEvaluationStatus;
    readonly safetyOutcome: SafetyOutcome;
}): ProgressionDecisionOutcome {
    if (isResolved(input.status)) return { allowed: false, refusal: "already_resolved" };
    if (!isActionable(input.status)) return { allowed: false, refusal: "not_actionable" };
    if (input.safetyOutcome === "block") return { allowed: false, refusal: "safety_blocked" };
    return { allowed: true };
}

/** Decide whether a persisted evaluation may be rejected/acknowledged. */
export function planRejection(input: { readonly status: ProgressionEvaluationStatus }): ProgressionDecisionOutcome {
    if (isResolved(input.status)) return { allowed: false, refusal: "already_resolved" };
    if (!isActionable(input.status)) return { allowed: false, refusal: "not_actionable" };
    return { allowed: true };
}

/**
 * Whether the context an evaluation was computed against has moved. Every recorded context revision
 * (e.g. the completed session's version) is compared to the current one; a missing or different current
 * revision means the proposal is stale and must be reevaluated rather than applied.
 */
export function isEvaluationStale(input: {
    readonly recordedContextRevisions: Readonly<Record<string, number>>;
    readonly currentContextRevisions: Readonly<Record<string, number>>;
}): boolean {
    for (const [key, recorded] of Object.entries(input.recordedContextRevisions)) {
        if (input.currentContextRevisions[key] !== recorded) return true;
    }
    return false;
}

// -------------------------------------------------------------------------------------------------
// Action application to an immutable prescription tree
// -------------------------------------------------------------------------------------------------

/** Node kinds a progression action can write in the MVP. */
export type ProgressionTargetNodeKind = "set" | "run_step" | "run_overall";

/** One changed target field, before and after, for the audit/before-after surface (PRD PG-7). */
export interface ProgressionFieldChange {
    readonly field: string;
    readonly before: string | number | null;
    readonly after: string | number | null;
}

/** Every field an action changed on one prescription node. */
export interface ProgressionNodeChange {
    readonly nodeKind: ProgressionTargetNodeKind;
    /** Logical key of the changed node; `null` for the run-overall target which has no logical key. */
    readonly logicalKey: string | null;
    readonly changes: readonly ProgressionFieldChange[];
}

/** The result of applying one proposed action to the target prescription. */
export interface ProgressionActionApplication {
    readonly position: number;
    readonly actionType: ProgressionActionType;
    /** Advisory actions (`recommendation`) never touch the tree. */
    readonly advisory: boolean;
    readonly nodeChanges: readonly ProgressionNodeChange[];
}

export interface AppliedPrescription {
    readonly prescription: SessionPrescriptionState;
    readonly applications: readonly ProgressionActionApplication[];
}

/** Raised when a proposed action cannot be applied deterministically to the target prescription. */
export class ProgressionActionNotApplicableError extends DomainValidationError {
    constructor(
        readonly actionType: ProgressionActionType,
        message: string,
    ) {
        super(message, { actions: [message] });
        this.name = "ProgressionActionNotApplicableError";
    }
}

const STRUCTURAL_ACTION_MESSAGE: Partial<Record<ProgressionActionType, string>> = {
    adjust_sets: "Adding or removing sets is not yet supported for automatic application",
    substitute_exercise: "Exercise substitution is not yet supported for automatic application",
    repeat_block: "Repeating a block is not yet supported for automatic application",
    insert_deload: "Inserting a deload is not yet supported for automatic application",
    reschedule_session: "Rescheduling a session is not a prescription change",
    skip_session: "Skipping a session is not a prescription change",
};

/** Precision (decimal places) each canonical measurement field is scaled to when a percentage applies. */
const DECIMAL_SCALE = 3;

/**
 * Apply a matched rule's proposed actions to the target prescription, returning a new validated tree
 * plus a before/after record. Logical keys are preserved on every unchanged and modified node (the
 * returned state keeps the same ids and keys; only target fields change). If any action cannot be
 * applied, the whole call throws so the caller applies all actions or none.
 */
export function applyProgressionActions(input: {
    readonly prescription: SessionPrescriptionState;
    readonly scope: RuleScope;
    readonly target: RuleTarget;
    readonly actions: readonly ActionV1[];
}): AppliedPrescription {
    const selection = resolveSelection(input.prescription, input.target);
    let working = input.prescription;
    const applications: ProgressionActionApplication[] = [];
    for (let position = 0; position < input.actions.length; position += 1) {
        const result = applyAction(working, selection, input.actions[position]!, position);
        working = result.state;
        applications.push(result.application);
    }
    // Re-validate the mutated tree against every prescription invariant before handing it back.
    return { prescription: SessionPrescription.rehydrate(working).state, applications };
}

// -------------------------------------------------------------------------------------------------
// Selection of the target nodes an action writes
// -------------------------------------------------------------------------------------------------

type KeySelection = "all" | ReadonlySet<string>;

interface TargetSelection {
    readonly sets: KeySelection;
    readonly runSteps: KeySelection;
    readonly runOverall: boolean;
}

function resolveSelection(prescription: SessionPrescriptionState, target: RuleTarget): TargetSelection {
    const selector = target.selector;
    if (selector.kind === "scope") return { sets: "all", runSteps: "all", runOverall: true };
    if (selector.kind === "exercise") {
        const exercise = findExercise(prescription, selector.logicalKey);
        if (!exercise) throw notApplicable("adjust_load", `Target exercise ${selector.logicalKey} was not found`);
        return { sets: new Set(exercise.sets.map(set => set.logicalKey)), runSteps: new Set(), runOverall: false };
    }
    if (selector.kind === "set") {
        if (!findSet(prescription, selector.logicalKey))
            throw notApplicable("adjust_load", `Target set ${selector.logicalKey} was not found`);
        return { sets: new Set([selector.logicalKey]), runSteps: new Set(), runOverall: false };
    }
    if (!findRunStep(prescription, selector.logicalKey))
        throw notApplicable("adjust_run_target", `Target run step ${selector.logicalKey} was not found`);
    return { sets: new Set(), runSteps: new Set([selector.logicalKey]), runOverall: false };
}

function selects(selection: KeySelection, logicalKey: string): boolean {
    return selection === "all" || selection.has(logicalKey);
}

// -------------------------------------------------------------------------------------------------
// Per-action application
// -------------------------------------------------------------------------------------------------

function applyAction(
    state: SessionPrescriptionState,
    selection: TargetSelection,
    action: ActionV1,
    position: number,
): { readonly state: SessionPrescriptionState; readonly application: ProgressionActionApplication } {
    switch (action.type) {
        case "recommendation":
            return { state, application: advisory(action.type, position) };
        case "adjust_load":
        case "adjust_reps":
        case "set_effort_target":
            return applySetAction(state, selection, action, position);
        case "adjust_run_target":
            return applyRunAction(state, selection, action, position);
        default: {
            const message = STRUCTURAL_ACTION_MESSAGE[action.type] ?? `Action ${action.type} cannot be applied`;
            throw notApplicable(action.type, message);
        }
    }
}

type SetAction = Extract<ActionV1, { type: "adjust_load" | "adjust_reps" | "set_effort_target" }>;

function applySetAction(
    state: SessionPrescriptionState,
    selection: TargetSelection,
    action: SetAction,
    position: number,
): { readonly state: SessionPrescriptionState; readonly application: ProgressionActionApplication } {
    const nodeChanges: ProgressionNodeChange[] = [];
    const activities = state.activities.map(activity =>
        activity.strength
            ? {
                  ...activity,
                  strength: {
                      ...activity.strength,
                      exercises: activity.strength.exercises.map(exercise =>
                          mapExerciseSets(exercise, selection.sets, action, nodeChanges),
                      ),
                  },
              }
            : activity,
    );
    if (nodeChanges.length === 0)
        throw notApplicable(action.type, `No target set had a field the ${action.type} action could change`);
    return { state: { ...state, activities }, application: applied(action.type, position, nodeChanges) };
}

function mapExerciseSets(
    exercise: PrescribedExerciseState,
    selection: KeySelection,
    action: SetAction,
    nodeChanges: ProgressionNodeChange[],
): PrescribedExerciseState {
    return {
        ...exercise,
        sets: exercise.sets.map(set => {
            if (!selects(selection, set.logicalKey)) return set;
            const result = applySetTargets(set.targets, action);
            if (result.changes.length === 0) return set;
            nodeChanges.push({ nodeKind: "set", logicalKey: set.logicalKey, changes: result.changes });
            return { ...set, targets: result.targets };
        }),
    };
}

function applySetTargets(
    targets: TargetRanges,
    action: SetAction,
): { readonly targets: TargetRanges; readonly changes: readonly ProgressionFieldChange[] } {
    switch (action.type) {
        case "adjust_load":
            return adjustLoad(targets, action);
        case "adjust_reps":
            return adjustReps(targets, action.value);
        case "set_effort_target":
            return setEffort(targets, action);
    }
}

function adjustLoad(
    targets: TargetRanges,
    action: Extract<ActionV1, { type: "adjust_load" }>,
): { readonly targets: TargetRanges; readonly changes: readonly ProgressionFieldChange[] } {
    const changes: ProgressionFieldChange[] = [];
    const next: Mutable<TargetRanges> = { ...targets };
    const hasAbsolute = targets.loadKgMin !== null || targets.loadKgMax !== null;
    if (hasAbsolute) {
        for (const field of ["loadKgMin", "loadKgMax"] as const) {
            const current = targets[field];
            if (current === null) continue;
            const updated =
                action.mode === "percent"
                    ? scaleDecimal(current, action.value)
                    : addLoad(current, action.value, action.unit ?? "kg");
            if (updated !== current) {
                next[field] = updated;
                changes.push({ field, before: current, after: updated });
            }
        }
        return { targets: next, changes };
    }
    // No absolute load: a percentage change can still scale a percent-of-1RM target.
    if (action.mode === "percent" && targets.percent1rm !== null) {
        const updated = scalePercent(targets.percent1rm, action.value);
        if (updated !== targets.percent1rm) {
            next.percent1rm = updated;
            changes.push({ field: "percent1rm", before: targets.percent1rm, after: updated });
        }
    }
    return { targets: next, changes };
}

function adjustReps(
    targets: TargetRanges,
    delta: number,
): { readonly targets: TargetRanges; readonly changes: readonly ProgressionFieldChange[] } {
    const changes: ProgressionFieldChange[] = [];
    const next: Mutable<TargetRanges> = { ...targets };
    for (const field of ["repsMin", "repsMax"] as const) {
        const current = targets[field];
        if (current === null) continue;
        const updated = Math.max(0, current + delta);
        if (updated !== current) {
            next[field] = updated;
            changes.push({ field, before: current, after: updated });
        }
    }
    return { targets: next, changes };
}

function setEffort(
    targets: TargetRanges,
    action: Extract<ActionV1, { type: "set_effort_target" }>,
): { readonly targets: TargetRanges; readonly changes: readonly ProgressionFieldChange[] } {
    const changes: ProgressionFieldChange[] = [];
    const next: Mutable<TargetRanges> = { ...targets };
    if (action.rpe !== undefined) {
        const value = String(action.rpe);
        recordScalar(next, targets, "rpeMin", value, changes);
        recordScalar(next, targets, "rpeMax", value, changes);
    }
    if (action.rir !== undefined) {
        recordScalar(next, targets, "rirMin", action.rir, changes);
        recordScalar(next, targets, "rirMax", action.rir, changes);
    }
    return { targets: next, changes };
}

function applyRunAction(
    state: SessionPrescriptionState,
    selection: TargetSelection,
    action: Extract<ActionV1, { type: "adjust_run_target" }>,
    position: number,
): { readonly state: SessionPrescriptionState; readonly application: ProgressionActionApplication } {
    if (action.mode !== "percent")
        throw notApplicable(action.type, "Only percentage run-target changes are supported for automatic application");
    const nodeChanges: ProgressionNodeChange[] = [];
    const activities = state.activities.map(activity => {
        if (!activity.running) return activity;
        const overall =
            selection.runOverall && runFieldOf(activity.running.overallTargets, action.field) !== null
                ? adjustRunOverall(activity.running.overallTargets, action, nodeChanges)
                : activity.running.overallTargets;
        return {
            ...activity,
            running: {
                ...activity.running,
                overallTargets: overall,
                steps: activity.running.steps.map(step => mapRunStep(step, selection.runSteps, action, nodeChanges)),
            },
        };
    });
    if (nodeChanges.length === 0)
        throw notApplicable(action.type, `No target run step carried a ${action.field} value to change`);
    return { state: { ...state, activities }, application: applied(action.type, position, nodeChanges) };
}

function adjustRunOverall(
    targets: TargetRanges,
    action: Extract<ActionV1, { type: "adjust_run_target" }>,
    nodeChanges: ProgressionNodeChange[],
): TargetRanges {
    const result = adjustRunTargets(targets, action);
    if (result.changes.length > 0)
        nodeChanges.push({ nodeKind: "run_overall", logicalKey: null, changes: result.changes });
    return result.targets;
}

function mapRunStep(
    step: PrescribedRunStepState,
    selection: KeySelection,
    action: Extract<ActionV1, { type: "adjust_run_target" }>,
    nodeChanges: ProgressionNodeChange[],
): PrescribedRunStepState {
    if (!selects(selection, step.logicalKey)) return step;
    const result = adjustRunTargets(step.targets, action);
    if (result.changes.length === 0) return step;
    nodeChanges.push({ nodeKind: "run_step", logicalKey: step.logicalKey, changes: result.changes });
    return { ...step, targets: result.targets };
}

/** The canonical target fields a run-target field maps to (min/max share the same field pair). */
const RUN_FIELD_COLUMNS: Record<
    Extract<ActionV1, { type: "adjust_run_target" }>["field"],
    readonly (keyof TargetRanges)[]
> = {
    duration: ["durationMsMin", "durationMsMax"],
    distance: ["distanceMMin", "distanceMMax"],
    pace: ["speedMpsMin", "speedMpsMax"],
    power: ["powerWMin", "powerWMax"],
};

function runFieldOf(targets: TargetRanges, field: Extract<ActionV1, { type: "adjust_run_target" }>["field"]): unknown {
    return targets[RUN_FIELD_COLUMNS[field][0]!] ?? targets[RUN_FIELD_COLUMNS[field][1]!] ?? null;
}

function adjustRunTargets(
    targets: TargetRanges,
    action: Extract<ActionV1, { type: "adjust_run_target" }>,
): { readonly targets: TargetRanges; readonly changes: readonly ProgressionFieldChange[] } {
    const changes: ProgressionFieldChange[] = [];
    const next: Mutable<TargetRanges> = { ...targets };
    for (const field of RUN_FIELD_COLUMNS[action.field]) {
        const current = targets[field];
        if (current === null || current === undefined) continue;
        if (field === "durationMsMin" || field === "durationMsMax") {
            const rounded = Math.max(0, Math.round(((current as number) * (100 + action.value)) / 100));
            if (rounded !== current) {
                next[field] = rounded;
                changes.push({ field, before: current as number, after: rounded });
            }
        } else {
            const updated = scaleDecimal(current as string, action.value);
            if (updated !== current) {
                (next as Record<string, unknown>)[field] = updated;
                changes.push({ field, before: current as string, after: updated });
            }
        }
    }
    return { targets: next, changes };
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function recordScalar<K extends keyof TargetRanges>(
    next: Mutable<TargetRanges>,
    previous: TargetRanges,
    field: K,
    value: TargetRanges[K],
    changes: ProgressionFieldChange[],
): void {
    if (previous[field] === value) return;
    next[field] = value;
    changes.push({
        field,
        before: previous[field] as string | number | null,
        after: value as string | number | null,
    });
}

/** Scale a canonical decimal string by a percentage, clamped at zero, truncated to a stable scale. */
function scaleDecimal(value: string, percent: number): string {
    const scaled = DecimalValue.from(value)
        .multiply(100 + percent)
        .divide(100, DECIMAL_SCALE);
    return (scaled.compare(0) < 0 ? DecimalValue.from(0) : scaled).toString();
}

/** Scale a percent-of-1RM target (0–100) by a relative percentage, clamped to the valid range. */
function scalePercent(value: string, percent: number): string {
    const scaled = DecimalValue.from(value)
        .multiply(100 + percent)
        .divide(100, DECIMAL_SCALE);
    const clamped =
        scaled.compare(0) < 0 ? DecimalValue.from(0) : scaled.compare(100) > 0 ? DecimalValue.from(100) : scaled;
    return clamped.toString();
}

/** Add an entered-unit load delta (which may be negative) to a canonical kg string, clamped at zero. */
function addLoad(value: string, delta: number, unit: "kg" | "lb"): string {
    const magnitude = Mass.from(Math.abs(delta), unit).canonical.toString();
    const sum = addDecimalStrings(value, delta >= 0 ? magnitude : `-${magnitude}`);
    const result = DecimalValue.from(sum);
    return (result.compare(0) < 0 ? DecimalValue.from(0) : result).toString();
}

interface ParsedDecimal {
    readonly coefficient: bigint;
    readonly scale: number;
}

/** Add two decimal strings exactly via aligned BigInt coefficients (DecimalValue has no add). */
function addDecimalStrings(a: string, b: string): string {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    const scale = Math.max(pa.scale, pb.scale);
    const left = pa.coefficient * 10n ** BigInt(scale - pa.scale);
    const right = pb.coefficient * 10n ** BigInt(scale - pb.scale);
    const total = left + right;
    if (scale === 0) return total.toString();
    const negative = total < 0n;
    const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
    return `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function parseDecimal(value: string): ParsedDecimal {
    const negative = value.startsWith("-");
    const body = negative ? value.slice(1) : value;
    const [whole, fraction = ""] = body.split(".");
    const coefficient = BigInt(`${whole || "0"}${fraction}`);
    return { coefficient: negative ? -coefficient : coefficient, scale: fraction.length };
}

function advisory(actionType: ProgressionActionType, position: number): ProgressionActionApplication {
    return { position, actionType, advisory: true, nodeChanges: [] };
}

function applied(
    actionType: ProgressionActionType,
    position: number,
    nodeChanges: readonly ProgressionNodeChange[],
): ProgressionActionApplication {
    return { position, actionType, advisory: false, nodeChanges };
}

function notApplicable(actionType: ProgressionActionType, message: string): ProgressionActionNotApplicableError {
    return new ProgressionActionNotApplicableError(actionType, message);
}

function findExercise(state: SessionPrescriptionState, logicalKey: string): PrescribedExerciseState | null {
    for (const activity of state.activities)
        for (const exercise of activity.strength?.exercises ?? [])
            if (exercise.logicalKey === logicalKey) return exercise;
    return null;
}

function findSet(state: SessionPrescriptionState, logicalKey: string): PrescribedSetState | null {
    for (const activity of state.activities)
        for (const exercise of activity.strength?.exercises ?? [])
            for (const set of exercise.sets) if (set.logicalKey === logicalKey) return set;
    return null;
}

function findRunStep(state: SessionPrescriptionState, logicalKey: string): PrescribedRunStepState | null {
    for (const activity of state.activities)
        for (const step of activity.running?.steps ?? []) if (step.logicalKey === logicalKey) return step;
    return null;
}
