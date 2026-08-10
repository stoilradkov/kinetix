import { describe, expect, it } from "vitest";

import {
    EMPTY_RUNNING_ACTIVITY,
    RUNNING_AVERAGE_HEART_RATE,
    RUNNING_AVERAGE_PACE,
    RUNNING_DISTANCE,
    RUNNING_DURATION,
    RUNNING_EDWARDS_HR_LOAD,
    RUNNING_SESSION_CALCULATORS,
    RUNNING_SESSION_RPE_LOAD,
    RUNNING_WINDOW_CALCULATORS,
    RUNNING_WINDOW_DISTANCE,
    RUNNING_WINDOW_EDWARDS_HR_LOAD,
    RUNNING_WINDOW_FREQUENCY,
    RUNNING_WINDOW_SESSION_RPE_LOAD,
    RUNNING_ZONE_TIME,
    edwardsLoad,
    sessionRpeLoad,
    type MetricCalculator,
    type MetricResult,
    type RunningActivityFacts,
    type RunningActivityState,
    type RunningSessionFacts,
    type RunningWindowFacts,
    type RunZoneTimeState,
} from "#src/modules/training/domain/index";

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;
const SESSION = id(500);
const PROFILE = id(600);
const ACT = id(1);

const config = { calculatorVersion: 1 };
const target = {
    scope: { type: "session", id: SESSION },
    period: { kind: "point" as const, at: "2026-08-01" },
    dimensions: {},
};

function calc(key: string): MetricCalculator {
    const found = [...RUNNING_SESSION_CALCULATORS, ...RUNNING_WINDOW_CALCULATORS].find(c => c.key === key);
    if (found === undefined) throw new Error(`no calculator ${key}`);
    return found;
}

function run(key: string, facts: RunningSessionFacts | RunningWindowFacts): readonly MetricResult[] {
    return calc(key).calculate({ target, facts, config });
}

function zoneTime(overrides: Partial<RunZoneTimeState>): RunZoneTimeState {
    return {
        id: id(900),
        position: 0,
        family: "heart_rate",
        zoneDefinitionId: id(800),
        zoneRangeId: id(810),
        zoneName: null,
        duration: { value: 10, unit: "min" },
        ...overrides,
    };
}

function activity(
    running: Partial<RunningActivityState>,
    opts: { activityRpe?: number | null; durationSeconds?: number | null; zoneNumbers?: Record<string, number> } = {},
): RunningActivityFacts {
    return {
        activityId: ACT,
        running: { ...EMPTY_RUNNING_ACTIVITY, ...running },
        activityRpe: opts.activityRpe ?? null,
        durationSeconds: opts.durationSeconds ?? null,
        zoneNumbers: opts.zoneNumbers ?? {},
    };
}

function sessionFacts(activities: RunningActivityFacts[]): RunningSessionFacts {
    return { sessionId: SESSION, profileId: PROFILE, sessionVersion: 2, localDate: "2026-08-01", activities };
}

// -------------------------------------------------------------------------------------------------

describe("running session calculators", () => {
    it("distance is the canonical metres of the recorded distance", () => {
        const results = run(RUNNING_DISTANCE, sessionFacts([activity({ distance: { value: 5, unit: "km" } })]));
        expect(results).toHaveLength(1);
        expect(results[0]!.value.numeric).toBe(5000);
        expect(results[0]!.value.unit).toBe("m");
        expect(results[0]!.dimensions).toEqual({ activity: ACT });
    });

    it("distance is not emitted when no distance was recorded", () => {
        expect(run(RUNNING_DISTANCE, sessionFacts([activity({})]))).toHaveLength(0);
    });

    it("duration prefers moving time and records both times in evidence", () => {
        const results = run(
            RUNNING_DURATION,
            sessionFacts([
                activity({ movingTime: { value: 30, unit: "min" }, elapsedTime: { value: 32, unit: "min" } }),
            ]),
        );
        expect(results[0]!.value.numeric).toBe(1_800_000);
        expect(results[0]!.value.details).toMatchObject({ source: "moving_time", elapsedTimeMs: 1_920_000 });
    });

    it("average pace derives seconds per kilometre and carries pace exclusions", () => {
        const results = run(
            RUNNING_AVERAGE_PACE,
            sessionFacts([activity({ distance: { value: 5, unit: "km" }, movingTime: { value: 25, unit: "min" } })]),
        );
        expect(results[0]!.value.numeric).toBe(300); // 1_500_000ms / 5000m
        expect(results[0]!.value.details).toMatchObject({ exclusions: [] });
    });

    it("average pace reports null with the missing input labelled", () => {
        const results = run(RUNNING_AVERAGE_PACE, sessionFacts([activity({ movingTime: { value: 25, unit: "min" } })]));
        expect(results[0]!.value.numeric).toBeNull();
        expect(results[0]!.value.details.exclusions).toContain("missing_distance");
    });

    it("average heart rate carries the maximum in evidence", () => {
        const results = run(
            RUNNING_AVERAGE_HEART_RATE,
            sessionFacts([activity({ averageHeartRate: 150, maxHeartRate: 175 })]),
        );
        expect(results[0]!.value.numeric).toBe(150);
        expect(results[0]!.value.details).toMatchObject({ maxHeartRate: 175 });
    });

    it("zone time emits one result per zone entry with the resolved zone number", () => {
        const zt = zoneTime({ id: id(901), position: 1 });
        const results = run(
            RUNNING_ZONE_TIME,
            sessionFacts([activity({ zoneTimes: [zt] }, { zoneNumbers: { [zt.id]: 3 } })]),
        );
        expect(results).toHaveLength(1);
        expect(results[0]!.value.numeric).toBe(600_000);
        expect(results[0]!.dimensions).toEqual({ activity: ACT, family: "heart_rate", zone: "3" });
    });
});

describe("session-RPE load (design §16.6)", () => {
    it("is duration minutes × RPE, preferring the run's own RPE and recorded duration", () => {
        const load = sessionRpeLoad(activity({ rpe: 8 }, { durationSeconds: 1800 }));
        expect(load.load).toBe(240); // 30 min × 8
        expect(load.durationSource).toBe("activity_duration");
    });

    it("falls back to the session-activity RPE and moving time", () => {
        const load = sessionRpeLoad(activity({ movingTime: { value: 40, unit: "min" } }, { activityRpe: 6 }));
        expect(load.load).toBe(240); // 40 × 6
        expect(load.durationSource).toBe("moving_time");
    });

    it("labels a missing RPE and yields no load", () => {
        const results = run(
            RUNNING_SESSION_RPE_LOAD,
            sessionFacts([activity({ movingTime: { value: 30, unit: "min" } })]),
        );
        expect(results[0]!.value.numeric).toBeNull();
        expect(results[0]!.value.details.exclusions).toContain("missing_rpe");
    });
});

describe("Edwards heart-rate load (design §16.6)", () => {
    it("sums zone minutes weighted by zone number", () => {
        const z2 = zoneTime({ id: id(902), position: 0, duration: { value: 10, unit: "min" } });
        const z3 = zoneTime({ id: id(903), position: 1, duration: { value: 20, unit: "min" } });
        const load = edwardsLoad(activity({ zoneTimes: [z2, z3] }, { zoneNumbers: { [z2.id]: 2, [z3.id]: 3 } }));
        expect(load.load).toBe(80); // 10×2 + 20×3
        expect(load.contributions).toHaveLength(2);
    });

    it("is not emitted at all when the run carries no heart-rate zone data", () => {
        const paceZone = zoneTime({ id: id(904), family: "pace" });
        expect(run(RUNNING_EDWARDS_HR_LOAD, sessionFacts([activity({ zoneTimes: [paceZone] })]))).toHaveLength(0);
    });

    it("reports null with unresolved zones excluded and labelled", () => {
        const z = zoneTime({ id: id(905) });
        const results = run(RUNNING_EDWARDS_HR_LOAD, sessionFacts([activity({ zoneTimes: [z] })])); // no zoneNumbers
        expect(results[0]!.value.numeric).toBeNull();
        expect(results[0]!.value.details.exclusions).toContain("unresolved_zone");
        expect(results[0]!.value.details.excludedZoneTimeIds).toEqual([z.id]);
    });
});

describe("running window calculators (rolling 7/28 keep their own identity, design §16.6 AC4)", () => {
    const windowFacts = (activities: RunningActivityFacts[]): RunningWindowFacts => ({
        profileId: PROFILE,
        scope: { type: "profile-rolling-7", id: `${PROFILE}:2026-08-01` },
        period: { kind: "rolling", days: 7, end: "2026-08-01" },
        sessions: [{ sessionId: SESSION, sessionVersion: 1, localDate: "2026-08-01", activities }],
    });

    it("sums distance across the window's runs", () => {
        const results = run(
            RUNNING_WINDOW_DISTANCE,
            windowFacts([
                activity({ distance: { value: 5, unit: "km" } }),
                activity({ distance: { value: 3, unit: "km" } }),
            ]),
        );
        expect(results[0]!.value.numeric).toBe(8000);
        expect(results[0]!.value.details).toMatchObject({ runCount: 2 });
    });

    it("counts run frequency", () => {
        const results = run(RUNNING_WINDOW_FREQUENCY, windowFacts([activity({}), activity({})]));
        expect(results[0]!.value.numeric).toBe(2);
        expect(results[0]!.value.unit).toBe("runs");
    });

    it("keeps the two rolling load models separately keyed", () => {
        const z = zoneTime({ id: id(906) });
        const runs = [activity({ rpe: 8, zoneTimes: [z] }, { durationSeconds: 1800, zoneNumbers: { [z.id]: 2 } })];
        const rpeLoad = run(RUNNING_WINDOW_SESSION_RPE_LOAD, windowFacts(runs));
        const edwards = run(RUNNING_WINDOW_EDWARDS_HR_LOAD, windowFacts(runs));
        expect(rpeLoad[0]!.value.numeric).toBe(240);
        expect(edwards[0]!.value.numeric).toBe(20); // 10 min × 2
        expect(rpeLoad[0]!.value.unit).toBe("au");
        expect(edwards[0]!.value.unit).toBe("au");
        // Distinct calculator keys ⇒ never collapsed into one universal load score.
        expect(RUNNING_WINDOW_SESSION_RPE_LOAD).not.toBe(RUNNING_WINDOW_EDWARDS_HR_LOAD);
    });
});
