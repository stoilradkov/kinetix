import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { HistoricalImportDryRun } from "#src/modules/training/application/index";
import { HistoricalImportController } from "#src/modules/training/presentation/index";
import type { HistoricalImportDryRunResponse } from "@kinetix/types";

const dryRunId = "0198a4db-d8da-7000-8000-0000000000d1";

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

function headers() {
    return { setHeader: vi.fn() };
}

function controller(execute = vi.fn().mockResolvedValue(response())) {
    const dryRun = { execute } as unknown as HistoricalImportDryRun;
    return { controller: new HistoricalImportController(dryRun), execute };
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
