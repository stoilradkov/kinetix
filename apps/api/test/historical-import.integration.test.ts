import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { createDatabase, historicalImportDryRuns } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { DrizzleHistoricalImportDryRunRepository } from "#src/modules/training/infrastructure/drizzle-historical-import-dry-run-repository";
import type { StoredHistoricalImportDryRun } from "#src/modules/training/application/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const profileId = randomUUID();
const namespace = `import-hi4-${randomUUID().slice(0, 8)}`;

/**
 * Persistence coverage for the HI4 historical dry-run artifact (issue #58). Gated on a real PostgreSQL
 * via `PROFILE_TEST_DATABASE_URL`; skipped otherwise. Every row is scoped to a throwaway `profileId` and
 * cleaned up, so it never collides with seeded data.
 */
describe.runIf(testDatabaseUrl)("historical import dry-run PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const repository = new DrizzleHistoricalImportDryRunRepository(db);

    function artifact(overrides: Partial<StoredHistoricalImportDryRun> = {}): StoredHistoricalImportDryRun {
        const now = new Date("2026-08-01T10:00:00.000Z");
        return {
            id: randomUUID(),
            profileId,
            schemaVersion: 1,
            sourceNamespace: namespace,
            sourceGeneratedBy: "coach-app@1.0.0",
            payloadId: "archive-2024",
            checksum: "a".repeat(64),
            mode: "create",
            state: "ready",
            referenceHash: "b".repeat(64),
            approvalToken: randomUUID(),
            programs: [],
            completedSessions: [],
            storagePlan: {
                namespace,
                mode: "create",
                entries: [],
                counts: { create: 0, update: 0, "skip-identical": 0, conflict: 0 },
                conflicts: [],
                hasConflicts: false,
            },
            summary: {
                programs: 0,
                completedSessions: 0,
                entities: 0,
                operations: { create: 0, update: 0, "skip-identical": 0, conflict: 0 },
                entityTypeCounts: [],
            },
            warnings: [],
            errors: [],
            mappings: [],
            proposedExercises: [],
            affectedVersions: [],
            createdAt: now,
            expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
            consumedAt: null,
            ...overrides,
        };
    }

    afterAll(async () => {
        try {
            await connection.db.delete(historicalImportDryRuns).where(eq(historicalImportDryRuns.profileId, profileId));
        } catch {
            // Best-effort cleanup.
        }
    });

    it("round-trips a saved artifact, preserving expiry and JSON columns", async () => {
        const record = artifact({
            storagePlan: {
                namespace,
                mode: "create",
                entries: [
                    {
                        path: ["completedSessions", 0],
                        entityType: "training-session",
                        externalId: "ts-1",
                        operation: "create",
                        currentEntityId: null,
                        currentVersion: null,
                        conflictCode: null,
                    },
                ],
                counts: { create: 1, update: 0, "skip-identical": 0, conflict: 0 },
                conflicts: [],
                hasConflicts: false,
            },
            summary: {
                programs: 0,
                completedSessions: 1,
                entities: 1,
                operations: { create: 1, update: 0, "skip-identical": 0, conflict: 0 },
                entityTypeCounts: [{ entityType: "training-session", count: 1 }],
            },
            affectedVersions: [{ entityType: "training.exercise", entityId: randomUUID(), version: 3 }],
        });
        await connection.db.transaction(async tx => {
            await repository.save(record, tx);
        });

        const loaded = await repository.findById(record.id);
        expect(loaded).not.toBeNull();
        expect(loaded!.id).toBe(record.id);
        expect(loaded!.checksum).toBe(record.checksum);
        expect(loaded!.expiresAt.getTime()).toBe(record.expiresAt.getTime());
        expect(loaded!.consumedAt).toBeNull();
        expect(loaded!.storagePlan.entries).toHaveLength(1);
        expect(loaded!.storagePlan.entries[0]!.operation).toBe("create");
        expect(loaded!.summary.entityTypeCounts[0]).toEqual({ entityType: "training-session", count: 1 });
        expect(loaded!.affectedVersions[0]!.version).toBe(3);
    });

    it("returns null for an unknown dry-run id", async () => {
        expect(await repository.findById(randomUUID())).toBeNull();
    });
});
