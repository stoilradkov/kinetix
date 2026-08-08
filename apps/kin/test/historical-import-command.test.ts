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
        programs: [],
        completedSessions: [],
        storagePlan: {
            namespace: "coach-app",
            mode: "create",
            entries: [],
            counts: { create: 3, update: 0, "skip-identical": 0, conflict: 0 },
            conflicts: [],
            hasConflicts: false,
        },
        summary: {
            programs: 0,
            completedSessions: 1,
            entities: 3,
            operations: { create: 3, update: 0, "skip-identical": 0, conflict: 0 },
            entityTypeCounts: [],
        },
        warnings: [],
        errors: [],
        mappings: [],
        proposedExercises: [],
        affectedVersions: [],
    };
}

const envelope = JSON.stringify({
    schemaVersion: 1,
    source: { namespace: "coach-app", payloadId: "archive-1", checksum: "a".repeat(64) },
    mode: "create",
    completedSessions: [
        {
            externalId: "ts-1",
            localDate: "2024-03-04",
            timeZone: "Europe/London",
            activities: [
                {
                    type: "strength",
                    externalId: "act-1",
                    position: 0,
                    strength: {
                        occurrences: [
                            {
                                externalId: "occ-1",
                                reference: { by: "id", exerciseId: "0198a4db-d8da-7000-8000-0000000000a1" },
                                position: 0,
                                performedSets: [
                                    { externalId: "set-1", position: 0, setType: "working", status: "completed" },
                                ],
                            },
                        ],
                    },
                },
            ],
        },
    ],
});

describe("kin training imports dry-run", () => {
    it("POSTs the historical envelope to the dry-run endpoint and prints a storage summary", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(dryRunResponse()));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "imports", "dry-run", "--input", envelope]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain("/training/imports/dry-runs");
        expect(init?.method).toBe("POST");
        expect(output).toHaveBeenCalledWith(
            `${dryRunId}\tready\tprograms=0\tsessions=1\texpires=2026-08-01T11:00:00.000Z`,
        );
        expect(output).toHaveBeenCalledWith("storage\tcreate=3\tupdate=0\tskip=0\tconflict=0");
    });

    it("emits raw JSON with --json and forwards the idempotency key", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(dryRunResponse()));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "imports",
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
                "imports",
                "dry-run",
                "--input",
                JSON.stringify({
                    schemaVersion: 2,
                    source: { namespace: "x", payloadId: "p", checksum: "a".repeat(64) },
                    mode: "create",
                    completedSessions: [],
                }),
            ]),
        ).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
    });
});
