import { describe, expect, it } from "vitest";

import {
    assessSafety,
    autoApplyDecision,
    detectConflicts,
    increasesDemand,
    targetFieldKey,
    type ActionV1,
    type ConflictCandidate,
    type RuleScope,
    type RuleTarget,
    type SafetyContext,
    type SafetyPolicyConfig,
} from "#src/modules/training/domain/index";

const PROGRAM: RuleScope = { type: "program", id: "0198a4db-d8da-7000-8000-000000000003" };
const EXERCISE_A = "0198a4db-d8da-7000-8000-0000000000a1";
const EXERCISE_B = "0198a4db-d8da-7000-8000-0000000000b1";

const bumpLoadPercent = (value: number): ActionV1 => ({ type: "adjust_load", mode: "percent", value });
const bumpLoadAbsolute = (value: number): ActionV1 => ({ type: "adjust_load", mode: "absolute", value, unit: "kg" });
const addSets = (value: number): ActionV1 => ({ type: "adjust_sets", value });
const recommend: ActionV1 = { type: "recommendation", messageTemplate: "Nice work" };

function context(overrides: Partial<SafetyContext> = {}): SafetyContext {
    return {
        targetMode: "next",
        config: {},
        reportedPainSeverity: 0,
        painAreas: [],
        readiness: 4,
        sleepHours: null,
        recoveryIntervalHours: null,
        weeklyVolume: null,
        ...overrides,
    };
}

function config(overrides: SafetyPolicyConfig): SafetyContext {
    return context({ config: overrides });
}

describe("increasesDemand", () => {
    it("treats positive adjustments and structural changes as demand increases", () => {
        expect(increasesDemand(bumpLoadPercent(2.5))).toBe(true);
        expect(increasesDemand(addSets(1))).toBe(true);
        expect(increasesDemand({ type: "repeat_block" })).toBe(true);
        expect(increasesDemand({ type: "set_effort_target", rpe: 9 })).toBe(true);
    });

    it("does not treat reductions or advisory actions as demand increases", () => {
        expect(increasesDemand(bumpLoadPercent(-5))).toBe(false);
        expect(increasesDemand(addSets(-1))).toBe(false);
        expect(increasesDemand(recommend)).toBe(false);
        expect(increasesDemand({ type: "insert_deload" })).toBe(false);
    });
});

describe("assessSafety — max load increase", () => {
    it("blocks a percentage increase over the configured limit", () => {
        const assessment = assessSafety([bumpLoadPercent(10)], config({ maxLoadIncreasePercent: 5 }));
        expect(assessment.outcome).toBe("block");
        expect(assessment.findings.find(f => f.policyKey === "max_load_increase")).toMatchObject({
            outcome: "block",
            evidence: { proposedPercent: 10, limitPercent: 5 },
        });
    });

    it("passes a percentage increase at the boundary", () => {
        const assessment = assessSafety([bumpLoadPercent(5)], config({ maxLoadIncreasePercent: 5 }));
        expect(assessment.findings.find(f => f.policyKey === "max_load_increase")?.outcome).toBe("pass");
    });

    it("blocks an absolute increase over the configured limit", () => {
        const assessment = assessSafety([bumpLoadAbsolute(20)], config({ maxLoadIncreaseAbsolute: 10 }));
        expect(assessment.outcome).toBe("block");
    });

    it("does not engage when no load cap is configured", () => {
        const assessment = assessSafety([bumpLoadPercent(50)], context());
        expect(assessment.findings.find(f => f.policyKey === "max_load_increase")).toBeUndefined();
    });
});

describe("assessSafety — weekly volume", () => {
    it("requires approval when a cap is set but the baseline volume is unavailable", () => {
        const assessment = assessSafety([addSets(2)], config({ maxWeeklyVolumeIncreasePercent: 10 }));
        const finding = assessment.findings.find(f => f.policyKey === "max_weekly_volume_increase");
        expect(finding?.outcome).toBe("requires_approval");
        expect(finding?.missingInputs).toEqual(["weekly_volume"]);
    });

    it("passes when the baseline volume is available", () => {
        const assessment = assessSafety(
            [addSets(2)],
            context({ config: { maxWeeklyVolumeIncreasePercent: 10 }, weeklyVolume: 100 }),
        );
        expect(assessment.findings.find(f => f.policyKey === "max_weekly_volume_increase")?.outcome).toBe("pass");
    });
});

describe("assessSafety — recovery interval", () => {
    it("blocks when recovery is below the minimum", () => {
        const assessment = assessSafety(
            [bumpLoadPercent(2.5)],
            context({ config: { minRecoveryHours: 48 }, recoveryIntervalHours: 12 }),
        );
        expect(assessment.outcome).toBe("block");
    });

    it("requires approval when the recovery interval is unavailable", () => {
        const assessment = assessSafety([bumpLoadPercent(2.5)], config({ minRecoveryHours: 48 }));
        const finding = assessment.findings.find(f => f.policyKey === "min_recovery_interval");
        expect(finding).toMatchObject({ outcome: "requires_approval", missingInputs: ["recovery_interval_hours"] });
    });

    it("passes at the boundary", () => {
        const assessment = assessSafety(
            [bumpLoadPercent(2.5)],
            context({ config: { minRecoveryHours: 48 }, recoveryIntervalHours: 48 }),
        );
        expect(assessment.findings.find(f => f.policyKey === "min_recovery_interval")?.outcome).toBe("pass");
    });
});

describe("assessSafety — active pain", () => {
    it("blocks a demand increase when active pain is reported", () => {
        const assessment = assessSafety(
            [bumpLoadPercent(2.5)],
            context({
                reportedPainSeverity: 6,
                painAreas: [{ bodyArea: "left knee", severity: 6, onsetDuringSession: true, stoppedActivity: false }],
            }),
        );
        expect(assessment.outcome).toBe("block");
        expect(assessment.findings.find(f => f.policyKey === "active_pain")?.evidence).toMatchObject({
            severity: 6,
            areas: "left knee",
        });
    });

    it("passes when pain was assessed as absent", () => {
        const assessment = assessSafety([bumpLoadPercent(2.5)], context({ reportedPainSeverity: 0 }));
        expect(assessment.findings.find(f => f.policyKey === "active_pain")?.outcome).toBe("pass");
    });

    it("requires approval when no pain assessment exists", () => {
        const assessment = assessSafety([bumpLoadPercent(2.5)], context({ reportedPainSeverity: null }));
        expect(assessment.findings.find(f => f.policyKey === "active_pain")?.outcome).toBe("requires_approval");
    });

    it("does not engage for advisory-only actions", () => {
        const assessment = assessSafety([recommend], context({ reportedPainSeverity: 8 }));
        expect(assessment.findings.find(f => f.policyKey === "active_pain")).toBeUndefined();
    });
});

describe("assessSafety — readiness and sleep", () => {
    it("blocks when readiness is below the minimum", () => {
        const assessment = assessSafety([bumpLoadPercent(2.5)], context({ config: { minReadiness: 3 }, readiness: 2 }));
        expect(assessment.outcome).toBe("block");
    });

    it("blocks when sleep is below the minimum", () => {
        const assessment = assessSafety(
            [bumpLoadPercent(2.5)],
            context({ config: { minSleepHours: 7 }, sleepHours: 5 }),
        );
        expect(assessment.outcome).toBe("block");
    });

    it("requires approval when sleep is unavailable but a sleep minimum is configured", () => {
        const assessment = assessSafety([bumpLoadPercent(2.5)], config({ minSleepHours: 7 }));
        expect(assessment.findings.find(f => f.policyKey === "poor_sleep")?.missingInputs).toEqual(["sleep_hours"]);
    });
});

describe("assessSafety — missing inputs", () => {
    it("requires approval when readiness is unavailable for a demand increase", () => {
        const assessment = assessSafety([bumpLoadPercent(2.5)], context({ readiness: null }));
        const finding = assessment.findings.find(f => f.policyKey === "missing_inputs");
        expect(finding).toMatchObject({ outcome: "requires_approval", missingInputs: ["readiness"] });
        expect(assessment.missingInputs).toContain("readiness");
    });

    it("passes silently when baseline context is present", () => {
        const assessment = assessSafety([bumpLoadPercent(2.5)], context());
        expect(assessment.findings.find(f => f.policyKey === "missing_inputs")).toBeUndefined();
    });
});

describe("assessSafety — template prohibition", () => {
    it("requires approval for any template-targeted change", () => {
        const assessment = assessSafety([recommend], context({ targetMode: "template" }));
        expect(assessment.findings.find(f => f.policyKey === "template_auto_change_prohibition")?.outcome).toBe(
            "requires_approval",
        );
    });
});

describe("targetFieldKey", () => {
    const target: RuleTarget = { mode: "next", selector: { kind: "exercise", logicalKey: EXERCISE_A } };

    it("maps actions to their prescription field", () => {
        expect(targetFieldKey(PROGRAM, target, bumpLoadPercent(2.5))).toBe(`next|exercise:${EXERCISE_A}|load`);
        expect(targetFieldKey(PROGRAM, target, addSets(1))).toBe(`next|exercise:${EXERCISE_A}|sets`);
    });

    it("returns null for advisory actions", () => {
        expect(targetFieldKey(PROGRAM, target, recommend)).toBeNull();
    });
});

describe("detectConflicts", () => {
    const candidate = (
        ref: string,
        ruleId: string,
        logicalKey: string,
        actions: readonly ActionV1[],
    ): ConflictCandidate => ({
        ref,
        ruleId,
        scope: PROGRAM,
        target: { mode: "next", selector: { kind: "exercise", logicalKey } },
        actions,
    });

    it("flags two rules that write the same exercise load, symmetrically", () => {
        const results = detectConflicts([
            candidate("e1", "r1", EXERCISE_A, [bumpLoadPercent(2.5)]),
            candidate("e2", "r2", EXERCISE_A, [bumpLoadPercent(5)]),
        ]);
        expect(results[0]!.conflictsWith).toEqual(["e2"]);
        expect(results[1]!.conflictsWith).toEqual(["e1"]);
        expect(results[0]!.fields).toEqual([`next|exercise:${EXERCISE_A}|load`]);
    });

    it("does not conflict on different fields or different targets", () => {
        const results = detectConflicts([
            candidate("e1", "r1", EXERCISE_A, [bumpLoadPercent(2.5)]),
            candidate("e2", "r2", EXERCISE_A, [addSets(1)]),
            candidate("e3", "r3", EXERCISE_B, [bumpLoadPercent(2.5)]),
        ]);
        expect(results.every(r => r.conflictsWith.length === 0)).toBe(true);
    });

    it("does not conflict a rule with its own actions", () => {
        const results = detectConflicts([
            candidate("e1", "r1", EXERCISE_A, [bumpLoadPercent(2.5), bumpLoadPercent(5)]),
        ]);
        expect(results[0]!.conflictsWith).toEqual([]);
    });

    it("never conflicts advisory-only actions", () => {
        const results = detectConflicts([
            candidate("e1", "r1", EXERCISE_A, [recommend]),
            candidate("e2", "r2", EXERCISE_A, [recommend]),
        ]);
        expect(results.every(r => r.conflictsWith.length === 0)).toBe(true);
    });
});

describe("autoApplyDecision", () => {
    const base = {
        matched: true,
        autoApply: true,
        targetMode: "next" as const,
        safetyOutcome: "pass" as const,
        hasConflict: false,
    };

    it("is eligible only when every gate clears", () => {
        expect(autoApplyDecision(base)).toEqual({ eligible: true, reason: null });
    });

    it("is ineligible when not enabled, unsafe, conflicting, or template-targeted", () => {
        expect(autoApplyDecision({ ...base, autoApply: false }).eligible).toBe(false);
        expect(autoApplyDecision({ ...base, safetyOutcome: "block" }).eligible).toBe(false);
        expect(autoApplyDecision({ ...base, safetyOutcome: "requires_approval" }).eligible).toBe(false);
        expect(autoApplyDecision({ ...base, hasConflict: true }).eligible).toBe(false);
        expect(autoApplyDecision({ ...base, targetMode: "template" }).eligible).toBe(false);
        expect(autoApplyDecision({ ...base, matched: false }).eligible).toBe(false);
    });
});
