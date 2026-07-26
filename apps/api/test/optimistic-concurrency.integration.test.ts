import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, entityRevisions, moduleInstances } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    MigratingSnapshotSerializer,
    RevisionMutationService,
    StaleAggregateVersionError,
    type CurrentStateStore,
    type TransactionalEventPublisher,
    type UnitOfWork,
} from "#src/platform/application/index";
import { entityId, type EntityId } from "#src/platform/domain/index";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";

const testDatabaseUrl = process.env.REVISION_TEST_DATABASE_URL;

describe.runIf(testDatabaseUrl)("PostgreSQL optimistic concurrency", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const revisions = new DrizzleRevisionStore(connection as unknown as DatabaseService);
    const usedIds: EntityId[] = [];

    beforeAll(async () => {
        await connection.db.select({ id: moduleInstances.id }).from(moduleInstances).limit(1);
    });

    afterEach(async () => {
        for (const id of usedIds.splice(0)) {
            await connection.db.delete(entityRevisions).where(eq(entityRevisions.entityId, id));
            await connection.db.delete(moduleInstances).where(eq(moduleInstances.id, id));
        }
    });

    afterAll(async () => {
        await connection.client.end({ timeout: 5 });
    });

    it("allows one of two clients with the same expected version to commit", async () => {
        const id = entityId(randomUUID());
        usedIds.push(id);
        await connection.db.insert(moduleInstances).values({
            id,
            moduleType: "integration-test",
            name: "Original",
            slug: `integration-${id}`,
        });

        type State = { name: string };
        const unitOfWork: UnitOfWork<unknown> = {
            execute: work => connection.db.transaction(transaction => work(transaction)),
        };
        const states: CurrentStateStore<State, unknown> = {
            loadForUpdate: async (_entityType, entity, transaction) => {
                const rows = await (transaction as typeof connection.db)
                    .select({ name: moduleInstances.name, version: moduleInstances.version })
                    .from(moduleInstances)
                    .where(eq(moduleInstances.id, entity))
                    .limit(1)
                    .for("update");
                const row = rows[0];
                return row ? { state: { name: row.name }, version: row.version } : null;
            },
            create: async () => undefined,
            save: async (_entityType, entity, state, expectedVersion, nextVersion, transaction) => {
                const rows = await (transaction as typeof connection.db)
                    .update(moduleInstances)
                    .set({ name: state.name, version: nextVersion, updatedAt: new Date() })
                    .where(and(eq(moduleInstances.id, entity), eq(moduleInstances.version, expectedVersion)))
                    .returning({ id: moduleInstances.id });
                if (rows.length !== 1) throw new Error("Concurrent state update was not persisted");
            },
        };
        const events: TransactionalEventPublisher<never, unknown> = {
            publish: async () => undefined,
        };
        const service = new RevisionMutationService(
            unitOfWork,
            states,
            revisions,
            new MigratingSnapshotSerializer<State>(
                1,
                state => state,
                value => value as State,
                [],
            ),
            events,
        );
        const mutate = (name: string) =>
            service.mutate({
                entityType: "integration-test-module",
                entityId: id,
                expectedVersion: 1,
                change: () => ({ state: { name } }),
                metadata: {
                    source: "agent",
                    summary: `Renamed to ${name}`,
                    correlationId: randomUUID(),
                },
            });

        const results = await Promise.allSettled([mutate("Client A"), mutate("Client B")]);

        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find(result => result.status === "rejected");
        expect(rejected).toMatchObject({
            reason: expect.any(StaleAggregateVersionError),
        });
        const rows = await connection.db
            .select({ version: moduleInstances.version })
            .from(moduleInstances)
            .where(eq(moduleInstances.id, id));
        expect(rows[0]?.version).toBe(2);
    });
});
