import { describe, expect, it } from "vitest";

import { DomainValidationError } from "#src/platform/domain/index";
import {
    deriveAveragePace,
    normalizeRunningActivity,
    TrainingSession,
    type RunningActivityInput,
    type SessionActivityInput,
} from "#src/modules/training/domain/index";

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const now = new Date("2026-08-02T09:00:00.000Z");
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

function runningActivity(
    running: RunningActivityInput = {},
    overrides: Record<string, unknown> = {},
): SessionActivityInput {
    return { id: id(1), type: "running", position: 0, running, ...overrides } as SessionActivityInput;
}

function build(activity: SessionActivityInput): TrainingSession {
    return TrainingSession.create(
        { id: id(50), profileId: PROFILE, localDate: "2026-08-02", timeZone: "UTC", activities: [activity] },
        now,
    );
}

function firstRunning(session: TrainingSession) {
    const activity = session.state.activities[0];
    if (!activity || activity.running === null) throw new Error("expected a running activity");
    return activity.running;
}

describe("RunningActivity summary invariants", () => {
    it("accepts an empty (fully partial) summary and keeps every metric absent", () => {
        const running = firstRunning(build(runningActivity()));
        expect(running.distance).toBeNull();
        expect(running.movingTime).toBeNull();
        expect(running.averageHeartRate).toBeNull();
        expect(running.indoor).toBe(false);
        expect(running.treadmill).toBe(false);
        expect(running.runTags).toEqual([]);
        expect(running.environment).toBeNull();
    });

    it("accepts any valid subset of the summary metrics", () => {
        const running = firstRunning(
            build(
                runningActivity({
                    distance: { value: 10, unit: "km" },
                    movingTime: { value: 50, unit: "min" },
                    elapsedTime: { value: 52, unit: "min" },
                    averageHeartRate: 150,
                    maxHeartRate: 178,
                    averageCadence: 172,
                    averagePower: 240,
                    maxPower: 320,
                    elevationGain: { value: 120, unit: "m" },
                    elevationLoss: { value: 110, unit: "m" },
                    calories: 640,
                    strideLength: { value: 118, unit: "cm" },
                    groundContactTime: { value: 240, unit: "ms" },
                    verticalOscillation: { value: 8, unit: "cm" },
                    vo2Max: 52.4,
                    rpe: 7.5,
                    indoor: false,
                    treadmill: false,
                }),
            ),
        );
        expect(running.distance).toEqual({ value: 10, unit: "km" });
        expect(running.maxHeartRate).toBe(178);
        expect(running.vo2Max).toBe(52.4);
        expect(running.rpe).toBe(7.5);
    });

    it("keeps a recorded zero distinct from a missing value", () => {
        const running = firstRunning(build(runningActivity({ calories: 0, averageHeartRate: 0 })));
        expect(running.calories).toBe(0);
        expect(running.averageHeartRate).toBe(0);
        expect(running.maxHeartRate).toBeNull();
    });

    it("normalizes run-classification tags case-insensitively, keeping first-seen display", () => {
        const running = firstRunning(build(runningActivity({ runTags: ["Easy", "easy", " Long ", "TEMPO"] })));
        expect(running.runTags).toEqual(["Easy", "Long", "TEMPO"]);
    });

    it("supports indoor and treadmill state", () => {
        const running = firstRunning(build(runningActivity({ indoor: true, treadmill: true })));
        expect(running.indoor).toBe(true);
        expect(running.treadmill).toBe(true);
    });

    it("rejects a treadmill run that is not marked indoor", () => {
        expect(() => build(runningActivity({ treadmill: true, indoor: false }))).toThrow(DomainValidationError);
    });

    it("rejects moving time greater than elapsed time", () => {
        expect(() =>
            build(runningActivity({ movingTime: { value: 30, unit: "min" }, elapsedTime: { value: 25, unit: "min" } })),
        ).toThrow(/moving time cannot exceed elapsed time/i);
    });

    it("allows moving time equal to elapsed time", () => {
        const running = firstRunning(
            build(runningActivity({ movingTime: { value: 25, unit: "min" }, elapsedTime: { value: 25, unit: "min" } })),
        );
        expect(running.movingTime).toEqual({ value: 25, unit: "min" });
    });

    it("rejects a max heart rate below the average heart rate", () => {
        expect(() => build(runningActivity({ averageHeartRate: 160, maxHeartRate: 150 }))).toThrow(
            DomainValidationError,
        );
    });

    it.each([
        ["heart rate", { averageHeartRate: 1000 }],
        ["cadence", { averageCadence: -1 }],
    ])("rejects an out-of-range %s", (_label, patch) => {
        expect(() => build(runningActivity(patch as RunningActivityInput))).toThrow(DomainValidationError);
    });

    it("rejects an RPE outside 1–10 in 0.5 increments", () => {
        expect(() => build(runningActivity({ rpe: 7.3 }))).toThrow(/0.5 increments/i);
        expect(() => build(runningActivity({ rpe: 11 }))).toThrow(DomainValidationError);
    });

    it("rejects a negative measurement", () => {
        expect(() => build(runningActivity({ distance: { value: -1, unit: "km" } }))).toThrow(DomainValidationError);
    });

    it("normalizes an environment placeholder and drops an all-empty one", () => {
        const withEnv = firstRunning(build(runningActivity({ environment: { surface: "trail", terrain: "hilly" } })));
        expect(withEnv.environment).toEqual({
            schemaVersion: 1,
            surface: "trail",
            terrain: "hilly",
            weather: null,
            temperatureCelsius: null,
        });
        const withoutEnv = firstRunning(build(runningActivity({ environment: { surface: "  " } })));
        expect(withoutEnv.environment).toBeNull();
    });

    it("rejects a running summary on a non-running activity", () => {
        expect(() => build({ id: id(1), type: "strength", position: 0, running: {} } as SessionActivityInput)).toThrow(
            /only running activities/i,
        );
    });

    it("rejects a strength tree on a running activity", () => {
        expect(() =>
            build({
                id: id(1),
                type: "running",
                position: 0,
                running: {},
                strength: { occurrences: [{ id: id(2), exerciseId: id(3), position: 0 }] },
            } as unknown as SessionActivityInput),
        ).toThrow(/only strength activities/i);
    });
});

describe("Structured running: steps, repeats, splits, zone times, route, gear", () => {
    it("preserves a hierarchical warm-up/repeat/cool-down step tree with nested children", () => {
        const running = firstRunning(
            build(
                runningActivity({
                    steps: [
                        {
                            id: id(10),
                            type: "warm_up",
                            position: 0,
                            measurements: { duration: { value: 10, unit: "min" } },
                        },
                        { id: id(11), type: "repeat", position: 1, repeatCount: 4 },
                        {
                            id: id(12),
                            type: "work",
                            position: 0,
                            parentStepId: id(11),
                            measurements: { distance: { value: 400, unit: "m" } },
                        },
                        {
                            id: id(13),
                            type: "recovery",
                            position: 1,
                            parentStepId: id(11),
                            measurements: { duration: { value: 90, unit: "s" } },
                        },
                        { id: id(14), type: "cool_down", position: 2 },
                    ],
                }),
            ),
        );
        expect(running.steps).toHaveLength(5);
        const repeat = running.steps.find(step => step.id === id(11));
        expect(repeat?.repeatCount).toBe(4);
        const children = running.steps.filter(step => step.parentStepId === id(11)).map(step => step.type);
        expect(children).toEqual(["work", "recovery"]);
    });

    it("rejects a repeat step without a count and a non-repeat step with a count", () => {
        expect(() => build(runningActivity({ steps: [{ id: id(10), type: "repeat", position: 0 }] }))).toThrow(
            /repeat/i,
        );
        expect(() =>
            build(runningActivity({ steps: [{ id: id(10), type: "work", position: 0, repeatCount: 3 }] })),
        ).toThrow(/repeat/i);
    });

    it("rejects non-contiguous sibling positions within a parent scope", () => {
        expect(() =>
            build(
                runningActivity({
                    steps: [
                        { id: id(10), type: "warm_up", position: 0 },
                        { id: id(11), type: "work", position: 2 },
                    ],
                }),
            ),
        ).toThrow(/contiguous/i);
    });

    it("rejects a child under a non-repeat step and an unknown parent", () => {
        expect(() =>
            build(
                runningActivity({
                    steps: [
                        { id: id(10), type: "work", position: 0 },
                        { id: id(11), type: "recovery", position: 0, parentStepId: id(10) },
                    ],
                }),
            ),
        ).toThrow(/only a repeat/i);
        expect(() =>
            build(runningActivity({ steps: [{ id: id(11), type: "work", position: 0, parentStepId: id(99) }] })),
        ).toThrow(/unknown parent/i);
    });

    it("records arbitrary ordered splits and rejects moving greater than elapsed", () => {
        const running = firstRunning(
            build(
                runningActivity({
                    splits: [
                        {
                            id: id(20),
                            position: 0,
                            distance: { value: 1, unit: "km" },
                            movingTime: { value: 4, unit: "min" },
                            averageHeartRate: 150,
                        },
                        {
                            id: id(21),
                            position: 1,
                            distance: { value: 1, unit: "km" },
                            movingTime: { value: 4, unit: "min" },
                        },
                    ],
                }),
            ),
        );
        expect(running.splits).toHaveLength(2);
        expect(running.splits[0]?.averageHeartRate).toBe(150);
        expect(() =>
            build(
                runningActivity({
                    splits: [
                        {
                            id: id(20),
                            position: 0,
                            movingTime: { value: 5, unit: "min" },
                            elapsedTime: { value: 4, unit: "min" },
                        },
                    ],
                }),
            ),
        ).toThrow(/split moving time cannot exceed elapsed/i);
    });

    it("records zone times and rejects a non-positive duration", () => {
        const running = firstRunning(
            build(
                runningActivity({
                    zoneTimes: [
                        {
                            id: id(30),
                            position: 0,
                            family: "heart_rate",
                            zoneDefinitionId: id(31),
                            zoneRangeId: id(32),
                            duration: { value: 20, unit: "min" },
                        },
                    ],
                }),
            ),
        );
        expect(running.zoneTimes[0]?.family).toBe("heart_rate");
        expect(running.zoneTimes[0]?.zoneDefinitionId).toBe(id(31));
        expect(() =>
            build(
                runningActivity({
                    zoneTimes: [{ id: id(30), position: 0, family: "power", duration: { value: 0, unit: "s" } }],
                }),
            ),
        ).toThrow(/greater than zero/i);
    });

    it("validates a bounded route and rejects out-of-range coordinates", () => {
        const running = firstRunning(
            build(
                runningActivity({
                    route: {
                        ref: "strava:123",
                        geometry: {
                            type: "line_string",
                            coordinates: [
                                [13.4, 52.5],
                                [13.41, 52.51],
                            ],
                        },
                    },
                }),
            ),
        );
        expect(running.route?.ref).toBe("strava:123");
        expect(running.route?.geometry?.coordinates).toHaveLength(2);
        expect(() =>
            build(
                runningActivity({
                    route: {
                        geometry: {
                            type: "line_string",
                            coordinates: [
                                [200, 0],
                                [13.41, 52.51],
                            ],
                        },
                    },
                }),
            ),
        ).toThrow(/longitude/i);
        expect(() =>
            build(runningActivity({ route: { geometry: { type: "line_string", coordinates: [[13.4, 52.5]] } } })),
        ).toThrow(/between 2 and/i);
    });

    it("accepts a gear reference and rejects a malformed one", () => {
        const running = firstRunning(build(runningActivity({ gearItemId: id(40) })));
        expect(running.gearItemId).toBe(id(40));
        expect(() => build(runningActivity({ gearItemId: "not-a-uuid" }))).toThrow(/UUID/i);
    });

    it("rejects duplicate IDs across steps, splits, and zone times", () => {
        expect(() =>
            build(
                runningActivity({
                    steps: [{ id: id(50), type: "work", position: 0 }],
                    splits: [{ id: id(50), position: 0 }],
                }),
            ),
        ).toThrow(/duplicate running child/i);
    });
});

describe("deriveAveragePace", () => {
    it("derives canonical pace from distance and moving time", () => {
        const pace = deriveAveragePace(
            normalizeRunningActivity({ distance: { value: 5, unit: "km" }, movingTime: { value: 25, unit: "min" } }),
        );
        expect(pace.exclusions).toEqual([]);
        expect(pace.speedMetresPerSecond).toBe("3.333333333333");
        // 25 min over 5 km = 300 s/km = 5:00/km.
        expect(pace.secondsPerKilometre).toBe(300);
        // 300 s/km × 1.609344 km/mi ≈ 482.803 s/mi.
        expect(pace.secondsPerMile).toBeCloseTo(482.803, 2);
    });

    it("is unit-agnostic: miles and seconds derive the same canonical pace as km and minutes", () => {
        const metric = deriveAveragePace(
            normalizeRunningActivity({ distance: { value: 5, unit: "km" }, movingTime: { value: 1500, unit: "s" } }),
        );
        const imperial = deriveAveragePace(
            normalizeRunningActivity({
                distance: { value: 5000, unit: "m" },
                movingTime: { value: 25, unit: "min" },
            }),
        );
        expect(metric.secondsPerKilometre).toBe(imperial.secondsPerKilometre);
    });

    it("reports missing distance and moving time as exclusions with null projections", () => {
        expect(deriveAveragePace(normalizeRunningActivity({})).exclusions).toEqual([
            "missing_distance",
            "missing_moving_time",
        ]);
        const partial = deriveAveragePace(normalizeRunningActivity({ distance: { value: 5, unit: "km" } }));
        expect(partial.exclusions).toEqual(["missing_moving_time"]);
        expect(partial.secondsPerKilometre).toBeNull();
        expect(partial.speedMetresPerSecond).toBeNull();
    });

    it("reports a zero distance or zero moving time as an exclusion rather than dividing", () => {
        const zeroDistance = deriveAveragePace(
            normalizeRunningActivity({ distance: { value: 0, unit: "km" }, movingTime: { value: 25, unit: "min" } }),
        );
        expect(zeroDistance.exclusions).toEqual(["zero_distance"]);
        expect(zeroDistance.secondsPerKilometre).toBeNull();

        const zeroMoving = deriveAveragePace(
            normalizeRunningActivity({ distance: { value: 5, unit: "km" }, movingTime: { value: 0, unit: "s" } }),
        );
        expect(zeroMoving.exclusions).toEqual(["zero_moving_time"]);
    });
});
