import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
    createDatabase,
    equipmentTypes,
    exerciseMuscles,
    exercises,
    movementPatterns,
    muscleGroups,
    trainingTags,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    ExerciseAliasConflictError,
    SeedTrainingCatalog,
    TrainingCatalogQueries,
} from "#src/modules/training/application/index";
import {
    ExerciseDefinition,
    normalizeCatalogValue,
    type TrainingCatalogSeed,
} from "#src/modules/training/domain/index";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { trainingCatalogSeed } from "#src/modules/training/infrastructure/seed/training-catalog";
import { TrainingCatalogController } from "#src/modules/training/presentation/index";
import type { UnitOfWork } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.CATALOG_TEST_DATABASE_URL;

describe.runIf(testDatabaseUrl)("Training catalog PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleTrainingCatalogRepository(connection as unknown as DatabaseService);
    const unitOfWork: UnitOfWork = {
        execute: work => connection.db.transaction(transaction => work(transaction)),
    };
    const useCase = (seed: TrainingCatalogSeed = trainingCatalogSeed) =>
        new SeedTrainingCatalog(unitOfWork, repository, seed, {
            now: () => new Date("2026-07-26T12:00:00.000Z"),
        });
    const usedExerciseIds: string[] = [];

    beforeAll(async () => {
        await connection.db.select({ id: muscleGroups.id }).from(muscleGroups).limit(1);
    });

    afterEach(cleanCatalog);

    afterAll(async () => {
        await connection.client.end({ timeout: 5 });
    });

    it("seeds idempotently and returns deterministic joined exercise records", async () => {
        const expectedCount =
            trainingCatalogSeed.muscles.length +
            trainingCatalogSeed.equipment.length +
            trainingCatalogSeed.movementPatterns.length +
            trainingCatalogSeed.tags.length +
            trainingCatalogSeed.exercises.length;

        await expect(useCase().execute()).resolves.toMatchObject({ created: expectedCount, archived: 0 });
        await expect(useCase().execute()).resolves.toMatchObject({ unchanged: expectedCount, archived: 0 });

        const muscles = await repository.listMuscles();
        const tags = await repository.listTags();
        const catalogExercises = await repository.listExercises();
        expect(muscles.map(item => item.slug)).toEqual(trainingCatalogSeed.muscles.map(item => item.slug));
        expect(tags.map(item => item.slug)).toEqual(trainingCatalogSeed.tags.map(item => item.slug));
        expect(catalogExercises.map(item => item.slug)).toEqual(trainingCatalogSeed.exercises.map(item => item.slug));
        expect(catalogExercises.find(item => item.slug === "barbell-back-squat")).toMatchObject({
            aliases: ["Back Squat"],
            equipment: { slug: "barbell" },
            movementPattern: { slug: "squat" },
            muscles: expect.arrayContaining([
                expect.objectContaining({ muscle: expect.objectContaining({ slug: "quadriceps" }), role: "primary" }),
            ]),
        });

        const response = await new TrainingCatalogController(new TrainingCatalogQueries(repository)).listExercises();
        expect(response).toMatchObject({
            schemaVersion: 1,
        });
        expect(response.items[0]).toMatchObject({
            schemaVersion: 1,
            slug: "barbell-back-squat",
            equipment: { schemaVersion: 1 },
            movementPattern: { schemaVersion: 1 },
        });
    });

    it("enforces foreign keys and case-folded tag uniqueness", async () => {
        await useCase().execute();
        await expect(
            connection.db.insert(exerciseMuscles).values({
                exerciseId: randomUUID(),
                muscleGroupId: randomUUID(),
                role: "primary",
            }),
        ).rejects.toThrow();
        await expect(
            connection.db.insert(trainingTags).values({
                slug: "another-easy",
                name: " EASY ",
                normalizedName: "easy",
                position: 100,
                category: "custom",
            }),
        ).rejects.toThrow();
    });

    it("updates seed metadata, preserves user-owned collisions, and archives removed seeds", async () => {
        await useCase().execute();
        const changed = {
            ...trainingCatalogSeed,
            equipment: trainingCatalogSeed.equipment.map(item =>
                item.slug === "barbell" ? { ...item, name: "Olympic Barbell" } : item,
            ),
        };
        await expect(useCase(changed).execute()).resolves.toMatchObject({ updated: 1, userConflicts: [] });
        await expect(repository.listEquipment()).resolves.toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "barbell", name: "Olympic Barbell" })]),
        );

        await connection.db
            .update(exercises)
            .set({ isSeeded: false, name: "My Pull-up" })
            .where(eq(exercises.slug, "pull-up"));
        await expect(useCase().execute()).resolves.toMatchObject({ userConflicts: ["pull-up"] });
        await expect(
            connection.db.select({ name: exercises.name }).from(exercises).where(eq(exercises.slug, "pull-up")),
        ).resolves.toEqual([{ name: "My Pull-up" }]);

        const removed = {
            ...trainingCatalogSeed,
            exercises: trainingCatalogSeed.exercises.filter(item => item.slug !== "side-plank"),
        };
        await expect(useCase(removed).execute()).resolves.toMatchObject({ archived: 1 });
        await expect(
            connection.db
                .select({ status: exercises.status, archivedAt: exercises.archivedAt })
                .from(exercises)
                .where(eq(exercises.slug, "side-plank")),
        ).resolves.toEqual([{ status: "archived", archivedAt: new Date("2026-07-26T12:00:00.000Z") }]);
        expect((await repository.listExercises()).some(item => item.slug === "side-plank")).toBe(false);
    });

    it("persists editable aggregate trees, aliases, relationships, and lifecycle state", async () => {
        await useCase().execute();
        const [equipment] = await repository.listEquipment();
        const [movement] = await repository.listMovementPatterns();
        const [muscle] = await repository.listMuscles();
        const [tag] = await repository.listTags();
        const [target] = await repository.listExercises();
        if (!equipment || !movement || !muscle || !tag || !target) throw new Error("Seed catalog is incomplete");

        const id = entityId(randomUUID());
        usedExerciseIds.push(id);
        const definition = ExerciseDefinition.create(
            {
                id,
                slug: `custom-${id}`,
                name: "My Test Exercise",
                aliases: ["Case Folded Alias"],
                equipmentTypeId: equipment.id,
                movementPatternId: movement.id,
                classification: "compound",
                laterality: "bilateral",
                bodyPosition: "standing",
                repetitionSemantics: "total",
                loadModel: "external_only",
                supportedMeasurements: ["repetitions", "external_load"],
                muscles: [{ muscleGroupId: muscle.id, role: "primary" }],
                tagIds: [tag.id],
                relationships: [{ targetExerciseId: target.id, type: "variation" }],
                notes: "integration",
            },
            new Date("2026-07-26T12:00:00.000Z"),
        );

        await connection.db.transaction(transaction =>
            repository.create("training.exercise", id, definition.state, 1, transaction),
        );
        await expect(repository.readExercise(id)).resolves.toMatchObject({
            aliases: ["Case Folded Alias"],
            relationships: [{ targetExerciseId: target.id, type: "variation" }],
            muscles: [{ muscle: { id: muscle.id }, role: "primary" }],
            tags: [{ id: tag.id }],
        });
        await expect(repository.resolveAlias(normalizeCatalogValue(" CASE FOLDED ALIAS "))).resolves.toMatchObject({
            id,
        });

        const conflictingId = entityId(randomUUID());
        usedExerciseIds.push(conflictingId);
        const conflicting = ExerciseDefinition.create(
            {
                ...definition.state,
                id: conflictingId,
                slug: `conflicting-${conflictingId}`,
                name: "Another Exercise",
                aliases: ["case folded alias"],
                ownership: "user",
                forkedFromExerciseId: null,
            },
            new Date("2026-07-26T12:00:00.000Z"),
        );
        await expect(
            connection.db.transaction(transaction =>
                repository.create("training.exercise", conflictingId, conflicting.state, 1, transaction),
            ),
        ).rejects.toBeInstanceOf(ExerciseAliasConflictError);

        definition.archive(new Date("2026-07-27T12:00:00.000Z"));
        await connection.db.transaction(transaction =>
            repository.save("training.exercise", id, definition.state, 1, 2, transaction),
        );
        await expect(repository.resolveAlias(normalizeCatalogValue("case folded alias"))).resolves.toBeNull();
        await expect(repository.readExercise(id)).resolves.toMatchObject({ status: "archived", version: 2 });

        definition.restore(new Date("2026-07-28T12:00:00.000Z"));
        await connection.db.transaction(transaction =>
            repository.save("training.exercise", id, definition.state, 2, 3, transaction),
        );
        await expect(repository.readExercise(id)).resolves.toMatchObject({ status: "active", version: 3 });
    });

    async function cleanCatalog(): Promise<void> {
        for (const id of usedExerciseIds.splice(0)) await connection.db.delete(exercises).where(eq(exercises.id, id));
        await connection.db.delete(exercises).where(
            inArray(
                exercises.slug,
                trainingCatalogSeed.exercises.map(item => item.slug),
            ),
        );
        await connection.db.delete(trainingTags).where(
            inArray(
                trainingTags.slug,
                trainingCatalogSeed.tags.map(item => item.slug),
            ),
        );
        await connection.db.delete(movementPatterns).where(
            inArray(
                movementPatterns.slug,
                trainingCatalogSeed.movementPatterns.map(item => item.slug),
            ),
        );
        await connection.db.delete(equipmentTypes).where(
            inArray(
                equipmentTypes.slug,
                trainingCatalogSeed.equipment.map(item => item.slug),
            ),
        );
        await connection.db.delete(muscleGroups).where(
            inArray(
                muscleGroups.slug,
                trainingCatalogSeed.muscles.map(item => item.slug),
            ),
        );
    }
});
