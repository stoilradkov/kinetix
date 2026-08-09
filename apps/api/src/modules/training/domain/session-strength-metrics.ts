/**
 * Structured-strength metric calculators (issue #44, A2; design §16.4; PRD AN-2).
 *
 * These are the first production calculators registered against the A1 derived-metric framework
 * (issue #43). They derive explainable strength workload from a completed session's structured sets —
 * work reps, external/effective load and volume, direct/indirect muscle sets, hard sets,
 * time-under-tension, and frequency — per session and per rolling window, on both the frozen-snapshot
 * (`historical`) and current-definition (`latest`) bases.
 *
 * Everything here is pure and deterministic: no repositories, no jobs, no persistence, no wire schemas.
 * The calculators reuse the aggregate's snapshot policies (`workReps`, `effectiveLoadKg`) so analytics
 * never re-derive repetition/load semantics, and they never conflate unrelated exercises or invent
 * fractional muscle weighting (§16.4). Every result carries its exclusions/transformations as evidence
 * plus the source session/set/exercise revisions that fed it.
 */

import { Mass, type DecimalValue } from "#src/modules/training/domain/measurement";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/exercise-definition";
import type { RepetitionSemantics } from "#src/modules/training/domain/catalog";
import { effectiveLoadKg, workReps, type PerformedSetState } from "#src/modules/training/domain/session-strength";
import {
    isoWeekStart,
    type MetricCalculator,
    type MetricDependency,
    type MetricInputRef,
    type MetricPeriod,
    type MetricResult,
    type MetricScope,
} from "#src/modules/training/domain/metric-projection";

// -------------------------------------------------------------------------------------------------
// Versioned configuration + entity-type / unit constants
// -------------------------------------------------------------------------------------------------

/** The two computation bases every strength metric is reported on (acceptance criterion 5). */
export type MetricBasis = "historical" | "latest";

export const METRIC_BASES: readonly MetricBasis[] = ["historical", "latest"];

/**
 * Default hard-set thresholds when a profile omits them (design §16.4: "RPE ≥ 7 or RIR ≤ 3"). The `V1`
 * suffix pins these to the calculator version, mirroring adherence's `*_V1` domain constants; a profile
 * may override them through the loaded {@link StrengthMetricConfig}, which folds into the fingerprint.
 */
export const STRENGTH_METRIC_DEFAULTS_V1 = { rpeThreshold: 7, rirThreshold: 3 } as const;

/** Source-entity types recorded as input references (they double as invalidation-scope keys). */
export const STRENGTH_METRIC_SESSION_ENTITY = "session";
export const STRENGTH_METRIC_EXERCISE_ENTITY = "exercise";

const REPS_UNIT = "reps";
const KG_UNIT = "kg";
const SETS_UNIT = "sets";
const MS_UNIT = "ms";
const OCCURRENCES_UNIT = "occurrences";
const SESSIONS_UNIT = "sessions";

/** How far a session's date reaches forward: a session influences rolling windows ending ≤ 27 days later. */
export const STRENGTH_WINDOW_MAX_DAYS = 28;

// -------------------------------------------------------------------------------------------------
// Facts — the pure inputs an infrastructure context reader assembles for the calculators
// -------------------------------------------------------------------------------------------------

/** One exercise occurrence with its frozen (`historical`) and current (`latest`) definition snapshots. */
export interface StrengthOccurrenceFacts {
    readonly occurrenceId: string;
    readonly exerciseId: string;
    /** Exercise version the historical snapshot was frozen at. */
    readonly historicalExerciseVersion: number;
    /** Current exercise version, or `null` when the definition is unavailable (e.g. archived). */
    readonly latestExerciseVersion: number | null;
    readonly historical: ExerciseSnapshotV1;
    readonly latest: ExerciseSnapshotV1 | null;
    readonly performedSets: readonly PerformedSetState[];
}

/** Everything the session-scope calculators score for one completed session. */
export interface StrengthSessionFacts {
    readonly sessionId: string;
    readonly profileId: string;
    readonly sessionVersion: number;
    readonly localDate: string;
    readonly occurrences: readonly StrengthOccurrenceFacts[];
}

/** One session contributing to a window aggregation. */
export interface StrengthWindowSessionFacts {
    readonly sessionId: string;
    readonly sessionVersion: number;
    readonly localDate: string;
    readonly occurrences: readonly StrengthOccurrenceFacts[];
}

/** Everything the window-scope calculators score for one profile window (scope + period pre-resolved). */
export interface StrengthWindowFacts {
    readonly profileId: string;
    readonly scope: MetricScope;
    readonly period: MetricPeriod;
    readonly sessions: readonly StrengthWindowSessionFacts[];
}

/** Versioned thresholds/config a calculator runs against (loaded from the training profile). */
export interface StrengthMetricConfig {
    readonly rpeThreshold: number;
    readonly rirThreshold: number;
    readonly calculatorVersion: number;
}

// -------------------------------------------------------------------------------------------------
// Set eligibility + per-set policies (design §16.4)
// -------------------------------------------------------------------------------------------------

/** A working set eligible for workload metrics: not a warm-up, and completed or partially completed. */
export function isEligibleWorkingSet(set: PerformedSetState): boolean {
    return set.setType !== "warm_up" && (set.status === "completed" || set.status === "partial");
}

/** A hard set: an eligible set that meets the configured RPE-or-RIR intensity threshold (design §16.4). */
export function isHardSet(set: PerformedSetState, config: StrengthMetricConfig): boolean {
    if (!isEligibleWorkingSet(set)) return false;
    const meetsRpe = set.measurements.rpe !== null && set.measurements.rpe >= config.rpeThreshold;
    const meetsRir = set.measurements.rir !== null && set.measurements.rir <= config.rirThreshold;
    return meetsRpe || meetsRir;
}

/** External load in canonical kilograms from the recorded `externalLoad` measurement, or null if absent. */
export function externalLoadKg(set: PerformedSetState): DecimalValue | null {
    const load = set.measurements.externalLoad;
    return load === null ? null : Mass.from(load.value, load.unit).canonical;
}

/**
 * Time under tension in milliseconds for one set (design §16.4): completed repetitions multiplied by the
 * total of the available tempo phases, or the explicit set duration when no tempo is recorded. Returns
 * null when neither tempo nor duration is available. Repetitions use the snapshotted work-rep semantics
 * so per-side movements count each side.
 */
export function timeUnderTensionMs(set: PerformedSetState, semantics: RepetitionSemantics): number | null {
    const tempoMs = totalTempoMs(set);
    if (tempoMs !== null) {
        const reps = workReps(set, semantics);
        return reps === null ? null : reps * tempoMs;
    }
    const duration = set.measurements.duration;
    return duration === null ? null : durationMs(duration.value, duration.unit);
}

// -------------------------------------------------------------------------------------------------
// Session-scope calculators
// -------------------------------------------------------------------------------------------------

/** The dependency categories the strength calculators invalidate on (design §16.3). */
const STRENGTH_DEPENDENCIES: readonly MetricDependency[] = ["session", "exercise", "context"];

export const STRENGTH_WORK_REPS = "strength.work_reps";
export const STRENGTH_EXTERNAL_VOLUME = "strength.external_volume";
export const STRENGTH_EFFECTIVE_VOLUME = "strength.effective_volume";
export const STRENGTH_DIRECT_MUSCLE_SETS = "strength.direct_muscle_sets";
export const STRENGTH_INDIRECT_MUSCLE_SETS = "strength.indirect_muscle_sets";
export const STRENGTH_HARD_SETS = "strength.hard_sets";
export const STRENGTH_TIME_UNDER_TENSION = "strength.time_under_tension";
export const STRENGTH_FREQUENCY = "strength.frequency";

export const STRENGTH_WINDOW_EXERCISE_VOLUME = "strength.window.exercise_volume";
export const STRENGTH_WINDOW_MUSCLE_SETS = "strength.window.muscle_sets";
export const STRENGTH_WINDOW_FREQUENCY = "strength.window.frequency";

/**
 * A resolved per-exercise group for one basis: the snapshot in force plus every eligible set (with the
 * occurrence it came from). Exercises repeated across occurrences aggregate into one group so volume and
 * counts reflect the whole session's work on that movement.
 */
interface ExerciseGroup {
    readonly exerciseId: string;
    readonly snapshot: ExerciseSnapshotV1;
    readonly exerciseVersion: number;
    readonly occurrenceIds: readonly string[];
    readonly eligibleSets: readonly PerformedSetState[];
}

function exerciseGroups(occurrences: readonly StrengthOccurrenceFacts[], basis: MetricBasis): ExerciseGroup[] {
    const groups = new Map<
        string,
        { snapshot: ExerciseSnapshotV1; version: number; occurrences: Set<string>; sets: PerformedSetState[] }
    >();
    for (const occurrence of occurrences) {
        const snapshot = basis === "historical" ? occurrence.historical : occurrence.latest;
        const version =
            basis === "historical" ? occurrence.historicalExerciseVersion : occurrence.latestExerciseVersion;
        if (snapshot === null || version === null) continue; // latest definition unavailable — no latest basis
        const eligible = occurrence.performedSets.filter(isEligibleWorkingSet);
        if (eligible.length === 0) continue;
        const group = groups.get(occurrence.exerciseId) ?? {
            snapshot,
            version,
            occurrences: new Set<string>(),
            sets: [],
        };
        group.occurrences.add(occurrence.occurrenceId);
        group.sets.push(...eligible);
        groups.set(occurrence.exerciseId, group);
    }
    return [...groups.entries()].map(([exerciseId, group]) => ({
        exerciseId,
        snapshot: group.snapshot,
        exerciseVersion: group.version,
        occurrenceIds: [...group.occurrences],
        eligibleSets: group.sets,
    }));
}

/** Sum work repetitions across an exercise's eligible sets, honouring per-side/alternating semantics. */
const workRepsCalculator: MetricCalculator<StrengthSessionFacts> = strengthSessionCalculator(
    STRENGTH_WORK_REPS,
    facts =>
        perExercisePerBasis(facts, group => {
            let total = 0;
            let anyReps = false;
            let perSideExpanded = false;
            const excluded: ExcludedSet[] = [];
            const includedSetIds: string[] = [];
            for (const set of group.eligibleSets) {
                const reps = workReps(set, group.snapshot.repetitionSemantics);
                if (reps === null) {
                    excluded.push({ setId: set.id, reason: "missing_reps" });
                    continue;
                }
                if (group.snapshot.repetitionSemantics === "per_side") perSideExpanded = true;
                anyReps = true;
                total += reps;
                includedSetIds.push(set.id);
            }
            return {
                numeric: anyReps ? total : null,
                unit: REPS_UNIT,
                details: { perSideExpanded, includedSetIds, excludedSets: excluded },
            };
        }),
);

/** External-load volume: Σ workReps × externalLoad (kg). Sets without external load are excluded. */
const externalVolumeCalculator: MetricCalculator<StrengthSessionFacts> = strengthSessionCalculator(
    STRENGTH_EXTERNAL_VOLUME,
    facts => perExercisePerBasis(facts, group => volumeReading(group, "external")),
);

/** Effective-load volume: Σ workReps × effectiveLoad (kg) via the snapshotted load model. */
const effectiveVolumeCalculator: MetricCalculator<StrengthSessionFacts> = strengthSessionCalculator(
    STRENGTH_EFFECTIVE_VOLUME,
    facts => perExercisePerBasis(facts, group => volumeReading(group, "effective")),
);

/** Count of eligible sets whose exercise lists the muscle as a **primary** (direct) mover. */
const directMuscleSetsCalculator: MetricCalculator<StrengthSessionFacts> = strengthSessionCalculator(
    STRENGTH_DIRECT_MUSCLE_SETS,
    facts => perMusclePerBasis(facts, "primary", SETS_UNIT),
);

/** Count of eligible sets whose exercise lists the muscle as a **secondary** (indirect) mover. */
const indirectMuscleSetsCalculator: MetricCalculator<StrengthSessionFacts> = strengthSessionCalculator(
    STRENGTH_INDIRECT_MUSCLE_SETS,
    facts => perMusclePerBasis(facts, "secondary", SETS_UNIT),
);

/** Count of eligible non-warm-up sets meeting the configured RPE/RIR hard-set threshold. */
const hardSetsCalculator: MetricCalculator<StrengthSessionFacts> = strengthSessionCalculator(
    STRENGTH_HARD_SETS,
    (facts, config) =>
        perExercisePerBasis(facts, group => {
            const hard: string[] = [];
            const excluded: ExcludedSet[] = [];
            for (const set of group.eligibleSets) {
                if (isHardSet(set, config)) hard.push(set.id);
                else excluded.push({ setId: set.id, reason: "below_threshold" });
            }
            return {
                numeric: group.eligibleSets.length === 0 ? null : hard.length,
                unit: SETS_UNIT,
                details: {
                    includedSetIds: hard,
                    excludedSets: excluded,
                    rpeThreshold: config.rpeThreshold,
                    rirThreshold: config.rirThreshold,
                },
            };
        }),
);

/** Time under tension: Σ per-set TUT (completed reps × tempo, or explicit duration) in milliseconds. */
const timeUnderTensionCalculator: MetricCalculator<StrengthSessionFacts> = strengthSessionCalculator(
    STRENGTH_TIME_UNDER_TENSION,
    facts =>
        perExercisePerBasis(facts, group => {
            let total = 0;
            let any = false;
            const includedSetIds: string[] = [];
            const excluded: ExcludedSet[] = [];
            for (const set of group.eligibleSets) {
                const tut = timeUnderTensionMs(set, group.snapshot.repetitionSemantics);
                if (tut === null) {
                    excluded.push({ setId: set.id, reason: "no_tempo_or_duration" });
                    continue;
                }
                any = true;
                total += tut;
                includedSetIds.push(set.id);
            }
            return { numeric: any ? total : null, unit: MS_UNIT, details: { includedSetIds, excludedSets: excluded } };
        }),
);

/** Frequency: how many occurrences of an exercise carried eligible working sets this session. */
const frequencyCalculator: MetricCalculator<StrengthSessionFacts> = strengthSessionCalculator(
    STRENGTH_FREQUENCY,
    facts =>
        perExercisePerBasis(facts, group => ({
            numeric: group.occurrenceIds.length,
            unit: OCCURRENCES_UNIT,
            details: { occurrenceIds: group.occurrenceIds },
        })),
);

// -------------------------------------------------------------------------------------------------
// Window-scope calculators
// -------------------------------------------------------------------------------------------------

/** Per-exercise effective-load volume aggregated across the window's sessions (external in evidence). */
const windowExerciseVolumeCalculator: MetricCalculator<StrengthWindowFacts> = strengthWindowCalculator(
    STRENGTH_WINDOW_EXERCISE_VOLUME,
    facts =>
        perWindowExercisePerBasis(facts, (group, refs) => {
            let effective = zero();
            let external = zero();
            const includedSetIds: string[] = [];
            const excluded: ExcludedSet[] = [];
            for (const { set, snapshot } of group) {
                const reps = workReps(set, snapshot.repetitionSemantics);
                const eff = reps === null ? null : effectiveLoadKg(set, snapshot.loadModel);
                const ext = reps === null ? null : externalLoadKg(set);
                if (reps === null || (eff === null && ext === null)) {
                    excluded.push({ setId: set.id, reason: reps === null ? "missing_reps" : "missing_load" });
                    continue;
                }
                if (eff !== null) effective = addDecimal(effective, eff.multiply(reps));
                if (ext !== null) external = addDecimal(external, ext.multiply(reps));
                includedSetIds.push(set.id);
            }
            return {
                numeric: includedSetIds.length === 0 ? null : effective.toNumber(),
                unit: KG_UNIT,
                details: {
                    externalVolumeKg: external.toNumber(),
                    sessionCount: refs.sessionIds.length,
                    includedSetIds,
                    excludedSets: excluded,
                },
            };
        }),
);

/** Per-muscle direct/indirect set counts aggregated across the window (hard-set count in evidence). */
const windowMuscleSetsCalculator: MetricCalculator<StrengthWindowFacts> = strengthWindowCalculator(
    STRENGTH_WINDOW_MUSCLE_SETS,
    (facts, config) => windowMuscleSets(facts, config),
);

/** Per-muscle frequency: the number of distinct window sessions that trained the muscle in any role. */
const windowFrequencyCalculator: MetricCalculator<StrengthWindowFacts> = strengthWindowCalculator(
    STRENGTH_WINDOW_FREQUENCY,
    facts => windowFrequency(facts),
);

// -------------------------------------------------------------------------------------------------
// Registration bundles
// -------------------------------------------------------------------------------------------------

export const STRENGTH_SESSION_CALCULATORS: readonly MetricCalculator[] = [
    workRepsCalculator,
    externalVolumeCalculator,
    effectiveVolumeCalculator,
    directMuscleSetsCalculator,
    indirectMuscleSetsCalculator,
    hardSetsCalculator,
    timeUnderTensionCalculator,
    frequencyCalculator,
] as MetricCalculator[];

export const STRENGTH_WINDOW_CALCULATORS: readonly MetricCalculator[] = [
    windowExerciseVolumeCalculator,
    windowMuscleSetsCalculator,
    windowFrequencyCalculator,
] as MetricCalculator[];

/** Every strength calculator registered by A2, in stable order (session metrics first, then windows). */
export const STRENGTH_CALCULATORS: readonly MetricCalculator[] = [
    ...STRENGTH_SESSION_CALCULATORS,
    ...STRENGTH_WINDOW_CALCULATORS,
];

/** The calculator keys A2 owns — used to scope "retire the strength metrics no longer produced". */
export const STRENGTH_CALCULATOR_KEYS: readonly string[] = STRENGTH_CALCULATORS.map(calculator => calculator.key);

// -------------------------------------------------------------------------------------------------
// Session-scope building blocks
// -------------------------------------------------------------------------------------------------

interface ExcludedSet {
    readonly setId: string;
    readonly reason: string;
}

interface Reading {
    readonly numeric: number | null;
    readonly unit: string;
    readonly details: Readonly<Record<string, unknown>>;
}

/** Build a session-scope calculator whose per-key results derive from a `(facts, config) → results` fn. */
function strengthSessionCalculator(
    key: string,
    compute: (facts: StrengthSessionFacts, config: StrengthMetricConfig) => readonly MetricResult[],
): MetricCalculator<StrengthSessionFacts> {
    return {
        key,
        version: 1,
        dependencies: STRENGTH_DEPENDENCIES,
        calculate: context => compute(context.facts, resolveConfig(context.config)),
    };
}

/** Emit one result per (exercise, basis) at session scope from a per-group reading. */
function perExercisePerBasis(facts: StrengthSessionFacts, reading: (group: ExerciseGroup) => Reading): MetricResult[] {
    const results: MetricResult[] = [];
    const scope: MetricScope = { type: "session", id: facts.sessionId };
    const period: MetricPeriod = { kind: "point", at: facts.localDate };
    for (const basis of METRIC_BASES) {
        for (const group of exerciseGroups(facts.occurrences, basis)) {
            const read = reading(group);
            results.push({
                scope,
                period,
                dimensions: { exercise: group.exerciseId, basis },
                value: {
                    numeric: read.numeric,
                    text: null,
                    unit: read.unit,
                    details: { basis, exerciseVersion: group.exerciseVersion, ...read.details },
                },
                inputs: sessionExerciseInputs(facts, group.exerciseId, group.exerciseVersion),
            });
        }
    }
    return results;
}

/** External or effective volume reading for one exercise group (kg), excluding sets missing the load. */
function volumeReading(group: ExerciseGroup, kind: "external" | "effective"): Reading {
    let total = zero();
    let any = false;
    const includedSetIds: string[] = [];
    const excluded: ExcludedSet[] = [];
    for (const set of group.eligibleSets) {
        const reps = workReps(set, group.snapshot.repetitionSemantics);
        const load =
            reps === null
                ? null
                : kind === "external"
                  ? externalLoadKg(set)
                  : effectiveLoadKg(set, group.snapshot.loadModel);
        if (reps === null || load === null) {
            excluded.push({ setId: set.id, reason: reps === null ? "missing_reps" : `missing_${kind}_load` });
            continue;
        }
        total = addDecimal(total, load.multiply(reps));
        any = true;
        includedSetIds.push(set.id);
    }
    return {
        numeric: any ? total.toNumber() : null,
        unit: KG_UNIT,
        details: { loadModel: group.snapshot.loadModel, includedSetIds, excludedSets: excluded },
    };
}

/** Emit one result per (muscle, basis) at session scope, counting eligible sets in the given muscle role. */
function perMusclePerBasis(facts: StrengthSessionFacts, role: "primary" | "secondary", unit: string): MetricResult[] {
    const results: MetricResult[] = [];
    const scope: MetricScope = { type: "session", id: facts.sessionId };
    const period: MetricPeriod = { kind: "point", at: facts.localDate };
    for (const basis of METRIC_BASES) {
        const perMuscle = new Map<
            string,
            { count: number; setIds: string[]; exercises: Set<string>; version: number }
        >();
        for (const group of exerciseGroups(facts.occurrences, basis)) {
            for (const muscle of musclesInRole(group.snapshot, role)) {
                const entry = perMuscle.get(muscle) ?? {
                    count: 0,
                    setIds: [],
                    exercises: new Set<string>(),
                    version: group.exerciseVersion,
                };
                entry.count += group.eligibleSets.length;
                entry.setIds.push(...group.eligibleSets.map(set => set.id));
                entry.exercises.add(group.exerciseId);
                perMuscle.set(muscle, entry);
            }
        }
        for (const [muscle, entry] of perMuscle) {
            results.push({
                scope,
                period,
                dimensions: { muscle, role, basis },
                value: {
                    numeric: entry.count,
                    text: null,
                    unit,
                    details: { basis, role, includedSetIds: entry.setIds, exerciseIds: [...entry.exercises] },
                },
                inputs: sessionMuscleInputs(facts, [...entry.exercises], basis),
            });
        }
    }
    return results;
}

function musclesInRole(snapshot: ExerciseSnapshotV1, role: "primary" | "secondary"): string[] {
    return snapshot.muscles.filter(muscle => muscle.role === role).map(muscle => muscle.muscleGroupId);
}

// -------------------------------------------------------------------------------------------------
// Window-scope building blocks
// -------------------------------------------------------------------------------------------------

/** Build a window-scope calculator whose results derive from a `(facts, config) → results` fn. */
function strengthWindowCalculator(
    key: string,
    compute: (facts: StrengthWindowFacts, config: StrengthMetricConfig) => readonly MetricResult[],
): MetricCalculator<StrengthWindowFacts> {
    return {
        key,
        version: 1,
        dependencies: STRENGTH_DEPENDENCIES,
        calculate: context => compute(context.facts, resolveConfig(context.config)),
    };
}

interface WindowSet {
    readonly set: PerformedSetState;
    readonly snapshot: ExerciseSnapshotV1;
    readonly sessionId: string;
}

interface WindowGroupRefs {
    readonly exerciseVersion: number;
    readonly sessionIds: readonly string[];
}

/** Emit one result per (exercise, basis) across the window, aggregating a per-exercise set collection. */
function perWindowExercisePerBasis(
    facts: StrengthWindowFacts,
    reading: (sets: readonly WindowSet[], refs: WindowGroupRefs) => Reading,
): MetricResult[] {
    const results: MetricResult[] = [];
    for (const basis of METRIC_BASES) {
        const perExercise = new Map<string, { sets: WindowSet[]; sessions: Set<string>; version: number }>();
        for (const session of facts.sessions) {
            for (const occurrence of session.occurrences) {
                const snapshot = basis === "historical" ? occurrence.historical : occurrence.latest;
                const version =
                    basis === "historical" ? occurrence.historicalExerciseVersion : occurrence.latestExerciseVersion;
                if (snapshot === null || version === null) continue;
                const eligible = occurrence.performedSets.filter(isEligibleWorkingSet);
                if (eligible.length === 0) continue;
                const entry = perExercise.get(occurrence.exerciseId) ?? {
                    sets: [],
                    sessions: new Set<string>(),
                    version,
                };
                entry.sessions.add(session.sessionId);
                for (const set of eligible) entry.sets.push({ set, snapshot, sessionId: session.sessionId });
                perExercise.set(occurrence.exerciseId, entry);
            }
        }
        for (const [exerciseId, entry] of perExercise) {
            const sessionIds = [...entry.sessions];
            const read = reading(entry.sets, { exerciseVersion: entry.version, sessionIds });
            results.push({
                scope: facts.scope,
                period: facts.period,
                dimensions: { exercise: exerciseId, basis },
                value: {
                    numeric: read.numeric,
                    text: null,
                    unit: read.unit,
                    details: { basis, exerciseVersion: entry.version, ...read.details },
                },
                inputs: windowInputs(facts, sessionIds, [{ exerciseId, version: entry.version }]),
            });
        }
    }
    return results;
}

/** Per-(muscle, role, basis) direct/indirect set counts across the window, with the hard-set count. */
function windowMuscleSets(facts: StrengthWindowFacts, config: StrengthMetricConfig): MetricResult[] {
    const results: MetricResult[] = [];
    for (const basis of METRIC_BASES) {
        for (const role of ["primary", "secondary"] as const) {
            const perMuscle = new Map<
                string,
                { count: number; hard: number; setIds: string[]; sessions: Set<string>; exercises: Map<string, number> }
            >();
            for (const session of facts.sessions) {
                for (const occurrence of session.occurrences) {
                    const snapshot = basis === "historical" ? occurrence.historical : occurrence.latest;
                    const version =
                        basis === "historical"
                            ? occurrence.historicalExerciseVersion
                            : occurrence.latestExerciseVersion;
                    if (snapshot === null || version === null) continue;
                    const eligible = occurrence.performedSets.filter(isEligibleWorkingSet);
                    if (eligible.length === 0) continue;
                    for (const muscle of musclesInRole(snapshot, role)) {
                        const entry = perMuscle.get(muscle) ?? {
                            count: 0,
                            hard: 0,
                            setIds: [],
                            sessions: new Set<string>(),
                            exercises: new Map<string, number>(),
                        };
                        entry.count += eligible.length;
                        entry.hard += eligible.filter(set => isHardSet(set, config)).length;
                        entry.setIds.push(...eligible.map(set => set.id));
                        entry.sessions.add(session.sessionId);
                        entry.exercises.set(occurrence.exerciseId, version);
                        perMuscle.set(muscle, entry);
                    }
                }
            }
            for (const [muscle, entry] of perMuscle) {
                results.push({
                    scope: facts.scope,
                    period: facts.period,
                    dimensions: { muscle, role, basis },
                    value: {
                        numeric: entry.count,
                        text: null,
                        unit: SETS_UNIT,
                        details: {
                            basis,
                            role,
                            hardSets: entry.hard,
                            sessionCount: entry.sessions.size,
                            includedSetIds: entry.setIds,
                        },
                    },
                    inputs: windowInputs(
                        facts,
                        [...entry.sessions],
                        [...entry.exercises].map(([exerciseId, version]) => ({ exerciseId, version })),
                    ),
                });
            }
        }
    }
    return results;
}

/** Per-(muscle, basis) count of distinct window sessions that trained the muscle in any role. */
function windowFrequency(facts: StrengthWindowFacts): MetricResult[] {
    const results: MetricResult[] = [];
    for (const basis of METRIC_BASES) {
        const perMuscle = new Map<string, { sessions: Set<string>; exercises: Map<string, number> }>();
        for (const session of facts.sessions) {
            const musclesThisSession = new Set<string>();
            const exerciseVersions = new Map<string, number>();
            for (const occurrence of session.occurrences) {
                const snapshot = basis === "historical" ? occurrence.historical : occurrence.latest;
                const version =
                    basis === "historical" ? occurrence.historicalExerciseVersion : occurrence.latestExerciseVersion;
                if (snapshot === null || version === null) continue;
                if (occurrence.performedSets.filter(isEligibleWorkingSet).length === 0) continue;
                for (const muscle of snapshot.muscles) musclesThisSession.add(muscle.muscleGroupId);
                exerciseVersions.set(occurrence.exerciseId, version);
            }
            for (const muscle of musclesThisSession) {
                const entry = perMuscle.get(muscle) ?? {
                    sessions: new Set<string>(),
                    exercises: new Map<string, number>(),
                };
                entry.sessions.add(session.sessionId);
                for (const [exerciseId, version] of exerciseVersions) entry.exercises.set(exerciseId, version);
                perMuscle.set(muscle, entry);
            }
        }
        for (const [muscle, entry] of perMuscle) {
            results.push({
                scope: facts.scope,
                period: facts.period,
                dimensions: { muscle, basis },
                value: {
                    numeric: entry.sessions.size,
                    text: null,
                    unit: SESSIONS_UNIT,
                    details: { basis, sessionIds: [...entry.sessions] },
                },
                inputs: windowInputs(
                    facts,
                    [...entry.sessions],
                    [...entry.exercises].map(([exerciseId, version]) => ({ exerciseId, version })),
                ),
            });
        }
    }
    return results;
}

// -------------------------------------------------------------------------------------------------
// Input references (source session/set/exercise revisions — acceptance criterion 5 + invalidation)
// -------------------------------------------------------------------------------------------------

function sessionExerciseInputs(
    facts: StrengthSessionFacts,
    exerciseId: string,
    exerciseVersion: number,
): MetricInputRef[] {
    return [
        { entityType: STRENGTH_METRIC_SESSION_ENTITY, entityId: facts.sessionId, revision: facts.sessionVersion },
        { entityType: STRENGTH_METRIC_EXERCISE_ENTITY, entityId: exerciseId, revision: exerciseVersion },
    ];
}

function sessionMuscleInputs(
    facts: StrengthSessionFacts,
    exerciseIds: readonly string[],
    basis: MetricBasis,
): MetricInputRef[] {
    const refs: MetricInputRef[] = [
        { entityType: STRENGTH_METRIC_SESSION_ENTITY, entityId: facts.sessionId, revision: facts.sessionVersion },
    ];
    for (const exerciseId of exerciseIds) {
        const occurrence = facts.occurrences.find(item => item.exerciseId === exerciseId);
        const version =
            occurrence === undefined
                ? 0
                : basis === "historical"
                  ? occurrence.historicalExerciseVersion
                  : (occurrence.latestExerciseVersion ?? 0);
        refs.push({ entityType: STRENGTH_METRIC_EXERCISE_ENTITY, entityId: exerciseId, revision: version });
    }
    return refs;
}

function windowInputs(
    facts: StrengthWindowFacts,
    sessionIds: readonly string[],
    exercises: readonly { readonly exerciseId: string; readonly version: number }[],
): MetricInputRef[] {
    const refs: MetricInputRef[] = [];
    for (const sessionId of sessionIds) {
        const session = facts.sessions.find(item => item.sessionId === sessionId);
        refs.push({
            entityType: STRENGTH_METRIC_SESSION_ENTITY,
            entityId: sessionId,
            revision: session?.sessionVersion ?? 0,
        });
    }
    for (const exercise of exercises)
        refs.push({
            entityType: STRENGTH_METRIC_EXERCISE_ENTITY,
            entityId: exercise.exerciseId,
            revision: exercise.version,
        });
    return refs;
}

// -------------------------------------------------------------------------------------------------
// Pure numeric / config helpers
// -------------------------------------------------------------------------------------------------

/** Narrow the opaque framework `config` record to the strength thresholds, filling documented defaults. */
export function resolveConfig(config: Readonly<Record<string, unknown>>): StrengthMetricConfig {
    return {
        rpeThreshold: numberOr(config.rpeThreshold, STRENGTH_METRIC_DEFAULTS_V1.rpeThreshold),
        rirThreshold: numberOr(config.rirThreshold, STRENGTH_METRIC_DEFAULTS_V1.rirThreshold),
        calculatorVersion: numberOr(config.calculatorVersion, 1),
    };
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function totalTempoMs(set: PerformedSetState): number | null {
    const tempo = set.measurements.tempo;
    if (tempo === null) return null;
    const phases = [tempo.eccentric, tempo.bottomPause, tempo.concentric, tempo.topPause];
    let total = 0;
    let any = false;
    for (const phase of phases) {
        if (phase === null) continue;
        any = true;
        total += durationMs(phase.value, phase.unit);
    }
    return any ? total : null;
}

function durationMs(value: number, unit: "ms" | "s" | "min" | "h"): number {
    const factor = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "min" ? 60_000 : 3_600_000;
    return value * factor;
}

function zero(): DecimalValue {
    return Mass.from(0, "kg").canonical;
}

/** Exact decimal addition by aligning coefficients to a common scale — no floating-point drift. */
function addDecimal(left: DecimalValue, right: DecimalValue): DecimalValue {
    const scale = Math.max(left.scale, right.scale);
    const l = left.coefficient * 10n ** BigInt(scale - left.scale);
    const r = right.coefficient * 10n ** BigInt(scale - right.scale);
    const sum = l + r;
    if (scale === 0) return Mass.from(sum.toString(), "kg").canonical;
    const negative = sum < 0n;
    const digits = (negative ? -sum : sum).toString().padStart(scale + 1, "0");
    const text = `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    return Mass.fromCanonical(text).canonical;
}

// window/day/week scope + period helpers are exported for the projection use case (application layer).

/** The window scope/period kinds A2 projects, keyed to the invalidation scope types A1 already emits. */
export type StrengthWindowKind = "day" | "week" | "rolling-7" | "rolling-28";

export const STRENGTH_WINDOW_KINDS: readonly StrengthWindowKind[] = ["day", "week", "rolling-7", "rolling-28"];

/** The polymorphic scope for a profile window anchored at `anchorDate` (matches A1's session fan-out). */
export function strengthWindowScope(kind: StrengthWindowKind, profileId: string, anchorDate: string): MetricScope {
    switch (kind) {
        case "day":
            return { type: "profile-day", id: `${profileId}:${anchorDate}` };
        case "week":
            return { type: "profile-week", id: `${profileId}:${isoWeekStart(anchorDate)}` };
        case "rolling-7":
            return { type: "profile-rolling-7", id: `${profileId}:${anchorDate}` };
        case "rolling-28":
            return { type: "profile-rolling-28", id: `${profileId}:${anchorDate}` };
    }
}

/** The canonical period covered by a window anchored at `anchorDate`. */
export function strengthWindowPeriod(kind: StrengthWindowKind, anchorDate: string): MetricPeriod {
    switch (kind) {
        case "day":
            return { kind: "point", at: anchorDate };
        case "week": {
            const start = isoWeekStart(anchorDate);
            return { kind: "range", start, end: addDays(start, 6) };
        }
        case "rolling-7":
            return { kind: "rolling", days: 7, end: anchorDate };
        case "rolling-28":
            return { kind: "rolling", days: 28, end: anchorDate };
    }
}

/** Inclusive `[start, end]` local-date bounds of a window anchored at `anchorDate`. */
export function strengthWindowBounds(
    kind: StrengthWindowKind,
    anchorDate: string,
): { readonly start: string; readonly end: string } {
    switch (kind) {
        case "day":
            return { start: anchorDate, end: anchorDate };
        case "week": {
            const start = isoWeekStart(anchorDate);
            return { start, end: addDays(start, 6) };
        }
        case "rolling-7":
            return { start: addDays(anchorDate, -6), end: anchorDate };
        case "rolling-28":
            return { start: addDays(anchorDate, -27), end: anchorDate };
    }
}

/** Add `days` (may be negative) to a `YYYY-MM-DD` date in UTC, returning `YYYY-MM-DD`. */
export function addDays(localDate: string, days: number): string {
    const date = new Date(`${localDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
