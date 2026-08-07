import { describe, expect, it } from "vitest";

import { DomainValidationError } from "#src/platform/domain/index";
import {
    TrainingSession,
    type ExerciseSnapshotV1,
    type SessionActivityInput,
    type SessionMappingsInput,
} from "#src/modules/training/domain/index";

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const now = new Date("2026-08-02T09:00:00.000Z");
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

const ACTIVITY = id(1);
const OCCURRENCE = id(2);
const SET = id(3);
const PLANNED = id(50);
const SOURCE_RX = id(51);
const RESOLVED_RX = id(52);
const PRESCRIBED_ACTIVITY = id(60);
const PRESCRIBED_EXERCISE = id(61);
const PRESCRIBED_SET = id(62);

function snapshot(exerciseId: string): ExerciseSnapshotV1 {
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
    };
}

const activity: SessionActivityInput = {
    id: ACTIVITY,
    type: "strength",
    position: 0,
    strength: {
        occurrences: [
            {
                id: OCCURRENCE,
                exerciseId: id(100),
                snapshot: snapshot(id(100)),
                position: 0,
                performedSets: [{ id: SET, position: 0, setType: "working", status: "completed" }],
            },
        ],
    },
};

function build(mappings: SessionMappingsInput): TrainingSession {
    return TrainingSession.create(
        { id: id(9), profileId: PROFILE, localDate: "2026-08-02", timeZone: "UTC", activities: [activity], mappings },
        now,
    );
}

const link = { plannedSessionId: PLANNED, sourcePrescriptionId: SOURCE_RX, resolvedPrescriptionId: RESOLVED_RX };

describe("session planned/actual mappings", () => {
    it("records a matched set mapping with a planned link", () => {
        const session = build({
            plannedLinks: [link],
            activityMappings: [
                {
                    id: id(70),
                    prescribedActivityId: PRESCRIBED_ACTIVITY,
                    actualActivityId: ACTIVITY,
                    relation: "matched",
                },
            ],
            occurrenceMappings: [
                {
                    id: id(71),
                    prescribedExerciseId: PRESCRIBED_EXERCISE,
                    occurrenceId: OCCURRENCE,
                    relation: "matched",
                },
            ],
            setMappings: [{ id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: SET, relation: "matched" }],
        });
        expect(session.state.plannedLinks).toEqual([link]);
        expect(session.state.setMappings[0]).toMatchObject({ relation: "matched", performedSetId: SET });
    });

    it("keeps substitution and reason provenance", () => {
        const session = build({
            plannedLinks: [link],
            occurrenceMappings: [
                {
                    id: id(71),
                    prescribedExerciseId: PRESCRIBED_EXERCISE,
                    occurrenceId: OCCURRENCE,
                    relation: "substituted",
                    reason: "Left knee pain",
                },
            ],
        });
        expect(session.state.occurrenceMappings[0]).toMatchObject({
            relation: "substituted",
            reason: "Left knee pain",
        });
    });

    it("allows an added mapping with no prescribed row", () => {
        const session = build({
            setMappings: [{ id: id(72), performedSetId: SET, relation: "added" }],
        });
        expect(session.state.setMappings[0]).toMatchObject({ relation: "added", prescribedSetId: null });
    });

    it("rejects an added mapping that names a prescribed row", () => {
        expect(() =>
            build({
                setMappings: [{ id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: SET, relation: "added" }],
            }),
        ).toThrow(DomainValidationError);
    });

    it("rejects a non-added mapping missing its prescribed row", () => {
        expect(() => build({ setMappings: [{ id: id(72), performedSetId: SET, relation: "matched" }] })).toThrow(
            DomainValidationError,
        );
    });

    it("rejects a mapping to an actual row outside the session", () => {
        expect(() =>
            build({
                setMappings: [
                    { id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: id(999), relation: "matched" },
                ],
            }),
        ).toThrow(/unknown performed set/i);
    });

    it("allows combined (many prescribed → one actual) but rejects a matched sharing that actual", () => {
        const combined = build({
            setMappings: [
                { id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: SET, relation: "combined" },
                { id: id(73), prescribedSetId: id(63), performedSetId: SET, relation: "combined" },
            ],
        });
        expect(combined.state.setMappings).toHaveLength(2);
        expect(() =>
            build({
                setMappings: [
                    { id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: SET, relation: "matched" },
                    { id: id(73), prescribedSetId: id(63), performedSetId: SET, relation: "combined" },
                ],
            }),
        ).toThrow(/combined/i);
    });

    it("rejects a prescribed row mapped to several actuals without split", () => {
        const activityTwoSets: SessionActivityInput = {
            ...activity,
            strength: {
                occurrences: [
                    {
                        id: OCCURRENCE,
                        exerciseId: id(100),
                        snapshot: snapshot(id(100)),
                        position: 0,
                        performedSets: [
                            { id: SET, position: 0, setType: "working", status: "completed" },
                            { id: id(4), position: 1, setType: "working", status: "completed" },
                        ],
                    },
                ],
            },
        };
        const create = (relation: "split" | "partial") =>
            TrainingSession.create(
                {
                    id: id(9),
                    profileId: PROFILE,
                    localDate: "2026-08-02",
                    timeZone: "UTC",
                    activities: [activityTwoSets],
                    mappings: {
                        setMappings: [
                            { id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: SET, relation },
                            { id: id(73), prescribedSetId: PRESCRIBED_SET, performedSetId: id(4), relation },
                        ],
                    },
                },
                now,
            );
        expect(create("split").state.setMappings).toHaveLength(2);
        expect(() => create("partial")).toThrow(/split/i);
    });

    it("maps performed run steps to prescribed run steps with split and combined cardinality (PRD R3/AC-1)", () => {
        const RUN_ACTIVITY = id(80);
        const RUN_STEP_A = id(81);
        const RUN_STEP_B = id(82);
        const PRESCRIBED_RUN_STEP = id(83);
        const PRESCRIBED_RUN_STEP_2 = id(84);
        const runActivity: SessionActivityInput = {
            id: RUN_ACTIVITY,
            type: "running",
            position: 0,
            running: {
                steps: [
                    { id: RUN_STEP_A, type: "work", position: 0 },
                    { id: RUN_STEP_B, type: "recovery", position: 1 },
                ],
            },
        };
        const buildRun = (mappings: SessionMappingsInput) =>
            TrainingSession.create(
                {
                    id: id(9),
                    profileId: PROFILE,
                    localDate: "2026-08-02",
                    timeZone: "UTC",
                    activities: [runActivity],
                    mappings,
                },
                now,
            );

        // One prescribed step split across two performed steps.
        const split = buildRun({
            runStepMappings: [
                {
                    id: id(90),
                    prescribedRunStepId: PRESCRIBED_RUN_STEP,
                    performedRunStepId: RUN_STEP_A,
                    relation: "split",
                },
                {
                    id: id(91),
                    prescribedRunStepId: PRESCRIBED_RUN_STEP,
                    performedRunStepId: RUN_STEP_B,
                    relation: "split",
                },
            ],
        });
        expect(split.state.runStepMappings).toHaveLength(2);

        // Two prescribed steps combined into one performed step.
        const combined = buildRun({
            runStepMappings: [
                {
                    id: id(92),
                    prescribedRunStepId: PRESCRIBED_RUN_STEP,
                    performedRunStepId: RUN_STEP_A,
                    relation: "combined",
                },
                {
                    id: id(93),
                    prescribedRunStepId: PRESCRIBED_RUN_STEP_2,
                    performedRunStepId: RUN_STEP_A,
                    relation: "combined",
                },
            ],
        });
        expect(combined.state.runStepMappings).toHaveLength(2);

        // A non-combined mapping may not share one performed step.
        expect(() =>
            buildRun({
                runStepMappings: [
                    {
                        id: id(94),
                        prescribedRunStepId: PRESCRIBED_RUN_STEP,
                        performedRunStepId: RUN_STEP_A,
                        relation: "matched",
                    },
                    {
                        id: id(95),
                        prescribedRunStepId: PRESCRIBED_RUN_STEP_2,
                        performedRunStepId: RUN_STEP_A,
                        relation: "combined",
                    },
                ],
            }),
        ).toThrow(/combined/i);

        // A mapping to a performed run step the session does not own is rejected.
        expect(() =>
            buildRun({
                runStepMappings: [
                    {
                        id: id(96),
                        prescribedRunStepId: PRESCRIBED_RUN_STEP,
                        performedRunStepId: id(999),
                        relation: "matched",
                    },
                ],
            }),
        ).toThrow(DomainValidationError);
    });

    it("rejects duplicate mapping ids", () => {
        expect(() =>
            build({
                setMappings: [
                    { id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: SET, relation: "matched" },
                ],
                activityMappings: [
                    {
                        id: id(72),
                        prescribedActivityId: PRESCRIBED_ACTIVITY,
                        actualActivityId: ACTIVITY,
                        relation: "matched",
                    },
                ],
            }),
        ).toThrow(/mapping id/i);
    });

    it("drops a mapping whose actual set an edit removes, without rejecting the edit", () => {
        const session = build({
            setMappings: [{ id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: SET, relation: "matched" }],
        });
        // Remove the performed set by replacing the activity's occurrence with no sets.
        const edited = session.update(
            {
                activities: [
                    {
                        id: ACTIVITY,
                        type: "strength",
                        position: 0,
                        strength: {
                            occurrences: [
                                { id: OCCURRENCE, exerciseId: id(100), snapshot: snapshot(id(100)), position: 0 },
                            ],
                        },
                    },
                ],
            },
            now,
        );
        expect(edited.state.setMappings).toHaveLength(0);
    });

    it("preserves planned links across a mapping edit", () => {
        const session = build({ plannedLinks: [link] });
        const edited = session.update(
            { mappings: { setMappings: [{ id: id(72), performedSetId: SET, relation: "added" }] } },
            now,
        );
        expect(edited.state.plannedLinks).toEqual([link]);
        expect(edited.state.setMappings).toHaveLength(1);
    });

    it("links a frozen prescription with no planned session (template/previous reference)", () => {
        const session = build({
            plannedLinks: [{ sourcePrescriptionId: SOURCE_RX, resolvedPrescriptionId: RESOLVED_RX }],
            setMappings: [{ id: id(72), prescribedSetId: PRESCRIBED_SET, performedSetId: SET, relation: "matched" }],
        });
        expect(session.state.plannedLinks[0]).toEqual({
            plannedSessionId: null,
            sourcePrescriptionId: SOURCE_RX,
            resolvedPrescriptionId: RESOLVED_RX,
        });
    });

    it("allows several reference links with no planned session", () => {
        const session = build({
            plannedLinks: [
                { sourcePrescriptionId: SOURCE_RX, resolvedPrescriptionId: RESOLVED_RX },
                { sourcePrescriptionId: id(80), resolvedPrescriptionId: id(81) },
            ],
        });
        expect(session.state.plannedLinks).toHaveLength(2);
    });
});
