import { describe, expect, it } from "vitest";

import {
    ProgressionActionNotApplicableError,
    SessionPrescription,
    applyProgressionActions,
    isEvaluationStale,
    isResolved,
    planApproval,
    planRejection,
    type ActionV1,
    type IdMinter,
    type PublishPrescriptionDraft,
    type RuleScope,
    type RuleTarget,
    type SessionPrescriptionState,
} from "#src/modules/training/domain/index";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/exercise-definition";

const now = new Date("2026-08-02T09:00:00.000Z");
const EXERCISE = "0198a4db-d8da-7000-8000-000000000100";
const SCOPE: RuleScope = { type: "template", id: "0198a4db-d8da-7000-8000-0000000000f0" };

function makeMinter(seed = 0x1000): IdMinter {
    let counter = seed;
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

/** A template prescription with a single working set carrying reps + absolute load. */
function strengthTemplate(target: Record<string, unknown>): SessionPrescriptionState {
    const draft: PublishPrescriptionDraft = {
        kind: "template",
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

function runningTemplate(target: Record<string, unknown>): SessionPrescriptionState {
    const draft: PublishPrescriptionDraft = {
        kind: "template",
        activities: [
            {
                ref: "a",
                type: "running",
                position: 0,
                running: {
                    steps: [{ ref: "w", type: "work", position: 0, targets: target }],
                },
            },
        ],
    };
    return SessionPrescription.publishDraft(draft, makeMinter(), now).state;
}

const scopeTarget: RuleTarget = { mode: "template", selector: { kind: "scope" } };

function apply(state: SessionPrescriptionState, actions: readonly ActionV1[], target: RuleTarget = scopeTarget) {
    return applyProgressionActions({ prescription: state, scope: SCOPE, target, actions });
}

describe("progression approval state machine", () => {
    it("allows approving a pending, safe proposal", () => {
        expect(planApproval({ status: "pending", safetyOutcome: "pass" })).toEqual({ allowed: true });
    });

    it("allows approving a blocked (conflicting or requires-approval) proposal", () => {
        expect(planApproval({ status: "blocked", safetyOutcome: "requires_approval" })).toEqual({ allowed: true });
    });

    it("refuses approving a proposal whose fresh safety blocks it", () => {
        expect(planApproval({ status: "blocked", safetyOutcome: "block" })).toEqual({
            allowed: false,
            refusal: "safety_blocked",
        });
    });

    it("refuses approving an already-resolved proposal", () => {
        expect(planApproval({ status: "applied", safetyOutcome: "pass" })).toEqual({
            allowed: false,
            refusal: "already_resolved",
        });
        expect(planRejection({ status: "rejected" })).toEqual({ allowed: false, refusal: "already_resolved" });
    });

    it("refuses acting on a non-actionable (unmatched) proposal", () => {
        expect(planApproval({ status: "unmatched", safetyOutcome: "pass" })).toEqual({
            allowed: false,
            refusal: "not_actionable",
        });
        expect(planRejection({ status: "unmatched" })).toEqual({ allowed: false, refusal: "not_actionable" });
    });

    it("allows rejecting an actionable proposal and reports resolution", () => {
        expect(planRejection({ status: "pending" })).toEqual({ allowed: true });
        expect(isResolved("applied")).toBe(true);
        expect(isResolved("pending")).toBe(false);
    });
});

describe("evaluation staleness", () => {
    it("is fresh when every recorded context revision matches the current one", () => {
        expect(
            isEvaluationStale({ recordedContextRevisions: { session: 3 }, currentContextRevisions: { session: 3 } }),
        ).toBe(false);
    });

    it("is stale when a context revision moved", () => {
        expect(
            isEvaluationStale({ recordedContextRevisions: { session: 3 }, currentContextRevisions: { session: 4 } }),
        ).toBe(true);
    });

    it("is stale when a recorded context revision is missing from the current context", () => {
        expect(isEvaluationStale({ recordedContextRevisions: { session: 3 }, currentContextRevisions: {} })).toBe(true);
    });
});

describe("applying progression actions to a prescription", () => {
    const bumpLoadPercent = (value: number): ActionV1 => ({ type: "adjust_load", mode: "percent", value });
    const bumpLoadAbsolute = (value: number, unit: "kg" | "lb" = "kg"): ActionV1 => ({
        type: "adjust_load",
        mode: "absolute",
        value,
        unit,
    });

    it("scales an absolute load by a percentage, preserving the set's logical key", () => {
        const template = strengthTemplate({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" });
        const before = template.activities[0]!.strength!.exercises[0]!.sets[0]!;
        const result = apply(template, [bumpLoadPercent(5)]);
        const after = result.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!;

        expect(after.logicalKey).toBe(before.logicalKey);
        expect(after.targets.loadKgMin).toBe("105");
        expect(after.targets.loadKgMax).toBe("105");
        expect(result.applications[0]).toMatchObject({ actionType: "adjust_load", advisory: false });
        expect(result.applications[0]!.nodeChanges[0]).toMatchObject({
            nodeKind: "set",
            logicalKey: before.logicalKey,
        });
        expect(result.applications[0]!.nodeChanges[0]!.changes).toContainEqual({
            field: "loadKgMin",
            before: "100",
            after: "105",
        });
    });

    it("adds an absolute load delta and converts entered units", () => {
        const template = strengthTemplate({ loadKgMin: "100", loadKgMax: "100" });
        const result = apply(template, [bumpLoadAbsolute(10, "lb")]);
        const after = result.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!;
        // 10 lb ≈ 4.535 kg.
        expect(after.targets.loadKgMin).toBe("104.5359237");
    });

    it("clamps a load decrease at zero", () => {
        const template = strengthTemplate({ loadKgMin: "5", loadKgMax: "5" });
        const result = apply(template, [bumpLoadAbsolute(-50)]);
        const after = result.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(after.targets.loadKgMin).toBe("0");
    });

    it("scales a percent-of-1RM target when there is no absolute load", () => {
        const template = strengthTemplate({ repsMin: 5, repsMax: 5, percent1rm: "80" });
        const result = apply(template, [bumpLoadPercent(10)]);
        const after = result.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(after.targets.percent1rm).toBe("88");
    });

    it("adjusts reps and clamps at zero", () => {
        const template = strengthTemplate({ repsMin: 5, repsMax: 8 });
        const result = apply(template, [{ type: "adjust_reps", value: 2 }]);
        const after = result.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(after.targets.repsMin).toBe(7);
        expect(after.targets.repsMax).toBe(10);
    });

    it("sets an effort target", () => {
        const template = strengthTemplate({ repsMin: 5, repsMax: 5 });
        const result = apply(template, [{ type: "set_effort_target", rpe: 8 }]);
        const after = result.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(after.targets.rpeMin).toBe("8");
        expect(after.targets.rpeMax).toBe("8");
    });

    it("applies multiple actions in order (all-or-none)", () => {
        const template = strengthTemplate({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" });
        const result = apply(template, [
            bumpLoadPercent(10),
            { type: "adjust_reps", value: 1 },
            { type: "recommendation", messageTemplate: "Great work" },
        ]);
        const after = result.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(after.targets.loadKgMin).toBe("110");
        expect(after.targets.repsMin).toBe(6);
        expect(result.applications).toHaveLength(3);
        expect(result.applications[2]).toMatchObject({ actionType: "recommendation", advisory: true, nodeChanges: [] });
    });

    it("targets a single set by logical key", () => {
        const template = strengthTemplate({ loadKgMin: "100", loadKgMax: "100" });
        const setKey = template.activities[0]!.strength!.exercises[0]!.sets[0]!.logicalKey;
        const target: RuleTarget = { mode: "template", selector: { kind: "set", logicalKey: setKey } };
        const result = apply(template, [bumpLoadPercent(5)], target);
        expect(result.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!.targets.loadKgMin).toBe("105");
    });

    it("scales a running duration target by a percentage", () => {
        const template = runningTemplate({ durationMsMin: 600000, durationMsMax: 600000 });
        const result = apply(template, [{ type: "adjust_run_target", field: "duration", mode: "percent", value: 10 }]);
        const step = result.prescription.activities[0]!.running!.steps[0]!;
        expect(step.targets.durationMsMin).toBe(660000);
    });

    it("rejects a structural action rather than applying it partially", () => {
        const template = strengthTemplate({ loadKgMin: "100", loadKgMax: "100" });
        expect(() => apply(template, [{ type: "adjust_sets", value: 1 }])).toThrow(ProgressionActionNotApplicableError);
    });

    it("rejects an absolute run-target change (MVP supports percentage only)", () => {
        const template = runningTemplate({ durationMsMin: 600000, durationMsMax: 600000 });
        expect(() =>
            apply(template, [{ type: "adjust_run_target", field: "duration", mode: "absolute", value: 60 }]),
        ).toThrow(ProgressionActionNotApplicableError);
    });

    it("rejects a load change when no selected set carries a load target", () => {
        const template = strengthTemplate({ repsMin: 5, repsMax: 5 });
        expect(() => apply(template, [bumpLoadPercent(5)])).toThrow(ProgressionActionNotApplicableError);
    });

    it("rejects a selector pointing at a missing node", () => {
        const template = strengthTemplate({ loadKgMin: "100", loadKgMax: "100" });
        const target: RuleTarget = {
            mode: "template",
            selector: { kind: "set", logicalKey: "0198a4db-d8da-7000-8000-000000009999" },
        };
        expect(() => apply(template, [bumpLoadPercent(5)], target)).toThrow(ProgressionActionNotApplicableError);
    });
});
