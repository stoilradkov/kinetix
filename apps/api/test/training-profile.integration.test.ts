import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, trainingProfiles } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { ActiveTrainingProfileExistsError } from "#src/modules/training/application/index";
import { TrainingProfile, type CreateTrainingProfileInput } from "#src/modules/training/domain/index";
import { DrizzleTrainingProfileRepository } from "#src/modules/training/infrastructure/drizzle-training-profile-repository";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-27T12:00:00.000Z");
const idA = "0198a4db-d8da-7000-8000-0000000000c1";
const idB = "0198a4db-d8da-7000-8000-0000000000c2";
const coreProfileId = "0198a4db-d8da-7000-8000-0000000000c9";

function state(id: string, overrides: Partial<CreateTrainingProfileInput> = {}) {
    return TrainingProfile.create({ id, profileId: coreProfileId, ...overrides }, now).state;
}

describe.runIf(testDatabaseUrl)("training profile PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleTrainingProfileRepository(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(trainingProfiles);
    });

    it("round-trips analytics defaults including the numeric RPE threshold", async () => {
        await repository.create(
            "training.profile",
            entityId(idA),
            state(idA, { hardSetRpeThreshold: 7.5 }),
            1,
            connection.db,
        );

        expect((await repository.findActive())?.state).toMatchObject({
            id: idA,
            profileId: coreProfileId,
            experience: "beginner",
            oneRepMaxRepCutoff: 12,
            hardSetRpeThreshold: 7.5,
            hardSetRirThreshold: 3,
        });
    });

    it("rejects a second active training profile at the database level", async () => {
        await repository.create("training.profile", entityId(idA), state(idA), 1, connection.db);

        await expect(
            repository.create("training.profile", entityId(idB), state(idB), 1, connection.db),
        ).rejects.toBeInstanceOf(ActiveTrainingProfileExistsError);
    });

    it("enforces optimistic concurrency on save", async () => {
        await repository.create("training.profile", entityId(idA), state(idA), 1, connection.db);
        const next = TrainingProfile.rehydrate(state(idA)).update({ ruleVersion: 2 }, now).state;

        await repository.save("training.profile", entityId(idA), next, 1, 2, connection.db);
        expect((await repository.findActive())?.version).toBe(2);

        await expect(
            repository.save("training.profile", entityId(idA), next, 1, 2, connection.db),
        ).rejects.toBeInstanceOf(VersionConflictError);
    });
});
