import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { CommitBulkProgram, DryRunBulkProgram } from "#src/modules/training/application/index";
import { BulkProgramController } from "#src/modules/training/presentation/index";
import type { BulkCommitResponse, BulkDryRunResponse } from "@kinetix/types";

const dryRunId = "0198a4db-d8da-7000-8000-0000000000d1";
const profileId = "0198a4db-d8da-7000-8000-0000000000f1";

function response(): BulkDryRunResponse {
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
            profileId,
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
        generatedSessionCount: 0,
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
        source: { namespace: "coach-app" },
        mode: "create",
        program: { name: "Spring Strength" },
    };
}

function commitResponse(): BulkCommitResponse {
    return {
        dryRunId,
        programId: "0198a4db-d8da-7000-8000-0000000000e1",
        programVersion: 1,
        mode: "create",
        source: { namespace: "coach-app", generatedBy: null },
        committedAt: "2026-08-01T10:05:00.000Z",
        sessions: [],
        createdExercises: [],
        affectedVersions: [],
        warnings: [],
    };
}

function headers() {
    return { setHeader: vi.fn() };
}

function controller(
    execute = vi.fn().mockResolvedValue(response()),
    commit = vi.fn().mockResolvedValue(commitResponse()),
) {
    const dryRun = { execute } as unknown as DryRunBulkProgram;
    const commitBulk = { execute: commit } as unknown as CommitBulkProgram;
    return { controller: new BulkProgramController(dryRun, commitBulk), execute, commit };
}

describe("BulkProgramController", () => {
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

    it("surfaces path-scoped field errors for an invalid program body", async () => {
        const { controller: subject } = controller();
        try {
            await subject.create({ ...envelope(), program: { name: "" } }, undefined, undefined, headers());
            throw new Error("expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(HttpException);
            const payload = (error as HttpException).getResponse() as {
                code: string;
                fieldErrors: Record<string, string[]>;
            };
            expect(payload.code).toBe("VALIDATION_FAILED");
            expect(Object.keys(payload.fieldErrors).some(key => key.includes("name"))).toBe(true);
        }
    });

    it("commits a dry-run and sets the program id header", async () => {
        const { controller: subject, commit } = controller();
        const response_ = headers();
        const body = await subject.commit({ dryRunId, approvalToken: "tok-1" }, undefined, undefined, response_);

        expect(body.programId).toBe("0198a4db-d8da-7000-8000-0000000000e1");
        expect(commit).toHaveBeenCalledTimes(1);
        expect(response_.setHeader).toHaveBeenCalledWith("X-Program-Id", body.programId);
    });

    it("rejects a commit body that smuggles a replacement program", async () => {
        const { controller: subject } = controller();
        await expect(
            subject.commit(
                { dryRunId, approvalToken: "tok-1", program: { name: "Sneaky" } },
                undefined,
                undefined,
                headers(),
            ),
        ).rejects.toBeInstanceOf(HttpException);
    });
});
