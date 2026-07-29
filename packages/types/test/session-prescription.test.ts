import { describe, expect, it } from "vitest";

import {
    clonePrescriptionRequestSchema,
    publishPrescriptionRequestSchema,
    sessionPrescriptionResponseSchema,
} from "#src/index";

const EXERCISE_A = "0198a4db-d8da-7000-8000-0000000000a1";
const EQUIPMENT_ID = "0198a4db-d8da-7000-8000-0000000000b1";
const MOVEMENT_ID = "0198a4db-d8da-7000-8000-0000000000c1";

function snapshot() {
    return {
        schemaVersion: 1 as const,
        exerciseId: EXERCISE_A,
        exerciseVersion: 1,
        name: "Back Squat",
        equipmentTypeId: EQUIPMENT_ID,
        movementPatternId: MOVEMENT_ID,
        classification: "compound" as const,
        laterality: "bilateral" as const,
        bodyPosition: "standing",
        repetitionSemantics: "total" as const,
        loadModel: "external_only" as const,
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
    };
}

const mixedRequest = {
    kind: "template",
    activities: [
        {
            ref: "strength",
            type: "strength",
            position: 0,
            strength: {
                exercises: [
                    {
                        ref: "ex-a",
                        exerciseId: EXERCISE_A,
                        snapshot: snapshot(),
                        position: 0,
                        sets: [
                            {
                                ref: "sa",
                                position: 0,
                                setGroupRef: "grp",
                                setType: "working",
                                targets: { repsMin: 8, repsMax: 8 },
                            },
                        ],
                    },
                ],
                setGroups: [
                    { ref: "grp", type: "superset", position: 0, members: [{ exerciseRef: "ex-a", position: 0 }] },
                ],
            },
        },
        {
            ref: "run",
            type: "running",
            position: 1,
            running: {
                runTags: ["intervals"],
                steps: [
                    { ref: "rep", type: "repeat", position: 0, repeatCount: 4 },
                    {
                        ref: "work",
                        type: "work",
                        position: 0,
                        parentStepRef: "rep",
                        targets: { distanceMMin: "400", distanceMMax: "400" },
                    },
                ],
            },
        },
    ],
};

describe("session prescription contracts", () => {
    it("parses a mixed publish request with strength groups and running repeats", () => {
        const parsed = publishPrescriptionRequestSchema.parse(mixedRequest);
        expect(parsed.activities).toHaveLength(2);
    });

    it("rejects a request that carries an infrastructure row id", () => {
        const withId = {
            ...mixedRequest,
            activities: [
                { ...mixedRequest.activities[0], id: "0198a4db-d8da-7000-8000-0000000000ff" },
                mixedRequest.activities[1],
            ],
        };
        expect(publishPrescriptionRequestSchema.safeParse(withId).success).toBe(false);
    });

    it("rejects a reversed target range", () => {
        const reversed = {
            kind: "template",
            activities: [
                {
                    ref: "s",
                    type: "strength",
                    position: 0,
                    strength: {
                        exercises: [
                            {
                                ref: "e",
                                exerciseId: EXERCISE_A,
                                snapshot: snapshot(),
                                position: 0,
                                sets: [
                                    { ref: "x", position: 0, setType: "working", targets: { repsMin: 10, repsMax: 5 } },
                                ],
                            },
                        ],
                    },
                },
            ],
        };
        expect(publishPrescriptionRequestSchema.safeParse(reversed).success).toBe(false);
    });

    it("rejects two contradictory load target modes", () => {
        const request = structuredClone(mixedRequest);
        (
            request.activities[0] as {
                strength: { exercises: Array<{ sets: Array<{ targets: Record<string, unknown> }> }> };
            }
        ).strength.exercises[0]!.sets[0]!.targets = {
            loadKgMin: "100",
            percent1rm: "80",
        };
        expect(publishPrescriptionRequestSchema.safeParse(request).success).toBe(false);
    });

    it("parses a clone request", () => {
        expect(
            clonePrescriptionRequestSchema.parse({
                sourcePrescriptionId: "0198a4db-d8da-7000-8000-0000000000aa",
                targetKind: "planned",
            }).targetKind,
        ).toBe("planned");
    });

    it("validates a full published response tree with lineage fields", () => {
        const response = {
            id: "0198a4db-d8da-7000-8000-0000000000aa",
            kind: "planned",
            schemaVersion: 1,
            expectedDurationMs: null,
            notes: null,
            sourcePrescriptionId: "0198a4db-d8da-7000-8000-0000000000bb",
            sourceKind: "template",
            createdAt: "2026-07-29T10:00:00.000Z",
            activities: [
                {
                    id: "0198a4db-d8da-7000-8000-000000000101",
                    logicalKey: "0198a4db-d8da-7000-8000-000000000201",
                    sourceLogicalKey: "0198a4db-d8da-7000-8000-000000000301",
                    sourceRowId: "0198a4db-d8da-7000-8000-000000000401",
                    type: "running",
                    position: 0,
                    expectedDurationMs: null,
                    rpeTarget: null,
                    notes: null,
                    strength: null,
                    running: {
                        runTags: ["easy"],
                        overallTargets: {},
                        steps: [
                            {
                                id: "0198a4db-d8da-7000-8000-000000000102",
                                logicalKey: "0198a4db-d8da-7000-8000-000000000202",
                                sourceLogicalKey: null,
                                sourceRowId: null,
                                parentStepLogicalKey: null,
                                type: "warm_up",
                                position: 0,
                                repeatCount: null,
                                targets: {},
                                notes: null,
                            },
                        ],
                    },
                },
            ],
        };
        expect(sessionPrescriptionResponseSchema.parse(response).activities[0]!.type).toBe("running");
    });
});
