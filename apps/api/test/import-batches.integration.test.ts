import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { bulkExternalIds, createDatabase, importBatches } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    ImportBatchQueryService,
    RegisterImportBatch,
    type BulkExternalIdEntry,
    type RegisterImportBatchInput,
} from "#src/modules/training/application/index";
import { DrizzleBulkExternalIdRegistry } from "#src/modules/training/infrastructure/drizzle-bulk-external-id-registry";
import { DrizzleImportBatchRepository } from "#src/modules/training/infrastructure/drizzle-import-batch-repository";
import { ImportPayloadConflictError, type UnitOfWork } from "#src/platform/application/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const profileId = randomUUID();
const namespace = `import-hi2-${randomUUID().slice(0, 8)}`;
const CHECKSUM = "a".repeat(64);
const OTHER_CHECKSUM = "b".repeat(64);

function source(payloadId: string, checksum = CHECKSUM): RegisterImportBatchInput {
    return { source: { namespace, payloadId, schemaVersion: 1, checksum } };
}

describe.runIf(testDatabaseUrl)("import batch PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const repository = new DrizzleImportBatchRepository(db);
    const registry = new DrizzleBulkExternalIdRegistry(db);
    const profileReader = { requireActiveProfileId: async () => profileId };
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const register = new RegisterImportBatch({ unitOfWork, repository, profileReader, generateId: randomUUID });
    const query = new ImportBatchQueryService({ repository, externalIds: registry, profileReader });

    beforeEach(async () => {
        await connection.db.delete(bulkExternalIds).where(eq(bulkExternalIds.profileId, profileId));
        await connection.db.delete(importBatches).where(eq(importBatches.profileId, profileId));
    });

    afterAll(async () => {
        try {
            await connection.db.delete(bulkExternalIds).where(eq(bulkExternalIds.profileId, profileId));
            await connection.db.delete(importBatches).where(eq(importBatches.profileId, profileId));
        } catch {
            // Best-effort cleanup.
        }
    });

    it("opens a pending batch and re-resolves the same identity to the same row", async () => {
        const first = await register.execute(source("archive-1"));
        expect(first).toMatchObject({ state: "pending", resolved: false });

        const second = await register.execute(source("archive-1"));
        expect(second.id).toBe(first.id);
        expect(second.resolved).toBe(true);

        const rows = await connection.db.select().from(importBatches).where(eq(importBatches.profileId, profileId));
        expect(rows).toHaveLength(1);
    });

    it("rejects a reused payload id with different canonical content as a conflict", async () => {
        await register.execute(source("archive-2"));
        await expect(register.execute(source("archive-2", OTHER_CHECKSUM))).rejects.toBeInstanceOf(
            ImportPayloadConflictError,
        );
        const rows = await connection.db.select().from(importBatches).where(eq(importBatches.profileId, profileId));
        expect(rows).toHaveLength(1);
    });

    it("converges concurrent first-time registrations of the same identity on one batch", async () => {
        const [a, b] = await Promise.all([
            register.execute(source("archive-3")),
            register.execute(source("archive-3")),
        ]);
        expect(a.id).toBe(b.id);
        // Exactly one opened it; the other resolved the winner.
        expect([a.resolved, b.resolved].filter(Boolean)).toHaveLength(1);

        const rows = await connection.db.select().from(importBatches).where(eq(importBatches.profileId, profileId));
        expect(rows).toHaveLength(1);
    });

    it("traces registered external ids back to a batch and enforces namespace/type/id uniqueness", async () => {
        const batch = await register.execute(source("archive-4"));
        const programId = randomUUID();
        const sessionId = randomUUID();
        const entries: BulkExternalIdEntry[] = [
            { entityType: "program", externalId: "prog-1", entityId: programId },
            { entityType: "training-session", externalId: "sess-1", entityId: sessionId },
        ];
        await connection.db.transaction(async tx =>
            registry.register({ profileId, namespace, importBatchId: batch.id, entries }, tx),
        );

        const mappings = await query.listMappings(batch.id);
        expect(mappings.count).toBe(2);
        expect(mappings.mappings).toEqual([
            { entityType: "program", externalId: "prog-1", entityId: programId },
            { entityType: "training-session", externalId: "sess-1", entityId: sessionId },
        ]);

        // Re-registering the same (namespace, type, external id) conflicts at the DB uniqueness index.
        await expect(
            connection.db.transaction(async tx =>
                registry.register({ profileId, namespace, importBatchId: batch.id, entries: [entries[0]!] }, tx),
            ),
        ).rejects.toMatchObject({ code: "EXTERNAL_ID_CONFLICT" });
    });

    it("stores identity for both program and completed-session aggregates under one batch", async () => {
        const batch = await register.execute(source("archive-5"));
        const entries: BulkExternalIdEntry[] = [
            { entityType: "program", externalId: "p", entityId: randomUUID() },
            { entityType: "program-block", externalId: "b", entityId: randomUUID() },
            { entityType: "planned-session", externalId: "ps", entityId: randomUUID() },
            { entityType: "training-session", externalId: "ts", entityId: randomUUID() },
            { entityType: "session-activity", externalId: "sa", entityId: randomUUID() },
            { entityType: "occurrence", externalId: "occ", entityId: randomUUID() },
            { entityType: "set-group", externalId: "sg", entityId: randomUUID() },
            { entityType: "performed-set", externalId: "pset", entityId: randomUUID() },
        ];
        await connection.db.transaction(async tx =>
            registry.register({ profileId, namespace, importBatchId: batch.id, entries }, tx),
        );
        const mappings = await query.listMappings(batch.id);
        expect(mappings.count).toBe(entries.length);
    });
});
