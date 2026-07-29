import { afterEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { createDatabase, zoneDefinitions } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { RepositoryZoneContextReader } from "#src/modules/training/application/index";
import { ZoneDefinition, type RecordZoneDefinitionInput } from "#src/modules/training/domain/index";
import { DrizzleZoneDefinitionRepository } from "#src/modules/training/infrastructure/drizzle-zone-definition-repository";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-28T12:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000000d9";
const defA = "0198a4db-d8da-7000-8000-000000001001";
const defB = "0198a4db-d8da-7000-8000-000000001002";

let seq = 100;
function nextId(): string {
    seq += 1;
    return `0198a4db-d8da-7000-8000-0000000${(10000 + seq).toString()}`;
}

function state(id: string, overrides: Partial<RecordZoneDefinitionInput> = {}) {
    return ZoneDefinition.record(
        {
            id,
            profileId,
            family: "heart_rate",
            method: "manual",
            ranges: [
                { id: nextId(), position: 0, name: "Z1", lowerBound: 0, upperBound: 130 },
                { id: nextId(), position: 1, name: "Z2", lowerBound: 130, upperBound: null },
            ],
            ...overrides,
        },
        now,
    ).state;
}

describe.runIf(testDatabaseUrl)("zone definitions PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleZoneDefinitionRepository(connection as unknown as DatabaseService);
    const contextReader = new RepositoryZoneContextReader(repository);

    afterEach(async () => {
        await connection.db.delete(zoneDefinitions).where(eq(zoneDefinitions.profileId, profileId));
    });

    it("stores ranges, closes the interval, and resolves by instant", async () => {
        await repository.insert(state(defA, { effectiveFrom: "2026-01-01T00:00:00.000Z" }), connection.db);
        const open = await repository.findOpenForUpdate(profileId, "heart_rate", connection.db);
        expect(open?.ranges).toHaveLength(2);

        const closed = ZoneDefinition.rehydrate(open!).close("2026-06-01T00:00:00.000Z", now).state;
        await repository.close(defA, closed.effectiveTo!, closed.updatedAt, connection.db);
        await repository.insert(state(defB, { effectiveFrom: "2026-06-01T00:00:00.000Z" }), connection.db);

        expect((await repository.listCurrent(profileId)).map(record => record.id)).toEqual([defB]);
        const resolved = await contextReader.resolveZoneDefinition({
            profileId,
            family: "heart_rate",
            at: "2026-03-01T00:00:00.000Z",
        });
        expect(resolved?.zoneDefinitionId).toBe(defA);
    });

    it("permits only one open definition per family", async () => {
        await repository.insert(state(defA, { effectiveFrom: "2026-01-01T00:00:00.000Z" }), connection.db);
        await expect(
            repository.insert(state(defB, { effectiveFrom: "2026-02-01T00:00:00.000Z" }), connection.db),
        ).rejects.toThrow();
    });
});
