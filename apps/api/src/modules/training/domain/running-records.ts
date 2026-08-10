/**
 * Running personal-record findings (issue #46, A4; design §16.6, §16.8; PRD AN-4/AN-5).
 *
 * A running record is a deterministic {@link ./metric-projection FindingValue}: the best comparable running
 * performance a profile has produced. Kinetix retains five running record types — fastest time at each
 * standard distance, best average pace, longest distance, longest duration, and highest power — each carrying
 * the exact source session/run revision, the value and unit, and (for standard-distance records) the matched
 * category. Records are compared only across *comparable* performances: a standard-distance record groups runs
 * that hit that exact distance category (within a versioned tolerance); best pace/power are explicitly their
 * own labelled scopes (design §16.6). Records are projections, not domain truth — a genuinely better record
 * supersedes the prior one and an unchanged best is a no-op on replay, with ties held by the earliest
 * achievement so a later, equal performance never displaces it. Everything here is pure and deterministic.
 */

import type { RecordFinding } from "#src/modules/training/domain/personal-records";
import type { MetricDimensions, MetricInputRef, MetricScope } from "#src/modules/training/domain/metric-projection";

// -------------------------------------------------------------------------------------------------
// Keys, versions, scope + unit constants
// -------------------------------------------------------------------------------------------------

export const RECORD_RUNNING_STANDARD_DISTANCE = "record.running_standard_distance";
export const RECORD_RUNNING_BEST_PACE = "record.running_best_pace";
export const RECORD_RUNNING_LONGEST_DISTANCE = "record.running_longest_distance";
export const RECORD_RUNNING_LONGEST_DURATION = "record.running_longest_duration";
export const RECORD_RUNNING_HIGHEST_POWER = "record.running_highest_power";

/** Every running-record finding key A4 owns, in stable order (used to scope retirement). */
export const RUNNING_RECORD_KEYS: readonly string[] = [
    RECORD_RUNNING_STANDARD_DISTANCE,
    RECORD_RUNNING_BEST_PACE,
    RECORD_RUNNING_LONGEST_DISTANCE,
    RECORD_RUNNING_LONGEST_DURATION,
    RECORD_RUNNING_HIGHEST_POWER,
];

export const RUNNING_RECORD_VERSION = 1;

/** The polymorphic finding scope type for a profile's running records (id = profile id). */
export const RECORD_SCOPE_RUNNING = "profile-running";

const METRES_UNIT = "m";
const MS_UNIT = "ms";
const SECONDS_PER_KM_UNIT = "s/km";
const WATTS_UNIT = "W";

/**
 * The comparable standard distances (design §16.6: "exact comparable distance categories"). A run counts for
 * a category when its recorded distance is within the configured tolerance of the standard; the categories are
 * far enough apart that a run matches at most one. Ordered shortest to longest for deterministic evidence.
 */
export const STANDARD_RUNNING_DISTANCES: readonly { readonly key: string; readonly metres: number }[] = [
    { key: "1km", metres: 1_000 },
    { key: "1mi", metres: 1_609.344 },
    { key: "5km", metres: 5_000 },
    { key: "10km", metres: 10_000 },
    { key: "half_marathon", metres: 21_097.5 },
    { key: "marathon", metres: 42_195 },
];

/** Default comparability tolerance for standard-distance matching (±2%); folds into the record fingerprint. */
export const RUNNING_RECORD_DEFAULT_TOLERANCE = 0.02;

// -------------------------------------------------------------------------------------------------
// Inputs — the pure facts an infrastructure reader assembles for the record computation
// -------------------------------------------------------------------------------------------------

/** One performed run from the profile's history with the canonical facts every running record scores. */
export interface RunRecordInput {
    readonly sessionId: string;
    readonly sessionVersion: number;
    readonly localDate: string;
    readonly activityId: string;
    readonly distanceMetres: number | null;
    readonly movingTimeMs: number | null;
    readonly elapsedTimeMs: number | null;
    readonly averagePowerW: number | null;
    readonly maxPowerW: number | null;
}

/** The versioned config a running-record computation runs against (the standard-distance tolerance). */
export interface RunningRecordsConfig {
    readonly standardToleranceFraction: number;
}

// -------------------------------------------------------------------------------------------------
// Record computation
// -------------------------------------------------------------------------------------------------

/**
 * Compute every running-record finding for a profile from its run history (design §16.6, §16.8). The best
 * comparable value wins, ties broken to the earliest achievement so the first performance holds the record
 * (recomputing over the full history is deterministic and never regresses). Returns one finding per whole-run
 * record type plus one standard-distance finding per matched category.
 */
export function computeRunningRecords(
    profileId: string,
    runs: readonly RunRecordInput[],
    config: RunningRecordsConfig,
): RecordFinding[] {
    const scope: MetricScope = { type: RECORD_SCOPE_RUNNING, id: profileId };
    const findings: RecordFinding[] = [];

    const longestDistance = bestBy(runs, run => positive(run.distanceMetres));
    if (longestDistance !== null)
        findings.push(
            record(
                scope,
                RECORD_RUNNING_LONGEST_DISTANCE,
                {},
                longestDistance.value,
                METRES_UNIT,
                longestDistance.run,
                {
                    distanceMetres: longestDistance.run.distanceMetres,
                },
            ),
        );

    const longestDuration = bestBy(runs, run => positive(durationOf(run)));
    if (longestDuration !== null)
        findings.push(
            record(scope, RECORD_RUNNING_LONGEST_DURATION, {}, longestDuration.value, MS_UNIT, longestDuration.run, {
                movingTimeMs: longestDuration.run.movingTimeMs,
                elapsedTimeMs: longestDuration.run.elapsedTimeMs,
            }),
        );

    const highestPower = bestBy(runs, run => positive(run.averagePowerW));
    if (highestPower !== null)
        findings.push(
            record(scope, RECORD_RUNNING_HIGHEST_POWER, {}, highestPower.value, WATTS_UNIT, highestPower.run, {
                averagePowerW: highestPower.run.averagePowerW,
                maxPowerW: highestPower.run.maxPowerW,
            }),
        );

    const bestPace = bestBy(
        runs,
        run => negate(paceSecondsPerKm(run)), // maximise the negated pace ⇒ minimise the pace (fastest)
    );
    if (bestPace !== null) {
        const pace = paceSecondsPerKm(bestPace.run)!;
        findings.push(
            record(scope, RECORD_RUNNING_BEST_PACE, {}, pace, SECONDS_PER_KM_UNIT, bestPace.run, {
                distanceMetres: bestPace.run.distanceMetres,
                movingTimeMs: bestPace.run.movingTimeMs,
                secondsPerKilometre: pace,
            }),
        );
    }

    findings.push(...standardDistanceRecords(scope, runs, config));
    return findings;
}

/** One fastest-time finding per standard distance category the profile has run (design §16.6). */
function standardDistanceRecords(
    scope: MetricScope,
    runs: readonly RunRecordInput[],
    config: RunningRecordsConfig,
): RecordFinding[] {
    const findings: RecordFinding[] = [];
    for (const standard of STANDARD_RUNNING_DISTANCES) {
        const matching = runs.filter(
            run =>
                run.distanceMetres !== null &&
                run.movingTimeMs !== null &&
                run.movingTimeMs > 0 &&
                withinTolerance(run.distanceMetres, standard.metres, config.standardToleranceFraction),
        );
        // Fastest = shortest moving time ⇒ maximise the negated time; ties held by the earliest achievement.
        const fastest = bestBy(matching, run => (run.movingTimeMs === null ? null : -run.movingTimeMs));
        if (fastest === null) continue;
        const movingTimeMs = fastest.run.movingTimeMs!;
        findings.push(
            record(
                scope,
                RECORD_RUNNING_STANDARD_DISTANCE,
                { distance: standard.key },
                movingTimeMs,
                MS_UNIT,
                fastest.run,
                {
                    standardDistance: standard.key,
                    standardMetres: standard.metres,
                    distanceMetres: fastest.run.distanceMetres,
                    movingTimeMs,
                    secondsPerKilometre: paceSecondsPerKm(fastest.run),
                },
            ),
        );
    }
    return findings;
}

// -------------------------------------------------------------------------------------------------
// Finding builder + scoring helpers
// -------------------------------------------------------------------------------------------------

/** Assemble a running-record finding: identity, dimensions, value, evidence, and the source session revision. */
function record(
    scope: MetricScope,
    findingKey: string,
    extraDimensions: MetricDimensions,
    numeric: number,
    unit: string,
    run: RunRecordInput,
    extraEvidence: Readonly<Record<string, unknown>>,
): RecordFinding {
    return {
        findingKey,
        version: RUNNING_RECORD_VERSION,
        scope,
        dimensions: { ...extraDimensions },
        numeric,
        unit,
        evidence: {
            sessionId: run.sessionId,
            activityId: run.activityId,
            achievedOn: run.localDate,
            ...extraEvidence,
        },
        inputs: [sessionInput(run)],
    };
}

/** The eligible run maximising `value(run)`, ties broken to the earliest achievement. */
function bestBy(
    runs: readonly RunRecordInput[],
    value: (run: RunRecordInput) => number | null,
): { readonly run: RunRecordInput; readonly value: number } | null {
    let best: { run: RunRecordInput; value: number } | null = null;
    for (const run of runs) {
        const scored = value(run);
        if (scored === null) continue;
        if (best === null || scored > best.value || (scored === best.value && earlier(run, best.run)))
            best = { run, value: scored };
    }
    return best;
}

/** Average pace in seconds per kilometre (moving time / distance), or null when either is missing/zero. */
function paceSecondsPerKm(run: RunRecordInput): number | null {
    if (run.distanceMetres === null || run.distanceMetres <= 0 || run.movingTimeMs === null || run.movingTimeMs <= 0)
        return null;
    // ms per metre is numerically seconds per kilometre; round to 3 dp to match deriveAveragePace.
    return Math.round((run.movingTimeMs / run.distanceMetres) * 1000) / 1000;
}

/** The record duration for a run: moving time preferred, elapsed time when moving time is absent. */
function durationOf(run: RunRecordInput): number | null {
    return run.movingTimeMs ?? run.elapsedTimeMs;
}

function withinTolerance(distance: number, standard: number, fraction: number): boolean {
    return Math.abs(distance - standard) <= standard * fraction;
}

function positive(value: number | null): number | null {
    return value !== null && value > 0 ? value : null;
}

function negate(value: number | null): number | null {
    return value === null ? null : -value;
}

function sessionInput(run: RunRecordInput): MetricInputRef {
    return { entityType: "session", entityId: run.sessionId, revision: run.sessionVersion };
}

/** Whether `left` was achieved before `right` — earlier local date, then session id, then activity id. */
function earlier(left: RunRecordInput, right: RunRecordInput): boolean {
    if (left.localDate !== right.localDate) return left.localDate < right.localDate;
    if (left.sessionId !== right.sessionId) return left.sessionId < right.sessionId;
    return left.activityId < right.activityId;
}
