import { describe, expect, it } from "vitest";

import {
    ADHERENCE_FORMULA,
    calculateSessionAdherenceV1,
    scoreScalarAgainstRange,
    type AdherenceComponentKey,
    type AdherenceComponentResult,
    type ExerciseOccurrenceState,
    type ExerciseSnapshotV1,
    type PerformedRunStepState,
    type PerformedSetMeasurements,
    type PerformedSetState,
    type PrescribedActivityState,
    type PrescribedExerciseState,
    type PrescribedRunStepState,
    type PrescribedSetState,
    type RunningActivityState,
    type SessionActivityState,
    type SessionAdherenceInput,
    type SessionMappingsState,
    type SessionPrescriptionState,
    type TargetRanges,
} from "#src/modules/training/domain/index";

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

// --- prescribed-side builders --------------------------------------------------------------------

function targets(overrides: Partial<TargetRanges> = {}): TargetRanges {
    return {
        repsMin: null,
        repsMax: null,
        loadKgMin: null,
        loadKgMax: null,
        durationMsMin: null,
        durationMsMax: null,
        distanceMMin: null,
        distanceMMax: null,
        speedMpsMin: null,
        speedMpsMax: null,
        powerWMin: null,
        powerWMax: null,
        rpeMin: null,
        rpeMax: null,
        rirMin: null,
        rirMax: null,
        hrBpmMin: null,
        hrBpmMax: null,
        percent1rm: null,
        percentTrainingMax: null,
        tempo: null,
        restMsMin: null,
        restMsMax: null,
        enteredTargets: {},
        ...overrides,
    };
}

function pSet(setId: string, t: TargetRanges): PrescribedSetState {
    return {
        id: setId,
        logicalKey: setId,
        sourceLogicalKey: null,
        sourceRowId: null,
        setGroupLogicalKey: null,
        position: 0,
        round: null,
        setType: "working",
        targets: t,
        notes: null,
    };
}

function snapshot(exerciseId: string, overrides: Partial<ExerciseSnapshotV1> = {}): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Exercise",
        equipmentTypeId: id(9001),
        movementPatternId: id(9002),
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "standing",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
        ...overrides,
    };
}

function pExercise(exerciseId: string, sets: PrescribedSetState[]): PrescribedExerciseState {
    return {
        id: exerciseId,
        logicalKey: exerciseId,
        sourceLogicalKey: null,
        sourceRowId: null,
        exerciseId,
        snapshot: snapshot(exerciseId),
        position: 0,
        purpose: null,
        substitutionPolicy: null,
        sets,
    };
}

function pStrengthActivity(
    activityId: string,
    exercises: PrescribedExerciseState[],
    overrides: Partial<PrescribedActivityState> = {},
): PrescribedActivityState {
    return {
        id: activityId,
        logicalKey: activityId,
        sourceLogicalKey: null,
        sourceRowId: null,
        type: "strength",
        position: 0,
        expectedDurationMs: null,
        rpeTarget: null,
        notes: null,
        strength: { exercises, setGroups: [] },
        running: null,
        ...overrides,
    };
}

function pRunStep(
    stepId: string,
    t: TargetRanges,
    type: PrescribedRunStepState["type"] = "work",
): PrescribedRunStepState {
    return {
        id: stepId,
        logicalKey: stepId,
        sourceLogicalKey: null,
        sourceRowId: null,
        parentStepLogicalKey: null,
        type,
        position: 0,
        repeatCount: null,
        targets: t,
        notes: null,
    };
}

function pRunningActivity(
    activityId: string,
    steps: PrescribedRunStepState[],
    overallTargets: TargetRanges,
    overrides: Partial<PrescribedActivityState> = {},
): PrescribedActivityState {
    return {
        id: activityId,
        logicalKey: activityId,
        sourceLogicalKey: null,
        sourceRowId: null,
        type: "running",
        position: 0,
        expectedDurationMs: null,
        rpeTarget: null,
        notes: null,
        strength: null,
        running: { runTags: [], overallTargets, steps },
        ...overrides,
    };
}

function prescription(activities: PrescribedActivityState[]): SessionPrescriptionState {
    return {
        id: id(500),
        kind: "resolved_execution",
        schemaVersion: 1,
        expectedDurationMs: null,
        notes: null,
        sourcePrescriptionId: null,
        sourceKind: null,
        activities,
        createdAt: "2026-08-02T09:00:00.000Z",
    };
}

// --- actual-side builders ------------------------------------------------------------------------

function meas(overrides: Partial<PerformedSetMeasurements> = {}): PerformedSetMeasurements {
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

function perfSet(
    setId: string,
    measurements: PerformedSetMeasurements,
    status: PerformedSetState["status"] = "completed",
): PerformedSetState {
    return {
        id: setId,
        setGroupId: null,
        round: null,
        position: 0,
        setType: "working",
        status,
        measurements,
        failureReason: null,
        technique: null,
        discomfort: null,
        pump: null,
        notes: null,
    };
}

function occurrence(
    occurrenceId: string,
    sets: PerformedSetState[],
    snapshotOverrides: Partial<ExerciseSnapshotV1> = {},
): ExerciseOccurrenceState {
    return {
        id: occurrenceId,
        exerciseId: occurrenceId,
        snapshot: snapshot(occurrenceId, snapshotOverrides),
        position: 0,
        purpose: null,
        technique: null,
        discomfort: null,
        pump: null,
        notes: null,
        performedSets: sets,
    };
}

function sActivity(activityId: string, occurrences: ExerciseOccurrenceState[]): SessionActivityState {
    return {
        id: activityId,
        type: "strength",
        position: 0,
        startedAt: null,
        endedAt: null,
        durationSeconds: null,
        rpe: null,
        feeling: null,
        notes: null,
        tags: [],
        strength: { occurrences, setGroups: [] },
        running: null,
    };
}

function runningState(overrides: Partial<RunningActivityState> = {}): RunningActivityState {
    return {
        distance: null,
        movingTime: null,
        elapsedTime: null,
        averageHeartRate: null,
        maxHeartRate: null,
        averageCadence: null,
        maxCadence: null,
        averagePower: null,
        maxPower: null,
        elevationGain: null,
        elevationLoss: null,
        calories: null,
        strideLength: null,
        groundContactTime: null,
        verticalOscillation: null,
        vo2Max: null,
        rpe: null,
        indoor: false,
        treadmill: false,
        runTags: [],
        environment: null,
        steps: [],
        splits: [],
        zoneTimes: [],
        route: null,
        gearItemId: null,
        ...overrides,
    };
}

function perfRunStep(stepId: string, measurements: PerformedRunStepState["measurements"]): PerformedRunStepState {
    return { id: stepId, parentStepId: null, type: "work", position: 0, repeatCount: null, measurements, notes: null };
}

function runStepMeasurements(
    overrides: Partial<PerformedRunStepState["measurements"]> = {},
): PerformedRunStepState["measurements"] {
    return {
        distance: null,
        duration: null,
        averageHeartRate: null,
        maxHeartRate: null,
        averageCadence: null,
        maxCadence: null,
        averagePower: null,
        maxPower: null,
        elevationGain: null,
        elevationLoss: null,
        rpe: null,
        ...overrides,
    };
}

function rActivity(activityId: string, running: RunningActivityState): SessionActivityState {
    return {
        id: activityId,
        type: "running",
        position: 0,
        startedAt: null,
        endedAt: null,
        durationSeconds: null,
        rpe: null,
        feeling: null,
        notes: null,
        tags: [],
        strength: null,
        running,
    };
}

// --- mapping builders ----------------------------------------------------------------------------

function mappings(overrides: Partial<SessionMappingsState> = {}): SessionMappingsState {
    return {
        plannedLinks: [],
        activityMappings: [],
        occurrenceMappings: [],
        setMappings: [],
        runStepMappings: [],
        ...overrides,
    };
}

let mappingSeq = 10_000;
const mappingId = () => id(mappingSeq++);

function activityMapping(prescribedActivityId: string | null, actualActivityId: string, relation = "matched") {
    return {
        id: mappingId(),
        relation: relation as never,
        reason: null,
        notes: null,
        prescribedActivityId,
        actualActivityId,
    };
}
function occurrenceMapping(prescribedExerciseId: string | null, occurrenceId: string, relation = "matched") {
    return {
        id: mappingId(),
        relation: relation as never,
        reason: null,
        notes: null,
        prescribedExerciseId,
        occurrenceId,
    };
}
function setMapping(
    prescribedSetId: string | null,
    performedSetId: string,
    relation = "matched",
    portion: string | null = null,
) {
    return {
        id: mappingId(),
        relation: relation as never,
        reason: null,
        notes: null,
        prescribedSetId,
        performedSetId,
        portion,
    };
}
function runStepMapping(prescribedRunStepId: string | null, performedRunStepId: string, relation = "matched") {
    return {
        id: mappingId(),
        relation: relation as never,
        reason: null,
        notes: null,
        prescribedRunStepId,
        performedRunStepId,
    };
}

// --- helpers -------------------------------------------------------------------------------------

function componentByKey(result: AdherenceComponentResult[], key: AdherenceComponentKey): AdherenceComponentResult {
    const component = result.find(entry => entry.key === key);
    if (component === undefined) throw new Error(`Component ${key} not present`);
    return component;
}

const kg = (value: number) => ({ value, unit: "kg" as const });
const metres = (value: number) => ({ value, unit: "m" as const });
const seconds = (value: number) => ({ value, unit: "s" as const });

// -------------------------------------------------------------------------------------------------

describe("scoreScalarAgainstRange (adherence.overall.v1)", () => {
    it("scores 100 inside the range", () => {
        expect(scoreScalarAgainstRange(10, 8, 12)).toBe(100);
        expect(scoreScalarAgainstRange(8, 8, 8)).toBe(100);
    });

    it("penalises against the nearest violated boundary", () => {
        expect(scoreScalarAgainstRange(8, 10, 12)).toBe(80); // 1 - |8-10|/10
        expect(scoreScalarAgainstRange(14, 10, 12)).toBeCloseTo(83.333, 3); // 1 - |14-12|/12
    });

    it("treats a missing bound as no limit on that side", () => {
        expect(scoreScalarAgainstRange(1000, 10, null)).toBe(100);
        expect(scoreScalarAgainstRange(5, null, 12)).toBe(100);
    });

    it("floors at zero for gross deviations", () => {
        expect(scoreScalarAgainstRange(0, 100, 100)).toBe(0);
    });
});

describe("calculateSessionAdherenceV1 — strength", () => {
    function perfectStrength(): SessionAdherenceInput {
        const setId = id(1);
        const exerciseId = id(2);
        const activityId = id(3);
        const resolved = prescription([
            pStrengthActivity(activityId, [
                pExercise(exerciseId, [
                    pSet(
                        setId,
                        targets({
                            repsMin: 5,
                            repsMax: 5,
                            loadKgMin: "100",
                            loadKgMax: "100",
                            rpeMin: "8",
                            rpeMax: "8",
                        }),
                    ),
                ]),
            ]),
        ]);
        const oId = id(52);
        const psId = id(53);
        const aId = id(51);
        const actualActivities = [
            sActivity(aId, [occurrence(oId, [perfSet(psId, meas({ reps: 5, externalLoad: kg(100), rpe: 8 }))])]),
        ];
        return {
            resolved,
            actualActivities,
            mappings: mappings({
                activityMappings: [activityMapping(activityId, aId)],
                occurrenceMappings: [occurrenceMapping(exerciseId, oId)],
                setMappings: [setMapping(setId, psId)],
            }),
        };
    }

    it("scores a fully-compliant strength session at 100 across every component", () => {
        const result = calculateSessionAdherenceV1(perfectStrength());
        expect(result.formula).toBe(ADHERENCE_FORMULA);
        expect(result.scope).toBe("strength");
        expect(result.overall).toBe(100);
        for (const key of [
            "session_completion",
            "exercise_completion",
            "set_completion",
            "reps",
            "load",
            "volume",
            "intensity",
        ] as const) {
            expect(componentByKey([...result.components], key).score).toBe(100);
        }
        // Weighted components sum to 100 (session 5 + exercise 15 + set 20 + reps 20 + load 15 + volume 15 + intensity 10).
        const weighted = result.components.filter(c => c.weight > 0).reduce((sum, c) => sum + c.weight, 0);
        expect(weighted).toBe(100);
    });

    it("penalises under-performed reps and volume against the boundary and renormalises overall", () => {
        const input = perfectStrength();
        const under: SessionAdherenceInput = {
            ...input,
            actualActivities: [
                sActivity(id(51), [
                    occurrence(id(52), [perfSet(id(53), meas({ reps: 4, externalLoad: kg(100), rpe: 8 }))]),
                ]),
            ],
        };
        const result = calculateSessionAdherenceV1(under);
        expect(componentByKey([...result.components], "reps").score).toBe(80); // 4 vs [5,5]
        expect(componentByKey([...result.components], "volume").score).toBe(80); // 400 vs [500,500]
        expect(componentByKey([...result.components], "load").score).toBe(100);
        // overall = (5+15+20 + 20*.8 + 15 + 15*.8 + 10)/100*100 = 93
        expect(result.overall).toBe(93);
    });

    it("excludes components with no comparable target and renormalises the remaining weights", () => {
        const setId = id(1);
        const exerciseId = id(2);
        const activityId = id(3);
        const resolved = prescription([
            pStrengthActivity(activityId, [pExercise(exerciseId, [pSet(setId, targets({ repsMin: 5, repsMax: 5 }))])]),
        ]);
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [
                sActivity(id(51), [occurrence(id(52), [perfSet(id(53), meas({ reps: 5, externalLoad: kg(100) }))])]),
            ],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                occurrenceMappings: [occurrenceMapping(exerciseId, id(52))],
                setMappings: [setMapping(setId, id(53))],
            }),
        });
        const load = componentByKey([...result.components], "load");
        const volume = componentByKey([...result.components], "volume");
        const intensity = componentByKey([...result.components], "intensity");
        expect(load.included).toBe(false);
        expect(load.exclusion).toBe("missing_target");
        expect(volume.included).toBe(false);
        expect(intensity.included).toBe(false);
        expect(result.exclusions).toContain("missing_target");
        expect(result.overall).toBe(100); // remaining components are all perfect
    });

    it("reflects a skipped set (no mapping) in set completion without excluding the exercise", () => {
        const [setA, setB, exerciseId, activityId] = [id(1), id(2), id(3), id(4)];
        const resolved = prescription([
            pStrengthActivity(activityId, [
                pExercise(exerciseId, [
                    pSet(setA, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" })),
                    pSet(setB, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" })),
                ]),
            ]),
        ]);
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [
                sActivity(id(51), [occurrence(id(52), [perfSet(id(53), meas({ reps: 5, externalLoad: kg(100) }))])]),
            ],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                occurrenceMappings: [occurrenceMapping(exerciseId, id(52))],
                setMappings: [setMapping(setA, id(53))],
            }),
        });
        expect(componentByKey([...result.components], "set_completion").score).toBe(50); // 1 of 2 sets
        expect(componentByKey([...result.components], "exercise_completion").score).toBe(100);
    });

    it("excludes a cancelled exercise from every denominator", () => {
        const [setA, setB, exA, exB, activityId] = [id(1), id(2), id(3), id(4), id(5)];
        const resolved = prescription([
            pStrengthActivity(activityId, [
                pExercise(exA, [pSet(setA, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" }))]),
                pExercise(exB, [pSet(setB, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" }))]),
            ]),
        ]);
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [
                sActivity(id(51), [occurrence(id(52), [perfSet(id(53), meas({ reps: 5, externalLoad: kg(100) }))])]),
            ],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                occurrenceMappings: [occurrenceMapping(exA, id(52))],
                setMappings: [setMapping(setA, id(53))],
            }),
            cancelledPrescribedIds: new Set([exB, setB]),
        });
        // Only the non-cancelled exercise/set count, so completion is 100 despite exB being unperformed.
        expect(componentByKey([...result.components], "exercise_completion").score).toBe(100);
        expect(componentByKey([...result.components], "set_completion").score).toBe(100);
    });

    it("counts a substitution as exercise completion and flags it", () => {
        const [setId, exerciseId, activityId] = [id(1), id(2), id(3)];
        const resolved = prescription([
            pStrengthActivity(activityId, [
                pExercise(exerciseId, [
                    pSet(setId, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" })),
                ]),
            ]),
        ]);
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [
                sActivity(id(51), [occurrence(id(52), [perfSet(id(53), meas({ reps: 5, externalLoad: kg(100) }))])]),
            ],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                occurrenceMappings: [occurrenceMapping(exerciseId, id(52), "substituted")],
                setMappings: [setMapping(setId, id(53))],
            }),
        });
        const exercise = componentByKey([...result.components], "exercise_completion");
        expect(exercise.score).toBe(100);
        expect(exercise.inputs.substituted).toBe(1);
    });

    it("reports added work as divergence without lowering completion", () => {
        const [setId, exerciseId, activityId] = [id(1), id(2), id(3)];
        const resolved = prescription([
            pStrengthActivity(activityId, [
                pExercise(exerciseId, [
                    pSet(setId, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" })),
                ]),
            ]),
        ]);
        const addedSetId = id(54);
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [
                sActivity(id(51), [
                    occurrence(id(52), [
                        perfSet(id(53), meas({ reps: 5, externalLoad: kg(100) })),
                        perfSet(addedSetId, meas({ reps: 8, externalLoad: kg(50) }), "added"),
                    ]),
                ]),
            ],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                occurrenceMappings: [occurrenceMapping(exerciseId, id(52))],
                setMappings: [setMapping(setId, id(53)), setMapping(null, addedSetId, "added")],
            }),
        });
        const setCompletion = componentByKey([...result.components], "set_completion");
        expect(setCompletion.score).toBe(100);
        expect(setCompletion.inputs.addedSets).toBe(1);
        // Added set is not compared, so reps stays a perfect 5-vs-[5,5].
        expect(componentByKey([...result.components], "reps").score).toBe(100);
    });

    it("aggregates a one-to-many (split) mapping before scoring", () => {
        const [setId, exerciseId, activityId] = [id(1), id(2), id(3)];
        const resolved = prescription([
            pStrengthActivity(activityId, [
                pExercise(exerciseId, [
                    pSet(setId, targets({ repsMin: 10, repsMax: 10, loadKgMin: "100", loadKgMax: "100" })),
                ]),
            ]),
        ]);
        const [pa, pb] = [id(53), id(54)];
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [
                sActivity(id(51), [
                    occurrence(id(52), [
                        perfSet(pa, meas({ reps: 5, externalLoad: kg(100) })),
                        perfSet(pb, meas({ reps: 5, externalLoad: kg(100) })),
                    ]),
                ]),
            ],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                occurrenceMappings: [occurrenceMapping(exerciseId, id(52))],
                setMappings: [setMapping(setId, pa, "split"), setMapping(setId, pb, "split")],
            }),
        });
        // Two performed sets of 5 sum to the planned 10 (planned counted once).
        expect(componentByKey([...result.components], "reps").score).toBe(100);
        expect(componentByKey([...result.components], "reps").inputs.actualTotal).toBe(10);
    });

    it("aggregates a many-to-one (combined) mapping before scoring", () => {
        const [setA, setB, exerciseId, activityId] = [id(1), id(2), id(3), id(4)];
        const resolved = prescription([
            pStrengthActivity(activityId, [
                pExercise(exerciseId, [
                    pSet(setA, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" })),
                    pSet(setB, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" })),
                ]),
            ]),
        ]);
        const performedId = id(53);
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [
                sActivity(id(51), [
                    occurrence(id(52), [perfSet(performedId, meas({ reps: 10, externalLoad: kg(100) }))]),
                ]),
            ],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                occurrenceMappings: [occurrenceMapping(exerciseId, id(52))],
                setMappings: [setMapping(setA, performedId, "combined"), setMapping(setB, performedId, "combined")],
            }),
        });
        // One performed set of 10 covers both prescribed 5s: reps 10 vs planned 5+5.
        expect(componentByKey([...result.components], "reps").score).toBe(100);
        expect(componentByKey([...result.components], "reps").inputs.actualTotal).toBe(10);
        expect(componentByKey([...result.components], "set_completion").score).toBe(100);
    });
});

describe("calculateSessionAdherenceV1 — running", () => {
    it("scores distance, duration, pace, step completion, and intensity from the run summary", () => {
        const [stepId, activityId] = [id(1), id(2)];
        const resolved = prescription([
            pRunningActivity(
                activityId,
                [pRunStep(stepId, targets())],
                targets({
                    distanceMMin: "5000",
                    distanceMMax: "5000",
                    durationMsMin: 1_500_000,
                    durationMsMax: 1_500_000,
                    speedMpsMin: "3.3",
                    speedMpsMax: "3.4",
                    rpeMin: "6",
                    rpeMax: "6",
                }),
            ),
        ]);
        const running = runningState({
            distance: metres(5000),
            movingTime: seconds(1500),
            rpe: 6,
            steps: [perfRunStep(id(52), runStepMeasurements({ distance: metres(5000) }))],
        });
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [rActivity(id(51), running)],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                runStepMappings: [runStepMapping(stepId, id(52))],
            }),
        });
        expect(result.scope).toBe("running");
        expect(componentByKey([...result.components], "distance").score).toBe(100);
        expect(componentByKey([...result.components], "duration").score).toBe(100);
        expect(componentByKey([...result.components], "step_completion").score).toBe(100);
        expect(componentByKey([...result.components], "intensity").score).toBe(100);
        // pace ≈ 5000m / 1500s = 3.333 m/s
        expect(componentByKey([...result.components], "pace").score).toBe(100);
        expect(result.overall).toBe(100);
    });

    it("excludes pace when the run has no moving time", () => {
        const [stepId, activityId] = [id(1), id(2)];
        const resolved = prescription([
            pRunningActivity(
                activityId,
                [pRunStep(stepId, targets())],
                targets({ distanceMMin: "5000", distanceMMax: "5000", speedMpsMin: "3", speedMpsMax: "3" }),
            ),
        ]);
        const running = runningState({ distance: metres(5000), steps: [perfRunStep(id(52), runStepMeasurements())] });
        const result = calculateSessionAdherenceV1({
            resolved,
            actualActivities: [rActivity(id(51), running)],
            mappings: mappings({
                activityMappings: [activityMapping(activityId, id(51))],
                runStepMappings: [runStepMapping(stepId, id(52))],
            }),
        });
        const pace = componentByKey([...result.components], "pace");
        expect(pace.included).toBe(false);
        expect(pace.exclusion).toBe("missing_actual");
        expect(componentByKey([...result.components], "distance").score).toBe(100);
    });
});

describe("calculateSessionAdherenceV1 — mixed sessions", () => {
    function mixedInput(strengthDurationMs: number | null, runDurationMs: number | null): SessionAdherenceInput {
        const [setId, exerciseId, strengthActivityId] = [id(1), id(2), id(3)];
        const [stepId, runActivityId] = [id(4), id(5)];
        const resolved = prescription([
            pStrengthActivity(
                strengthActivityId,
                [
                    pExercise(exerciseId, [
                        pSet(setId, targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" })),
                    ]),
                ],
                { expectedDurationMs: strengthDurationMs, position: 0 },
            ),
            pRunningActivity(
                runActivityId,
                [pRunStep(stepId, targets())],
                targets({ distanceMMin: "5000", distanceMMax: "5000" }),
                { expectedDurationMs: runDurationMs, position: 1 },
            ),
        ]);
        // Strength is perfect; running distance is only half of target (2500 of 5000).
        const strengthActual = sActivity(id(51), [
            occurrence(id(52), [perfSet(id(53), meas({ reps: 5, externalLoad: kg(100) }))]),
        ]);
        const runActual = rActivity(
            id(54),
            runningState({
                distance: metres(2500),
                steps: [perfRunStep(id(55), runStepMeasurements({ distance: metres(2500) }))],
            }),
        );
        return {
            resolved,
            actualActivities: [strengthActual, runActual],
            mappings: mappings({
                activityMappings: [activityMapping(strengthActivityId, id(51)), activityMapping(runActivityId, id(54))],
                occurrenceMappings: [occurrenceMapping(exerciseId, id(52))],
                setMappings: [setMapping(setId, id(53))],
                runStepMappings: [runStepMapping(stepId, id(55))],
            }),
        };
    }

    it("labels the scope mixed and weights activities equally when a duration is missing", () => {
        const result = calculateSessionAdherenceV1(mixedInput(null, null));
        expect(result.scope).toBe("mixed");
        // Strength block weights sum to 95/2 across the two activities.
        const strengthReps = result.components.find(c => c.key === "reps");
        expect(strengthReps?.weight).toBeCloseTo(20 * 0.5, 3);
        const runningDistance = result.components.find(c => c.key === "distance");
        expect(runningDistance?.weight).toBeCloseTo(25 * 0.5, 3);
    });

    it("weights activities by planned expected duration when all provide it", () => {
        // Strength 45 min, running 15 min → strength gets 75% of the 95-weight block.
        const result = calculateSessionAdherenceV1(mixedInput(2_700_000, 900_000));
        const strengthReps = result.components.find(c => c.key === "reps");
        expect(strengthReps?.weight).toBeCloseTo(20 * 0.75, 3);
        const runningDistance = result.components.find(c => c.key === "distance");
        expect(runningDistance?.weight).toBeCloseTo(25 * 0.25, 3);
    });
});
