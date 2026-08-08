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

const commitId = "0198a4db-d8da-7000-8000-0000000000e1";

function commitResponse(overrides: Record<string, unknown> = {}) {
    return {
        commitId,
        dryRunId,
        importBatchId: "0198a4db-d8da-7000-8000-0000000000e2",
        state: "succeeded",
        mode: "create",
        source: { namespace: "coach-app", generatedBy: null },
        programs: 1,
        completedSessions: 1,
        counts: { created: 4, updated: 0, skipped: 0, conflicted: 0 },
        entities: [
            { entityType: "training-session", externalId: "ts-1", entityId: "0198a4db-d8da-7000-8000-0000000000a1" },
        ],
        createdExercises: [],
        affectedVersions: [],
        warnings: [],
        failure: null,
        createdAt: "2026-08-08T10:00:00.000Z",
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:01.000Z",
        ...overrides,
    };
}

describe("kin training imports commit", () => {
    it("POSTs the dry-run id + token to the commit endpoint and prints a counts summary", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(commitResponse()));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "imports",
            "commit",
            "--dry-run-id",
            dryRunId,
            "--approval-token",
            "tok-1",
            "--idempotency-key",
            "abc-123",
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain("/training/imports/commits");
        expect(init?.method).toBe("POST");
        expect((init?.headers as Headers).get("idempotency-key")).toBe("abc-123");
        expect(JSON.parse(String(init?.body))).toEqual({ dryRunId, approvalToken: "tok-1" });
        expect(output).toHaveBeenCalledWith(`${commitId}\tsucceeded\tprograms=1\tsessions=1`);
        expect(output).toHaveBeenCalledWith("counts\tcreated=4\tupdated=0\tskipped=0\tconflicted=0");
    });

    it("reads a commit status by id and prints a failure line for a failed run", async () => {
        const output = vi.fn();
        const failed = commitResponse({
            state: "failed",
            completedAt: null,
            counts: { created: 2, updated: 0, skipped: 0, conflicted: 1 },
            failure: {
                path: ["completedSessions", 0],
                code: "EXTERNAL_ID_CONFLICT",
                message: "already exists",
                entityType: "training-session",
                externalId: "ts-1",
            },
        });
        const request = vi.fn(async () => Response.json(failed));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "imports", "commit-status", "--id", commitId]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/imports/commits/${commitId}`);
        expect(init?.method ?? "GET").toBe("GET");
        expect(output).toHaveBeenCalledWith("failure\tEXTERNAL_ID_CONFLICT\tcompletedSessions.0\talready exists");
    });

    it("resumes a commit run via the retry endpoint", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(commitResponse()));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "imports", "commit-retry", "--id", commitId]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/imports/commits/${commitId}/retries`);
        expect(init?.method).toBe("POST");
    });
});
