import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, entityRevisions } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import type { EntityRevision } from "#src/platform/application/index";
import { entityId, type EntityId } from "#src/platform/domain/index";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";

const testDatabaseUrl = process.env.REVISION_TEST_DATABASE_URL;

describe.runIf(testDatabaseUrl)("Drizzle revision persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const store = new DrizzleRevisionStore(connection as unknown as DatabaseService);
    const usedIds: EntityId[] = [];

    beforeAll(async () => {
        await connection.db.select({ id: entityRevisions.id }).from(entityRevisions).limit(1);
    });

    afterEach(async () => {
        for (const id of usedIds.splice(0))
            await connection.db.delete(entityRevisions).where(eq(entityRevisions.entityId, id));
    });

    afterAll(async () => {
        await connection.client.end({ timeout: 5 });
    });

    it("rolls revision inserts back with the surrounding transaction", async () => {
        const revision = createRevision(1, { name: "rolled back" });

        await expect(
            connection.db.transaction(async transaction => {
                await store.append(revision, transaction);
                throw new Error("abort transaction");
            }),
        ).rejects.toThrow("abort transaction");

        await expect(store.find(revision.entityType, revision.entityId, 1)).resolves.toBeNull();
    });

    it("round-trips JSON and pages history newest first", async () => {
        const first = createRevision(1, { name: "First", nested: { count: 1 } });
        await connection.db.transaction(async transaction => {
            await store.append(first, transaction);
            await store.append({ ...first, version: 2, snapshot: { name: "Second" } }, transaction);
            await store.append({ ...first, version: 3, snapshot: { name: "Third" } }, transaction);
        });

        await expect(store.find(first.entityType, first.entityId, 1)).resolves.toMatchObject({
            snapshot: { name: "First", nested: { count: 1 } },
        });
        await expect(store.history(first.entityType, first.entityId, 2)).resolves.toMatchObject({
            items: [{ version: 3 }, { version: 2 }],
            nextCursor: 2,
        });
        await expect(store.history(first.entityType, first.entityId, 2, 2)).resolves.toMatchObject({
            items: [{ version: 1 }],
            nextCursor: null,
        });
    });

    it("allows only one concurrent append for an entity version", async () => {
        const revision = createRevision(1, { name: "Concurrent" });

        const results = await Promise.allSettled([
            connection.db.transaction(transaction => store.append(revision, transaction)),
            connection.db.transaction(transaction => store.append(revision, transaction)),
        ]);

        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    });

    function createRevision(version: number, snapshot: unknown): EntityRevision {
        const id = entityId(randomUUID());
        usedIds.push(id);
        return {
            entityType: "integration-test-program",
            entityId: id,
            version,
            schemaVersion: 1,
            snapshot,
            source: "system",
            actorId: null,
            reason: null,
            summary: `Created revision ${version}`,
            correlationId: randomUUID(),
            createdAt: new Date(),
        };
    }
});
