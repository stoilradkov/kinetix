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
import { SeedTrainingCatalog, TrainingCatalogQueries } from "#src/modules/training/application/index";
import type { TrainingCatalogSeed } from "#src/modules/training/domain/index";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { trainingCatalogSeed } from "#src/modules/training/infrastructure/seed/training-catalog";
import { TrainingCatalogController } from "#src/modules/training/presentation/index";
import type { UnitOfWork } from "#src/platform/application/index";

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

    async function cleanCatalog(): Promise<void> {
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
