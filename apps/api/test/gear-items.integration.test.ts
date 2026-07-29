import { afterEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { createDatabase, gearItems } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { GEAR_ITEM_ENTITY_TYPE } from "#src/modules/training/application/index";
import { GearItem, type CreateGearItemInput } from "#src/modules/training/domain/index";
import { DrizzleGearItemRepository } from "#src/modules/training/infrastructure/drizzle-gear-item-repository";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-28T12:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000000d9";
const idA = "0198a4db-d8da-7000-8000-000000003001";

function state(id: string, overrides: Partial<CreateGearItemInput> = {}) {
    return GearItem.create({ id, profileId, name: "Daily Trainers", gearType: "shoes", ...overrides }, now).state;
}

describe.runIf(testDatabaseUrl)("gear items PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleGearItemRepository(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(gearItems).where(eq(gearItems.profileId, profileId));
    });

    it("round-trips gear, filters archived, and enforces optimistic concurrency", async () => {
        await repository.create(
            GEAR_ITEM_ENTITY_TYPE,
            entityId(idA),
            state(idA, { distanceLimit: { value: 800, unit: "km" } }),
            1,
            connection.db,
        );
        const stored = await repository.readGear(entityId(idA));
        expect(stored).toMatchObject({ status: "active", distanceLimitM: "800000" });

        const archived = GearItem.rehydrate(state(idA)).archive(now).state;
        await repository.save(GEAR_ITEM_ENTITY_TYPE, entityId(idA), archived, 1, 2, connection.db);
        expect(await repository.listGear()).toHaveLength(0);
        expect(await repository.listGear({ includeArchived: true })).toHaveLength(1);

        await expect(
            repository.save(GEAR_ITEM_ENTITY_TYPE, entityId(idA), archived, 1, 2, connection.db),
        ).rejects.toBeInstanceOf(VersionConflictError);
    });
});
