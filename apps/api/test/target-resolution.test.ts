import { describe, expect, it } from "vitest";

import {
    MissingTrainingMaxError,
    SessionPrescription,
    resolveExecutionPrescription,
    type IdMinter,
    type PublishPrescriptionDraft,
    type SessionPrescriptionState,
    type TargetResolutionContext,
} from "#src/modules/training/domain/index";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/exercise-definition";

const now = new Date("2026-08-02T09:00:00.000Z");
const EXERCISE = "0198a4db-d8da-7000-8000-000000000100";

function makeMinter(): IdMinter {
    let counter = 0x1000;
    const next = () => {
        counter += 1;
        return `0198a4db-d8da-7000-8000-${counter.toString(16).padStart(12, "0")}`;
    };
    return { rowId: next, logicalKey: next };
}

function snapshot(): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId: EXERCISE,
        exerciseVersion: 1,
        name: "Back Squat",
        equipmentTypeId: "0198a4db-d8da-7000-8000-0000000000e1",
        movementPatternId: "0198a4db-d8da-7000-8000-0000000000e2",
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

function plannedWith(target: Record<string, unknown>): SessionPrescriptionState {
    const draft: PublishPrescriptionDraft = {
        kind: "planned",
        activities: [
            {
                ref: "a",
                type: "strength",
                position: 0,
                strength: {
                    exercises: [
                        {
                            ref: "e",
                            exerciseId: EXERCISE,
                            snapshot: snapshot(),
                            position: 0,
                            sets: [{ ref: "s", position: 0, setType: "working", targets: target }],
                        },
                    ],
                },
            },
        ],
    };
    return SessionPrescription.publishDraft(draft, makeMinter(), now).state;
}

const context: TargetResolutionContext = {
    resolveMax: () => ({
        trainingMaxId: "0198a4db-d8da-7000-8000-000000000200",
        maxType: "estimated_1rm",
        valueKg: "100",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
    }),
    roundLoad: ({ loadKg }) => ({
        valueKg: loadKg,
        incrementId: "0198a4db-d8da-7000-8000-000000000300",
        incrementScope: "exercise",
    }),
};

describe("target resolution", () => {
    it("returns no prescription when nothing needs resolving", () => {
        const result = resolveExecutionPrescription(
            plannedWith({ repsMin: 5, repsMax: 5 }),
            context,
            makeMinter(),
            now,
        );
        expect(result.prescription).toBeNull();
        expect(result.evidence).toHaveLength(0);
    });

    it("freezes a percent-of-1RM set into an absolute rounded load with evidence", () => {
        const planned = plannedWith({ repsMin: 5, repsMax: 5, percent1rm: "82.5" });
        const result = resolveExecutionPrescription(planned, context, makeMinter(), now);
        const resolved = result.prescription!.state;
        expect(resolved.kind).toBe("resolved_execution");
        expect(resolved.sourcePrescriptionId).toBe(planned.id);

        const set = resolved.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(set.targets.percent1rm).toBeNull();
        expect(set.targets.loadKgMin).toBe("82.5");
        expect(set.targets.loadKgMax).toBe("82.5");
        // Lineage back to the planned set survives the clone.
        const plannedSet = planned.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(set.sourceRowId).toBe(plannedSet.id);
        expect((set.targets.enteredTargets as { resolution?: unknown }).resolution).toMatchObject({
            basis: "estimated_1rm",
            percent: "82.5",
            maxValueKg: "100",
            resolvedLoadKg: "82.5",
            incrementScope: "exercise",
        });

        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0]).toMatchObject({ exerciseId: EXERCISE, percent: "82.5", resolvedLoadKg: "82.5" });
    });

    it("resolves percent of training max against the training_max basis", () => {
        const bases: string[] = [];
        const spyContext: TargetResolutionContext = {
            resolveMax: input => {
                bases.push(input.basis);
                return {
                    trainingMaxId: "0198a4db-d8da-7000-8000-000000000200",
                    maxType: input.basis,
                    valueKg: "120",
                    effectiveFrom: "2026-07-01T00:00:00.000Z",
                };
            },
            roundLoad: ({ loadKg }) => ({ valueKg: loadKg, incrementId: null, incrementScope: null }),
        };
        const result = resolveExecutionPrescription(
            plannedWith({ percentTrainingMax: "90" }),
            spyContext,
            makeMinter(),
            now,
        );
        expect(bases).toEqual(["training_max"]);
        expect(result.prescription!.state.activities[0]!.strength!.exercises[0]!.sets[0]!.targets.loadKgMin).toBe(
            "108",
        );
    });

    it("throws when the required max is missing", () => {
        const missing: TargetResolutionContext = {
            resolveMax: () => null,
            roundLoad: ({ loadKg }) => ({ valueKg: loadKg, incrementId: null, incrementScope: null }),
        };
        expect(() =>
            resolveExecutionPrescription(plannedWith({ percent1rm: "80" }), missing, makeMinter(), now),
        ).toThrow(MissingTrainingMaxError);
    });
});
