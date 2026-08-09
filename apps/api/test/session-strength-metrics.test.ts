import { describe, expect, it } from "vitest";

import {
    STRENGTH_CALCULATORS,
    STRENGTH_DIRECT_MUSCLE_SETS,
    STRENGTH_EFFECTIVE_VOLUME,
    STRENGTH_EXTERNAL_VOLUME,
    STRENGTH_FREQUENCY,
    STRENGTH_HARD_SETS,
    STRENGTH_INDIRECT_MUSCLE_SETS,
    STRENGTH_TIME_UNDER_TENSION,
    STRENGTH_WINDOW_EXERCISE_VOLUME,
    STRENGTH_WINDOW_FREQUENCY,
    STRENGTH_WINDOW_MUSCLE_SETS,
    STRENGTH_WORK_REPS,
    strengthWindowPeriod,
    strengthWindowScope,
    type ExerciseLoadModel,
    type ExerciseMuscleAssignment,
    type ExerciseSnapshotV1,
    type MetricCalculator,
    type MetricResult,
    type PerformedSetMeasurements,
    type PerformedSetState,
    type PerformedSetStatus,
    type PerformedSetType,
    type RepetitionSemantics,
    type StrengthOccurrenceFacts,
    type StrengthSessionFacts,
    type StrengthWindowFacts,
    type StrengthWindowSessionFacts,
} from "#src/modules/training/domain/index";

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

const EX_A = id(1);
const CHEST = id(10);
const TRICEPS = id(11);
const SHOULDERS = id(12);

function muscles(...pairs: [string, "primary" | "secondary"][]): ExerciseMuscleAssignment[] {
    return pairs.map(([muscleGroupId, role]) => ({ muscleGroupId, role }));
}

function snapshot(overrides: Partial<ExerciseSnapshotV1> = {}): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId: EX_A,
        exerciseVersion: 1,
        name: "Bench Press",
        equipmentTypeId: id(90),
        movementPatternId: id(91),
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "supine",
        repetitionSemantics: "total" as RepetitionSemantics,
        loadModel: "external_only" as ExerciseLoadModel,
        supportedMeasurements: [
            "repetitions",
            "external_load",
            "bodyweight",
            "added_load",
            "assistance",
            "effective_load",
            "duration",
        ],
        muscles: muscles([CHEST, "primary"], [TRICEPS, "secondary"]),
        tagIds: [],
        analyticsFamilyExerciseIds: [],
        ...overrides,
    };
}

function measurements(overrides: Partial<PerformedSetMeasurements> = {}): PerformedSetMeasurements {
    return {
        reps: null,
        externalLoad: null,
        bodyweight: null,
        addedLoad: null,
        assistanceLoad: null,
        effectiveLoad: null,
        duration: null,
        distance: null,
        powerWatts: null,
        rpe: null,
        rir: null,
        tempo: null,
        restBefore: null,
        restAfter: null,
        ...overrides,
    };
}

let setCounter = 100;
function set(
    measure: Partial<PerformedSetMeasurements>,
    overrides: Partial<PerformedSetState> = {},
): PerformedSetState {
    return {
        id: id(setCounter++),
        setGroupId: null,
        round: null,
        position: 0,
        setType: "working" as PerformedSetType,
        status: "completed" as PerformedSetStatus,
        measurements: measurements(measure),
        failureReason: null,
        technique: null,
        discomfort: null,
        pump: null,
        notes: null,
        ...overrides,
    };
}

let occCounter = 1000;
function occurrence(
    snap: ExerciseSnapshotV1,
    sets: PerformedSetState[],
    overrides: Partial<StrengthOccurrenceFacts> = {},
): StrengthOccurrenceFacts {
    return {
        occurrenceId: id(occCounter++),
        exerciseId: snap.exerciseId,
        historicalExerciseVersion: snap.exerciseVersion,
        latestExerciseVersion: snap.exerciseVersion,
        historical: snap,
        latest: snap,
        performedSets: sets,
        ...overrides,
    };
}

function sessionFacts(
    occurrences: StrengthOccurrenceFacts[],
    overrides: Partial<StrengthSessionFacts> = {},
): StrengthSessionFacts {
    return {
        sessionId: id(500),
        profileId: id(600),
        sessionVersion: 3,
        localDate: "2026-03-16",
        occurrences,
        ...overrides,
    };
}

const CONFIG = { rpeThreshold: 7, rirThreshold: 3 };

function calculator(key: string): MetricCalculator {
    const found = STRENGTH_CALCULATORS.find(item => item.key === key);
    if (found === undefined) throw new Error(`no calculator ${key}`);
    return found;
}

function runSession(key: string, facts: StrengthSessionFacts, config = CONFIG): readonly MetricResult[] {
    return calculator(key).calculate({
        target: { scope: { type: "session", id: facts.sessionId }, period: { kind: "all_time" }, dimensions: {} },
        facts,
        config,
    });
}

function historical(results: readonly MetricResult[]): MetricResult[] {
    return results.filter(result => result.dimensions.basis === "historical");
}

// -------------------------------------------------------------------------------------------------
// work reps
// -------------------------------------------------------------------------------------------------

describe("strength.work_reps", () => {
    it("sums stored reps for total semantics", () => {
        const facts = sessionFacts([occurrence(snapshot(), [set({ reps: 8 }), set({ reps: 6 })])]);
        const result = historical(runSession(STRENGTH_WORK_REPS, facts))[0]!;
        expect(result.value.numeric).toBe(14);
        expect(result.value.unit).toBe("reps");
        expect(result.value.details).toMatchObject({ perSideExpanded: false, basis: "historical" });
    });

    it("doubles per-side repetitions and records the expansion", () => {
        const snap = snapshot({ repetitionSemantics: "per_side", laterality: "unilateral" });
        const facts = sessionFacts([occurrence(snap, [set({ reps: 10 })])]);
        const result = historical(runSession(STRENGTH_WORK_REPS, facts))[0]!;
        expect(result.value.numeric).toBe(20);
        expect(result.value.details).toMatchObject({ perSideExpanded: true });
    });

    it("excludes sets with no recorded reps and yields null when none have reps", () => {
        const facts = sessionFacts([occurrence(snapshot(), [set({ externalLoad: { value: 50, unit: "kg" } })])]);
        const result = historical(runSession(STRENGTH_WORK_REPS, facts))[0]!;
        expect(result.value.numeric).toBeNull();
        expect(result.value.details.excludedSets).toEqual([expect.objectContaining({ reason: "missing_reps" })]);
    });

    it("aggregates repeated occurrences of the same exercise into one result", () => {
        const facts = sessionFacts([
            occurrence(snapshot(), [set({ reps: 5 })]),
            occurrence(snapshot(), [set({ reps: 5 })]),
        ]);
        const results = historical(runSession(STRENGTH_WORK_REPS, facts));
        expect(results).toHaveLength(1);
        expect(results[0]!.value.numeric).toBe(10);
    });
});

// -------------------------------------------------------------------------------------------------
// volumes + load models
// -------------------------------------------------------------------------------------------------

describe("strength volume", () => {
    it("external volume is Σ workReps × externalLoad", () => {
        const facts = sessionFacts([
            occurrence(snapshot(), [
                set({ reps: 5, externalLoad: { value: 100, unit: "kg" } }),
                set({ reps: 5, externalLoad: { value: 100, unit: "kg" } }),
            ]),
        ]);
        const result = historical(runSession(STRENGTH_EXTERNAL_VOLUME, facts))[0]!;
        expect(result.value.numeric).toBe(1000);
        expect(result.value.unit).toBe("kg");
    });

    it("converts entered pounds to canonical kilograms without float drift", () => {
        const facts = sessionFacts([
            occurrence(snapshot(), [set({ reps: 1, externalLoad: { value: 100, unit: "lb" } })]),
        ]);
        const result = historical(runSession(STRENGTH_EXTERNAL_VOLUME, facts))[0]!;
        expect(result.value.numeric).toBeCloseTo(45.359237, 6);
    });

    it("effective volume uses the bodyweight load model (bw + added − assistance)", () => {
        const snap = snapshot({ loadModel: "full_bodyweight_plus_added_minus_assistance" });
        const facts = sessionFacts([
            occurrence(snap, [
                set({ reps: 10, bodyweight: { value: 80, unit: "kg" }, addedLoad: { value: 20, unit: "kg" } }),
            ]),
        ]);
        const result = historical(runSession(STRENGTH_EFFECTIVE_VOLUME, facts))[0]!;
        expect(result.value.numeric).toBe(1000);
    });

    it("excludes sets missing bodyweight under the bodyweight model (missing ≠ zero)", () => {
        const snap = snapshot({ loadModel: "full_bodyweight_plus_added_minus_assistance" });
        const facts = sessionFacts([occurrence(snap, [set({ reps: 10, addedLoad: { value: 20, unit: "kg" } })])]);
        const result = historical(runSession(STRENGTH_EFFECTIVE_VOLUME, facts))[0]!;
        expect(result.value.numeric).toBeNull();
        expect(result.value.details.excludedSets).toEqual([
            expect.objectContaining({ reason: "missing_effective_load" }),
        ]);
    });

    it("effective volume under the none load model is null", () => {
        const snap = snapshot({ loadModel: "none", supportedMeasurements: ["repetitions", "duration"] });
        const facts = sessionFacts([occurrence(snap, [set({ reps: 10 })])]);
        const result = historical(runSession(STRENGTH_EFFECTIVE_VOLUME, facts))[0]!;
        expect(result.value.numeric).toBeNull();
    });
});

// -------------------------------------------------------------------------------------------------
// muscle sets
// -------------------------------------------------------------------------------------------------

describe("strength muscle sets", () => {
    it("counts direct and indirect sets separately with no fractional weighting", () => {
        const snap = snapshot({ muscles: muscles([CHEST, "primary"], [SHOULDERS, "primary"], [TRICEPS, "secondary"]) });
        const facts = sessionFacts([occurrence(snap, [set({ reps: 8 }), set({ reps: 8 }), set({ reps: 8 })])]);

        const direct = historical(runSession(STRENGTH_DIRECT_MUSCLE_SETS, facts));
        expect(direct.map(r => [r.dimensions.muscle, r.value.numeric]).sort()).toEqual(
            [
                [CHEST, 3],
                [SHOULDERS, 3],
            ].sort(),
        );

        const indirect = historical(runSession(STRENGTH_INDIRECT_MUSCLE_SETS, facts));
        expect(indirect).toHaveLength(1);
        expect(indirect[0]!.dimensions.muscle).toBe(TRICEPS);
        expect(indirect[0]!.value.numeric).toBe(3);
    });
});

// -------------------------------------------------------------------------------------------------
// hard sets
// -------------------------------------------------------------------------------------------------

describe("strength.hard_sets", () => {
    it("counts non-warm-up sets meeting RPE ≥ threshold or RIR ≤ threshold", () => {
        const facts = sessionFacts([
            occurrence(snapshot(), [
                set({ reps: 5, rpe: 8 }), // hard (rpe)
                set({ reps: 5, rir: 2 }), // hard (rir)
                set({ reps: 5, rpe: 6 }), // not hard
                set({ reps: 5 }, { setType: "warm_up" }), // excluded (warm-up)
            ]),
        ]);
        const result = historical(runSession(STRENGTH_HARD_SETS, facts))[0]!;
        expect(result.value.numeric).toBe(2);
        expect(result.value.details).toMatchObject({ rpeThreshold: 7, rirThreshold: 3 });
    });

    it("honours a profile-overridden threshold from config", () => {
        const facts = sessionFacts([occurrence(snapshot(), [set({ reps: 5, rpe: 8.5 })])]);
        const strict = historical(runSession(STRENGTH_HARD_SETS, facts, { rpeThreshold: 9, rirThreshold: 0 }))[0]!;
        expect(strict.value.numeric).toBe(0);
    });
});

// -------------------------------------------------------------------------------------------------
// time under tension
// -------------------------------------------------------------------------------------------------

describe("strength.time_under_tension", () => {
    it("multiplies completed reps by summed tempo phases", () => {
        const facts = sessionFacts([
            occurrence(snapshot(), [
                set({
                    reps: 10,
                    tempo: {
                        eccentric: { value: 3, unit: "s" },
                        bottomPause: null,
                        concentric: { value: 1, unit: "s" },
                        topPause: null,
                    },
                }),
            ]),
        ]);
        const result = historical(runSession(STRENGTH_TIME_UNDER_TENSION, facts))[0]!;
        expect(result.value.numeric).toBe(10 * 4000);
        expect(result.value.unit).toBe("ms");
    });

    it("falls back to explicit set duration when no tempo is recorded", () => {
        const facts = sessionFacts([occurrence(snapshot(), [set({ reps: 1, duration: { value: 45, unit: "s" } })])]);
        const result = historical(runSession(STRENGTH_TIME_UNDER_TENSION, facts))[0]!;
        expect(result.value.numeric).toBe(45000);
    });
});

// -------------------------------------------------------------------------------------------------
// frequency
// -------------------------------------------------------------------------------------------------

describe("strength.frequency", () => {
    it("counts occurrences of an exercise that carried eligible sets", () => {
        const facts = sessionFacts([
            occurrence(snapshot(), [set({ reps: 5 })]),
            occurrence(snapshot(), [set({ reps: 5 })]),
        ]);
        const result = historical(runSession(STRENGTH_FREQUENCY, facts))[0]!;
        expect(result.value.numeric).toBe(2);
        expect(result.value.unit).toBe("occurrences");
    });
});

// -------------------------------------------------------------------------------------------------
// basis dimension
// -------------------------------------------------------------------------------------------------

describe("computation basis", () => {
    it("emits both historical and latest results, differing when the current definition changed", () => {
        const historicalSnap = snapshot({ muscles: muscles([CHEST, "primary"]) });
        const latestSnap = snapshot({
            exerciseVersion: 4,
            muscles: muscles([CHEST, "primary"], [SHOULDERS, "primary"]),
        });
        const occ = occurrence(historicalSnap, [set({ reps: 8 })], { latest: latestSnap, latestExerciseVersion: 4 });
        const facts = sessionFacts([occ]);

        const results = runSession(STRENGTH_DIRECT_MUSCLE_SETS, facts);
        const bases = new Set(results.map(r => r.dimensions.basis));
        expect(bases).toEqual(new Set(["historical", "latest"]));
        expect(results.filter(r => r.dimensions.basis === "historical")).toHaveLength(1);
        expect(results.filter(r => r.dimensions.basis === "latest")).toHaveLength(2);
    });

    it("omits the latest basis when the current definition is unavailable", () => {
        const occ = occurrence(snapshot(), [set({ reps: 8 })], { latest: null, latestExerciseVersion: null });
        const results = runSession(STRENGTH_WORK_REPS, sessionFacts([occ]));
        expect(results.every(r => r.dimensions.basis === "historical")).toBe(true);
    });

    it("records source session and exercise input revisions", () => {
        const facts = sessionFacts([occurrence(snapshot(), [set({ reps: 8 })])], { sessionVersion: 7 });
        const result = historical(runSession(STRENGTH_WORK_REPS, facts))[0]!;
        expect(result.inputs).toEqual(
            expect.arrayContaining([
                { entityType: "session", entityId: facts.sessionId, revision: 7 },
                { entityType: "exercise", entityId: EX_A, revision: 1 },
            ]),
        );
    });
});

// -------------------------------------------------------------------------------------------------
// window calculators
// -------------------------------------------------------------------------------------------------

function windowSession(
    sessionId: string,
    localDate: string,
    occurrences: StrengthOccurrenceFacts[],
): StrengthWindowSessionFacts {
    return { sessionId, sessionVersion: 1, localDate, occurrences };
}

function windowFacts(sessions: StrengthWindowSessionFacts[]): StrengthWindowFacts {
    return {
        profileId: id(600),
        scope: strengthWindowScope("rolling-7", id(600), "2026-03-16"),
        period: strengthWindowPeriod("rolling-7", "2026-03-16"),
        sessions,
    };
}

function runWindow(key: string, facts: StrengthWindowFacts, config = CONFIG): readonly MetricResult[] {
    return calculator(key).calculate({
        target: { scope: facts.scope, period: facts.period, dimensions: {} },
        facts,
        config,
    });
}

describe("strength window calculators", () => {
    const snapA = snapshot({ exerciseId: EX_A, muscles: muscles([CHEST, "primary"], [TRICEPS, "secondary"]) });
    const facts = windowFacts([
        windowSession(id(701), "2026-03-11", [
            occurrence(snapA, [set({ reps: 5, externalLoad: { value: 100, unit: "kg" } })], { exerciseId: EX_A }),
        ]),
        windowSession(id(702), "2026-03-14", [
            occurrence(
                snapA,
                [
                    set({ reps: 5, externalLoad: { value: 100, unit: "kg" } }),
                    set({ reps: 5, externalLoad: { value: 100, unit: "kg" } }),
                ],
                { exerciseId: EX_A },
            ),
        ]),
    ]);

    it("sums per-exercise volume across the window sessions", () => {
        const result = historical(runWindow(STRENGTH_WINDOW_EXERCISE_VOLUME, facts))[0]!;
        expect(result.dimensions.exercise).toBe(EX_A);
        expect(result.value.details).toMatchObject({ sessionCount: 2 });
        expect(result.value.details.externalVolumeKg).toBe(1500);
    });

    it("counts per-muscle sets and hard sets across the window", () => {
        const direct = historical(runWindow(STRENGTH_WINDOW_MUSCLE_SETS, facts)).filter(
            r => r.dimensions.muscle === CHEST && r.dimensions.role === "primary",
        )[0]!;
        expect(direct!.value.numeric).toBe(3);
    });

    it("counts distinct sessions per muscle for frequency", () => {
        const chest = historical(runWindow(STRENGTH_WINDOW_FREQUENCY, facts)).filter(
            r => r.dimensions.muscle === CHEST,
        )[0]!;
        expect(chest!.value.numeric).toBe(2);
        expect(chest!.value.unit).toBe("sessions");
    });

    it("scopes and periods every window result to the window it was asked about", () => {
        const result = historical(runWindow(STRENGTH_WINDOW_EXERCISE_VOLUME, facts))[0]!;
        expect(result!.scope).toEqual(strengthWindowScope("rolling-7", id(600), "2026-03-16"));
        expect(result!.period).toEqual({ kind: "rolling", days: 7, end: "2026-03-16" });
    });
});
