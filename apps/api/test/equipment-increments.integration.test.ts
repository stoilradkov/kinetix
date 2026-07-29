import { afterEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { createDatabase, equipmentIncrements } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { EQUIPMENT_INCREMENT_ENTITY_TYPE } from "#src/modules/training/application/index";
import { EquipmentIncrement, type CreateEquipmentIncrementInput } from "#src/modules/training/domain/index";
import { DrizzleEquipmentIncrementRepository } from "#src/modules/training/infrastructure/drizzle-equipment-increment-repository";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-28T12:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000000d9";
const idA = "0198a4db-d8da-7000-8000-000000002001";
const idB = "0198a4db-d8da-7000-8000-000000002002";

function state(id: string, overrides: Partial<CreateEquipmentIncrementInput> = {}) {
    return EquipmentIncrement.create(
        { id, profileId, scope: "default", increment: { value: 2.5, unit: "kg" }, ...overrides },
        now,
    ).state;
}

describe.runIf(testDatabaseUrl)("equipment increments PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleEquipmentIncrementRepository(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(equipmentIncrements).where(eq(equipmentIncrements.profileId, profileId));
    });

    it("round-trips an increment and enforces optimistic concurrency", async () => {
        await repository.create(EQUIPMENT_INCREMENT_ENTITY_TYPE, entityId(idA), state(idA), 1, connection.db);
        const stored = await repository.read(entityId(idA));
        expect(stored).toMatchObject({ scope: "default", incrementKg: "2.5", version: 1 });

        const next = EquipmentIncrement.rehydrate(state(idA)).update(
            { increment: { value: 5, unit: "kg" } },
            now,
        ).state;
        await repository.save(EQUIPMENT_INCREMENT_ENTITY_TYPE, entityId(idA), next, 1, 2, connection.db);
        await expect(
            repository.save(EQUIPMENT_INCREMENT_ENTITY_TYPE, entityId(idA), next, 1, 2, connection.db),
        ).rejects.toBeInstanceOf(VersionConflictError);
    });

    it("permits only one default increment per profile", async () => {
        await repository.create(EQUIPMENT_INCREMENT_ENTITY_TYPE, entityId(idA), state(idA), 1, connection.db);
        await expect(
            repository.create(EQUIPMENT_INCREMENT_ENTITY_TYPE, entityId(idB), state(idB), 1, connection.db),
        ).rejects.toThrow();
    });
});
