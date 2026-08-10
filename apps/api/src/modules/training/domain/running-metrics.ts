/**
 * Running metric calculators (issue #46, A4; design §16.6; PRD AN-5).
 *
 * These are the running analogue of the A2 strength calculators (issue #44) registered against the A1
 * derived-metric framework (issue #43). They derive explainable running progress and load from a completed
 * session's manual running summaries and structured detail — distance, duration, average pace, heart-rate,
 * power, cadence, elevation, per-zone time — plus two deliberately *separate*, separately versioned load
 * models (session-RPE load and Edwards heart-rate-zone load), each per run and per rolling window. There is
 * no universal load score: every model keeps its own calculator key and unit (§16.6, acceptance criterion 4).
 *
 * Everything here is pure and deterministic: no repositories, no jobs, no persistence, no wire schemas. The
 * calculators reuse the aggregate's canonical measurement value objects and {@link deriveAveragePace} so
 * analytics never re-derive pace/distance semantics, and every result carries its missing inputs/exclusions
 * as evidence plus the source session/run/zone revisions that fed it (acceptance criterion 5). Running runs
 * are compared as performed — there is no exercise-definition snapshot, so there is no historical/latest basis.
 */

import { Distance, Duration } from "#src/modules/training/domain/measurement";
import type { DistanceValue, DurationValue } from "#src/modules/training/domain/session-strength";
import {
    deriveAveragePace,
    type RunningActivityState,
    type RunZoneTimeState,
} from "#src/modules/training/domain/session-running";
import {
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

/** Default versioned config when a profile omits it; the `V1` suffix pins it to the calculator version. */
export const RUNNING_METRIC_DEFAULTS_V1 = {
    calculatorVersion: 1,
} as const;

/** Source-entity types recorded as input references (they double as invalidation-scope keys). */
export const RUNNING_METRIC_SESSION_ENTITY = "session";
export const RUNNING_METRIC_ZONE_ENTITY = "zone";

const METRES_UNIT = "m";
const MS_UNIT = "ms";
const SECONDS_PER_KM_UNIT = "s/km";
const BPM_UNIT = "bpm";
const WATTS_UNIT = "W";
const RPM_UNIT = "rpm";
/** Arbitrary training-load units — session-RPE and Edwards loads are unitless indices, never interchanged. */
const LOAD_UNIT = "au";
const RUNS_UNIT = "runs";

/** How far a session's date reaches forward: a run influences rolling windows ending ≤ 27 days later. */
export const RUNNING_WINDOW_MAX_DAYS = 28;

// -------------------------------------------------------------------------------------------------
// Facts — the pure inputs an infrastructure context reader assembles for the calculators
// -------------------------------------------------------------------------------------------------

/**
 * One performed running activity's facts: the manual summary/structured state, the effective activity RPE,
 * the recorded activity duration, and — resolved by the application through the zone port — the 1-based
 * heart-rate zone number for each zone-time entry (used to weight Edwards load). A missing zone number means
 * the zone could not be resolved and that zone time is excluded from Edwards load with a labelled reason.
 */
export interface RunningActivityFacts {
    readonly activityId: string;
    readonly running: RunningActivityState;
    /** The session-activity RPE (0–10) used when the run summary itself omits an RPE. */
    readonly activityRpe: number | null;
    /** The recorded session-activity duration in seconds, used for session-RPE load when present. */
    readonly durationSeconds: number | null;
    /** Zone-time id → 1-based zone number, resolved from the effective zone definition's ranges. */
    readonly zoneNumbers: Readonly<Record<string, number>>;
}

/** Everything the session-scope running calculators score for one completed session. */
export interface RunningSessionFacts {
    readonly sessionId: string;
    readonly profileId: string;
    readonly sessionVersion: number;
    readonly localDate: string;
    readonly activities: readonly RunningActivityFacts[];
}

/** One session (with its running activities) contributing to a window aggregation. */
export interface RunningWindowSessionFacts {
    readonly sessionId: string;
    readonly sessionVersion: number;
    readonly localDate: string;
    readonly activities: readonly RunningActivityFacts[];
}

/** Everything the window-scope running calculators score for one profile window (scope + period resolved). */
export interface RunningWindowFacts {
    readonly profileId: string;
    readonly scope: MetricScope;
    readonly period: MetricPeriod;
    readonly sessions: readonly RunningWindowSessionFacts[];
}

/** Versioned config a running calculator runs against (a profile-level recalculation bump knob). */
export interface RunningMetricConfig {
    readonly calculatorVersion: number;
}

// -------------------------------------------------------------------------------------------------
// Calculator keys
// -------------------------------------------------------------------------------------------------

export const RUNNING_DISTANCE = "running.distance";
export const RUNNING_DURATION = "running.duration";
export const RUNNING_AVERAGE_PACE = "running.average_pace";
export const RUNNING_AVERAGE_HEART_RATE = "running.average_heart_rate";
export const RUNNING_AVERAGE_POWER = "running.average_power";
export const RUNNING_AVERAGE_CADENCE = "running.average_cadence";
export const RUNNING_ELEVATION_GAIN = "running.elevation_gain";
export const RUNNING_ZONE_TIME = "running.zone_time";
export const RUNNING_SESSION_RPE_LOAD = "running.session_rpe_load";
export const RUNNING_EDWARDS_HR_LOAD = "running.edwards_hr_load";

export const RUNNING_WINDOW_DISTANCE = "running.window.distance";
export const RUNNING_WINDOW_DURATION = "running.window.duration";
export const RUNNING_WINDOW_FREQUENCY = "running.window.frequency";
export const RUNNING_WINDOW_SESSION_RPE_LOAD = "running.window.session_rpe_load";
export const RUNNING_WINDOW_EDWARDS_HR_LOAD = "running.window.edwards_hr_load";

/** The dependency categories the running calculators invalidate on (design §16.3). */
const RUNNING_DEPENDENCIES: readonly MetricDependency[] = ["session", "zone", "context"];

// -------------------------------------------------------------------------------------------------
// Per-activity load models (design §16.6) — pure, separately keyed, never combined
// -------------------------------------------------------------------------------------------------

/** Why a load model could not be computed for a run, labelled on the (null-valued) result. */
export type LoadExclusionReason = "missing_rpe" | "missing_duration" | "no_heart_rate_zones" | "unresolved_zone";

/** The session-RPE load for one run: `activity duration minutes × activity/session RPE` (design §16.6). */
export interface SessionRpeLoad {
    readonly load: number | null;
    readonly rpe: number | null;
    readonly durationMinutes: number | null;
    readonly durationSource: "activity_duration" | "moving_time" | "elapsed_time" | null;
    readonly exclusions: readonly LoadExclusionReason[];
}

/**
 * Session-RPE load for one run (design §16.6). RPE is the run summary's own perceived effort, falling back
 * to the session-activity RPE; duration is the recorded activity duration, falling back to moving then
 * elapsed time. Returns a null load with the missing input labelled when either factor is absent.
 */
export function sessionRpeLoad(activity: RunningActivityFacts): SessionRpeLoad {
    const rpe = activity.running.rpe ?? activity.activityRpe;
    const duration = loadDurationMinutes(activity);
    const exclusions: LoadExclusionReason[] = [];
    if (rpe === null) exclusions.push("missing_rpe");
    if (duration === null) exclusions.push("missing_duration");
    const load = rpe === null || duration === null ? null : round2(duration.minutes * rpe);
    return {
        load,
        rpe,
        durationMinutes: duration === null ? null : round2(duration.minutes),
        durationSource: duration?.source ?? null,
        exclusions,
    };
}

/** One heart-rate zone's contribution to Edwards load: minutes in the zone weighted by its zone number. */
export interface EdwardsZoneContribution {
    readonly zoneTimeId: string;
    readonly position: number;
    readonly zoneNumber: number;
    readonly zoneName: string | null;
    readonly minutes: number;
    readonly weight: number;
    readonly contribution: number;
}

/** The Edwards heart-rate-zone load for one run plus the per-zone evidence and any excluded zone times. */
export interface EdwardsLoad {
    readonly load: number | null;
    readonly contributions: readonly EdwardsZoneContribution[];
    readonly excludedZoneTimeIds: readonly string[];
    readonly zoneDefinitionIds: readonly string[];
    readonly exclusions: readonly LoadExclusionReason[];
}

/**
 * Edwards heart-rate-zone load for one run (design §16.6): the sum over heart-rate zone times of the minutes
 * in the zone multiplied by its zone number (zone 1 = weight 1 … zone 5 = weight 5, generalised to N zones).
 * A zone time whose zone number could not be resolved is excluded and labelled; the load is null when the run
 * carries no heart-rate zone data at all, or none of it resolved to a weight.
 */
export function edwardsLoad(activity: RunningActivityFacts): EdwardsLoad {
    const heartRateZones = activity.running.zoneTimes.filter(zone => zone.family === "heart_rate");
    if (heartRateZones.length === 0)
        return {
            load: null,
            contributions: [],
            excludedZoneTimeIds: [],
            zoneDefinitionIds: [],
            exclusions: ["no_heart_rate_zones"],
        };

    const contributions: EdwardsZoneContribution[] = [];
    const excluded: string[] = [];
    const definitionIds = new Set<string>();
    let total = 0;
    for (const zone of heartRateZones) {
        if (zone.zoneDefinitionId !== null) definitionIds.add(zone.zoneDefinitionId);
        const weight = activity.zoneNumbers[zone.id];
        if (weight === undefined) {
            excluded.push(zone.id);
            continue;
        }
        const minutes = zoneMinutes(zone);
        const contribution = round2(minutes * weight);
        total = round2(total + contribution);
        contributions.push({
            zoneTimeId: zone.id,
            position: zone.position,
            zoneNumber: weight,
            zoneName: zone.zoneName,
            minutes: round2(minutes),
            weight,
            contribution,
        });
    }
    return {
        load: contributions.length === 0 ? null : total,
        contributions,
        excludedZoneTimeIds: excluded,
        zoneDefinitionIds: [...definitionIds],
        exclusions: contributions.length === 0 ? ["unresolved_zone"] : [],
    };
}

// -------------------------------------------------------------------------------------------------
// Session-scope calculators
// -------------------------------------------------------------------------------------------------

/** Total run distance in canonical metres (design §16.6). Emitted only when a distance was recorded. */
const distanceCalculator = runningSessionCalculator(RUNNING_DISTANCE, facts =>
    perActivity(facts, activity => {
        const metres = distanceMetres(activity.running.distance);
        if (metres === null) return null;
        return { numeric: metres, unit: METRES_UNIT, details: {} };
    }),
);

/** Run duration in milliseconds — moving time preferred, elapsed time when moving time is absent. */
const durationCalculator = runningSessionCalculator(RUNNING_DURATION, facts =>
    perActivity(facts, activity => {
        const moving = durationMs(activity.running.movingTime);
        const elapsed = durationMs(activity.running.elapsedTime);
        const numeric = moving ?? elapsed;
        if (numeric === null) return null;
        return {
            numeric,
            unit: MS_UNIT,
            details: {
                source: moving !== null ? "moving_time" : "elapsed_time",
                movingTimeMs: moving,
                elapsedTimeMs: elapsed,
            },
        };
    }),
);

/** Average pace in seconds per kilometre via {@link deriveAveragePace}; exclusions travel in the evidence. */
const paceCalculator = runningSessionCalculator(RUNNING_AVERAGE_PACE, facts =>
    perActivity(facts, activity => {
        if (activity.running.distance === null && activity.running.movingTime === null) return null;
        const pace = deriveAveragePace(activity.running);
        return {
            numeric: pace.secondsPerKilometre,
            unit: SECONDS_PER_KM_UNIT,
            details: {
                speedMetresPerSecond: pace.speedMetresPerSecond,
                secondsPerMile: pace.secondsPerMile,
                exclusions: pace.exclusions,
            },
        };
    }),
);

/** Average heart rate in beats per minute; maximum heart rate travels in the evidence. */
const heartRateCalculator = runningSessionCalculator(RUNNING_AVERAGE_HEART_RATE, facts =>
    perActivity(facts, activity => {
        if (activity.running.averageHeartRate === null) return null;
        return {
            numeric: activity.running.averageHeartRate,
            unit: BPM_UNIT,
            details: { maxHeartRate: activity.running.maxHeartRate },
        };
    }),
);

/** Average power in watts; maximum power travels in the evidence. */
const powerCalculator = runningSessionCalculator(RUNNING_AVERAGE_POWER, facts =>
    perActivity(facts, activity => {
        if (activity.running.averagePower === null) return null;
        return {
            numeric: activity.running.averagePower,
            unit: WATTS_UNIT,
            details: { maxPower: activity.running.maxPower },
        };
    }),
);

/** Average cadence in revolutions per minute; maximum cadence travels in the evidence. */
const cadenceCalculator = runningSessionCalculator(RUNNING_AVERAGE_CADENCE, facts =>
    perActivity(facts, activity => {
        if (activity.running.averageCadence === null) return null;
        return {
            numeric: activity.running.averageCadence,
            unit: RPM_UNIT,
            details: { maxCadence: activity.running.maxCadence },
        };
    }),
);

/** Elevation gain in canonical metres; elevation loss travels in the evidence. */
const elevationCalculator = runningSessionCalculator(RUNNING_ELEVATION_GAIN, facts =>
    perActivity(facts, activity => {
        const gain = distanceMetres(activity.running.elevationGain);
        if (gain === null) return null;
        return {
            numeric: gain,
            unit: METRES_UNIT,
            details: { elevationLossM: distanceMetres(activity.running.elevationLoss) },
        };
    }),
);

/**
 * Time spent in each recorded zone (heart-rate/pace/power), one result per zone-time entry — the honest
 * zone-time distribution the design keeps distinct rather than collapsing into a single intensity number.
 */
const zoneTimeCalculator: MetricCalculator<RunningSessionFacts> = {
    key: RUNNING_ZONE_TIME,
    version: 1,
    dependencies: RUNNING_DEPENDENCIES,
    calculate: context => {
        const facts = context.facts;
        const results: MetricResult[] = [];
        const scope: MetricScope = { type: "session", id: facts.sessionId };
        const period: MetricPeriod = { kind: "point", at: facts.localDate };
        for (const activity of facts.activities) {
            for (const zone of activity.running.zoneTimes) {
                const zoneNumber = activity.zoneNumbers[zone.id] ?? null;
                results.push({
                    scope,
                    period,
                    dimensions: {
                        activity: activity.activityId,
                        family: zone.family,
                        zone: zoneNumber !== null ? String(zoneNumber) : `pos-${zone.position}`,
                    },
                    value: {
                        numeric: durationMs(zone.duration),
                        text: null,
                        unit: MS_UNIT,
                        details: {
                            minutes: round2(zoneMinutes(zone)),
                            zoneNumber,
                            zoneName: zone.zoneName,
                            position: zone.position,
                            zoneDefinitionId: zone.zoneDefinitionId,
                        },
                    },
                    inputs: zoneInputs(facts, zone.zoneDefinitionId),
                });
            }
        }
        return results;
    },
};

/** Session-RPE load: run duration minutes × RPE (design §16.6). A separate, separately versioned model. */
const sessionRpeLoadCalculator = runningSessionCalculator(RUNNING_SESSION_RPE_LOAD, facts =>
    perActivity(facts, activity => {
        const load = sessionRpeLoad(activity);
        if (load.rpe === null && load.durationMinutes === null) return null; // not a load-bearing run at all
        return {
            numeric: load.load,
            unit: LOAD_UNIT,
            details: {
                rpe: load.rpe,
                durationMinutes: load.durationMinutes,
                durationSource: load.durationSource,
                exclusions: load.exclusions,
            },
        };
    }),
);

/** Edwards heart-rate-zone load: Σ zone minutes × zone weight (design §16.6). Separate from session-RPE. */
const edwardsLoadCalculator: MetricCalculator<RunningSessionFacts> = {
    key: RUNNING_EDWARDS_HR_LOAD,
    version: 1,
    dependencies: RUNNING_DEPENDENCIES,
    calculate: context => {
        const facts = context.facts;
        const results: MetricResult[] = [];
        const scope: MetricScope = { type: "session", id: facts.sessionId };
        const period: MetricPeriod = { kind: "point", at: facts.localDate };
        for (const activity of facts.activities) {
            const load = edwardsLoad(activity);
            if (load.exclusions.includes("no_heart_rate_zones")) continue; // no HR zone data — nothing to model
            results.push({
                scope,
                period,
                dimensions: { activity: activity.activityId },
                value: {
                    numeric: load.load,
                    text: null,
                    unit: LOAD_UNIT,
                    details: {
                        contributions: load.contributions,
                        excludedZoneTimeIds: load.excludedZoneTimeIds,
                        exclusions: load.exclusions,
                    },
                },
                inputs: edwardsInputs(facts, load.zoneDefinitionIds),
            });
        }
        return results;
    },
};

// -------------------------------------------------------------------------------------------------
// Window-scope calculators
// -------------------------------------------------------------------------------------------------

/** Total distance in metres across the window's runs. */
const windowDistanceCalculator = runningWindowCalculator(RUNNING_WINDOW_DISTANCE, facts =>
    windowSum(facts, activity => distanceMetres(activity.running.distance), METRES_UNIT),
);

/** Total moving (or elapsed) duration in milliseconds across the window's runs. */
const windowDurationCalculator = runningWindowCalculator(RUNNING_WINDOW_DURATION, facts =>
    windowSum(
        facts,
        activity => durationMs(activity.running.movingTime) ?? durationMs(activity.running.elapsedTime),
        MS_UNIT,
    ),
);

/** Run frequency: the number of running activities across the window (never a load score). */
const windowFrequencyCalculator = runningWindowCalculator(RUNNING_WINDOW_FREQUENCY, facts => {
    let runCount = 0;
    const sessionIds = new Set<string>();
    for (const session of facts.sessions) {
        if (session.activities.length === 0) continue;
        sessionIds.add(session.sessionId);
        runCount += session.activities.length;
    }
    if (runCount === 0) return [];
    return [windowResult(facts, runCount, RUNS_UNIT, { runCount, sessionCount: sessionIds.size }, [...sessionIds], [])];
});

/** Rolling session-RPE load: the sum of each run's session-RPE load — keeps its own identity (AC4). */
const windowSessionRpeLoadCalculator = runningWindowCalculator(RUNNING_WINDOW_SESSION_RPE_LOAD, facts =>
    windowLoad(facts, activity => sessionRpeLoad(activity).load, []),
);

/** Rolling Edwards heart-rate load: the sum of each run's Edwards load — separate from session-RPE (AC4). */
const windowEdwardsLoadCalculator = runningWindowCalculator(RUNNING_WINDOW_EDWARDS_HR_LOAD, facts =>
    windowLoad(facts, activity => edwardsLoad(activity).load, ["zone"]),
);

// -------------------------------------------------------------------------------------------------
// Registration bundles
// -------------------------------------------------------------------------------------------------

export const RUNNING_SESSION_CALCULATORS: readonly MetricCalculator[] = [
    distanceCalculator,
    durationCalculator,
    paceCalculator,
    heartRateCalculator,
    powerCalculator,
    cadenceCalculator,
    elevationCalculator,
    zoneTimeCalculator,
    sessionRpeLoadCalculator,
    edwardsLoadCalculator,
] as MetricCalculator[];

export const RUNNING_WINDOW_CALCULATORS: readonly MetricCalculator[] = [
    windowDistanceCalculator,
    windowDurationCalculator,
    windowFrequencyCalculator,
    windowSessionRpeLoadCalculator,
    windowEdwardsLoadCalculator,
] as MetricCalculator[];

/** Every running calculator registered by A4, in stable order (session metrics first, then windows). */
export const RUNNING_CALCULATORS: readonly MetricCalculator[] = [
    ...RUNNING_SESSION_CALCULATORS,
    ...RUNNING_WINDOW_CALCULATORS,
];

/** The calculator keys A4 owns — used to scope "retire the running metrics no longer produced". */
export const RUNNING_CALCULATOR_KEYS: readonly string[] = RUNNING_CALCULATORS.map(calculator => calculator.key);

// -------------------------------------------------------------------------------------------------
// Session-scope building blocks
// -------------------------------------------------------------------------------------------------

interface Reading {
    readonly numeric: number | null;
    readonly unit: string;
    readonly details: Readonly<Record<string, unknown>>;
}

/** Build a session-scope calculator whose per-activity results derive from a `(facts) → results` fn. */
function runningSessionCalculator(
    key: string,
    compute: (facts: RunningSessionFacts, config: RunningMetricConfig) => readonly MetricResult[],
): MetricCalculator<RunningSessionFacts> {
    return {
        key,
        version: 1,
        dependencies: RUNNING_DEPENDENCIES,
        calculate: context => compute(context.facts, resolveRunningConfig(context.config)),
    };
}

/** Emit one result per running activity for which `reading` produces a value (null skips the activity). */
function perActivity(
    facts: RunningSessionFacts,
    reading: (activity: RunningActivityFacts) => Reading | null,
): MetricResult[] {
    const results: MetricResult[] = [];
    const scope: MetricScope = { type: "session", id: facts.sessionId };
    const period: MetricPeriod = { kind: "point", at: facts.localDate };
    for (const activity of facts.activities) {
        const read = reading(activity);
        if (read === null) continue;
        results.push({
            scope,
            period,
            dimensions: { activity: activity.activityId },
            value: { numeric: read.numeric, text: null, unit: read.unit, details: read.details },
            inputs: sessionInputs(facts),
        });
    }
    return results;
}

// -------------------------------------------------------------------------------------------------
// Window-scope building blocks
// -------------------------------------------------------------------------------------------------

/** Build a window-scope calculator whose results derive from a `(facts) → results` fn. */
function runningWindowCalculator(
    key: string,
    compute: (facts: RunningWindowFacts, config: RunningMetricConfig) => readonly MetricResult[],
): MetricCalculator<RunningWindowFacts> {
    return {
        key,
        version: 1,
        dependencies: RUNNING_DEPENDENCIES,
        calculate: context => compute(context.facts, resolveRunningConfig(context.config)),
    };
}

/** Sum a per-activity metric across the window; emit one profile-window result (null when nothing summed). */
function windowSum(
    facts: RunningWindowFacts,
    value: (activity: RunningActivityFacts) => number | null,
    unit: string,
): MetricResult[] {
    let total = 0;
    let runCount = 0;
    const sessionIds = new Set<string>();
    for (const session of facts.sessions) {
        for (const activity of session.activities) {
            const scored = value(activity);
            if (scored === null) continue;
            total += scored;
            runCount += 1;
            sessionIds.add(session.sessionId);
        }
    }
    if (runCount === 0) return [];
    return [windowResult(facts, round2(total), unit, { runCount, sessionCount: sessionIds.size }, [...sessionIds], [])];
}

/** Sum a per-activity load across the window; emit one profile-window load result (never combined models). */
function windowLoad(
    facts: RunningWindowFacts,
    load: (activity: RunningActivityFacts) => number | null,
    extraDependencies: readonly MetricDependency[],
): MetricResult[] {
    let total = 0;
    let runCount = 0;
    const sessionIds = new Set<string>();
    const zoneDefinitionIds = new Set<string>();
    for (const session of facts.sessions) {
        for (const activity of session.activities) {
            if (extraDependencies.includes("zone"))
                for (const zone of activity.running.zoneTimes)
                    if (zone.family === "heart_rate" && zone.zoneDefinitionId !== null)
                        zoneDefinitionIds.add(zone.zoneDefinitionId);
            const scored = load(activity);
            if (scored === null) continue;
            total += scored;
            runCount += 1;
            sessionIds.add(session.sessionId);
        }
    }
    if (runCount === 0) return [];
    return [
        windowResult(
            facts,
            round2(total),
            LOAD_UNIT,
            { runCount, sessionCount: sessionIds.size },
            [...sessionIds],
            [...zoneDefinitionIds],
        ),
    ];
}

/** Assemble one profile-window result with the sessions (and any zone definitions) it aggregated as inputs. */
function windowResult(
    facts: RunningWindowFacts,
    numeric: number,
    unit: string,
    details: Readonly<Record<string, unknown>>,
    sessionIds: readonly string[],
    zoneDefinitionIds: readonly string[],
): MetricResult {
    const inputs: MetricInputRef[] = [];
    for (const sessionId of sessionIds) {
        const session = facts.sessions.find(item => item.sessionId === sessionId);
        inputs.push({
            entityType: RUNNING_METRIC_SESSION_ENTITY,
            entityId: sessionId,
            revision: session?.sessionVersion ?? 0,
        });
    }
    for (const zoneDefinitionId of zoneDefinitionIds)
        inputs.push({ entityType: RUNNING_METRIC_ZONE_ENTITY, entityId: zoneDefinitionId, revision: 0 });
    return {
        scope: facts.scope,
        period: facts.period,
        dimensions: {},
        value: { numeric, text: null, unit, details },
        inputs,
    };
}

// -------------------------------------------------------------------------------------------------
// Input references (source session/run/zone revisions — acceptance criterion 5 + invalidation)
// -------------------------------------------------------------------------------------------------

function sessionInputs(facts: RunningSessionFacts): MetricInputRef[] {
    return [{ entityType: RUNNING_METRIC_SESSION_ENTITY, entityId: facts.sessionId, revision: facts.sessionVersion }];
}

function zoneInputs(facts: RunningSessionFacts, zoneDefinitionId: string | null): MetricInputRef[] {
    const inputs = sessionInputs(facts);
    if (zoneDefinitionId !== null)
        inputs.push({ entityType: RUNNING_METRIC_ZONE_ENTITY, entityId: zoneDefinitionId, revision: 0 });
    return inputs;
}

function edwardsInputs(facts: RunningSessionFacts, zoneDefinitionIds: readonly string[]): MetricInputRef[] {
    const inputs = sessionInputs(facts);
    for (const zoneDefinitionId of zoneDefinitionIds)
        inputs.push({ entityType: RUNNING_METRIC_ZONE_ENTITY, entityId: zoneDefinitionId, revision: 0 });
    return inputs;
}

// -------------------------------------------------------------------------------------------------
// Pure numeric / config helpers
// -------------------------------------------------------------------------------------------------

/** Narrow the opaque framework `config` record to the running config, filling documented defaults. */
export function resolveRunningConfig(config: Readonly<Record<string, unknown>>): RunningMetricConfig {
    return { calculatorVersion: numberOr(config.calculatorVersion, RUNNING_METRIC_DEFAULTS_V1.calculatorVersion) };
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Canonical metres from a distance value, or null when absent. */
export function distanceMetres(value: DistanceValue | null): number | null {
    return value === null ? null : Distance.from(value.value, value.unit).canonical.toNumber();
}

/** Canonical milliseconds from a duration value, or null when absent. */
export function durationMs(value: DurationValue | null): number | null {
    return value === null ? null : Number(Duration.from(value.value, value.unit).milliseconds);
}

/** Minutes spent in a zone time from its canonical duration. */
function zoneMinutes(zone: RunZoneTimeState): number {
    return Number(Duration.from(zone.duration.value, zone.duration.unit).milliseconds) / 60_000;
}

/** The load-bearing duration for session-RPE load: activity duration, then moving, then elapsed time. */
function loadDurationMinutes(
    activity: RunningActivityFacts,
): { readonly minutes: number; readonly source: "activity_duration" | "moving_time" | "elapsed_time" } | null {
    if (activity.durationSeconds !== null)
        return { minutes: activity.durationSeconds / 60, source: "activity_duration" };
    const moving = durationMs(activity.running.movingTime);
    if (moving !== null) return { minutes: moving / 60_000, source: "moving_time" };
    const elapsed = durationMs(activity.running.elapsedTime);
    if (elapsed !== null) return { minutes: elapsed / 60_000, source: "elapsed_time" };
    return null;
}

/** Round to two decimal places, avoiding negative-zero and floating drift on load/aggregate sums. */
function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
