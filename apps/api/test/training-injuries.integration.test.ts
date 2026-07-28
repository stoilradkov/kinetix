import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, trainingInjuries } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { TrainingInjury, type CreateTrainingInjuryInput } from "#src/modules/training/domain/index";
import { DrizzleTrainingInjuryRepository } from "#src/modules/training/infrastructure/drizzle-training-injury-repository";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-28T12:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000000f9";
const idA = "0198a4db-d8da-7000-8000-0000000000f1";
const idB = "0198a4db-d8da-7000-8000-0000000000f2";
const muscle = "0198a4db-d8da-7000-8000-0000000000fa";
const exercise = "0198a4db-d8da-7000-8000-0000000000fb";

function state(id: string, overrides: Partial<CreateTrainingInjuryInput> = {}) {
    return TrainingInjury.create({ id, profileId, name: "Shoulder strain", bodyArea: "shoulder", ...overrides }, now)
        .state;
}

describe.runIf(testDatabaseUrl)("training injuries PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleTrainingInjuryRepository(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(trainingInjuries);
    });

    it("round-trips catalog links and lists injuries filtered by status", async () => {
        await repository.create(
            "training.injury",
            entityId(idA),
            state(idA, { onsetDate: "2026-07-20", muscleGroupIds: [muscle], exerciseIds: [exercise], side: "left" }),
            1,
            connection.db,
        );
        await repository.create(
            "training.injury",
            entityId(idB),
            state(idB, { onsetDate: "2026-07-10" }),
            1,
            connection.db,
        );

        const stored = await repository.readInjury(entityId(idA));
        expect(stored?.side).toBe("left");
        expect(stored?.muscleGroupIds).toEqual([muscle]);
        expect(stored?.exerciseIds).toEqual([exercise]);

        const ordered = await repository.listInjuries();
        expect(ordered.map(injury => injury.id)).toEqual([idB, idA]);

        const resolved = TrainingInjury.rehydrate(state(idB, { onsetDate: "2026-07-10" })).update(
            { status: "resolved", resolvedDate: "2026-07-25" },
            now,
        ).state;
        await repository.save("training.injury", entityId(idB), resolved, 1, 2, connection.db);
        expect((await repository.listInjuries({ status: "resolved" })).map(injury => injury.id)).toEqual([idB]);
    });

    it("replaces links on save and enforces optimistic concurrency", async () => {
        await repository.create(
            "training.injury",
            entityId(idA),
            state(idA, { muscleGroupIds: [muscle] }),
            1,
            connection.db,
        );
        const relinked = TrainingInjury.rehydrate(state(idA, { muscleGroupIds: [muscle] })).update(
            { muscleGroupIds: [], exerciseIds: [exercise] },
            now,
        ).state;

        await repository.save("training.injury", entityId(idA), relinked, 1, 2, connection.db);
        const stored = await repository.readInjury(entityId(idA));
        expect(stored?.muscleGroupIds).toEqual([]);
        expect(stored?.exerciseIds).toEqual([exercise]);

        await expect(
            repository.save("training.injury", entityId(idA), relinked, 1, 2, connection.db),
        ).rejects.toBeInstanceOf(VersionConflictError);
    });
});
