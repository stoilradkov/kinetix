import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";

import { historicalImportReverts, type Database, type HistoricalImportRevertRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    HistoricalImportBlockedEntity,
    HistoricalImportCommitFailure,
    HistoricalImportRevertRepository,
    HistoricalImportRevertState,
    HistoricalImportRevertedEntity,
    StoredHistoricalImportRevert,
} from "#src/modules/training/application/index";

/**
 * Maps the durable historical-import revert run to and from its `historical_import_reverts` row (issue
 * #60, HI6). Identity (`commit_id`, `dry_run_id`, source batch) is fixed at insert; the lifecycle fields
 * (state, the archived-entity checkpoint, blocked entities, attempts, failure, timestamps) are rewritten
 * by `save`. `insertIfAbsent` converges concurrent first-time reverts on one run via the unique
 * `commit_id`; `lockByCommitId` takes `SELECT … FOR UPDATE` so the gate cannot race. Drizzle rows never
 * escape this boundary (ADR 0003); every write runs inside the caller's UnitOfWork.
 */
@Injectable()
export class DrizzleHistoricalImportRevertRepository implements HistoricalImportRevertRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async insertIfAbsent(record: StoredHistoricalImportRevert, transaction: unknown): Promise<boolean> {
        const inserted = await this.executor(transaction)
            .insert(historicalImportReverts)
            .values({
                id: record.id,
                commitId: record.commitId,
                dryRunId: record.dryRunId,
                profileId: record.profileId,
                importBatchId: record.importBatchId,
                state: record.state,
                archivedEntities: record.archivedEntities as unknown as Record<string, unknown>[],
                blockedEntities: record.blockedEntities as unknown as Record<string, unknown>[],
                attempts: record.attempts,
                failure: record.failure as unknown as Record<string, unknown> | null,
                createdAt: record.createdAt,
                startedAt: record.startedAt,
                completedAt: record.completedAt,
                updatedAt: record.updatedAt,
            })
            .onConflictDoNothing({ target: historicalImportReverts.commitId })
            .returning({ id: historicalImportReverts.id });
        return inserted.length > 0;
    }

    async save(record: StoredHistoricalImportRevert, transaction: unknown): Promise<void> {
        await this.executor(transaction)
            .update(historicalImportReverts)
            .set({
                importBatchId: record.importBatchId,
                state: record.state,
                archivedEntities: record.archivedEntities as unknown as Record<string, unknown>[],
                blockedEntities: record.blockedEntities as unknown as Record<string, unknown>[],
                attempts: record.attempts,
                failure: record.failure as unknown as Record<string, unknown> | null,
                startedAt: record.startedAt,
                completedAt: record.completedAt,
                updatedAt: record.updatedAt,
            })
            .where(eq(historicalImportReverts.id, record.id));
    }

    async lockByCommitId(
        commitId: string,
        profileId: string,
        transaction: unknown,
    ): Promise<StoredHistoricalImportRevert | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(historicalImportReverts)
                .where(
                    and(
                        eq(historicalImportReverts.commitId, commitId),
                        eq(historicalImportReverts.profileId, profileId),
                    ),
                )
                .limit(1)
                .for("update")
        )[0];
        return row ? hydrate(row) : null;
    }

    async findByCommitId(
        commitId: string,
        profileId: string,
        transaction?: unknown,
    ): Promise<StoredHistoricalImportRevert | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(historicalImportReverts)
                .where(
                    and(
                        eq(historicalImportReverts.commitId, commitId),
                        eq(historicalImportReverts.profileId, profileId),
                    ),
                )
                .limit(1)
        )[0];
        return row ? hydrate(row) : null;
    }

    async listByProfile(profileId: string, transaction?: unknown): Promise<readonly StoredHistoricalImportRevert[]> {
        const rows = await this.executor(transaction)
            .select()
            .from(historicalImportReverts)
            .where(eq(historicalImportReverts.profileId, profileId))
            .orderBy(desc(historicalImportReverts.createdAt));
        return rows.map(hydrate);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: HistoricalImportRevertRow): StoredHistoricalImportRevert {
    return {
        id: row.id,
        commitId: row.commitId,
        dryRunId: row.dryRunId,
        profileId: row.profileId,
        importBatchId: row.importBatchId,
        state: row.state as HistoricalImportRevertState,
        archivedEntities: (row.archivedEntities ?? []) as unknown as HistoricalImportRevertedEntity[],
        blockedEntities: (row.blockedEntities ?? []) as unknown as HistoricalImportBlockedEntity[],
        attempts: row.attempts,
        failure: (row.failure as unknown as HistoricalImportCommitFailure | null) ?? null,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
    };
}
