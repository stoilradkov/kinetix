import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const sessionId = "0198a4db-d8da-7000-8000-00000000e001";

const result = {
    id: "0198a4db-d8da-7000-8000-00000000e010",
    trainingSessionId: sessionId,
    trainingSessionVersion: 2,
    plannedSessionId: "0198a4db-d8da-7000-8000-00000000e020",
    sourcePrescriptionId: "0198a4db-d8da-7000-8000-00000000e021",
    resolvedPrescriptionId: "0198a4db-d8da-7000-8000-00000000e022",
    formula: "adherence.overall.v1",
    scope: "strength",
    overall: 92.5,
    sourceFingerprint: "a".repeat(64),
    components: [
        {
            key: "reps",
            scope: "strength",
            score: 80,
            weight: 20,
            included: true,
            exclusion: null,
            inputs: { actualTotal: 8 },
        },
        {
            key: "load",
            scope: "strength",
            score: null,
            weight: 15,
            included: false,
            exclusion: "missing_target",
            inputs: {},
        },
    ],
    exclusions: ["missing_target"],
    calculatedAt: "2026-08-09T09:00:00.000Z",
    status: "stale",
    plannedSessionTitle: "Week 1 · Lower A",
};

describe("kin training adherence", () => {
    it("shows a session's results with status, overall, and component lines", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ trainingSessionId: sessionId, results: [result] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "adherence", "session", sessionId]);

        expect(request.mock.calls[0]?.[0]).toContain(`/training/sessions/${sessionId}/adherence`);
        expect(output.mock.calls[0]?.[0]).toContain("status=stale");
        expect(output.mock.calls[0]?.[0]).toContain("overall=92.5");
        expect(output.mock.calls.some(call => String(call[0]).includes("component\treps"))).toBe(true);
        // Evidence is hidden unless --evidence is passed.
        expect(output.mock.calls.some(call => String(call[0]).includes("inputs="))).toBe(false);
    });

    it("includes evidence inputs when --evidence is passed", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ trainingSessionId: sessionId, results: [result] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "adherence", "session", sessionId, "--evidence"]);

        expect(output.mock.calls.some(call => String(call[0]).includes('inputs={"actualTotal":8}'))).toBe(true);
    });

    it("queries across scopes with filters and prints the next cursor", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [result], nextCursor: "CURSOR2" }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "adherence",
            "list",
            "--limit",
            "10",
            "--program",
            "0198a4db-d8da-7000-8000-00000000e099",
            "--scope",
            "strength",
            "--from",
            "2026-08-01",
        ]);

        const url = request.mock.calls[0]?.[0] as string;
        expect(url).toContain("/training/adherence?");
        expect(url).toContain("limit=10");
        expect(url).toContain("programId=0198a4db-d8da-7000-8000-00000000e099");
        expect(url).toContain("scope=strength");
        expect(url).toContain("from=2026-08-01");
        expect(output).toHaveBeenCalledWith("next-cursor\tCURSOR2");
    });

    it("emits JSON when --json is passed", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [result], nextCursor: null }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "adherence", "list", "--json"]);

        expect(output).toHaveBeenCalledTimes(1);
        expect(JSON.parse(output.mock.calls[0]?.[0] as string).items[0].overall).toBe(92.5);
    });

    it("shows the versioned formula metadata with component weights", async () => {
        const output = vi.fn();
        const request = vi.fn(async () =>
            Response.json({
                schemaVersion: 1,
                formula: "adherence.overall.v1",
                scoring: "100 inside the range; otherwise a linear penalty to the nearest boundary.",
                strengthComponents: [{ key: "reps", scope: "strength", weight: 20, label: "Repetitions" }],
                runningComponents: [{ key: "distance", scope: "running", weight: 25, label: "Distance" }],
            }),
        );
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "adherence", "formula"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/adherence/formula");
        expect(output.mock.calls.some(call => String(call[0]).includes("formula\tadherence.overall.v1"))).toBe(true);
        expect(output.mock.calls.some(call => String(call[0]).includes("Repetitions"))).toBe(true);
    });

    it("forces a recompute via POST", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ trainingSessionId: sessionId, results: [result] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "adherence",
            "recalculate",
            sessionId,
            "--idempotency-key",
            "key-1",
            "--source",
            "system",
        ]);

        const init = request.mock.calls[0]?.[1] as RequestInit;
        expect(request.mock.calls[0]?.[0]).toContain(`/training/sessions/${sessionId}/adherence/recalculate`);
        expect(init.method).toBe("POST");
        const headers = init.headers as Headers;
        expect(headers.get("idempotency-key")).toBe("key-1");
        expect(headers.get("x-kinetix-source")).toBe("system");
    });
});
