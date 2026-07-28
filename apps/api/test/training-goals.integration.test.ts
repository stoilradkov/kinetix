import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, trainingGoals } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { TrainingGoal, type CreateTrainingGoalInput } from "#src/modules/training/domain/index";
import { DrizzleTrainingGoalRepository } from "#src/modules/training/infrastructure/drizzle-training-goal-repository";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-28T12:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000000f9";
const idA = "0198a4db-d8da-7000-8000-0000000000f1";
const idB = "0198a4db-d8da-7000-8000-0000000000f2";

function state(id: string, overrides: Partial<CreateTrainingGoalInput> = {}) {
    return TrainingGoal.create({ id, profileId, type: "strength", ...overrides }, now).state;
}

describe.runIf(testDatabaseUrl)("training goals PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleTrainingGoalRepository(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(trainingGoals);
    });

    it("round-trips a target and lists goals by priority, filtered by status", async () => {
        await repository.create(
            "training.goal",
            entityId(idA),
            state(idA, { priority: 2, targetValue: "100", targetUnit: "kg" }),
            1,
            connection.db,
        );
        await repository.create("training.goal", entityId(idB), state(idB, { priority: 1 }), 1, connection.db);

        const stored = await repository.readGoal(entityId(idA));
        expect(stored?.targetUnit).toBe("kg");
        expect(Number(stored?.targetValue)).toBe(100);

        const ordered = await repository.listGoals();
        expect(ordered.map(goal => goal.id)).toEqual([idB, idA]);

        const achieved = TrainingGoal.rehydrate(state(idB)).update({ status: "achieved" }, now).state;
        await repository.save("training.goal", entityId(idB), achieved, 1, 2, connection.db);
        expect((await repository.listGoals({ status: "achieved" })).map(goal => goal.id)).toEqual([idB]);
    });

    it("enforces optimistic concurrency on save", async () => {
        await repository.create("training.goal", entityId(idA), state(idA), 1, connection.db);
        const next = TrainingGoal.rehydrate(state(idA)).update({ priority: 5 }, now).state;

        await repository.save("training.goal", entityId(idA), next, 1, 2, connection.db);
        await expect(repository.save("training.goal", entityId(idA), next, 1, 2, connection.db)).rejects.toBeInstanceOf(
            VersionConflictError,
        );
    });
});
