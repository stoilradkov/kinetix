import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type {
    CommitHistoricalImport,
    HistoricalImportCommitQueryService,
    HistoricalImportDryRun,
    RevertHistoricalImport,
} from "#src/modules/training/application/index";
import { HistoricalImportController } from "#src/modules/training/presentation/index";
import type {
    HistoricalImportCommitResponse,
    HistoricalImportDryRunResponse,
    HistoricalImportListResponse,
    HistoricalImportReportResponse,
    HistoricalImportRevertResponse,
} from "@kinetix/types";

const dryRunId = "0198a4db-d8da-7000-8000-0000000000d1";
const commitId = "0198a4db-d8da-7000-8000-0000000000e1";

function response(): HistoricalImportDryRunResponse {
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
            counts: { create: 0, update: 0, "skip-identical": 0, conflict: 0 },
            conflicts: [],
            hasConflicts: false,
        },
        summary: {
            programs: 0,
            completedSessions: 0,
            entities: 0,
            operations: { create: 0, update: 0, "skip-identical": 0, conflict: 0 },
            entityTypeCounts: [],
        },
        warnings: [],
        errors: [],
        mappings: [],
        proposedExercises: [],
        affectedVersions: [],
    };
}

function envelope() {
    return {
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
    };
}

function commitResponse(overrides: Partial<HistoricalImportCommitResponse> = {}): HistoricalImportCommitResponse {
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
        entities: [],
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

function listResponse(): HistoricalImportListResponse {
    return {
        items: [
            {
                commitId,
                dryRunId,
                importBatchId: "0198a4db-d8da-7000-8000-0000000000e2",
                state: "succeeded",
                mode: "create",
                source: { namespace: "coach-app", generatedBy: null },
                programs: 1,
                completedSessions: 1,
                attempts: 1,
                reverted: false,
                createdAt: "2026-08-08T10:00:00.000Z",
                startedAt: "2026-08-08T10:00:00.000Z",
                completedAt: "2026-08-08T10:00:01.000Z",
            },
        ],
        count: 1,
    };
}

function reportResponse(): HistoricalImportReportResponse {
    return {
        commitId,
        dryRunId,
        importBatchId: "0198a4db-d8da-7000-8000-0000000000e2",
        schemaVersion: 1,
        source: { namespace: "coach-app", generatedBy: null },
        payloadId: "archive-1",
        checksum: "a".repeat(64),
        mode: "create",
        state: "succeeded",
        programs: 1,
        completedSessions: 1,
        counts: { created: 4, updated: 0, skipped: 0, conflicted: 0 },
        storagePlan: {
            namespace: "coach-app",
            mode: "create",
            entries: [],
            counts: { create: 4, update: 0, "skip-identical": 0, conflict: 0 },
            conflicts: [],
            hasConflicts: false,
        },
        entities: [
            {
                entityType: "program",
                externalId: "prog-1",
                entityId: "0198a4db-d8da-7000-8000-0000000000c1",
                currentVersion: 1,
                archived: false,
            },
        ],
        affectedVersions: [],
        warnings: [],
        failure: null,
        revert: null,
        createdAt: "2026-08-08T10:00:00.000Z",
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:01.000Z",
    };
}

function revertResponse(overrides: Partial<HistoricalImportRevertResponse> = {}): HistoricalImportRevertResponse {
    return {
        revertId: "0198a4db-d8da-7000-8000-0000000000f1",
        commitId,
        importBatchId: "0198a4db-d8da-7000-8000-0000000000e2",
        state: "succeeded",
        counts: { archived: 2, blocked: 0, skipped: 0 },
        archivedEntities: [],
        blockedEntities: [],
        failure: null,
        createdAt: "2026-08-09T10:00:00.000Z",
        startedAt: "2026-08-09T10:00:00.000Z",
        completedAt: "2026-08-09T10:00:01.000Z",
        ...overrides,
    };
}

function headers() {
    return { setHeader: vi.fn() };
}

function controller(execute = vi.fn().mockResolvedValue(response())) {
    const dryRun = { execute } as unknown as HistoricalImportDryRun;
    const commitExecute = vi.fn().mockResolvedValue(commitResponse());
    const commitRetry = vi.fn().mockResolvedValue(commitResponse());
    const commitFindById = vi.fn().mockResolvedValue(commitResponse());
    const commitList = vi.fn().mockResolvedValue(listResponse());
    const commitReport = vi.fn().mockResolvedValue(reportResponse());
    const commitRevertStatus = vi.fn().mockResolvedValue(revertResponse());
    const revertExecute = vi.fn().mockResolvedValue(revertResponse());
    const commit = { execute: commitExecute, retry: commitRetry } as unknown as CommitHistoricalImport;
    const commits = {
        findById: commitFindById,
        list: commitList,
        report: commitReport,
        revertStatus: commitRevertStatus,
    } as unknown as HistoricalImportCommitQueryService;
    const revert = { execute: revertExecute } as unknown as RevertHistoricalImport;
    return {
        controller: new HistoricalImportController(dryRun, commit, commits, revert),
        execute,
        commitExecute,
        commitRetry,
        commitFindById,
        commitList,
        commitReport,
        commitRevertStatus,
        revertExecute,
    };
}

describe("HistoricalImportController", () => {
    it("returns the dry-run body and sets the dry-run id + expiry headers", async () => {
        const { controller: subject, execute } = controller();
        const response_ = headers();
        const body = await subject.create(envelope(), undefined, undefined, response_);

        expect(body.dryRunId).toBe(dryRunId);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(response_.setHeader).toHaveBeenCalledWith("X-Dry-Run-Id", dryRunId);
        expect(response_.setHeader).toHaveBeenCalledWith("X-Dry-Run-Expires-At", body.expiresAt);
    });

    it("rejects an unsupported schema version with a 422 validation error", async () => {
        const { controller: subject } = controller();
        await expect(
            subject.create({ ...envelope(), schemaVersion: 2 }, undefined, undefined, headers()),
        ).rejects.toBeInstanceOf(HttpException);
    });

    it("rejects an empty archive (no programs or completed sessions)", async () => {
        const { controller: subject } = controller();
        await expect(
            subject.create(
                { schemaVersion: 1, source: envelope().source, mode: "create" },
                undefined,
                undefined,
                headers(),
            ),
        ).rejects.toBeInstanceOf(HttpException);
    });

    it("surfaces path-scoped field errors for a non-canonical exercise reference", async () => {
        const { controller: subject } = controller();
        const bad = envelope();
        // An alias/name reference is not a canonical selector and must be rejected at the boundary.
        (bad.completedSessions[0]!.activities[0]!.strength.occurrences[0]! as Record<string, unknown>).reference = {
            by: "alias",
            alias: "Back Squat",
        };
        try {
            await subject.create(bad, undefined, undefined, headers());
            throw new Error("expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(HttpException);
            const payload = (error as HttpException).getResponse() as { code: string };
            expect(payload.code).toBe("VALIDATION_FAILED");
        }
    });
});

describe("HistoricalImportController — commit", () => {
    const request = { dryRunId, approvalToken: "tok-1" };

    it("commits with the dry-run id + token, forwards the idempotency key, and sets the commit-id header", async () => {
        const { controller: subject, commitExecute } = controller();
        const response_ = headers();
        const body = await subject.createCommit(request, undefined, "idem-1", response_);

        expect(body.commitId).toBe(commitId);
        expect(commitExecute).toHaveBeenCalledWith(
            { dryRunId, approvalToken: "tok-1", idempotencyKey: "idem-1" },
            expect.objectContaining({ source: "agent" }),
        );
        expect(response_.setHeader).toHaveBeenCalledWith("X-Commit-Id", commitId);
    });

    it("rejects a commit body that smuggles a payload with a 422 validation error", async () => {
        const { controller: subject, commitExecute } = controller();
        await expect(
            subject.createCommit({ ...request, programs: [{ name: "sneaky" }] }, undefined, undefined, headers()),
        ).rejects.toBeInstanceOf(HttpException);
        expect(commitExecute).not.toHaveBeenCalled();
    });

    it("reads a commit run status by id", async () => {
        const { controller: subject, commitFindById } = controller();
        const body = await subject.readCommit(commitId);
        expect(body.commitId).toBe(commitId);
        expect(commitFindById).toHaveBeenCalledWith(commitId);
    });

    it("resumes a commit run by id and sets the commit-id header", async () => {
        const { controller: subject, commitRetry } = controller();
        const response_ = headers();
        const body = await subject.retryCommit(commitId, undefined, response_);
        expect(body.commitId).toBe(commitId);
        expect(commitRetry).toHaveBeenCalledWith(commitId, expect.objectContaining({ source: "agent" }));
        expect(response_.setHeader).toHaveBeenCalledWith("X-Commit-Id", commitId);
    });
});

describe("HistoricalImportController — list, report, revert", () => {
    it("lists the profile's historical imports", async () => {
        const { controller: subject, commitList } = controller();
        const body = await subject.listCommits();
        expect(body.count).toBe(1);
        expect(body.items[0]?.commitId).toBe(commitId);
        expect(commitList).toHaveBeenCalledTimes(1);
    });

    it("generates the immutable storage audit for a commit", async () => {
        const { controller: subject, commitReport } = controller();
        const body = await subject.report(commitId);
        expect(body.checksum).toBe("a".repeat(64));
        expect(body.entities[0]?.entityType).toBe("program");
        expect(commitReport).toHaveBeenCalledWith(commitId);
    });

    it("starts a revert by commit id and sets the revert-id header", async () => {
        const { controller: subject, revertExecute } = controller();
        const response_ = headers();
        const body = await subject.createRevert(commitId, undefined, response_);
        expect(body.state).toBe("succeeded");
        expect(revertExecute).toHaveBeenCalledWith(commitId, expect.objectContaining({ source: "agent" }));
        expect(response_.setHeader).toHaveBeenCalledWith("X-Revert-Id", body.revertId);
    });

    it("reads a revert run status by commit id", async () => {
        const { controller: subject, commitRevertStatus } = controller();
        const body = await subject.readRevert(commitId);
        expect(body.commitId).toBe(commitId);
        expect(commitRevertStatus).toHaveBeenCalledWith(commitId);
    });
});
