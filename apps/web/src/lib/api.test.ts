import { afterEach, describe, expect, it, vi } from "vitest";

import { revertExerciseMerge } from "@/lib/api";

const ids = {
    canonical: "0198a4db-d8da-7000-8000-000000000001",
    merged: "0198a4db-d8da-7000-8000-000000000002",
    merge: "0198a4db-d8da-7000-8000-000000000003",
    equipment: "0198a4db-d8da-7000-8000-000000000004",
    movement: "0198a4db-d8da-7000-8000-000000000005",
    muscle: "0198a4db-d8da-7000-8000-000000000006",
} as const;

describe("exercise catalog API client", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("loads current exercise versions before issuing a merge revert", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(Response.json(exercise(ids.canonical, "Bench Press", 5, "active")))
            .mockResolvedValueOnce(Response.json(exercise(ids.merged, "Imported Bench", 7, "archived")))
            .mockResolvedValueOnce(Response.json({ ...merge(), status: "reverted", version: 2 }));
        vi.stubGlobal("fetch", request);

        await revertExerciseMerge(merge());

        expect(request).toHaveBeenCalledTimes(3);
        const [url, init] = request.mock.calls[2]!;
        expect(url).toContain(`/exercise-merges/${ids.merge}/revert`);
        expect(init?.method).toBe("POST");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect((init?.headers as Headers).get("idempotency-key")).toBeTruthy();
        expect(JSON.parse(String(init?.body))).toEqual({
            expectedCanonicalVersion: 5,
            expectedMergedVersion: 7,
        });
    });
});

function merge() {
    return {
        schemaVersion: 1 as const,
        id: ids.merge,
        status: "applied" as const,
        version: 1,
        canonicalExercise: { id: ids.canonical, name: "Bench Press", version: 3 },
        mergedExercise: { id: ids.merged, name: "Imported Bench", version: 4 },
        mergedExerciseVersionAfterApply: 5,
        revertedCanonicalExerciseVersion: null,
        revertedMergedExerciseVersion: null,
        redirectedAliases: ["Imported Bench"],
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

function exercise(id: string, name: string, version: number, status: "active" | "archived") {
    const taxonomy = {
        schemaVersion: 1 as const,
        id: ids.equipment,
        slug: "barbell",
        name: "Barbell",
        position: 0,
        ownership: "seeded" as const,
        analyticsMappingStatus: "standard" as const,
    };
    return {
        schemaVersion: 1,
        id,
        slug: name.toLowerCase().replaceAll(" ", "-"),
        name,
        aliases: [],
        status,
        ownership: "user",
        forkedFromExerciseId: null,
        equipment: taxonomy,
        movementPattern: { ...taxonomy, id: ids.movement, slug: "horizontal-push", name: "Horizontal Push" },
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "supine",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [
            {
                muscle: {
                    schemaVersion: 1,
                    id: ids.muscle,
                    slug: "chest",
                    name: "Chest",
                    position: 0,
                },
                role: "primary",
            },
        ],
        tags: [],
        relationships: [],
        notes: null,
        version,
        position: 0,
        archivedAt: status === "archived" ? "2026-07-26T12:00:00.000Z" : null,
    };
}
