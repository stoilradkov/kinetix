import { describe, expect, it } from "vitest";

import { DomainValidationError } from "#src/platform/domain/index";
import {
    TrainingSession,
    effectiveLoadKg,
    workReps,
    type ExerciseSnapshotV1,
    type PerformedSetState,
    type SessionActivityInput,
} from "#src/modules/training/domain/index";

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const now = new Date("2026-08-02T09:00:00.000Z");

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

function snapshot(exerciseId: string, overrides: Partial<ExerciseSnapshotV1> = {}): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Exercise",
        equipmentTypeId: PROFILE,
        movementPatternId: PROFILE,
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

function strengthActivity(overrides: Record<string, unknown> = {}): SessionActivityInput {
    return {
        id: id(1),
        type: "strength",
        position: 0,
        strength: {
            occurrences: [
                {
                    id: id(2),
                    exerciseId: id(100),
                    snapshot: snapshot(id(100)),
                    position: 0,
                    performedSets: [{ id: id(3), position: 0, setType: "working", status: "completed" }],
                },
            ],
        },
        ...overrides,
    } as SessionActivityInput;
}

function build(activity: SessionActivityInput): TrainingSession {
    return TrainingSession.create(
        { id: id(9), profileId: PROFILE, localDate: "2026-08-02", timeZone: "UTC", activities: [activity] },
        now,
    );
}

describe("strength activity domain", () => {
    it("accepts a straight strength occurrence with a snapshot and set", () => {
        const session = build(strengthActivity());
        const strength = session.state.activities[0]!.strength!;
        expect(strength.occurrences).toHaveLength(1);
        expect(strength.occurrences[0]!.performedSets).toHaveLength(1);
    });

    it("rejects a running activity that carries strength detail", () => {
        expect(() =>
            build({
                id: id(1),
                type: "running",
                position: 0,
                strength: {
                    occurrences: [{ id: id(2), exerciseId: id(100), snapshot: snapshot(id(100)), position: 0 }],
                },
            } as SessionActivityInput),
        ).toThrow(DomainValidationError);
    });

    it("rejects a set measurement the exercise does not support", () => {
        expect(() =>
            build(
                strengthActivity({
                    strength: {
                        occurrences: [
                            {
                                id: id(2),
                                exerciseId: id(100),
                                snapshot: snapshot(id(100)), // supports external_load only
                                position: 0,
                                performedSets: [
                                    {
                                        id: id(3),
                                        position: 0,
                                        setType: "working",
                                        status: "completed",
                                        measurements: { distance: { value: 10, unit: "m" } },
                                    },
                                ],
                            },
                        ],
                    },
                }),
            ),
        ).toThrow(/does not support/);
    });

    it("supports many-to-many superset membership and nested groups", () => {
        const session = build(
            strengthActivity({
                strength: {
                    occurrences: [
                        { id: id(2), exerciseId: id(100), snapshot: snapshot(id(100)), position: 0 },
                        { id: id(4), exerciseId: id(101), snapshot: snapshot(id(101)), position: 1 },
                    ],
                    setGroups: [
                        {
                            id: id(20),
                            type: "superset",
                            position: 0,
                            members: [
                                { occurrenceId: id(2), position: 0 },
                                { occurrenceId: id(4), position: 1 },
                            ],
                        },
                        {
                            id: id(21),
                            parentGroupId: id(20),
                            type: "drop",
                            position: 0,
                            members: [{ occurrenceId: id(2), position: 0 }],
                        },
                    ],
                },
            }),
        );
        const strength = session.state.activities[0]!.strength!;
        expect(strength.setGroups).toHaveLength(2);
        expect(strength.setGroups[0]!.members).toHaveLength(2);
        expect(strength.setGroups[1]!.parentGroupId).toBe(id(20));
    });

    it("rejects a set-group member referencing an unknown occurrence", () => {
        expect(() =>
            build(
                strengthActivity({
                    strength: {
                        occurrences: [{ id: id(2), exerciseId: id(100), snapshot: snapshot(id(100)), position: 0 }],
                        setGroups: [
                            {
                                id: id(20),
                                type: "superset",
                                position: 0,
                                members: [{ occurrenceId: id(999), position: 0 }],
                            },
                        ],
                    },
                }),
            ),
        ).toThrow(/unknown exercise occurrence/);
    });

    it("rejects a cyclic set-group hierarchy", () => {
        expect(() =>
            build(
                strengthActivity({
                    strength: {
                        occurrences: [{ id: id(2), exerciseId: id(100), snapshot: snapshot(id(100)), position: 0 }],
                        setGroups: [
                            { id: id(20), parentGroupId: id(21), type: "superset", position: 0 },
                            { id: id(21), parentGroupId: id(20), type: "drop", position: 0 },
                        ],
                    },
                }),
            ),
        ).toThrow(/acyclic/);
    });

    it("rejects duplicate performed-set positions within an occurrence", () => {
        expect(() =>
            build(
                strengthActivity({
                    strength: {
                        occurrences: [
                            {
                                id: id(2),
                                exerciseId: id(100),
                                snapshot: snapshot(id(100)),
                                position: 0,
                                performedSets: [
                                    { id: id(3), position: 0, setType: "working", status: "completed" },
                                    { id: id(4), position: 0, setType: "working", status: "completed" },
                                ],
                            },
                        ],
                    },
                }),
            ),
        ).toThrow(/position/);
    });
});

describe("objective calculation policies", () => {
    const baseSet = (measurements: Partial<PerformedSetState["measurements"]>): PerformedSetState => ({
        id: id(3),
        setGroupId: null,
        round: null,
        position: 0,
        setType: "working",
        status: "completed",
        measurements: {
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
            ...measurements,
        },
        failureReason: null,
        technique: null,
        discomfort: null,
        pump: null,
        notes: null,
    });

    it("doubles reps for per-side semantics and keeps total semantics as-is", () => {
        const set = baseSet({ reps: 10 });
        expect(workReps(set, "total")).toBe(10);
        expect(workReps(set, "alternating")).toBe(10);
        expect(workReps(set, "per_side")).toBe(20);
        expect(workReps(baseSet({}), "total")).toBeNull();
    });

    it("derives external-only effective load from external load in kilograms", () => {
        const set = baseSet({ externalLoad: { value: 100, unit: "kg" } });
        expect(effectiveLoadKg(set, "external_only")!.toString()).toBe("100");
        expect(effectiveLoadKg(baseSet({}), "external_only")).toBeNull();
    });

    it("combines bodyweight, added, and assistance for the bodyweight load model", () => {
        const set = baseSet({
            bodyweight: { value: 80, unit: "kg" },
            addedLoad: { value: 20, unit: "kg" },
            assistanceLoad: { value: 30, unit: "kg" },
        });
        expect(effectiveLoadKg(set, "full_bodyweight_plus_added_minus_assistance")!.toString()).toBe("70");
    });

    it("floors the bodyweight model at zero and never invents load for the none model", () => {
        const assisted = baseSet({ bodyweight: { value: 50, unit: "kg" }, assistanceLoad: { value: 90, unit: "kg" } });
        expect(effectiveLoadKg(assisted, "full_bodyweight_plus_added_minus_assistance")!.toString()).toBe("0");
        expect(effectiveLoadKg(baseSet({ externalLoad: { value: 10, unit: "kg" } }), "none")).toBeNull();
    });

    it("uses the caller-supplied effective load for the manual model, honouring unit conversion", () => {
        const set = baseSet({ effectiveLoad: { value: 100, unit: "lb" } });
        expect(effectiveLoadKg(set, "manual_effective_load")!.toString()).toBe("45.359237");
    });
});
