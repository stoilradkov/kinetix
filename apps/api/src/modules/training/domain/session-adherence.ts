import { DomainValidationError } from "#src/platform/domain/index";

import { Distance, Duration, type DecimalValue } from "#src/modules/training/domain/measurement";
import type {
    ActivityMappingState,
    OccurrenceMappingState,
    RunStepMappingState,
    SessionMappingsState,
    SetMappingState,
} from "#src/modules/training/domain/session-mapping";
import type {
    PrescribedActivityState,
    PrescribedExerciseState,
    PrescribedRunStepState,
    PrescribedSetState,
    SessionPrescriptionState,
    TargetRanges,
} from "#src/modules/training/domain/session-prescription";
import { deriveAveragePace, type RunningActivityState } from "#src/modules/training/domain/session-running";
import {
    effectiveLoadKg,
    workReps,
    type ExerciseOccurrenceState,
    type PerformedSetState,
} from "#src/modules/training/domain/session-strength";
import type { SessionActivityState } from "#src/modules/training/domain/training-session";

/**
 * Pure, versioned adherence policy `adherence.overall.v1` (design §16.7; PRD AD-1–3). Given one planned
 * prescription an actual session fulfils — plus the explicit planned↔actual mappings and the frozen
 * resolved-execution targets — it scores each compliance component from 0–100 and a single overall
 * percentage. It never loads repositories or persists: it consumes domain state and returns evidence
 * (component inputs) and exclusions as values so the application can store them verbatim.
 *
 * The policy honours the design invariants: values inside a target range score 100 and deviations score
 * against the nearest boundary; missing or non-comparable components are excluded and the remaining
 * weights are renormalised (never scored zero); cancelled prescriptions are reported but excluded from
 * the denominator; added work is reported as divergence and never lowers completion; a substitution
 * counts as exercise completion with a separate flag while volume/intensity still compare only
 * compatible measurements; one-to-many/many-to-one mappings aggregate comparable quantities before
 * scoring; and mixed-activity sessions weight activities by planned expected duration when every
 * activity provides it, otherwise equally. Bumping the version lets the formula evolve without rewriting
 * previously stored results.
 */

export const ADHERENCE_FORMULA = "adherence.overall.v1" as const;
export type AdherenceFormula = typeof ADHERENCE_FORMULA;

export const adherenceComponentKeys = [
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
] as const;
export type AdherenceComponentKey = (typeof adherenceComponentKeys)[number];

export const adherenceScopes = ["session", "strength", "running", "mixed"] as const;
export type AdherenceScope = (typeof adherenceScopes)[number];

export const adherenceExclusionReasons = [
    "missing_target",
    "missing_actual",
    "non_comparable",
    "cancelled",
    "no_load_model",
    "no_mapped_work",
] as const;
export type AdherenceExclusionReason = (typeof adherenceExclusionReasons)[number];

/** Initial versioned weights (design §16.7). Both tables sum to 100; session completion is shared. */
export const STRENGTH_COMPONENT_WEIGHTS_V1 = {
    session_completion: 5,
    exercise_completion: 15,
    set_completion: 20,
    reps: 20,
    load: 15,
    volume: 15,
    intensity: 10,
} as const;

export const RUNNING_COMPONENT_WEIGHTS_V1 = {
    session_completion: 5,
    step_completion: 20,
    distance: 25,
    duration: 20,
    pace: 20,
    intensity: 10,
} as const;

/** Weight reserved for the shared session-completion component; the per-activity block gets the rest. */
export const SESSION_COMPLETION_WEIGHT_V1 = STRENGTH_COMPONENT_WEIGHTS_V1.session_completion;

export interface AdherenceComponentResult {
    readonly key: AdherenceComponentKey;
    readonly scope: AdherenceScope;
    /** 0–100 rounded to three decimals, or `null` when the component is excluded. */
    readonly score: number | null;
    /** Renormalisation weight; may be fractional for mixed sessions. Zero for informational components. */
    readonly weight: number;
    readonly included: boolean;
    readonly exclusion: AdherenceExclusionReason | null;
    /** Human-inspectable evidence: the aggregated actual/planned quantities that produced the score. */
    readonly inputs: Readonly<Record<string, unknown>>;
}

export interface AdherenceCalculation {
    readonly formula: AdherenceFormula;
    readonly scope: AdherenceScope;
    /** Weighted, renormalised overall 0–100, or `null` when every weighted component was excluded. */
    readonly overall: number | null;
    readonly components: readonly AdherenceComponentResult[];
    /** Distinct exclusion reasons that removed at least one weighted component from the denominator. */
    readonly exclusions: readonly AdherenceExclusionReason[];
}

export interface SessionAdherenceInput {
    /** The resolved-execution (or planned) prescription this result scores against — absolute targets. */
    readonly resolved: SessionPrescriptionState;
    /** The performed session's ordered activities (strength/running detail). */
    readonly actualActivities: readonly SessionActivityState[];
    /** Planned↔actual mappings already filtered to this prescription's tree. */
    readonly mappings: SessionMappingsState;
    /** Prescribed row IDs (activity/exercise/set/run-step) the athlete cancelled; excluded from denominators. */
    readonly cancelledPrescribedIds?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------------------------
// Scalar scoring (design §16.7)
// ---------------------------------------------------------------------------------------------

/**
 * Score an actual scalar against a target range: 100 inside `[low, high]`, otherwise a linear penalty
 * against the nearest violated boundary in canonical units. A `null` bound imposes no limit on that
 * side. The caller must exclude the component when both bounds are `null` (there is nothing to compare).
 */
export function scoreScalarAgainstRange(actual: number, low: number | null, high: number | null): number {
    if (low === null && high === null) throw new DomainValidationError("A target range needs at least one bound");
    if (low !== null && actual < low) return boundaryPenalty(actual, low);
    if (high !== null && actual > high) return boundaryPenalty(actual, high);
    return 100;
}

function boundaryPenalty(actual: number, boundary: number): number {
    const deviation = Math.abs(actual - boundary) / Math.max(Math.abs(boundary), 1);
    return round3(Math.max(0, 1 - deviation) * 100);
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

export function calculateSessionAdherenceV1(input: SessionAdherenceInput): AdherenceCalculation {
    const cancelled = input.cancelledPrescribedIds ?? new Set<string>();
    const index = indexActuals(input.actualActivities);
    const mappings = input.mappings;

    // Prescribed activities that were not cancelled participate in scoring; cancelled ones are reported
    // by their absence from every denominator (design §16.7 "reported but excluded from the denominator").
    const activities = input.resolved.activities.filter(activity => !cancelled.has(activity.id));

    const sessionComponents: AdherenceComponentResult[] = [
        sessionCompletionComponent(activities, mappings.activityMappings, cancelled),
        activityCompletionComponent(activities, mappings.activityMappings),
    ];

    // Per-activity blocks share the 95-weight remainder, split by planned expected duration when every
    // activity provides it, otherwise equally (design §16.7 mixed-session rule).
    const shares = activityWeightShares(activities);
    const activityComponents: AdherenceComponentResult[] = [];
    let sawStrength = false;
    let sawRunning = false;
    activities.forEach((activity, position) => {
        const share = shares[position]!;
        if (activity.type === "strength" && activity.strength !== null) {
            sawStrength = true;
            activityComponents.push(...strengthComponents(activity, share, index, mappings, cancelled));
        } else if (activity.type === "running" && activity.running !== null) {
            sawRunning = true;
            activityComponents.push(...runningComponents(activity, share, index, mappings, cancelled));
        }
    });

    const components = [...sessionComponents, ...activityComponents];
    const scope: AdherenceScope = sawStrength && sawRunning ? "mixed" : sawRunning ? "running" : "strength";
    const overall = weightedOverall(components);
    const exclusions = distinctExclusions(components);

    return { formula: ADHERENCE_FORMULA, scope, overall, components, exclusions };
}

// ---------------------------------------------------------------------------------------------
// Session-scope components
// ---------------------------------------------------------------------------------------------

function sessionCompletionComponent(
    activities: readonly PrescribedActivityState[],
    activityMappings: readonly ActivityMappingState[],
    cancelled: ReadonlySet<string>,
): AdherenceComponentResult {
    const byPrescribed = groupBy(activityMappings, mapping => mapping.prescribedActivityId);
    let covered = 0;
    let counted = 0;
    for (const activity of activities) {
        if (cancelled.has(activity.id)) continue;
        counted += 1;
        covered += activityCoverage(byPrescribed.get(activity.id) ?? []);
    }
    const score = counted === 0 ? 100 : round3((covered / counted) * 100);
    return {
        key: "session_completion",
        scope: "session",
        score,
        weight: SESSION_COMPLETION_WEIGHT_V1,
        included: true,
        exclusion: null,
        inputs: { prescribedActivities: counted, coveredActivities: round3(covered) },
    };
}

/** Informational (weight 0): the fraction of prescribed activities that were attempted at all. */
function activityCompletionComponent(
    activities: readonly PrescribedActivityState[],
    activityMappings: readonly ActivityMappingState[],
): AdherenceComponentResult {
    const mapped = new Set(activityMappings.map(mapping => mapping.prescribedActivityId).filter(nonNull));
    const counted = activities.length;
    const attempted = activities.filter(activity => mapped.has(activity.id)).length;
    const score = counted === 0 ? 100 : round3((attempted / counted) * 100);
    return {
        key: "activity_completion",
        scope: "session",
        score,
        weight: 0,
        included: true,
        exclusion: null,
        inputs: { prescribedActivities: counted, attemptedActivities: attempted },
    };
}

// ---------------------------------------------------------------------------------------------
// Strength components
// ---------------------------------------------------------------------------------------------

function strengthComponents(
    activity: PrescribedActivityState,
    share: number,
    index: ActualIndex,
    mappings: SessionMappingsState,
    cancelled: ReadonlySet<string>,
): AdherenceComponentResult[] {
    const exercises = activity.strength!.exercises.filter(exercise => !cancelled.has(exercise.id));
    const prescribedSets = exercises.flatMap(exercise => exercise.sets).filter(set => !cancelled.has(set.id));
    const prescribedSetById = new Map(prescribedSets.map(set => [set.id, set] as const));

    const setMappings = mappings.setMappings.filter(
        mapping => mapping.prescribedSetId === null || prescribedSetById.has(mapping.prescribedSetId),
    );
    const occurrenceMappings = mappings.occurrenceMappings.filter(
        mapping =>
            mapping.prescribedExerciseId === null || exercises.some(ex => ex.id === mapping.prescribedExerciseId),
    );

    const weightOf = (key: keyof typeof STRENGTH_COMPONENT_WEIGHTS_V1): number =>
        round3(STRENGTH_COMPONENT_WEIGHTS_V1[key] * share);

    return [
        exerciseCompletionComponent(exercises, occurrenceMappings, weightOf("exercise_completion")),
        setCompletionComponent(prescribedSets, setMappings, weightOf("set_completion")),
        ...strengthMeasurementComponents(prescribedSetById, setMappings, index, weightOf),
    ];
}

function exerciseCompletionComponent(
    exercises: readonly PrescribedExerciseState[],
    occurrenceMappings: readonly OccurrenceMappingState[],
    weight: number,
): AdherenceComponentResult {
    const byPrescribed = groupBy(occurrenceMappings, mapping => mapping.prescribedExerciseId);
    let covered = 0;
    let substituted = 0;
    for (const exercise of exercises) {
        const relevant = byPrescribed.get(exercise.id) ?? [];
        covered += levelCoverage(relevant);
        if (relevant.some(mapping => mapping.relation === "substituted")) substituted += 1;
    }
    const counted = exercises.length;
    const added = occurrenceMappings.filter(mapping => mapping.relation === "added").length;
    if (counted === 0) {
        return excluded("exercise_completion", "strength", weight, "no_mapped_work", { addedExercises: added });
    }
    return {
        key: "exercise_completion",
        scope: "strength",
        score: round3((covered / counted) * 100),
        weight,
        included: true,
        exclusion: null,
        inputs: { prescribedExercises: counted, coveredExercises: round3(covered), substituted, addedExercises: added },
    };
}

function setCompletionComponent(
    prescribedSets: readonly PrescribedSetState[],
    setMappings: readonly SetMappingState[],
    weight: number,
): AdherenceComponentResult {
    const byPrescribed = groupBy(setMappings, mapping => mapping.prescribedSetId);
    let covered = 0;
    for (const set of prescribedSets) {
        const relevant = byPrescribed.get(set.id) ?? [];
        covered += Math.min(
            1,
            relevant.reduce((sum, mapping) => sum + setCoverage(mapping), 0),
        );
    }
    const counted = prescribedSets.length;
    const added = setMappings.filter(mapping => mapping.prescribedSetId === null).length;
    if (counted === 0) {
        return excluded("set_completion", "strength", weight, "no_mapped_work", { addedSets: added });
    }
    return {
        key: "set_completion",
        scope: "strength",
        score: round3((covered / counted) * 100),
        weight,
        included: true,
        exclusion: null,
        inputs: { prescribedSets: counted, coveredSets: round3(covered), addedSets: added },
    };
}

/**
 * Reps, load, and volume: aggregate comparable quantities *before* scoring (design §16.7). Planned
 * quantities sum/average over the **distinct prescribed sets** in comparable mappings and actual
 * quantities over the **distinct performed sets**, so one-to-many (split) and many-to-one (combined)
 * mappings compare total-versus-total without double counting either side. Added work carries no
 * prescribed side and never enters these comparisons.
 */
function strengthMeasurementComponents(
    prescribedSetById: ReadonlyMap<string, PrescribedSetState>,
    setMappings: readonly SetMappingState[],
    index: ActualIndex,
    weightOf: (key: keyof typeof STRENGTH_COMPONENT_WEIGHTS_V1) => number,
): AdherenceComponentResult[] {
    const comparable = setMappings.filter(
        mapping =>
            mapping.prescribedSetId !== null &&
            prescribedSetById.has(mapping.prescribedSetId) &&
            index.performedSets.has(mapping.performedSetId),
    );
    const prescribed = [...new Set(comparable.map(mapping => mapping.prescribedSetId!))].map(id =>
        prescribedSetById.get(id)!,
    );
    const performed = [...new Set(comparable.map(mapping => mapping.performedSetId))].map(id =>
        index.performedSets.get(id)!,
    );

    const plannedReps = sumBounds(prescribed.map(set => numberRange(set.targets.repsMin, set.targets.repsMax)));
    const actualReps = sumActual(performed.map(ctx => workReps(ctx.set, ctx.occurrence.snapshot.repetitionSemantics)));

    const plannedLoad = meanBounds(prescribed.map(set => decimalRange(set.targets.loadKgMin, set.targets.loadKgMax)));
    const actualLoad = meanActual(
        performed.map(ctx => decimalToNumber(effectiveLoadKg(ctx.set, ctx.occurrence.snapshot.loadModel))),
    );

    const plannedVolume = sumBounds(prescribed.map(set => volumeTargetRange(set.targets)));
    const actualVolume = sumActual(performed.map(performedVolume));

    const plannedRpe = meanBounds(prescribed.map(set => decimalRange(set.targets.rpeMin, set.targets.rpeMax)));
    const actualRpe = meanActual(performed.map(ctx => ctx.set.measurements.rpe));

    return [
        totalComponent("reps", "strength", weightOf("reps"), actualReps, plannedReps),
        meanComponent("load", "strength", weightOf("load"), actualLoad, plannedLoad),
        totalComponent("volume", "strength", weightOf("volume"), actualVolume, plannedVolume),
        meanComponent("intensity", "strength", weightOf("intensity"), actualRpe, plannedRpe),
    ];
}

function performedVolume(ctx: PerformedSetContext): number | null {
    const reps = workReps(ctx.set, ctx.occurrence.snapshot.repetitionSemantics);
    const load = effectiveLoadKg(ctx.set, ctx.occurrence.snapshot.loadModel);
    return reps === null || load === null ? null : reps * load.toNumber();
}

// ---------------------------------------------------------------------------------------------
// Running components
// ---------------------------------------------------------------------------------------------

function runningComponents(
    activity: PrescribedActivityState,
    share: number,
    index: ActualIndex,
    mappings: SessionMappingsState,
    cancelled: ReadonlySet<string>,
): AdherenceComponentResult[] {
    const running = activity.running!;
    const actual = index.runningByActivity.get(activity.id) ?? firstRunning(index);
    const steps = running.steps.filter(step => !cancelled.has(step.id));
    const stepMappings = mappings.runStepMappings.filter(
        mapping => mapping.prescribedRunStepId === null || steps.some(step => step.id === mapping.prescribedRunStepId),
    );

    const weightOf = (key: keyof typeof RUNNING_COMPONENT_WEIGHTS_V1): number =>
        round3(RUNNING_COMPONENT_WEIGHTS_V1[key] * share);

    const overall = running.overallTargets;
    const distance = scalarComponent(
        "distance",
        weightOf("distance"),
        actual === null ? null : canonicalMetres(actual.distance),
        decimalRange(overall.distanceMMin, overall.distanceMMax) ?? summedStepDistanceRange(steps),
    );
    const duration = scalarComponent(
        "duration",
        weightOf("duration"),
        actual === null ? null : canonicalMillis(actual.movingTime),
        numberRange(overall.durationMsMin, overall.durationMsMax) ?? summedStepDurationRange(steps),
    );
    const pace = scalarComponent(
        "pace",
        weightOf("pace"),
        actualPace(actual),
        decimalRange(overall.speedMpsMin, overall.speedMpsMax),
    );
    const intensity = scalarComponent(
        "intensity",
        weightOf("intensity"),
        actual?.rpe ?? null,
        decimalRange(overall.rpeMin, overall.rpeMax) ?? singleValueRange(activity.rpeTarget),
    );

    return [
        stepCompletionComponent(steps, stepMappings, weightOf("step_completion")),
        distance,
        duration,
        pace,
        intensity,
    ];
}

function stepCompletionComponent(
    steps: readonly PrescribedRunStepState[],
    stepMappings: readonly RunStepMappingState[],
    weight: number,
): AdherenceComponentResult {
    const byPrescribed = groupBy(stepMappings, mapping => mapping.prescribedRunStepId);
    let covered = 0;
    for (const step of steps) covered += levelCoverage(byPrescribed.get(step.id) ?? []);
    const counted = steps.length;
    const added = stepMappings.filter(mapping => mapping.prescribedRunStepId === null).length;
    if (counted === 0) return excluded("step_completion", "running", weight, "no_mapped_work", { addedSteps: added });
    return {
        key: "step_completion",
        scope: "running",
        score: round3((covered / counted) * 100),
        weight,
        included: true,
        exclusion: null,
        inputs: { prescribedSteps: counted, coveredSteps: round3(covered), addedSteps: added },
    };
}

// ---------------------------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------------------------

interface NumericRange {
    readonly low: number | null;
    readonly high: number | null;
}

interface ActualTotal {
    readonly value: number;
    readonly count: number;
}

/** Sum actual quantities over distinct performed entities, ignoring the ones that were not recorded. */
function sumActual(values: readonly (number | null)[]): ActualTotal {
    let value = 0;
    let count = 0;
    for (const entry of values) {
        if (entry === null) continue;
        value += entry;
        count += 1;
    }
    return { value, count };
}

/** Mean actual quantity over distinct performed entities (for per-unit quantities like load and RPE). */
function meanActual(values: readonly (number | null)[]): ActualTotal {
    const { value, count } = sumActual(values);
    return { value: count === 0 ? 0 : value / count, count };
}

/** Sum planned range bounds over distinct prescribed entities; a bound stays null until any is present. */
function sumBounds(ranges: readonly (NumericRange | null)[]): NumericRange {
    let low: number | null = null;
    let high: number | null = null;
    for (const range of ranges) {
        if (range === null) continue;
        if (range.low !== null) low = (low ?? 0) + range.low;
        if (range.high !== null) high = (high ?? 0) + range.high;
    }
    return { low, high };
}

/** Mean planned range bounds over distinct prescribed entities. */
function meanBounds(ranges: readonly (NumericRange | null)[]): NumericRange {
    let lowSum = 0;
    let lowCount = 0;
    let highSum = 0;
    let highCount = 0;
    for (const range of ranges) {
        if (range === null) continue;
        if (range.low !== null) {
            lowSum += range.low;
            lowCount += 1;
        }
        if (range.high !== null) {
            highSum += range.high;
            highCount += 1;
        }
    }
    return { low: lowCount === 0 ? null : lowSum / lowCount, high: highCount === 0 ? null : highSum / highCount };
}

/** Total-versus-total comparison: score the summed actual against the summed planned range. */
function totalComponent(
    key: AdherenceComponentKey,
    scope: AdherenceScope,
    weight: number,
    actual: ActualTotal,
    planned: NumericRange,
): AdherenceComponentResult {
    if (actual.count === 0) return excluded(key, scope, weight, "missing_actual", {});
    if (planned.low === null && planned.high === null) return excluded(key, scope, weight, "missing_target", {});
    const low = planned.low === null ? null : round3(planned.low);
    const high = planned.high === null ? null : round3(planned.high);
    return {
        key,
        scope,
        score: scoreScalarAgainstRange(round3(actual.value), low, high),
        weight,
        included: true,
        exclusion: null,
        inputs: { actualTotal: round3(actual.value), targetLow: low, targetHigh: high, comparedEntities: actual.count },
    };
}

/** Mean-versus-mean comparison for quantities that do not sum meaningfully (load, RPE). */
function meanComponent(
    key: AdherenceComponentKey,
    scope: AdherenceScope,
    weight: number,
    actual: ActualTotal,
    planned: NumericRange,
): AdherenceComponentResult {
    if (actual.count === 0) return excluded(key, scope, weight, "missing_actual", {});
    if (planned.low === null && planned.high === null) return excluded(key, scope, weight, "missing_target", {});
    const mean = round3(actual.value);
    const low = planned.low === null ? null : round3(planned.low);
    const high = planned.high === null ? null : round3(planned.high);
    return {
        key,
        scope,
        score: scoreScalarAgainstRange(mean, low, high),
        weight,
        included: true,
        exclusion: null,
        inputs: { actualMean: mean, targetLow: low, targetHigh: high, comparedEntities: actual.count },
    };
}

/** One-shot scalar component (running distance/duration/pace/intensity operate at the activity level). */
function scalarComponent(
    key: AdherenceComponentKey,
    weight: number,
    actual: number | null,
    planned: NumericRange | null,
): AdherenceComponentResult {
    if (planned === null || (planned.low === null && planned.high === null)) {
        return excluded(key, "running", weight, "missing_target", actual === null ? {} : { actual: round3(actual) });
    }
    if (actual === null) {
        return excluded(key, "running", weight, "missing_actual", { targetLow: planned.low, targetHigh: planned.high });
    }
    return {
        key,
        scope: "running",
        score: scoreScalarAgainstRange(actual, planned.low, planned.high),
        weight,
        included: true,
        exclusion: null,
        inputs: { actual: round3(actual), targetLow: planned.low, targetHigh: planned.high },
    };
}

// ---------------------------------------------------------------------------------------------
// Coverage helpers
// ---------------------------------------------------------------------------------------------

/** Coverage a prescribed set receives from one mapped performed set (portion-aware, design §16.7). */
function setCoverage(mapping: SetMappingState): number {
    const portion = mapping.portion === null ? null : Number(mapping.portion);
    switch (mapping.relation) {
        case "partial":
            return portion ?? 0.5;
        case "matched":
        case "substituted":
        case "combined":
        case "split":
            return portion ?? 1;
        default:
            return 0;
    }
}

/** Categorical coverage of a prescribed activity/exercise/step from its mappings (partial → 0.5). */
function levelCoverage(mappings: readonly { readonly relation: string }[]): number {
    if (mappings.length === 0) return 0;
    return mappings.some(mapping => mapping.relation === "partial") &&
        !mappings.some(mapping => mapping.relation !== "partial")
        ? 0.5
        : 1;
}

function activityCoverage(mappings: readonly ActivityMappingState[]): number {
    return levelCoverage(mappings);
}

// ---------------------------------------------------------------------------------------------
// Actual-side index + canonical extraction
// ---------------------------------------------------------------------------------------------

interface PerformedSetContext {
    readonly set: PerformedSetState;
    readonly occurrence: ExerciseOccurrenceState;
}

interface ActualIndex {
    readonly performedSets: ReadonlyMap<string, PerformedSetContext>;
    readonly runningByActivity: ReadonlyMap<string, RunningActivityState>;
}

function indexActuals(activities: readonly SessionActivityState[]): ActualIndex {
    const performedSets = new Map<string, PerformedSetContext>();
    const runningByActivity = new Map<string, RunningActivityState>();
    for (const activity of activities) {
        if (activity.strength !== null) {
            for (const occurrence of activity.strength.occurrences) {
                for (const set of occurrence.performedSets) performedSets.set(set.id, { set, occurrence });
            }
        }
        if (activity.running !== null) runningByActivity.set(activity.id, activity.running);
    }
    return { performedSets, runningByActivity };
}

function firstRunning(index: ActualIndex): RunningActivityState | null {
    for (const running of index.runningByActivity.values()) return running;
    return null;
}

function actualPace(running: RunningActivityState | null): number | null {
    if (running === null) return null;
    const pace = deriveAveragePace(running);
    return pace.speedMetresPerSecond === null ? null : Number(pace.speedMetresPerSecond);
}

function canonicalMetres(distance: RunningActivityState["distance"]): number | null {
    return distance === null ? null : Distance.from(distance.value, distance.unit).canonical.toNumber();
}

function canonicalMillis(duration: RunningActivityState["movingTime"]): number | null {
    return duration === null ? null : Number(Duration.from(duration.value, duration.unit).milliseconds);
}

function summedStepDistanceRange(steps: readonly PrescribedRunStepState[]): NumericRange | null {
    return summedRange(steps.map(step => decimalRange(step.targets.distanceMMin, step.targets.distanceMMax)));
}

function summedStepDurationRange(steps: readonly PrescribedRunStepState[]): NumericRange | null {
    return summedRange(steps.map(step => numberRange(step.targets.durationMsMin, step.targets.durationMsMax)));
}

function summedRange(ranges: readonly (NumericRange | null)[]): NumericRange | null {
    let low: number | null = null;
    let high: number | null = null;
    for (const range of ranges) {
        if (range === null) continue;
        if (range.low !== null) low = (low ?? 0) + range.low;
        if (range.high !== null) high = (high ?? 0) + range.high;
    }
    return low === null && high === null ? null : { low, high };
}

// ---------------------------------------------------------------------------------------------
// Overall aggregation
// ---------------------------------------------------------------------------------------------

function activityWeightShares(activities: readonly PrescribedActivityState[]): number[] {
    const scored = activities.filter(activity => activity.type === "strength" || activity.type === "running");
    if (scored.length === 0) return activities.map(() => 0);
    const durations = scored.map(activity => activity.expectedDurationMs);
    const total = durations.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const useDuration = durations.every(value => value !== null && value > 0) && total > 0;
    return activities.map(activity => {
        if (activity.type !== "strength" && activity.type !== "running") return 0;
        return useDuration ? activity.expectedDurationMs! / total : 1 / scored.length;
    });
}

function weightedOverall(components: readonly AdherenceComponentResult[]): number | null {
    let weighted = 0;
    let totalWeight = 0;
    for (const component of components) {
        if (!component.included || component.score === null || component.weight <= 0) continue;
        weighted += component.score * component.weight;
        totalWeight += component.weight;
    }
    return totalWeight === 0 ? null : round3(weighted / totalWeight);
}

function distinctExclusions(components: readonly AdherenceComponentResult[]): AdherenceExclusionReason[] {
    const reasons = new Set<AdherenceExclusionReason>();
    for (const component of components) {
        if (!component.included && component.exclusion !== null && component.weight > 0)
            reasons.add(component.exclusion);
    }
    return [...reasons];
}

// ---------------------------------------------------------------------------------------------
// Range extraction + primitives
// ---------------------------------------------------------------------------------------------

function numberRange(low: number | null, high: number | null): NumericRange | null {
    return low === null && high === null ? null : { low, high };
}

function decimalRange(low: string | null, high: string | null): NumericRange | null {
    const parsedLow = low === null ? null : Number(low);
    const parsedHigh = high === null ? null : Number(high);
    return parsedLow === null && parsedHigh === null ? null : { low: parsedLow, high: parsedHigh };
}

function singleValueRange(value: string | null): NumericRange | null {
    return value === null ? null : { low: Number(value), high: Number(value) };
}

/** Planned external-load volume range for one prescribed set: reps × load at each matching bound. */
function volumeTargetRange(targets: TargetRanges): NumericRange | null {
    const reps = numberRange(targets.repsMin, targets.repsMax);
    const load = decimalRange(targets.loadKgMin, targets.loadKgMax);
    if (reps === null || load === null) return null;
    const low = reps.low !== null && load.low !== null ? reps.low * load.low : null;
    const high = reps.high !== null && load.high !== null ? reps.high * load.high : null;
    return low === null && high === null ? null : { low, high };
}

function decimalToNumber(value: DecimalValue | null): number | null {
    return value === null ? null : value.toNumber();
}

function excluded(
    key: AdherenceComponentKey,
    scope: AdherenceScope,
    weight: number,
    reason: AdherenceExclusionReason,
    inputs: Readonly<Record<string, unknown>>,
): AdherenceComponentResult {
    return { key, scope, score: null, weight, included: false, exclusion: reason, inputs };
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K | null): Map<K, T[]> {
    const grouped = new Map<K, T[]>();
    for (const item of items) {
        const groupKey = key(item);
        if (groupKey === null) continue;
        const bucket = grouped.get(groupKey);
        if (bucket === undefined) grouped.set(groupKey, [item]);
        else bucket.push(item);
    }
    return grouped;
}

function nonNull<T>(value: T | null): value is T {
    return value !== null;
}

function round3(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
