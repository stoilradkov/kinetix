import { describe, expect, it } from "vitest";

import { ExerciseDefinition, ExerciseMergePolicy } from "#src/modules/training/domain/index";

const ids = {
    canonical: "0198a4db-d8da-7000-8000-000000000001",
    merged: "0198a4db-d8da-7000-8000-000000000002",
    family: "0198a4db-d8da-7000-8000-000000000003",
    merge: "0198a4db-d8da-7000-8000-000000000004",
    equipment: "0198a4db-d8da-7000-8000-000000000005",
    movement: "0198a4db-d8da-7000-8000-000000000006",
    muscle: "0198a4db-d8da-7000-8000-000000000007",
} as const;
const now = new Date("2026-07-26T12:00:00.000Z");

describe("ExerciseMergePolicy", () => {
    it("records immutable reversible evidence for an eligible merge", () => {
        const policy = new ExerciseMergePolicy();
        const intent = policy.plan(
            {
                id: ids.merge,
                canonical: exercise(ids.canonical, "Bench Press", "seeded"),
                merged: exercise(ids.merged, "Barbell Bench Press", "user"),
                canonicalExerciseVersion: 3,
                mergedExerciseVersion: 2,
                activeRedirects: [],
                externalIds: [{ provider: "strong", externalId: "bench-42" }],
                referenceImpact: [{ referenceType: "planned_exercises", count: 4 }],
                affectedFamilyExerciseIds: [ids.family],
                reason: "Duplicate imported exercise",
            },
            now,
        );

        expect(intent).toEqual({
            id: ids.merge,
            canonicalExerciseId: ids.canonical,
            mergedExerciseId: ids.merged,
            canonicalExerciseName: "Bench Press",
            mergedExerciseName: "Barbell Bench Press",
            canonicalExerciseVersion: 3,
            mergedExerciseVersion: 2,
            redirectedAliases: ["Barbell Bench Press", "Old Barbell Bench Press"],
            externalIds: [{ provider: "strong", externalId: "bench-42" }],
            referenceImpact: [{ referenceType: "planned_exercises", count: 4 }],
            affectedExerciseIds: [ids.canonical, ids.merged],
            affectedFamilyExerciseIds: [ids.canonical, ids.merged, ids.family].sort(),
            reason: "Duplicate imported exercise",
            appliedAt: now.toISOString(),
        });
        expect(Object.isFrozen(intent)).toBe(true);
    });

    it("rejects self merges, ineligible roots, and redirect cycles", () => {
        const policy = new ExerciseMergePolicy();
        const canonical = exercise(ids.canonical, "Bench Press", "seeded");
        const merged = exercise(ids.merged, "Barbell Bench Press", "user");

        expect(() =>
            policy.plan(
                {
                    id: ids.merge,
                    canonical,
                    merged: { ...merged, id: ids.canonical },
                    canonicalExerciseVersion: 1,
                    mergedExerciseVersion: 1,
                    activeRedirects: [],
                },
                now,
            ),
        ).toThrow(/itself/);
        expect(() =>
            policy.plan(
                {
                    id: ids.merge,
                    canonical,
                    merged: { ...merged, ownership: "seeded" },
                    canonicalExerciseVersion: 1,
                    mergedExerciseVersion: 1,
                    activeRedirects: [],
                },
                now,
            ),
        ).toThrow(/seeded exercise/);
        expect(() =>
            policy.plan(
                {
                    id: ids.merge,
                    canonical,
                    merged,
                    canonicalExerciseVersion: 1,
                    mergedExerciseVersion: 1,
                    activeRedirects: [
                        {
                            mergedExerciseId: ids.canonical,
                            canonicalExerciseId: ids.merged,
                        },
                    ],
                },
                now,
            ),
        ).toThrow(/redirect|cycle/);
    });

    it("requires the exact active redirect and archived merged root before revert", () => {
        const policy = new ExerciseMergePolicy();
        const canonical = exercise(ids.canonical, "Bench Press", "seeded");
        const merged = exercise(ids.merged, "Barbell Bench Press", "user");
        const intent = policy.plan(
            {
                id: ids.merge,
                canonical,
                merged,
                canonicalExerciseVersion: 1,
                mergedExerciseVersion: 1,
                activeRedirects: [],
            },
            now,
        );

        expect(() =>
            policy.assertRevertible({
                intent,
                canonical,
                merged,
                activeRedirects: [
                    {
                        mergedExerciseId: ids.merged,
                        canonicalExerciseId: ids.canonical,
                    },
                ],
            }),
        ).toThrow(/archived/);

        expect(() =>
            policy.assertRevertible({
                intent,
                canonical,
                merged: { ...merged, status: "archived", archivedAt: now.toISOString() },
                activeRedirects: [
                    {
                        mergedExerciseId: ids.merged,
                        canonicalExerciseId: ids.canonical,
                    },
                ],
            }),
        ).not.toThrow();
    });
});

function exercise(id: string, name: string, ownership: "seeded" | "user") {
    return ExerciseDefinition.create(
        {
            id,
            slug: name.toLowerCase().replaceAll(" ", "-"),
            name,
            aliases: [`Old ${name}`],
            ownership,
            equipmentTypeId: ids.equipment,
            movementPatternId: ids.movement,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "supine",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            muscles: [{ muscleGroupId: ids.muscle, role: "primary" }],
            relationships: [{ targetExerciseId: ids.family, type: "analytics_family" }],
        },
        now,
    ).state;
}
