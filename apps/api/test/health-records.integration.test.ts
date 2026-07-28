import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, healthRecords } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    ManualHealthRecord,
    type CreateManualHealthRecordInput,
    type HealthRecordBody,
} from "#src/modules/health-data/domain/index";
import { DrizzleHealthRecordRepository } from "#src/modules/health-data/infrastructure/drizzle-health-record-repository";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-28T12:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000000b9";
const ids = {
    weight: "0198a4db-d8da-7000-8000-0000000000b1",
    sleep: "0198a4db-d8da-7000-8000-0000000000b2",
    readiness: "0198a4db-d8da-7000-8000-0000000000b3",
} as const;

function state(id: string, body: HealthRecordBody, overrides: Partial<CreateManualHealthRecordInput> = {}) {
    return ManualHealthRecord.create(
        { id, profileId, effectiveAt: "2026-07-28T06:30:00.000Z", body, ...overrides },
        now,
    ).state;
}

describe.runIf(testDatabaseUrl)("health records PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleHealthRecordRepository(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(healthRecords);
    });

    it("round-trips promoted numeric fields and schema-versioned JSON per type", async () => {
        await repository.create(
            "health.record",
            entityId(ids.weight),
            state(ids.weight, { type: "body_weight", massKg: 82.125 }),
            1,
            connection.db,
        );
        await repository.create(
            "health.record",
            entityId(ids.sleep),
            state(
                ids.sleep,
                { type: "sleep", startAt: "2026-07-27T22:00:00.000Z", endAt: "2026-07-28T06:00:00.000Z" },
                { effectiveAt: "2026-07-28T06:00:00.000Z" },
            ),
            1,
            connection.db,
        );

        const weight = await repository.readRecord(entityId(ids.weight));
        expect(weight).toMatchObject({ type: "body_weight", body: { massKg: 82.125 }, bodySchemaVersion: 1 });

        const [row] = await connection.db.select().from(healthRecords).where(eq(healthRecords.id, ids.sleep));
        expect(row?.sleepDurationMinutes).toBe(480);
        expect(row?.massKg).toBeNull();
        expect(row?.data).toMatchObject({ type: "sleep" });
    });

    it("filters by type and effective-time window and excludes archived records", async () => {
        await repository.create(
            "health.record",
            entityId(ids.readiness),
            state(
                ids.readiness,
                { type: "daily_readiness", score: 72, scaleMin: 0, scaleMax: 100 },
                { effectiveAt: "2026-07-20T06:00:00.000Z" },
            ),
            1,
            connection.db,
        );
        await repository.create(
            "health.record",
            entityId(ids.weight),
            state(ids.weight, { type: "body_weight", massKg: 80 }, { effectiveAt: "2026-07-25T06:00:00.000Z" }),
            1,
            connection.db,
        );

        const july = await repository.listRecords({ from: "2026-07-24T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z" });
        expect(july.map(record => record.id)).toEqual([ids.weight]);

        const archived = ManualHealthRecord.rehydrate(
            state(ids.weight, { type: "body_weight", massKg: 80 }, { effectiveAt: "2026-07-25T06:00:00.000Z" }),
        ).archive(now).state;
        await repository.save("health.record", entityId(ids.weight), archived, 1, 2, connection.db);
        expect((await repository.listRecords({ type: "body_weight" })).map(record => record.id)).toEqual([]);
        expect((await repository.listRecords({ type: "body_weight", includeArchived: true })).map(r => r.id)).toEqual([
            ids.weight,
        ]);
    });

    it("enforces optimistic concurrency on save", async () => {
        await repository.create(
            "health.record",
            entityId(ids.weight),
            state(ids.weight, { type: "body_weight", massKg: 80 }),
            1,
            connection.db,
        );
        const next = ManualHealthRecord.rehydrate(state(ids.weight, { type: "body_weight", massKg: 80 })).update(
            { body: { type: "body_weight", massKg: 79 } },
            now,
        ).state;
        await repository.save("health.record", entityId(ids.weight), next, 1, 2, connection.db);
        await expect(
            repository.save("health.record", entityId(ids.weight), next, 1, 2, connection.db),
        ).rejects.toBeInstanceOf(VersionConflictError);
    });
});
