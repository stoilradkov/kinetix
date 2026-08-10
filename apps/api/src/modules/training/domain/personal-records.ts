/**
 * Personal-record findings (issue #45, A3; design §16.8; PRD AN-4).
 *
 * A personal record is a deterministic {@link ../metric-projection FindingValue}: the best comparable
 * performance a profile has produced for an exercise (or an explicit analytics family). Kinetix retains four
 * strength record types — maximum load, estimated 1RM, repetition maximum at a given load, and single-session
 * exercise volume — each carrying the exact source set/session revision, the value and unit, and (for family
 * records) the labelled member exercises. Records are projections, not domain truth: a genuinely improved
 * record supersedes the prior one and an unchanged best is a no-op on replay (design §5.10). Everything here
 * is pure and deterministic; eligibility and record semantics live here rather than in infrastructure so a
 * record never encodes formula logic outside the domain.
 */

import type { ExerciseLoadModel, RepetitionSemantics } from "#src/modules/training/domain/catalog";
import { effectiveLoadKg, workReps, type PerformedSetState } from "#src/modules/training/domain/session-strength";
import { isEligibleWorkingSet } from "#src/modules/training/domain/session-strength-metrics";
import { is1RMEligibleReps, oneRmEstimate, roundKg } from "#src/modules/training/domain/estimated-1rm";
import type { MetricDimensions, MetricInputRef, MetricScope } from "#src/modules/training/domain/metric-projection";

// -------------------------------------------------------------------------------------------------
// Keys, versions, scope + unit constants
// -------------------------------------------------------------------------------------------------

export const RECORD_MAX_LOAD = "record.max_load";
export const RECORD_ESTIMATED_1RM = "record.estimated_1rm";
export const RECORD_REP_MAX_AT_LOAD = "record.rep_max_at_load";
export const RECORD_EXERCISE_VOLUME = "record.exercise_volume";

/** Every personal-record finding key A3 owns, in stable order (used to scope retirement). */
export const PERSONAL_RECORD_KEYS: readonly string[] = [
    RECORD_MAX_LOAD,
    RECORD_ESTIMATED_1RM,
    RECORD_REP_MAX_AT_LOAD,
    RECORD_EXERCISE_VOLUME,
];

export const PERSONAL_RECORD_VERSION = 1;

/** The polymorphic finding scope types — a single exercise, or an explicit analytics family (PRD AN-2). */
export const RECORD_SCOPE_EXERCISE = "profile-exercise";
export const RECORD_SCOPE_FAMILY = "profile-exercise-family";

const KG_UNIT = "kg";
const REPS_UNIT = "reps";

/** Records reflect the as-performed (frozen) exercise definition; the basis dimension pins that (design §16.4). */
const HISTORICAL_BASIS = "historical";

// -------------------------------------------------------------------------------------------------
// Inputs — the pure facts an infrastructure reader assembles for the record computation
// -------------------------------------------------------------------------------------------------

/** One performed set from the profile's history, with the frozen model needed to score it (as-performed). */
export interface RecordSetInput {
    readonly sessionId: string;
    readonly sessionVersion: number;
    readonly localDate: string;
    readonly exerciseId: string;
    readonly exerciseVersion: number;
    readonly loadModel: ExerciseLoadModel;
    readonly repetitionSemantics: RepetitionSemantics;
    readonly set: PerformedSetState;
}

/** The record scope a computation is asked about — one exercise, or a labelled analytics family. */
export interface PersonalRecordsScope {
    readonly aggregation: "exercise" | "family";
    readonly scopeType: string;
    readonly profileId: string;
    /** Stable representative id (the exercise id, or the family's minimum member id) that names the scope. */
    readonly representativeId: string;
    /** The exercise ids the scope aggregates (one for an exercise scope; all members for a family). */
    readonly memberExerciseIds: readonly string[];
}

/** The versioned config a record computation runs against (the 1RM eligibility window). */
export interface PersonalRecordsConfig {
    readonly repMin: number;
    readonly repCutoff: number;
}

// -------------------------------------------------------------------------------------------------
// Output — a record finding ready for the application to persist supersede-and-insert
// -------------------------------------------------------------------------------------------------

/**
 * One computed personal-record finding. The application stamps the natural key, source fingerprint, status,
 * and calculation time when it persists it; this value carries the identity, comparison value, evidence, and
 * source revisions.
 */
export interface RecordFinding {
    readonly findingKey: string;
    readonly version: number;
    readonly scope: MetricScope;
    readonly dimensions: MetricDimensions;
    readonly numeric: number;
    readonly unit: string;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly inputs: readonly MetricInputRef[];
}

// -------------------------------------------------------------------------------------------------
// Scope helpers
// -------------------------------------------------------------------------------------------------

/** The polymorphic finding scope for a record scope (`profileId:representativeId`). */
export function personalRecordScope(scope: PersonalRecordsScope): MetricScope {
    return { type: scope.scopeType, id: `${scope.profileId}:${scope.representativeId}` };
}

/** The stable representative id for an analytics family — the lexicographically smallest member id. */
export function familyRepresentative(memberExerciseIds: readonly string[]): string {
    return [...memberExerciseIds].sort()[0] ?? "";
}

// -------------------------------------------------------------------------------------------------
// Record computation
// -------------------------------------------------------------------------------------------------

/** A scored candidate set: its resolved load/reps plus the coordinates needed for evidence and inputs. */
interface Candidate {
    readonly input: RecordSetInput;
    readonly loadKg: number | null;
    readonly reps: number | null;
    readonly workReps: number | null;
}

/**
 * Compute every personal-record finding for a record scope from the profile's eligible history (design
 * §16.8). Eligible sets are completed/partial, non-warm-up, with the required measurements; the best
 * comparable value wins, ties broken by the earliest achievement so the first performance holds the record
 * ("no regression" — a later, lesser set never displaces it, and recomputing over the full history is
 * deterministic). Returns one finding per record type, plus one repetition-maximum finding per distinct load.
 */
export function computePersonalRecords(
    scope: PersonalRecordsScope,
    sets: readonly RecordSetInput[],
    config: PersonalRecordsConfig,
): RecordFinding[] {
    const candidates = sets.filter(input => isEligibleWorkingSet(input.set)).map(scoreCandidate);
    const findings: RecordFinding[] = [];

    const maxLoad = bestBy(candidates, candidate =>
        candidate.loadKg !== null && candidate.loadKg > 0 ? candidate.loadKg : null,
    );
    if (maxLoad !== null) findings.push(loadRecord(scope, RECORD_MAX_LOAD, maxLoad.value, maxLoad.candidate, {}));

    const bestEstimate = bestEstimatedOneRm(candidates, config);
    if (bestEstimate !== null)
        findings.push(
            loadRecord(scope, RECORD_ESTIMATED_1RM, bestEstimate.value, bestEstimate.candidate, {
                reps: bestEstimate.candidate.reps,
                loadKg: bestEstimate.candidate.loadKg,
                formulas: bestEstimate.formulas,
                repMin: config.repMin,
                repCutoff: config.repCutoff,
            }),
        );

    findings.push(...repMaxAtLoadRecords(scope, candidates));
    const volume = bestExerciseVolume(scope, candidates);
    if (volume !== null) findings.push(volume);

    return findings;
}

/** Resolve a set's effective load and repetitions once so every record scores from the same numbers. */
function scoreCandidate(input: RecordSetInput): Candidate {
    const load = effectiveLoadKg(input.set, input.loadModel);
    return {
        input,
        loadKg: load === null ? null : roundKg(load.toNumber()),
        reps: input.set.measurements.reps,
        workReps: workReps(input.set, input.repetitionSemantics),
    };
}

/** The eligible candidate maximising `value(candidate)`, ties broken to the earliest achievement. */
function bestBy(
    candidates: readonly Candidate[],
    value: (candidate: Candidate) => number | null,
): { readonly candidate: Candidate; readonly value: number } | null {
    let best: { candidate: Candidate; value: number } | null = null;
    for (const candidate of candidates) {
        const scored = value(candidate);
        if (scored === null) continue;
        if (
            best === null ||
            scored > best.value ||
            (scored === best.value && earlier(candidate.input, best.candidate.input))
        )
            best = { candidate, value: scored };
    }
    return best;
}

/** The estimated-1RM record: the highest primary median estimate over the 1RM-eligible sets. */
function bestEstimatedOneRm(
    candidates: readonly Candidate[],
    config: PersonalRecordsConfig,
): {
    readonly candidate: Candidate;
    readonly value: number;
    readonly formulas: Readonly<Record<string, number>>;
} | null {
    let best: { candidate: Candidate; value: number; formulas: Readonly<Record<string, number>> } | null = null;
    for (const candidate of candidates) {
        if (candidate.loadKg === null || candidate.loadKg <= 0 || candidate.reps === null) continue;
        if (!is1RMEligibleReps(candidate.reps, config.repMin, config.repCutoff)) continue;
        const estimate = oneRmEstimate(candidate.loadKg, candidate.reps);
        if (estimate.primary === null) continue;
        if (
            best === null ||
            estimate.primary > best.value ||
            (estimate.primary === best.value && earlier(candidate.input, best.candidate.input))
        )
            best = { candidate, value: estimate.primary, formulas: estimate.formulas };
    }
    return best;
}

/** One repetition-maximum finding per distinct load: the most reps ever performed at that load. */
function repMaxAtLoadRecords(scope: PersonalRecordsScope, candidates: readonly Candidate[]): RecordFinding[] {
    const perLoad = new Map<string, { candidate: Candidate; reps: number }>();
    for (const candidate of candidates) {
        if (candidate.loadKg === null || candidate.loadKg <= 0 || candidate.reps === null) continue;
        const bucket = candidate.loadKg.toFixed(2);
        const current = perLoad.get(bucket);
        if (
            current === undefined ||
            candidate.reps > current.reps ||
            (candidate.reps === current.reps && earlier(candidate.input, current.candidate.input))
        )
            perLoad.set(bucket, { candidate, reps: candidate.reps });
    }
    const findings: RecordFinding[] = [];
    for (const [bucket, entry] of perLoad) {
        findings.push(
            finding(scope, RECORD_REP_MAX_AT_LOAD, { load: bucket }, entry.reps, REPS_UNIT, entry.candidate, {
                loadKg: entry.candidate.loadKg,
            }),
        );
    }
    return findings;
}

/** The single-session exercise-volume record: the highest Σ workReps × effective load in one session. */
function bestExerciseVolume(scope: PersonalRecordsScope, candidates: readonly Candidate[]): RecordFinding | null {
    const perSession = new Map<
        string,
        { volume: number; input: RecordSetInput; setIds: string[]; exercises: Map<string, number> }
    >();
    for (const candidate of candidates) {
        if (candidate.loadKg === null || candidate.loadKg <= 0 || candidate.workReps === null) continue;
        const key = candidate.input.sessionId;
        const entry = perSession.get(key) ?? {
            volume: 0,
            input: candidate.input,
            setIds: [],
            exercises: new Map<string, number>(),
        };
        entry.volume = roundKg(entry.volume + candidate.loadKg * candidate.workReps);
        entry.setIds.push(candidate.input.set.id);
        entry.exercises.set(candidate.input.exerciseId, candidate.input.exerciseVersion);
        perSession.set(key, entry);
    }

    let best: { volume: number; input: RecordSetInput; setIds: string[]; exercises: Map<string, number> } | null = null;
    for (const entry of perSession.values()) {
        if (
            best === null ||
            entry.volume > best.volume ||
            (entry.volume === best.volume && earlier(entry.input, best.input))
        )
            best = entry;
    }
    if (best === null) return null;

    const inputs: MetricInputRef[] = [sessionInput(best.input)];
    for (const [exerciseId, version] of best.exercises)
        inputs.push({ entityType: "exercise", entityId: exerciseId, revision: version });
    return {
        findingKey: RECORD_EXERCISE_VOLUME,
        version: PERSONAL_RECORD_VERSION,
        scope: personalRecordScope(scope),
        dimensions: baseDimensions(scope),
        numeric: best.volume,
        unit: KG_UNIT,
        evidence: {
            ...aggregationEvidence(scope),
            sessionId: best.input.sessionId,
            achievedOn: best.input.localDate,
            setCount: best.setIds.length,
            includedSetIds: best.setIds,
        },
        inputs,
    };
}

// -------------------------------------------------------------------------------------------------
// Finding builders
// -------------------------------------------------------------------------------------------------

/** A load-valued record (max load / estimated 1RM) held by a single set, with optional extra evidence. */
function loadRecord(
    scope: PersonalRecordsScope,
    findingKey: string,
    value: number,
    candidate: Candidate,
    extraEvidence: Readonly<Record<string, unknown>>,
): RecordFinding {
    return finding(scope, findingKey, {}, value, KG_UNIT, candidate, extraEvidence);
}

/** Assemble a single-set record finding: identity, dimensions, value, evidence, and source revisions. */
function finding(
    scope: PersonalRecordsScope,
    findingKey: string,
    extraDimensions: MetricDimensions,
    numeric: number,
    unit: string,
    candidate: Candidate,
    extraEvidence: Readonly<Record<string, unknown>>,
): RecordFinding {
    return {
        findingKey,
        version: PERSONAL_RECORD_VERSION,
        scope: personalRecordScope(scope),
        dimensions: { ...baseDimensions(scope), ...extraDimensions },
        numeric,
        unit,
        evidence: {
            ...aggregationEvidence(scope),
            exerciseId: candidate.input.exerciseId,
            sessionId: candidate.input.sessionId,
            setId: candidate.input.set.id,
            occurrenceReps: candidate.reps,
            achievedOn: candidate.input.localDate,
            ...extraEvidence,
        },
        inputs: [
            sessionInput(candidate.input),
            { entityType: "exercise", entityId: candidate.input.exerciseId, revision: candidate.input.exerciseVersion },
        ],
    };
}

/** The dimensions every record in a scope shares — the historical basis and the aggregation kind. */
function baseDimensions(scope: PersonalRecordsScope): MetricDimensions {
    return { basis: HISTORICAL_BASIS, aggregation: scope.aggregation };
}

/** Evidence that labels how a record was aggregated (PRD AN-2: family aggregation must be explicit/labelled). */
function aggregationEvidence(scope: PersonalRecordsScope): Readonly<Record<string, unknown>> {
    return scope.aggregation === "family"
        ? { aggregation: "family", familyExerciseIds: [...scope.memberExerciseIds].sort() }
        : { aggregation: "exercise" };
}

function sessionInput(input: RecordSetInput): MetricInputRef {
    return { entityType: "session", entityId: input.sessionId, revision: input.sessionVersion };
}

/** Whether `left` was achieved before `right` — earlier local date, then session id, then set id. */
function earlier(left: RecordSetInput, right: RecordSetInput): boolean {
    if (left.localDate !== right.localDate) return left.localDate < right.localDate;
    if (left.sessionId !== right.sessionId) return left.sessionId < right.sessionId;
    return left.set.id < right.set.id;
}
