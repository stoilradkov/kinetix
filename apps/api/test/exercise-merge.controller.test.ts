import { describe, expect, it, vi } from "vitest";

import type { ExerciseMergeService } from "#src/modules/training/application/index";
import { ExerciseMergeController } from "#src/modules/training/presentation/index";
import {
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";

const ids = {
    canonical: "0198a4db-d8da-7000-8000-000000000001",
    merged: "0198a4db-d8da-7000-8000-000000000002",
    merge: "0198a4db-d8da-7000-8000-000000000003",
} as const;

describe("ExerciseMergeController", () => {
    it("returns a validated before/after preview", async () => {
        const preview = vi.fn(async () => previewResource());
        const controller = new ExerciseMergeController({ preview } as unknown as ExerciseMergeService);

        await expect(
            controller.preview({
                canonicalExerciseId: ids.canonical,
                mergedExerciseId: ids.merged,
                expectedCanonicalVersion: 2,
                expectedMergedVersion: 3,
            }),
        ).resolves.toMatchObject({
            schemaVersion: 1,
            totalReferenceCount: 4,
            after: { historicalSnapshotsPreserved: true },
        });
    });

    it("requires idempotency and returns an ETag for a merge", async () => {
        const merge = vi.fn(async () => mergeResource());
        const response = { setHeader: vi.fn() };
        const controller = new ExerciseMergeController({ merge } as unknown as ExerciseMergeService, idempotency());

        await expect(
            controller.merge(
                {
                    canonicalExerciseId: ids.canonical,
                    mergedExerciseId: ids.merged,
                    expectedCanonicalVersion: 2,
                    expectedMergedVersion: 3,
                },
                "request-1",
                undefined,
                response,
            ),
        ).rejects.toBeInstanceOf(ApplicationValidationError);

        await controller.merge(
            {
                canonicalExerciseId: ids.canonical,
                mergedExerciseId: ids.merged,
                expectedCanonicalVersion: 2,
                expectedMergedVersion: 3,
            },
            "request-1",
            "merge-1",
            response,
        );
        expect(merge).toHaveBeenCalledWith(
            expect.objectContaining({ expectedMergedVersion: 3 }),
            expect.objectContaining({ correlationId: "request-1" }),
            expect.anything(),
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("requires the merge version through If-Match before revert", async () => {
        const controller = new ExerciseMergeController({} as ExerciseMergeService, idempotency());
        await expect(
            controller.revert(
                ids.merge,
                { expectedCanonicalVersion: 2, expectedMergedVersion: 4 },
                undefined,
                "request-2",
                "revert-1",
                { setHeader: vi.fn() },
            ),
        ).rejects.toBeInstanceOf(ExpectedVersionRequiredError);
    });
});

function idempotency(): IdempotentCommandExecutor {
    return {
        execute: async (input, operation) => ({
            ...(await operation({}, input.context)),
            replayed: false,
        }),
    } as IdempotentCommandExecutor;
}

function previewResource() {
    return {
        canonicalExercise: { id: ids.canonical, name: "Bench Press", version: 2 },
        mergedExercise: { id: ids.merged, name: "Barbell Bench Press", version: 3 },
        redirectedAliases: ["Barbell Bench Press"],
        externalIds: [],
        referenceImpact: [{ referenceType: "planned_exercises", count: 4 }],
        totalReferenceCount: 4,
        affectedExerciseIds: [ids.canonical, ids.merged],
        affectedFamilyExerciseIds: [ids.canonical, ids.merged],
        after: {
            resolvedExerciseId: ids.canonical,
            mergedExerciseSelectable: false as const,
            historicalSnapshotsPreserved: true as const,
        },
    };
}

function mergeResource() {
    return {
        id: ids.merge,
        status: "applied" as const,
        version: 1,
        canonicalExercise: { id: ids.canonical, name: "Bench Press", version: 2 },
        mergedExercise: { id: ids.merged, name: "Barbell Bench Press", version: 3 },
        mergedExerciseVersionAfterApply: 4,
        revertedCanonicalExerciseVersion: null,
        revertedMergedExerciseVersion: null,
        redirectedAliases: ["Barbell Bench Press"],
        externalIds: [],
        referenceImpact: [],
        totalReferenceCount: 0,
        affectedExerciseIds: [ids.canonical, ids.merged],
        affectedFamilyExerciseIds: [ids.canonical, ids.merged],
        reason: null,
        revertReason: null,
        appliedAt: "2026-07-26T12:00:00.000Z",
        revertedAt: null,
    };
}
