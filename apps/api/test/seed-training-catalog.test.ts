import { describe, expect, it } from "vitest";

import {
    SeedTrainingCatalog,
    type CatalogSeedWriteResult,
    type TrainingCatalogSeedRepository,
} from "#src/modules/training/application/index";
import type {
    EquipmentTypeSeed,
    ExerciseSeed,
    MuscleGroupSeed,
    MovementPatternSeed,
    TagSeed,
    TrainingCatalogSeed,
} from "#src/modules/training/domain/index";
import { trainingCatalogSeed } from "#src/modules/training/infrastructure/seed/training-catalog";
import type { UnitOfWork } from "#src/platform/application/index";

const now = new Date("2026-07-26T12:00:00.000Z");
const transaction = Symbol("transaction");
const unitOfWork: UnitOfWork = {
    execute: work => work(transaction),
};

describe("SeedTrainingCatalog", () => {
    it("creates the catalog once and leaves a repeated seed unchanged", async () => {
        const repository = new FakeCatalogRepository();
        const useCase = seedUseCase(repository);
        const expectedCount =
            trainingCatalogSeed.muscles.length +
            trainingCatalogSeed.equipment.length +
            trainingCatalogSeed.movementPatterns.length +
            trainingCatalogSeed.tags.length +
            trainingCatalogSeed.exercises.length;

        await expect(useCase.execute()).resolves.toEqual({
            schemaVersion: 1,
            created: expectedCount,
            updated: 0,
            unchanged: 0,
            archived: 0,
            userConflicts: [],
        });
        await expect(useCase.execute()).resolves.toEqual({
            schemaVersion: 1,
            created: 0,
            updated: 0,
            unchanged: expectedCount,
            archived: 0,
            userConflicts: [],
        });
        expect(repository.transactions).toHaveLength(expectedCount * 2 + 10);
        expect(repository.transactions.every(value => value === transaction)).toBe(true);
    });

    it("updates safe seed metadata without replacing a user-owned collision", async () => {
        const repository = new FakeCatalogRepository();
        await seedUseCase(repository).execute();
        repository.userOwns("exercise", "pull-up");
        const changed = {
            ...trainingCatalogSeed,
            equipment: trainingCatalogSeed.equipment.map(item =>
                item.slug === "barbell" ? { ...item, name: "Olympic Barbell" } : item,
            ),
        } satisfies TrainingCatalogSeed;

        await expect(seedUseCase(repository, changed).execute()).resolves.toMatchObject({
            created: 0,
            updated: 1,
            userConflicts: ["pull-up"],
        });
        expect(repository.value("exercise", "pull-up")?.owner).toBe("user");
        expect(repository.value("equipment", "barbell")?.seed).toMatchObject({ name: "Olympic Barbell" });
    });

    it("archives a removed seed and restores it if the seed returns", async () => {
        const repository = new FakeCatalogRepository();
        await seedUseCase(repository).execute();
        const removed = {
            ...trainingCatalogSeed,
            exercises: trainingCatalogSeed.exercises.filter(item => item.slug !== "side-plank"),
        } satisfies TrainingCatalogSeed;

        await expect(seedUseCase(repository, removed).execute()).resolves.toMatchObject({ archived: 1 });
        expect(repository.value("exercise", "side-plank")?.archived).toBe(true);

        await expect(seedUseCase(repository).execute()).resolves.toMatchObject({ updated: 1, archived: 0 });
        expect(repository.value("exercise", "side-plank")?.archived).toBe(false);
    });
});

type Kind = "muscle" | "equipment" | "movement" | "tag" | "exercise";
type SeedDefinition = MuscleGroupSeed | EquipmentTypeSeed | MovementPatternSeed | TagSeed | ExerciseSeed;
interface Stored {
    owner: "seeded" | "user";
    seed: SeedDefinition;
    archived: boolean;
}

class FakeCatalogRepository implements TrainingCatalogSeedRepository {
    readonly transactions: unknown[] = [];
    private readonly values = new Map<string, Stored>();

    upsertMuscle(seed: MuscleGroupSeed, _now: Date, tx: unknown) {
        return this.write("muscle", seed, tx);
    }
    upsertEquipment(seed: EquipmentTypeSeed, _now: Date, tx: unknown) {
        return this.write("equipment", seed, tx);
    }
    upsertMovementPattern(seed: MovementPatternSeed, _now: Date, tx: unknown) {
        return this.write("movement", seed, tx);
    }
    upsertTag(seed: TagSeed, _now: Date, tx: unknown) {
        return this.write("tag", seed, tx);
    }
    upsertExercise(seed: ExerciseSeed, _now: Date, tx: unknown) {
        return this.write("exercise", seed, tx);
    }

    archiveRemovedMuscles(slugs: readonly string[], _now: Date, tx: unknown) {
        return this.archive("muscle", slugs, tx);
    }
    archiveRemovedEquipment(slugs: readonly string[], _now: Date, tx: unknown) {
        return this.archive("equipment", slugs, tx);
    }
    archiveRemovedMovementPatterns(slugs: readonly string[], _now: Date, tx: unknown) {
        return this.archive("movement", slugs, tx);
    }
    archiveRemovedTags(slugs: readonly string[], _now: Date, tx: unknown) {
        return this.archive("tag", slugs, tx);
    }
    archiveRemovedExercises(slugs: readonly string[], _now: Date, tx: unknown) {
        return this.archive("exercise", slugs, tx);
    }

    userOwns(kind: Kind, slug: string): void {
        const existing = this.value(kind, slug);
        if (!existing) throw new Error(`Missing fake ${kind} ${slug}`);
        this.values.set(this.key(kind, slug), { ...existing, owner: "user" });
    }

    value(kind: Kind, slug: string): Stored | undefined {
        return this.values.get(this.key(kind, slug));
    }

    private write(kind: Kind, seed: SeedDefinition, tx: unknown): Promise<CatalogSeedWriteResult> {
        this.transactions.push(tx);
        const key = this.key(kind, seed.slug);
        const existing = this.values.get(key);
        if (existing?.owner === "user") return Promise.resolve({ outcome: "user_conflict", slug: seed.slug });
        if (!existing) {
            this.values.set(key, { owner: "seeded", seed, archived: false });
            return Promise.resolve({ outcome: "created", slug: seed.slug });
        }
        if (!existing.archived && JSON.stringify(existing.seed) === JSON.stringify(seed))
            return Promise.resolve({ outcome: "unchanged", slug: seed.slug });
        this.values.set(key, { owner: "seeded", seed, archived: false });
        return Promise.resolve({ outcome: "updated", slug: seed.slug });
    }

    private archive(kind: Kind, activeSlugs: readonly string[], tx: unknown): Promise<number> {
        this.transactions.push(tx);
        const active = new Set(activeSlugs);
        let count = 0;
        for (const [key, value] of this.values) {
            if (
                !key.startsWith(`${kind}:`) ||
                value.owner !== "seeded" ||
                value.archived ||
                active.has(value.seed.slug)
            )
                continue;
            this.values.set(key, { ...value, archived: true });
            count += 1;
        }
        return Promise.resolve(count);
    }

    private key(kind: Kind, slug: string): string {
        return `${kind}:${slug}`;
    }
}

function seedUseCase(
    repository: TrainingCatalogSeedRepository,
    seed: TrainingCatalogSeed = trainingCatalogSeed,
): SeedTrainingCatalog {
    return new SeedTrainingCatalog(unitOfWork, repository, seed, { now: () => now });
}
