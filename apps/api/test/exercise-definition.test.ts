import { describe, expect, it } from "vitest";

import {
    ExerciseDefinition,
    createExerciseSnapshot,
    normalizeCatalogValue,
    type CreateExerciseDefinitionInput,
} from "#src/modules/training/domain/index";

const ids = {
    exercise: "0198a4db-d8da-7000-8000-000000000001",
    fork: "0198a4db-d8da-7000-8000-000000000002",
    equipment: "0198a4db-d8da-7000-8000-000000000003",
    movement: "0198a4db-d8da-7000-8000-000000000004",
    chest: "0198a4db-d8da-7000-8000-000000000005",
    triceps: "0198a4db-d8da-7000-8000-000000000006",
    tag: "0198a4db-d8da-7000-8000-000000000007",
    family: "0198a4db-d8da-7000-8000-000000000008",
    variation: "0198a4db-d8da-7000-8000-000000000009",
} as const;
const now = new Date("2026-07-26T12:00:00.000Z");

describe("ExerciseDefinition", () => {
    it("normalizes aliases and creates a stable analytical snapshot from the aggregate", () => {
        const definition = ExerciseDefinition.create(input(), now);

        expect(definition.state.aliases).toEqual([
            {
                value: "Flat Bench",
                normalizedValue: normalizeCatalogValue("Flat Bench"),
                source: "user",
            },
        ]);
        expect(createExerciseSnapshot(definition, 3)).toEqual({
            schemaVersion: 1,
            exerciseId: ids.exercise,
            exerciseVersion: 3,
            name: "Bench Press",
            equipmentTypeId: ids.equipment,
            movementPatternId: ids.movement,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "supine",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["external_load", "repetitions"],
            muscles: [
                { muscleGroupId: ids.chest, role: "primary" },
                { muscleGroupId: ids.triceps, role: "secondary" },
            ],
            tagIds: [ids.tag],
            analyticsFamilyExerciseIds: [ids.family],
        });
    });

    it("enforces alias, muscle, and load-model invariants", () => {
        expect(() => ExerciseDefinition.create(input({ aliases: [" bench press "] }), now)).toThrow(
            /duplicates the exercise name/,
        );
        expect(() =>
            ExerciseDefinition.create(input({ muscles: [{ muscleGroupId: ids.chest, role: "secondary" }] }), now),
        ).toThrow(/primary muscle/);
        expect(() =>
            ExerciseDefinition.create(
                input({ loadModel: "external_only", supportedMeasurements: ["repetitions"] }),
                now,
            ),
        ).toThrow(/external_only/);
    });

    it("keeps seeded definitions immutable and forks user-owned lineage", () => {
        const seeded = ExerciseDefinition.create(input({ ownership: "seeded" }), now);

        expect(() => seeded.update({ notes: "local edit" }, now)).toThrow(/must be forked/);
        const fork = seeded
            .fork({ id: ids.fork }, new Date("2026-07-26T13:00:00.000Z"))
            .update({ notes: "local edit" }, new Date("2026-07-26T13:00:00.000Z"));

        expect(seeded.state).toMatchObject({ ownership: "seeded", notes: null });
        expect(fork.state).toMatchObject({
            id: ids.fork,
            ownership: "user",
            forkedFromExerciseId: ids.exercise,
            notes: "local edit",
        });
    });

    it("supports archive/restore and requires explicit analytics-family relationships", () => {
        const definition = ExerciseDefinition.create(input(), now);
        expect(definition.isInExplicitAnalyticsFamilyWith(ids.family)).toBe(true);
        expect(definition.isInExplicitAnalyticsFamilyWith(ids.variation)).toBe(false);

        definition.archive(new Date("2026-07-27T12:00:00.000Z"));
        expect(definition.state).toMatchObject({
            status: "archived",
            archivedAt: "2026-07-27T12:00:00.000Z",
        });
        definition.restore(new Date("2026-07-28T12:00:00.000Z"));
        expect(definition.state).toMatchObject({ status: "active", archivedAt: null });
    });

    it("rejects self and duplicate relationships", () => {
        expect(() =>
            ExerciseDefinition.create(
                input({
                    relationships: [{ targetExerciseId: ids.exercise, type: "variation" }],
                }),
                now,
            ),
        ).toThrow(/relate to itself/);
        expect(() =>
            ExerciseDefinition.create(
                input({
                    relationships: [
                        { targetExerciseId: ids.variation, type: "variation" },
                        { targetExerciseId: ids.variation, type: "variation" },
                    ],
                }),
                now,
            ),
        ).toThrow(/unique/);
    });
});

function input(overrides: Partial<CreateExerciseDefinitionInput> = {}): CreateExerciseDefinitionInput {
    return {
        id: ids.exercise,
        slug: "bench-press",
        name: "Bench Press",
        aliases: ["Flat Bench"],
        equipmentTypeId: ids.equipment,
        movementPatternId: ids.movement,
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "supine",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [
            { muscleGroupId: ids.chest, role: "primary" },
            { muscleGroupId: ids.triceps, role: "secondary" },
        ],
        tagIds: [ids.tag],
        relationships: [
            { targetExerciseId: ids.family, type: "analytics_family" },
            { targetExerciseId: ids.variation, type: "variation" },
        ],
        notes: null,
        ...overrides,
    };
}
