import { describe, expect, it } from "vitest";

import type { ActiveTrainingSessionResponse } from "@kinetix/types";

import {
    buildActivityGrids,
    buildOccurrenceGrids,
    describeTarget,
    recordSetRequestFrom,
    relationForStatus,
} from "@/lib/active-session";

const ACTIVITY = "0198a4db-d8da-7000-8000-0000000000a0";

const OCCURRENCE = "0198a4db-d8da-7000-8000-000000000001";
const PRESCRIBED_EXERCISE = "0198a4db-d8da-7000-8000-000000000002";
const PRESCRIBED_SET = "0198a4db-d8da-7000-8000-000000000003";
const PERFORMED_SET = "0198a4db-d8da-7000-8000-000000000004";
const EXTRA_SET = "0198a4db-d8da-7000-8000-000000000005";

function targets(overrides: Record<string, unknown> = {}): never {
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
    } as never;
}

function view(): ActiveTrainingSessionResponse {
    return {
        activities: [
            {
                id: ACTIVITY,
                type: "strength",
                strength: {
                    occurrences: [
                        {
                            id: OCCURRENCE,
                            snapshot: { name: "Back Squat", repetitionSemantics: "total" },
                            performedSets: [
                                { id: PERFORMED_SET, status: "completed", measurements: {} },
                                { id: EXTRA_SET, status: "added", measurements: {} },
                            ],
                        },
                    ],
                },
            },
        ],
        occurrenceMappings: [{ occurrenceId: OCCURRENCE, prescribedExerciseId: PRESCRIBED_EXERCISE }],
        setMappings: [{ performedSetId: PERFORMED_SET, prescribedSetId: PRESCRIBED_SET, relation: "matched" }],
        plans: [
            {
                prescription: {
                    activities: [
                        {
                            type: "strength",
                            strength: {
                                exercises: [
                                    {
                                        id: PRESCRIBED_EXERCISE,
                                        sets: [
                                            {
                                                id: PRESCRIBED_SET,
                                                targets: targets({
                                                    repsMin: 5,
                                                    repsMax: 5,
                                                    loadKgMin: "100",
                                                    loadKgMax: "100",
                                                }),
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        ],
    } as unknown as ActiveTrainingSessionResponse;
}

describe("describeTarget", () => {
    it("formats reps × load", () => {
        expect(describeTarget(targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" }))).toBe(
            "5 × 100 kg",
        );
    });

    it("formats a range and percentage", () => {
        expect(describeTarget(targets({ repsMin: 3, repsMax: 5, percent1rm: "80" }))).toBe("3–5 reps · 80% 1RM");
    });

    it("returns null when nothing is prescribed", () => {
        expect(describeTarget(targets())).toBeNull();
    });
});

describe("buildOccurrenceGrids", () => {
    it("joins prescribed sets to their performed matches and lists extra work", () => {
        const grids = buildOccurrenceGrids(view());
        expect(grids).toHaveLength(1);
        const rows = grids[0]!.rows;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            prescribedSetId: PRESCRIBED_SET,
            prescribedLabel: "5 × 100 kg",
            relation: "matched",
        });
        expect(rows[0]!.performedSet?.id).toBe(PERFORMED_SET);
        expect(rows[1]).toMatchObject({ prescribedSetId: null });
        expect(rows[1]!.performedSet?.id).toBe(EXTRA_SET);
        expect(grids[0]!.activityId).toBe(ACTIVITY);
    });

    it("groups occurrence grids under their activity", () => {
        const groups = buildActivityGrids(view());
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ activityId: ACTIVITY });
        expect(groups[0]!.occurrences).toHaveLength(1);
    });
});

describe("recordSetRequestFrom / relationForStatus", () => {
    it("maps a completed prescribed set to a matched mapping with measurements", () => {
        const request = recordSetRequestFrom({
            activityId: "a",
            occurrenceId: OCCURRENCE,
            setId: PERFORMED_SET,
            position: 0,
            prescribedSetId: PRESCRIBED_SET,
            values: { reps: "5", loadKg: "100", rpe: "8", status: "completed" },
        });
        expect(request.set.measurements).toEqual({ reps: 5, externalLoad: { value: 100, unit: "kg" }, rpe: 8 });
        expect(request.mapping).toEqual({ prescribedSetId: PRESCRIBED_SET, relation: "matched" });
    });

    it("maps unplanned work to an added relation and partial/skipped to partial", () => {
        expect(relationForStatus("completed", false)).toBe("added");
        expect(relationForStatus("completed", true)).toBe("matched");
        expect(relationForStatus("partial", true)).toBe("partial");
        expect(relationForStatus("skipped", true)).toBe("partial");
    });
});
