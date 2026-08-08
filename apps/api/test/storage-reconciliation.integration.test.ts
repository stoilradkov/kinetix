import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { bulkExternalIds, createDatabase, programs } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    ReconcileImportStorage,
    fingerprintImportContent,
    type BulkExternalIdEntry,
} from "#src/modules/training/application/index";
import { DrizzleBulkExternalIdRegistry } from "#src/modules/training/infrastructure/drizzle-bulk-external-id-registry";
import { DrizzleImportStorageReadPort } from "#src/modules/training/infrastructure/drizzle-import-storage-read-port";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const profileId = randomUUID();
const namespace = `import-hi3-${randomUUID().slice(0, 8)}`;

/**
 * Batched persistence + concurrent-change coverage for the HI3 read port (issue #57). Gated on a real
 * PostgreSQL via `PROFILE_TEST_DATABASE_URL`; skipped otherwise. Every row is scoped to a throwaway
 * `profileId`/`namespace` and cleaned around each test so it never collides with seeded data.
 */
describe.runIf(testDatabaseUrl)("storage reconciliation PostgreSQL read port", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const registry = new DrizzleBulkExternalIdRegistry(db);
    const readPort = new DrizzleImportStorageReadPort(db);
    const service = new ReconcileImportStorage({ readPort });

    async function insertProgram(name: string, version: number): Promise<string> {
        const id = randomUUID();
        await connection.db.insert(programs).values({ id, profileId, name, version });
        return id;
    }

    async function register(entries: readonly BulkExternalIdEntry[]): Promise<void> {
        await connection.db.transaction(async tx => {
            await registry.register({ profileId, namespace, entries }, tx);
        });
    }

    beforeEach(async () => {
        await connection.db.delete(bulkExternalIds).where(eq(bulkExternalIds.profileId, profileId));
        await connection.db.delete(programs).where(eq(programs.profileId, profileId));
    });

    afterAll(async () => {
        try {
            await connection.db.delete(bulkExternalIds).where(eq(bulkExternalIds.profileId, profileId));
            await connection.db.delete(programs).where(eq(programs.profileId, profileId));
        } catch {
            // Best-effort cleanup.
        }
    });

    it("resolves batched mappings + live versions and classifies skip/update/create in one plan", async () => {
        const fpA = fingerprintImportContent({ name: "5x5" });
        const fpB = fingerprintImportContent({ name: "PPL" });
        const progA = await insertProgram("5x5", 1);
        const progB = await insertProgram("PPL", 3);
        await register([
            { entityType: "program", externalId: "prog-a", entityId: progA, contentFingerprint: fpA },
            { entityType: "program", externalId: "prog-b", entityId: progB, contentFingerprint: fpB },
        ]);

        const plan = await service.execute(
            [
                { path: ["a"], entityType: "program", externalId: "prog-a", incomingFingerprint: fpA },
                {
                    path: ["b"],
                    entityType: "program",
                    externalId: "prog-b",
                    incomingFingerprint: fingerprintImportContent({ name: "PPL v2" }),
                    expectedVersion: 3,
                },
                {
                    path: ["c"],
                    entityType: "program",
                    externalId: "prog-c",
                    incomingFingerprint: fingerprintImportContent({ name: "New" }),
                },
            ],
            { namespace, mode: "upsert" },
        );

        expect(plan.entries.map(e => e.operation)).toEqual(["skip-identical", "update", "create"]);
        expect(plan.entries[1]).toMatchObject({ currentEntityId: progB, currentVersion: 3 });
    });

    it("classifies a concurrently modified target as a version-mismatch conflict", async () => {
        const fp = fingerprintImportContent({ name: "5x5" });
        const progId = await insertProgram("5x5", 1);
        await register([{ entityType: "program", externalId: "prog-a", entityId: progId, contentFingerprint: fp }]);

        // A user (or a prior import) modifies the program underneath the caller, bumping its version.
        await connection.db.update(programs).set({ version: 2 }).where(eq(programs.id, progId));

        const plan = await service.execute(
            [
                {
                    path: ["a"],
                    entityType: "program",
                    externalId: "prog-a",
                    incomingFingerprint: fingerprintImportContent({ name: "5x5 revised" }),
                    expectedVersion: 1,
                },
            ],
            { namespace, mode: "upsert" },
        );

        expect(plan.entries[0]).toMatchObject({
            operation: "conflict",
            conflictCode: "VERSION_MISMATCH",
            currentEntityId: progId,
            currentVersion: 2,
        });
    });

    it("treats a byte-identical replay of the whole batch as all skip-identical", async () => {
        const fp = fingerprintImportContent({ name: "5x5" });
        const progId = await insertProgram("5x5", 1);
        await register([{ entityType: "program", externalId: "prog-a", entityId: progId, contentFingerprint: fp }]);

        const replay = () =>
            service.execute([{ path: ["a"], entityType: "program", externalId: "prog-a", incomingFingerprint: fp }], {
                namespace,
                mode: "create",
            });

        expect((await replay()).entries[0]).toMatchObject({ operation: "skip-identical", currentEntityId: progId });
        expect((await replay()).entries[0]).toMatchObject({ operation: "skip-identical", currentEntityId: progId });
    });
});
