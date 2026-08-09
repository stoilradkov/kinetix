import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
    ProgressionSubjectUnavailableError,
    type EvaluateProgression,
    type ProgressionEvaluationRepository,
    type ProgressionEvaluationView,
} from "#src/modules/training/application/index";
import { ProgressionEvaluationController } from "#src/modules/training/presentation/index";
import type { ProfileReader } from "#src/modules/profile/index";

const ids = {
    evaluation: "0198a4db-d8da-7000-8000-000000000f01",
    rule: "0198a4db-d8da-7000-8000-000000000f02",
    session: "0198a4db-d8da-7000-8000-000000000f03",
    scope: "0198a4db-d8da-7000-8000-000000000f04",
    profile: "0198a4db-d8da-7000-8000-000000000f05",
};

function view(overrides: Partial<ProgressionEvaluationView> = {}): ProgressionEvaluationView {
    return {
        id: ids.evaluation,
        profileId: ids.profile,
        ruleId: ids.rule,
        ruleVersion: 1,
        ruleName: "Progress on low RPE",
        trainingSessionId: ids.session,
        trainingSessionVersion: 1,
        trigger: "manual",
        scopeType: "program",
        scopeId: ids.scope,
        target: { mode: "next", selector: { kind: "scope" } },
        matched: true,
        status: "pending",
        explanation: {
            kind: "metric",
            matched: true,
            metricKey: "rpe",
            canonicalKey: "rpe|session|w:-|f:-",
            operator: "lte",
            comparand: 8,
            observed: 7,
            missing: false,
            sourceRevision: 1,
        },
        missingMetrics: [],
        contextRevisions: { session: 1 },
        contextFacts: { "rpe|session|w:-|f:-": { value: 7, sourceRevision: 1 } },
        contextFingerprint: "a".repeat(64),
        safety: { outcome: "pass", findings: [], missingInputs: [] },
        conflict: { conflicting: false, ruleIds: [], fields: [] },
        autoApplyEligible: false,
        autoApplyReason: "Rule is not enabled for automatic application",
        actions: [
            {
                position: 0,
                actionType: "adjust_load",
                action: { type: "adjust_load", mode: "percent", value: 2.5 },
                status: "proposed",
            },
        ],
        evaluatedAt: new Date("2026-08-09T10:00:00.000Z"),
        ...overrides,
    };
}

function repository(overrides: Partial<ProgressionEvaluationRepository> = {}): ProgressionEvaluationRepository {
    return {
        existsByFingerprint: async () => false,
        insert: async () => view(),
        readById: async () => view(),
        listForSession: async () => [view()],
        listForProfile: async () => [view()],
        ...overrides,
    } as unknown as ProgressionEvaluationRepository;
}

const profiles = { requireActiveProfileId: async () => ids.profile } as unknown as ProfileReader;

function evaluator(results: readonly ProgressionEvaluationView[] = [view()]): EvaluateProgression {
    return { evaluateSession: async () => results } as unknown as EvaluateProgression;
}

describe("ProgressionEvaluationController", () => {
    it("evaluates a session and returns the recorded evaluations", async () => {
        const controller = new ProgressionEvaluationController(evaluator(), repository(), profiles);
        const result = await controller.evaluateSession(ids.session, { trigger: "manual" }, undefined, undefined);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({ id: ids.evaluation, status: "pending", matched: true });
        expect(result.items[0]!.actions[0]).toMatchObject({ actionType: "adjust_load" });
    });

    it("maps a missing session to a 404", async () => {
        const throwing = {
            evaluateSession: async () => {
                throw new ProgressionSubjectUnavailableError(ids.session);
            },
        } as unknown as EvaluateProgression;
        const controller = new ProgressionEvaluationController(throwing, repository(), profiles);
        await expect(controller.evaluateSession(ids.session, {}, undefined, undefined)).rejects.toBeInstanceOf(
            HttpException,
        );
    });

    it("reads one evaluation and 404s an unknown id", async () => {
        const controller = new ProgressionEvaluationController(
            evaluator(),
            repository({ readById: async () => null }),
            profiles,
        );
        await expect(controller.detail(ids.evaluation)).rejects.toBeInstanceOf(HttpException);

        const found = new ProgressionEvaluationController(evaluator(), repository(), profiles);
        const detail = await found.detail(ids.evaluation);
        expect(detail.id).toBe(ids.evaluation);
    });

    it("lists the profile approval queue filtered by status", async () => {
        let captured: unknown;
        const controller = new ProgressionEvaluationController(
            evaluator(),
            repository({
                listForProfile: async filter => {
                    captured = filter;
                    return [view()];
                },
            }),
            profiles,
        );
        const result = await controller.list({ status: "pending" });
        expect(result.items).toHaveLength(1);
        expect(captured).toMatchObject({ profileId: ids.profile, status: "pending" });
    });

    it("rejects a non-UUID session id", async () => {
        const controller = new ProgressionEvaluationController(evaluator(), repository(), profiles);
        await expect(controller.evaluateSession("not-a-uuid", {}, undefined, undefined)).rejects.toBeTruthy();
    });

    it("exposes the safety, conflict, and auto-apply verdict on the response", async () => {
        const blocked = view({
            status: "blocked",
            safety: {
                outcome: "block",
                findings: [
                    {
                        policyKey: "max_load_increase",
                        outcome: "block",
                        message: "Proposed load increase of 20% exceeds the 5% limit",
                        evidence: { proposedPercent: 20, limitPercent: 5 },
                        missingInputs: [],
                    },
                ],
                missingInputs: [],
            },
            conflict: { conflicting: true, ruleIds: [ids.rule], fields: ["next|scope:program:" + ids.scope + "|load"] },
            autoApplyEligible: false,
            autoApplyReason: "A safety policy blocked the change",
        });
        const controller = new ProgressionEvaluationController(
            evaluator(),
            repository({ readById: async () => blocked }),
            profiles,
        );
        const detail = await controller.detail(ids.evaluation);
        expect(detail.safety.outcome).toBe("block");
        expect(detail.safety.findings[0]).toMatchObject({ policyKey: "max_load_increase", outcome: "block" });
        expect(detail.conflict).toMatchObject({ conflicting: true, ruleIds: [ids.rule] });
        expect(detail.autoApplyEligible).toBe(false);
        expect(detail.autoApplyReason).toBe("A safety policy blocked the change");
    });
});
