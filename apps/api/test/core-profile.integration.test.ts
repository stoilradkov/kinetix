import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, profiles } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { ActiveCoreProfileExistsError } from "#src/modules/profile/application/index";
import { CoreProfile, type CreateCoreProfileInput } from "#src/modules/profile/domain/index";
import { DrizzleCoreProfileRepository } from "#src/modules/profile/infrastructure/drizzle-core-profile-repository";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-27T12:00:00.000Z");
const idA = "0198a4db-d8da-7000-8000-0000000000a1";
const idB = "0198a4db-d8da-7000-8000-0000000000a2";

function state(id: string, overrides: Partial<CreateCoreProfileInput> = {}) {
    return CoreProfile.create(
        { id, timeZone: "Europe/Sofia", unitPreferences: { mass: "kg", distance: "km", length: "cm" }, ...overrides },
        now,
    ).state;
}

describe.runIf(testDatabaseUrl)("core profile PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleCoreProfileRepository(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(profiles);
    });

    it("round-trips the active profile and its canonical height", async () => {
        await repository.create("profile.core", entityId(idA), state(idA, { heightMeters: "1.780" }), 1, connection.db);

        const active = await repository.findActive();
        expect(active).toMatchObject({
            version: 1,
            state: { id: idA, heightMeters: "1.780", timeZone: "Europe/Sofia" },
        });
    });

    it("rejects a second active profile at the database level", async () => {
        await repository.create("profile.core", entityId(idA), state(idA), 1, connection.db);

        await expect(
            repository.create("profile.core", entityId(idB), state(idB), 1, connection.db),
        ).rejects.toBeInstanceOf(ActiveCoreProfileExistsError);
    });

    it("enforces optimistic concurrency on save", async () => {
        await repository.create("profile.core", entityId(idA), state(idA), 1, connection.db);
        const next = CoreProfile.rehydrate(state(idA)).update({ timeZone: "UTC" }, now).state;

        await repository.save("profile.core", entityId(idA), next, 1, 2, connection.db);
        expect((await repository.findActive())?.version).toBe(2);

        await expect(repository.save("profile.core", entityId(idA), next, 1, 2, connection.db)).rejects.toBeInstanceOf(
            VersionConflictError,
        );
    });
});
