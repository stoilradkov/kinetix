import { DomainValidationError } from "#src/platform/domain/index";

import { DecimalValue } from "#src/modules/training/domain/measurement";
import {
    SessionPrescription,
    type IdMinter,
    type PrescribedSetState,
    type SessionPrescriptionState,
    type TargetRanges,
} from "#src/modules/training/domain/session-prescription";

/**
 * Pure target-resolution policy (design 10.2, 11.6 step 2; AC-3). When a training session starts from a
 * percentage-based planned prescription, the percentage must be frozen into an absolute load so later
 * max or equipment changes can never rewrite adherence history. Resolution clones the planned tree into
 * an immutable `resolved_execution` prescription (preserving logical keys and recording source row/
 * logical lineage) and rewrites every percentage set into an absolute `load_kg` target rounded to the
 * exercise's equipment increment, retaining the original percentage, the exact max used, and the
 * increment configuration as reproducible evidence.
 *
 * The policy is framework-free: the caller supplies a {@link TargetResolutionContext} that reads the max
 * in force and rounds to the equipment step. Percentages are resolved for strength sets only, because a
 * percentage of 1RM/training-max is defined per exercise.
 */

export type MaxBasis = "estimated_1rm" | "training_max";

export interface ResolvedMaxRef {
    readonly trainingMaxId: string;
    readonly maxType: MaxBasis;
    readonly valueKg: string;
    readonly effectiveFrom: string;
}

export interface RoundedLoadRef {
    readonly valueKg: string;
    readonly incrementId: string | null;
    readonly incrementScope: string | null;
}

/** Capability the caller provides to freeze absolute loads (application wires it to maxes + increments). */
export interface TargetResolutionContext {
    /** The max in force for an exercise+basis at the freeze instant, or null when none is recorded. */
    resolveMax(input: { exerciseId: string; basis: MaxBasis }): ResolvedMaxRef | null;
    /** Round a canonical-kg load to the exercise's equipment increment (nearest step, ties up). */
    roundLoad(input: { exerciseId: string; loadKg: string }): RoundedLoadRef;
}

/** Reproducible evidence for one resolved percentage target (persisted in the resolved set's entry). */
export interface ResolvedTargetEvidence {
    readonly resolvedSetId: string;
    readonly sourceSetId: string | null;
    readonly sourceLogicalKey: string | null;
    readonly exerciseId: string;
    readonly basis: MaxBasis;
    readonly percent: string;
    readonly trainingMaxId: string;
    readonly maxValueKg: string;
    readonly incrementId: string | null;
    readonly incrementScope: string | null;
    readonly resolvedLoadKg: string;
    readonly formula: string;
}

export interface TargetResolutionResult {
    /** The immutable resolved-execution prescription, or null when nothing required resolution. */
    readonly prescription: SessionPrescription | null;
    readonly evidence: readonly ResolvedTargetEvidence[];
}

/** Raised when a percentage target cannot be frozen because no max is in force (design test: missing max). */
export class MissingTrainingMaxError extends DomainValidationError {
    constructor(
        readonly exerciseId: string,
        readonly basis: MaxBasis,
    ) {
        super(`No ${basis === "training_max" ? "training max" : "estimated 1RM"} is recorded for this exercise`, {
            targets: [`No ${basis} is recorded for exercise ${exerciseId}`],
        });
        this.name = "MissingTrainingMaxError";
    }
}

/**
 * Resolve every percentage strength target in a planned prescription into an absolute load. Returns a
 * null prescription (and empty evidence) when no target required resolution, in which case the caller
 * points both the source and resolved references at the planned prescription.
 */
export function resolveExecutionPrescription(
    planned: SessionPrescriptionState,
    context: TargetResolutionContext,
    ids: IdMinter,
    now: Date,
): TargetResolutionResult {
    if (!hasPercentageTarget(planned)) return { prescription: null, evidence: [] };

    // Clone into a resolved_execution tree first: this mints fresh row IDs, preserves logical keys, and
    // records source row/logical lineage for every node (design 10.2). We then rewrite the percentages.
    const cloned = SessionPrescription.rehydrate(planned).cloneForOwner(
        { targetKind: "resolved_execution", preserveLogicalKeys: true },
        ids,
        now,
    ).state;

    const evidence: ResolvedTargetEvidence[] = [];
    const activities = cloned.activities.map(activity => {
        if (activity.strength === null) return activity;
        const exercises = activity.strength.exercises.map(exercise => ({
            ...exercise,
            sets: exercise.sets.map(set => resolveSet(set, exercise.exerciseId, context, evidence)),
        }));
        return { ...activity, strength: { ...activity.strength, exercises } };
    });

    const resolvedState: SessionPrescriptionState = { ...cloned, activities };
    return { prescription: SessionPrescription.rehydrate(resolvedState), evidence };
}

function resolveSet(
    set: PrescribedSetState,
    exerciseId: string,
    context: TargetResolutionContext,
    evidence: ResolvedTargetEvidence[],
): PrescribedSetState {
    const basis = percentBasis(set.targets);
    if (basis === null) return set;
    const percent = basis === "training_max" ? set.targets.percentTrainingMax! : set.targets.percent1rm!;

    const max = context.resolveMax({ exerciseId, basis });
    if (max === null) throw new MissingTrainingMaxError(exerciseId, basis);

    const raw = DecimalValue.from(max.valueKg).multiply(percent).divide(100, 3);
    const rounded = context.roundLoad({ exerciseId, loadKg: raw.toString() });
    const formula = `${max.valueKg} × ${percent}% = ${raw.toString()} → ${rounded.valueKg} kg`;

    evidence.push({
        resolvedSetId: set.id,
        sourceSetId: set.sourceRowId,
        sourceLogicalKey: set.sourceLogicalKey,
        exerciseId,
        basis,
        percent,
        trainingMaxId: max.trainingMaxId,
        maxValueKg: max.valueKg,
        incrementId: rounded.incrementId,
        incrementScope: rounded.incrementScope,
        resolvedLoadKg: rounded.valueKg,
        formula,
    });

    const targets: TargetRanges = {
        ...set.targets,
        loadKgMin: rounded.valueKg,
        loadKgMax: rounded.valueKg,
        percent1rm: null,
        percentTrainingMax: null,
        enteredTargets: {
            ...set.targets.enteredTargets,
            resolution: {
                basis,
                percent,
                trainingMaxId: max.trainingMaxId,
                maxValueKg: max.valueKg,
                effectiveFrom: max.effectiveFrom,
                incrementId: rounded.incrementId,
                incrementScope: rounded.incrementScope,
                resolvedLoadKg: rounded.valueKg,
                formula,
            },
        },
    };
    return { ...set, targets };
}

function percentBasis(targets: TargetRanges): MaxBasis | null {
    if (targets.percent1rm !== null) return "estimated_1rm";
    if (targets.percentTrainingMax !== null) return "training_max";
    return null;
}

function hasPercentageTarget(state: SessionPrescriptionState): boolean {
    for (const activity of state.activities)
        for (const exercise of activity.strength?.exercises ?? [])
            for (const set of exercise.sets) if (percentBasis(set.targets) !== null) return true;
    return false;
}
