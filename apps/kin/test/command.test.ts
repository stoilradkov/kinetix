import { describe, expect, it, vi } from "vitest";

import { CliApiError, cliExitCode } from "#src/api-error";
import { createProgram } from "#src/command";

describe("kin", () => {
    it("prints local information", async () => {
        const output = vi.fn();
        const program = createProgram({ fetch, output });

        await program.parseAsync(["node", "kin", "info"]);

        expect(output).toHaveBeenCalledWith("Kinetix");
        expect(output).toHaveBeenCalledWith("API: http://localhost:3000/api/v1");
    });

    it("sends explicit version and idempotency headers when restoring history", async () => {
        const output = vi.fn();
        const request = vi.fn(async () =>
            Response.json({
                version: 4,
                etag: '"4"',
                resource: { name: "Original" },
            }),
        );
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "history",
            "restore",
            "program",
            "0198a4db-d8da-7000-8000-000000000001",
            "1",
            "--version",
            "3",
            "--idempotency-key",
            "restore-1",
            "--json",
        ]);

        expect(request).toHaveBeenCalledWith(
            expect.stringContaining("/history/program/0198a4db-d8da-7000-8000-000000000001/restore/1"),
            expect.objectContaining({
                method: "POST",
                headers: expect.any(Headers),
            }),
        );
        const init = request.mock.calls[0]?.[1];
        const headers = init?.headers as Headers;
        expect(headers.get("if-match")).toBe('"3"');
        expect(headers.get("idempotency-key")).toBe("restore-1");
        expect(output).toHaveBeenCalledWith(
            JSON.stringify({ version: 4, etag: '"4"', resource: { name: "Original" } }),
        );
    });

    it("maps machine-readable API failures to deterministic exit codes", () => {
        expect(
            cliExitCode(
                new CliApiError({
                    code: "VERSION_CONFLICT",
                    message: "stale",
                    correlationId: "request-1",
                }),
            ),
        ).toBe(5);
    });

    it("polls a durable job until it succeeds", async () => {
        const output = vi.fn();
        const request = vi
            .fn()
            .mockResolvedValueOnce(Response.json(jobResource("running")))
            .mockResolvedValueOnce(Response.json(jobResource("succeeded")));
        const sleep = vi.fn(async () => undefined);
        const program = createProgram({ fetch: request, output, sleep, now: () => 0 });

        await program.parseAsync([
            "node",
            "kin",
            "jobs",
            "status",
            "0198a4db-d8da-7000-8000-000000000001",
            "--wait",
            "--json",
        ]);

        expect(request).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(1_000);
        expect(output).toHaveBeenCalledWith(JSON.stringify(jobResource("succeeded")));
    });

    it("maps a terminal durable job to the JOB_FAILED exit code", async () => {
        const program = createProgram({
            fetch: vi.fn(async () => Response.json(jobResource("failed"))),
            output: vi.fn(),
        });

        const error = await program
            .parseAsync(["node", "kin", "jobs", "status", "0198a4db-d8da-7000-8000-000000000001"])
            .catch((failure: unknown) => failure);

        expect(error).toBeInstanceOf(CliApiError);
        expect(cliExitCode(error)).toBe(6);
    });

    it("sends non-interactive merge JSON with both expected versions and idempotency", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(mergeResource("applied")));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "exercises",
            "merge",
            "--canonical",
            ids.canonical,
            "--merged",
            ids.merged,
            "--canonical-version",
            "2",
            "--merged-version",
            "3",
            "--idempotency-key",
            "merge-1",
            "--reason",
            "Imported duplicate",
            "--json",
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain("/training/catalog/exercise-merges");
        expect(init?.method).toBe("POST");
        expect((init?.headers as Headers).get("idempotency-key")).toBe("merge-1");
        expect(JSON.parse(String(init?.body))).toEqual({
            canonicalExerciseId: ids.canonical,
            mergedExerciseId: ids.merged,
            expectedCanonicalVersion: 2,
            expectedMergedVersion: 3,
            reason: "Imported duplicate",
        });
        expect(output).toHaveBeenCalledWith(JSON.stringify(mergeResource("applied")));
    });

    it("requires all revert versions and sends the merge ETag", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(mergeResource("reverted")));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "exercises",
            "revert-merge",
            ids.merge,
            "--merge-version",
            "1",
            "--canonical-version",
            "2",
            "--merged-version",
            "4",
            "--idempotency-key",
            "revert-1",
            "--json",
        ]);

        const [, init] = request.mock.calls[0]!;
        const headers = init?.headers as Headers;
        expect(headers.get("if-match")).toBe('"1"');
        expect(headers.get("idempotency-key")).toBe("revert-1");
        expect(JSON.parse(String(init?.body))).toEqual({
            expectedCanonicalVersion: 2,
            expectedMergedVersion: 4,
        });
        expect(output).toHaveBeenCalledWith(JSON.stringify(mergeResource("reverted")));
    });
});

const ids = {
    canonical: "0198a4db-d8da-7000-8000-000000000011",
    merged: "0198a4db-d8da-7000-8000-000000000012",
    merge: "0198a4db-d8da-7000-8000-000000000013",
} as const;

function mergeResource(status: "applied" | "reverted") {
    return {
        schemaVersion: 1,
        id: ids.merge,
        status,
        version: status === "applied" ? 1 : 2,
        canonicalExercise: { id: ids.canonical, name: "Bench Press", version: 2 },
        mergedExercise: { id: ids.merged, name: "Imported Bench Press", version: 3 },
        mergedExerciseVersionAfterApply: 4,
        revertedCanonicalExerciseVersion: status === "reverted" ? 2 : null,
        revertedMergedExerciseVersion: status === "reverted" ? 5 : null,
        redirectedAliases: ["Imported Bench Press"],
        externalIds: [],
        referenceImpact: [],
        totalReferenceCount: 0,
        affectedExerciseIds: [ids.canonical, ids.merged],
        affectedFamilyExerciseIds: [ids.canonical, ids.merged],
        reason: null,
        revertReason: status === "reverted" ? "Not duplicates" : null,
        appliedAt: "2026-07-26T12:00:00.000Z",
        revertedAt: status === "reverted" ? "2026-07-26T13:00:00.000Z" : null,
    };
}

function jobResource(state: "running" | "succeeded" | "failed") {
    return {
        id: "0198a4db-d8da-7000-8000-000000000001",
        type: "training.analytics.recalculate",
        version: 1,
        state,
        attempts: 1,
        maxAttempts: 5,
        progress: state === "succeeded" ? { completed: 1, total: 1, percentage: 100 } : null,
        error:
            state === "failed"
                ? {
                      code: "INVALID_INPUT",
                      message: "The recalculation input is no longer valid",
                      retryable: false,
                      failedAt: "2026-07-26T12:00:02.000Z",
                  }
                : null,
        correlationId: "request-1",
        createdAt: "2026-07-26T12:00:00.000Z",
        startedAt: "2026-07-26T12:00:01.000Z",
        nextAttemptAt: "2026-07-26T12:00:00.000Z",
        completedAt: state === "running" ? null : "2026-07-26T12:00:02.000Z",
        updatedAt: "2026-07-26T12:00:02.000Z",
    };
}
