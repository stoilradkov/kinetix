import { describe, expect, it } from "vitest";

import { DomainValidationError } from "#src/platform/domain/index";

import {
    SessionPrescription,
    collectLogicalKeys,
    draftFromState,
    type ExerciseSnapshotV1,
    type IdMinter,
    type PrescribedActivityDraft,
    type PublishPrescriptionDraft,
} from "#src/modules/training/domain/index";

const EXERCISE_A = "0198a4db-d8da-7000-8000-0000000000a1";
const EXERCISE_B = "0198a4db-d8da-7000-8000-0000000000a2";
const EQUIPMENT_ID = "0198a4db-d8da-7000-8000-0000000000b1";
const MOVEMENT_ID = "0198a4db-d8da-7000-8000-0000000000c1";
const now = new Date("2026-07-29T10:00:00.000Z");

/**
 * Deterministic minter producing distinct, well-formed UUIDs. `tag` (one hex digit)
 * namespaces the output so identifiers from two trees never collide by accident.
 */
function counterMinter(tag = "1"): IdMinter {
    let row = 0;
    let logical = 0;
    return {
        rowId: () => `11111111-1111-7111-8111-${tag}${(++row).toString(16).padStart(11, "0")}`,
        logicalKey: () => `22222222-2222-7222-8222-${tag}${(++logical).toString(16).padStart(11, "0")}`,
    };
}

function snapshot(exerciseId: string, name = "Back Squat"): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name,
        equipmentTypeId: EQUIPMENT_ID,
        movementPatternId: MOVEMENT_ID,
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "standing",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
    };
}

function strengthActivity(overrides: Partial<PrescribedActivityDraft> = {}): PrescribedActivityDraft {
    return {
        ref: "a1",
        type: "strength",
        position: 0,
        strength: {
            exercises: [
                {
                    ref: "e1",
                    exerciseId: EXERCISE_A,
                    snapshot: snapshot(EXERCISE_A),
                    position: 0,
                    sets: [
                        { ref: "s1", position: 0, setType: "warm_up", targets: { repsMin: 5, repsMax: 5 } },
                        {
                            ref: "s2",
                            position: 1,
                            setType: "working",
                            targets: { repsMin: 3, repsMax: 5, percent1rm: "80" },
                        },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

function supersetActivity(): PrescribedActivityDraft {
    return {
        ref: "a1",
        type: "strength",
        position: 0,
        strength: {
            exercises: [
                {
                    ref: "e1",
                    exerciseId: EXERCISE_A,
                    snapshot: snapshot(EXERCISE_A),
                    position: 0,
                    sets: [
                        {
                            ref: "s1",
                            position: 0,
                            setType: "working",
                            setGroupRef: "g1",
                            targets: { repsMin: 8, repsMax: 8 },
                        },
                    ],
                },
                {
                    ref: "e2",
                    exerciseId: EXERCISE_B,
                    snapshot: snapshot(EXERCISE_B, "Bench Press"),
                    position: 1,
                    sets: [
                        {
                            ref: "s2",
                            position: 0,
                            setType: "working",
                            setGroupRef: "g1",
                            targets: { repsMin: 8, repsMax: 8 },
                        },
                    ],
                },
            ],
            setGroups: [
                {
                    ref: "g1",
                    type: "superset",
                    position: 0,
                    rounds: 3,
                    members: [
                        { exerciseRef: "e1", position: 0 },
                        { exerciseRef: "e2", position: 1 },
                    ],
                },
            ],
        },
    };
}

function runningActivity(): PrescribedActivityDraft {
    return {
        ref: "run",
        type: "running",
        position: 1,
        running: {
            runTags: ["intervals"],
            overallTargets: { distanceMMin: "5000", distanceMMax: "5000" },
            steps: [
                {
                    ref: "warm",
                    type: "warm_up",
                    position: 0,
                    targets: { durationMsMin: 600000, durationMsMax: 600000 },
                },
                { ref: "rep", type: "repeat", position: 1, repeatCount: 4 },
                {
                    ref: "work",
                    type: "work",
                    position: 0,
                    parentStepRef: "rep",
                    targets: { distanceMMin: "400", distanceMMax: "400" },
                },
                {
                    ref: "rec",
                    type: "recovery",
                    position: 1,
                    parentStepRef: "rep",
                    targets: { durationMsMin: 90000, durationMsMax: 90000 },
                },
            ],
        },
    };
}

function publish(draft: PublishPrescriptionDraft) {
    return SessionPrescription.publishDraft(draft, counterMinter(), now).state;
}

describe("SessionPrescription domain — publish", () => {
    it("publishes a strength tree with minted row IDs, logical keys, and embedded snapshot", () => {
        const state = publish({ kind: "template", activities: [strengthActivity()] });
        expect(state.kind).toBe("template");
        expect(state.schemaVersion).toBe(1);
        expect(state.createdAt).toBe("2026-07-29T10:00:00.000Z");
        const activity = state.activities[0]!;
        expect(activity.type).toBe("strength");
        expect(activity.id).toMatch(/^11111111/);
        expect(activity.logicalKey).toMatch(/^22222222/);
        const exercise = activity.strength!.exercises[0]!;
        expect(exercise.exerciseId).toBe(EXERCISE_A);
        expect(exercise.snapshot.name).toBe("Back Squat");
        expect(exercise.sets.map(set => set.position)).toEqual([0, 1]);
        expect(exercise.sets[1]!.targets.percent1rm).toBe("80");
    });

    it("canonicalizes decimal targets and keeps null distinct from zero", () => {
        const state = publish({
            kind: "template",
            activities: [
                strengthActivity({
                    strength: {
                        exercises: [
                            {
                                ref: "e1",
                                exerciseId: EXERCISE_A,
                                snapshot: snapshot(EXERCISE_A),
                                position: 0,
                                sets: [
                                    {
                                        ref: "s1",
                                        position: 0,
                                        setType: "working",
                                        targets: { loadKgMin: "100.500", loadKgMax: "120" },
                                    },
                                ],
                            },
                        ],
                    },
                }),
            ],
        });
        const targets = state.activities[0]!.strength!.exercises[0]!.sets[0]!.targets;
        expect(targets.loadKgMin).toBe("100.5");
        expect(targets.loadKgMax).toBe("120");
        expect(targets.repsMin).toBeNull();
    });

    it("wires superset group membership and set→group references by logical key", () => {
        const state = publish({ kind: "template", activities: [supersetActivity()] });
        const strength = state.activities[0]!.strength!;
        const group = strength.setGroups[0]!;
        const exerciseKeys = strength.exercises.map(exercise => exercise.logicalKey);
        expect(group.members.map(member => member.exerciseLogicalKey)).toEqual(exerciseKeys);
        for (const exercise of strength.exercises) expect(exercise.sets[0]!.setGroupLogicalKey).toBe(group.logicalKey);
    });

    it("publishes a mixed strength + running tree with hierarchical run steps", () => {
        const state = publish({ kind: "template", activities: [strengthActivity(), runningActivity()] });
        expect(state.activities.map(activity => activity.type)).toEqual(["strength", "running"]);
        const running = state.activities[1]!.running!;
        const repeat = running.steps.find(step => step.type === "repeat")!;
        const children = running.steps.filter(step => step.parentStepLogicalKey === repeat.logicalKey);
        expect(children.map(step => step.type)).toEqual(["work", "recovery"]);
        expect(repeat.repeatCount).toBe(4);
    });

    it("freezes published state against external mutation", () => {
        const prescription = SessionPrescription.publishDraft(
            { kind: "template", activities: [strengthActivity()] },
            counterMinter(),
            now,
        );
        const first = prescription.state;
        (first.activities as unknown as unknown[]).length = 0;
        expect(prescription.state.activities).toHaveLength(1);
    });
});

describe("SessionPrescription domain — edit republish", () => {
    it("preserves retained logical keys, mints new ones, and drops removed elements", () => {
        const original = publish({ kind: "template", activities: [supersetActivity()] });
        const draft = draftFromState(original);
        const strength = draft.activities[0]!.strength!;
        // Remove the second exercise + its set and membership, add a fresh third exercise.
        const edited: PublishPrescriptionDraft = {
            ...draft,
            activities: [
                {
                    ...draft.activities[0]!,
                    strength: {
                        exercises: [
                            strength.exercises[0]!,
                            {
                                ref: "e3",
                                exerciseId: EXERCISE_B,
                                snapshot: snapshot(EXERCISE_B, "Row"),
                                position: 1,
                                sets: [
                                    {
                                        ref: "s3",
                                        position: 0,
                                        setType: "working",
                                        targets: { repsMin: 10, repsMax: 10 },
                                    },
                                ],
                            },
                        ],
                        setGroups: [
                            {
                                ...strength.setGroups![0]!,
                                members: [{ exerciseRef: strength.exercises[0]!.ref, position: 0 }],
                            },
                        ],
                    },
                },
            ],
        };
        const republished = SessionPrescription.publishDraft(edited, counterMinter("b"), now).state;
        const originalKeys = collectLogicalKeys(original);
        const newStrength = republished.activities[0]!.strength!;
        // Retained exercise keeps logical key but gets a fresh row ID.
        expect(newStrength.exercises[0]!.logicalKey).toBe(strength.exercises[0]!.logicalKey);
        expect(newStrength.exercises[0]!.id).not.toBe(originalKeys.get(strength.exercises[0]!.logicalKey!)!.rowId);
        // New exercise gets a brand-new logical key.
        expect(originalKeys.has(newStrength.exercises[1]!.logicalKey)).toBe(false);
        // Removed exercise's logical key is gone from the new tree.
        const newKeys = collectLogicalKeys(republished);
        expect(newKeys.has(original.activities[0]!.strength!.exercises[1]!.logicalKey)).toBe(false);
    });
});

describe("SessionPrescription domain — clone", () => {
    it("clones template → planned with fresh logical keys and full source lineage", () => {
        const template = publish({ kind: "template", activities: [supersetActivity()] });
        const planned = SessionPrescription.rehydrate(template).cloneForOwner(
            { targetKind: "planned", preserveLogicalKeys: false },
            counterMinter("a"),
            now,
        ).state;
        expect(planned.kind).toBe("planned");
        expect(planned.sourcePrescriptionId).toBe(template.id);
        expect(planned.sourceKind).toBe("template");
        const templateExercise = template.activities[0]!.strength!.exercises[0]!;
        const plannedExercise = planned.activities[0]!.strength!.exercises[0]!;
        expect(plannedExercise.logicalKey).not.toBe(templateExercise.logicalKey);
        expect(plannedExercise.sourceLogicalKey).toBe(templateExercise.logicalKey);
        expect(plannedExercise.sourceRowId).toBe(templateExercise.id);
        // Group membership + set→group references remap consistently to the new keys.
        const plannedGroup = planned.activities[0]!.strength!.setGroups[0]!;
        expect(plannedGroup.members.map(member => member.exerciseLogicalKey)).toEqual(
            planned.activities[0]!.strength!.exercises.map(exercise => exercise.logicalKey),
        );
        expect(plannedExercise.sets[0]!.setGroupLogicalKey).toBe(plannedGroup.logicalKey);
    });

    it("clones planned → resolved_execution preserving logical keys", () => {
        const planned = publish({ kind: "planned", activities: [strengthActivity()] });
        const resolved = SessionPrescription.rehydrate(planned).cloneForOwner(
            { targetKind: "resolved_execution", preserveLogicalKeys: true },
            counterMinter("a"),
            now,
        ).state;
        expect(resolved.kind).toBe("resolved_execution");
        const plannedExercise = planned.activities[0]!.strength!.exercises[0]!;
        const resolvedExercise = resolved.activities[0]!.strength!.exercises[0]!;
        expect(resolvedExercise.logicalKey).toBe(plannedExercise.logicalKey);
        expect(resolvedExercise.sourceRowId).toBe(plannedExercise.id);
        expect(resolvedExercise.id).not.toBe(plannedExercise.id);
    });

    it("round-trips a mixed tree through rehydrate", () => {
        const state = publish({ kind: "template", activities: [strengthActivity(), runningActivity()] });
        expect(SessionPrescription.rehydrate(state).state).toEqual(state);
    });
});

describe("SessionPrescription domain — invariants", () => {
    const expectRejection = (draft: PublishPrescriptionDraft) =>
        expect(() => publish(draft)).toThrow(DomainValidationError);

    it("rejects reversed target ranges", () => {
        expectRejection({
            kind: "template",
            activities: [
                strengthActivity({
                    strength: {
                        exercises: [
                            {
                                ref: "e1",
                                exerciseId: EXERCISE_A,
                                snapshot: snapshot(EXERCISE_A),
                                position: 0,
                                sets: [
                                    {
                                        ref: "s1",
                                        position: 0,
                                        setType: "working",
                                        targets: { repsMin: 10, repsMax: 5 },
                                    },
                                ],
                            },
                        ],
                    },
                }),
            ],
        });
    });

    it("rejects two contradictory load target modes", () => {
        expectRejection({
            kind: "template",
            activities: [
                strengthActivity({
                    strength: {
                        exercises: [
                            {
                                ref: "e1",
                                exerciseId: EXERCISE_A,
                                snapshot: snapshot(EXERCISE_A),
                                position: 0,
                                sets: [
                                    {
                                        ref: "s1",
                                        position: 0,
                                        setType: "working",
                                        targets: { loadKgMin: "100", percent1rm: "80" },
                                    },
                                ],
                            },
                        ],
                    },
                }),
            ],
        });
    });

    it("rejects non-contiguous positions", () => {
        expectRejection({
            kind: "template",
            activities: [
                strengthActivity({
                    strength: {
                        exercises: [
                            {
                                ref: "e1",
                                exerciseId: EXERCISE_A,
                                snapshot: snapshot(EXERCISE_A),
                                position: 0,
                                sets: [
                                    { ref: "s1", position: 0, setType: "working" },
                                    { ref: "s2", position: 2, setType: "working" },
                                ],
                            },
                        ],
                    },
                }),
            ],
        });
    });

    it("rejects a strength activity that also carries running detail (via rehydrate)", () => {
        const base = publish({ kind: "template", activities: [strengthActivity(), runningActivity()] });
        const corrupt = {
            ...base,
            activities: [{ ...base.activities[0]!, running: base.activities[1]!.running }, base.activities[1]!],
        };
        expect(() => SessionPrescription.rehydrate(corrupt)).toThrow(DomainValidationError);
    });

    it("rejects a set group member from another activity", () => {
        expect(() =>
            publish({
                kind: "template",
                activities: [
                    {
                        ref: "a1",
                        type: "strength",
                        position: 0,
                        strength: {
                            exercises: [
                                {
                                    ref: "e1",
                                    exerciseId: EXERCISE_A,
                                    snapshot: snapshot(EXERCISE_A),
                                    position: 0,
                                    sets: [],
                                },
                            ],
                            setGroups: [
                                {
                                    ref: "g1",
                                    type: "superset",
                                    position: 0,
                                    members: [{ exerciseRef: "missing", position: 0 }],
                                },
                            ],
                        },
                    },
                ],
            }),
        ).toThrow(DomainValidationError);
    });

    it("rejects a cyclic set group hierarchy", () => {
        // Two groups referencing each other as parents cannot be expressed via refs before minting,
        // so assert acyclicity through rehydrate of a hand-built cyclic state.
        const base = publish({ kind: "template", activities: [supersetActivity()] });
        const group = base.activities[0]!.strength!.setGroups[0]!;
        const cyclic = {
            ...base,
            activities: [
                {
                    ...base.activities[0]!,
                    strength: {
                        ...base.activities[0]!.strength!,
                        setGroups: [{ ...group, parentGroupLogicalKey: group.logicalKey }],
                    },
                },
            ],
        };
        expect(() => SessionPrescription.rehydrate(cyclic)).toThrow(DomainValidationError);
    });

    it("rejects a repeat run step without a repeat count", () => {
        expectRejection({
            kind: "template",
            activities: [
                {
                    ref: "run",
                    type: "running",
                    position: 0,
                    running: { runTags: ["x"], steps: [{ ref: "r", type: "repeat", position: 0 }] },
                },
            ],
        });
    });

    it("rejects duplicate logical keys via rehydrate", () => {
        const base = publish({ kind: "template", activities: [strengthActivity()] });
        const exercise = base.activities[0]!.strength!.exercises[0]!;
        const duplicated = {
            ...base,
            activities: [
                {
                    ...base.activities[0]!,
                    logicalKey: exercise.logicalKey,
                },
            ],
        };
        expect(() => SessionPrescription.rehydrate(duplicated)).toThrow(DomainValidationError);
    });
});
