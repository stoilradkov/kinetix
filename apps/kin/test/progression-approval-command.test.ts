import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const evaluation = {
    id: "0198a4db-d8da-7000-8000-0000000060a1",
    ruleId: "0198a4db-d8da-7000-8000-0000000060a2",
    ruleVersion: 1,
    ruleName: "Progress bench",
    trainingSessionId: "0198a4db-d8da-7000-8000-0000000060a3",
    trainingSessionVersion: 2,
    trigger: "session_completed",
    scopeType: "template",
    scopeId: "0198a4db-d8da-7000-8000-0000000060a4",
    target: { mode: "template", selector: { kind: "scope" } },
    matched: true,
    status: "applied",
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
    contextRevisions: { session: 2 },
    contextFacts: {},
    contextFingerprint: "a".repeat(64),
    safety: { outcome: "requires_approval", findings: [], missingInputs: [] },
    conflict: { conflicting: false, ruleIds: [], fields: [] },
    autoApplyEligible: false,
    autoApplyReason: "Template changes always require approval",
    stale: false,
    decidedAt: "2026-08-10T09:00:00.000Z",
    decidedBy: "user",
    decisionReason: "Looks good",
    resultRevisions: [
        {
            entityType: "training.workout-template",
            entityId: "0198a4db-d8da-7000-8000-0000000060a4",
            version: 2,
            prescriptionId: "0198a4db-d8da-7000-8000-0000000060a5",
        },
    ],
    actions: [
        {
            position: 0,
            actionType: "adjust_load",
            action: { type: "adjust_load", mode: "percent", value: 5 },
            status: "applied",
        },
    ],
    evaluatedAt: "2026-08-10T08:00:00.000Z",
};

describe("kin training progression approve/reject", () => {
    it("lists pending proposals", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [{ ...evaluation, status: "pending" }] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "progression", "pending", "--limit", "10"]);

        const url = String(request.mock.calls[0]?.[0]);
        expect(url).toContain("/training/progression/evaluations?");
        expect(url).toContain("status=pending");
        expect(url).toContain("limit=10");
        expect(output).toHaveBeenCalled();
    });

    it("approves a proposal with a reason and idempotency key", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(evaluation));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "progression",
            "approve",
            evaluation.id,
            "--reason",
            "Looks good",
            "--idempotency-key",
            "key-1",
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(String(url)).toContain(`/training/progression/evaluations/${evaluation.id}/approve`);
        const requestInit = init as RequestInit;
        expect(requestInit.method).toBe("POST");
        expect(new Headers(requestInit.headers).get("idempotency-key")).toBe("key-1");
        expect(JSON.parse(String(requestInit.body))).toEqual({ reason: "Looks good" });
    });

    it("rejects a proposal", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...evaluation, status: "rejected", resultRevisions: [] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "progression",
            "reject",
            evaluation.id,
            "--reason",
            "Not now",
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(String(url)).toContain(`/training/progression/evaluations/${evaluation.id}/reject`);
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({ reason: "Not now" });
    });
});
