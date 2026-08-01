import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const dryRunId = "0198a4db-d8da-7000-8000-0000000000d1";

function dryRunResponse() {
    return {
        dryRunId,
        approvalToken: "tok-1",
        referenceHash: "a".repeat(64),
        schemaVersion: 1,
        mode: "create",
        source: { namespace: "coach-app", generatedBy: null },
        state: "ready",
        createdAt: "2026-08-01T10:00:00.000Z",
        expiresAt: "2026-08-01T11:00:00.000Z",
        program: {
            id: "0198a4db-d8da-7000-8000-0000000000e1",
            externalId: "prog-1",
            profileId: "0198a4db-d8da-7000-8000-0000000000f1",
            name: "Spring Strength",
            description: null,
            scheduleMode: "ordered",
            startDate: null,
            endDate: null,
            focus: null,
            goalIds: [],
            blocks: [],
            sessions: [],
        },
        generatedSessionCount: 2,
        warnings: [],
        errors: [],
        mappings: [],
        proposedExercises: [],
        affectedVersions: [],
    };
}

const envelope = JSON.stringify({
    schemaVersion: 1,
    source: { namespace: "coach-app" },
    mode: "create",
    program: { name: "Spring Strength" },
});

describe("kin training programs dry-run", () => {
    it("POSTs the versioned envelope to the dry-run endpoint and prints a summary", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(dryRunResponse()));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "programs", "dry-run", "--input", envelope]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain("/training/bulk/programs/dry-runs");
        expect(init?.method).toBe("POST");
        expect(output).toHaveBeenCalledWith(`${dryRunId}\tready\tsessions=2\texpires=2026-08-01T11:00:00.000Z`);
    });

    it("emits raw JSON with --json and forwards the idempotency key", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(dryRunResponse()));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "programs",
            "dry-run",
            "--input",
            envelope,
            "--idempotency-key",
            "abc-123",
            "--json",
        ]);

        const [, init] = request.mock.calls[0]!;
        expect((init?.headers as Headers).get("idempotency-key")).toBe("abc-123");
        expect(output).toHaveBeenCalledWith(JSON.stringify(dryRunResponse()));
    });

    it("rejects an unsupported schema version before calling the API", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(dryRunResponse()));
        const program = createProgram({ fetch: request, output });

        await expect(
            program.parseAsync([
                "node",
                "kin",
                "training",
                "programs",
                "dry-run",
                "--input",
                JSON.stringify({
                    schemaVersion: 2,
                    source: { namespace: "x" },
                    mode: "create",
                    program: { name: "P" },
                }),
            ]),
        ).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
    });
});
