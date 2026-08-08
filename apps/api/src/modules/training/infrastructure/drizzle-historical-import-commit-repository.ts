import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { historicalImportCommits, type Database, type HistoricalImportCommitRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    HistoricalImportCommitFailure,
    HistoricalImportCommitRepository,
    HistoricalImportCommitState,
    StoredHistoricalImportCommit,
} from "#src/modules/training/application/index";

/**
 * Maps the durable historical-import commit run to and from its `historical_import_commits` row (issue
 * #59, HI5). Identity (`dry_run_id`, source, mode, idempotency key) is fixed at insert; the lifecycle
 * fields (state, the committed-batch checkpoint, attempts, failure, timestamps) are rewritten by `save`.
 * `insertIfAbsent` converges concurrent first-time starts on one run via the unique `dry_run_id`;
 * `lockByDryRunId` / `lockById` take `SELECT … FOR UPDATE` so the gate cannot race. Drizzle rows never
 * escape this boundary (ADR 0003); every write runs inside the caller's UnitOfWork.
 */
@Injectable()
export class DrizzleHistoricalImportCommitRepository implements HistoricalImportCommitRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async insertIfAbsent(record: StoredHistoricalImportCommit, transaction: unknown): Promise<boolean> {
        const inserted = await this.executor(transaction)
            .insert(historicalImportCommits)
            .values({
                id: record.id,
                dryRunId: record.dryRunId,
                profileId: record.profileId,
                importBatchId: record.importBatchId,
                sourceNamespace: record.sourceNamespace,
                sourceGeneratedBy: record.sourceGeneratedBy,
                mode: record.mode,
                idempotencyKey: record.idempotencyKey,
                state: record.state,
                committedBatchKeys: [...record.committedBatchKeys],
                attempts: record.attempts,
                failure: record.failure as unknown as Record<string, unknown> | null,
                createdAt: record.createdAt,
                startedAt: record.startedAt,
                completedAt: record.completedAt,
                updatedAt: record.updatedAt,
            })
            .onConflictDoNothing({ target: historicalImportCommits.dryRunId })
            .returning({ id: historicalImportCommits.id });
        return inserted.length > 0;
    }

    async save(record: StoredHistoricalImportCommit, transaction: unknown): Promise<void> {
        await this.executor(transaction)
            .update(historicalImportCommits)
            .set({
                importBatchId: record.importBatchId,
                state: record.state,
                committedBatchKeys: [...record.committedBatchKeys],
                attempts: record.attempts,
                failure: record.failure as unknown as Record<string, unknown> | null,
                startedAt: record.startedAt,
                completedAt: record.completedAt,
                updatedAt: record.updatedAt,
            })
            .where(eq(historicalImportCommits.id, record.id));
    }

    async lockByDryRunId(
        dryRunId: string,
        profileId: string,
        transaction: unknown,
    ): Promise<StoredHistoricalImportCommit | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(historicalImportCommits)
                .where(
                    and(
                        eq(historicalImportCommits.dryRunId, dryRunId),
                        eq(historicalImportCommits.profileId, profileId),
                    ),
                )
                .limit(1)
                .for("update")
        )[0];
        return row ? hydrate(row) : null;
    }

    async lockById(id: string, profileId: string, transaction: unknown): Promise<StoredHistoricalImportCommit | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(historicalImportCommits)
                .where(and(eq(historicalImportCommits.id, id), eq(historicalImportCommits.profileId, profileId)))
                .limit(1)
                .for("update")
        )[0];
        return row ? hydrate(row) : null;
    }

    async findById(id: string, profileId: string, transaction?: unknown): Promise<StoredHistoricalImportCommit | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(historicalImportCommits)
                .where(and(eq(historicalImportCommits.id, id), eq(historicalImportCommits.profileId, profileId)))
                .limit(1)
        )[0];
        return row ? hydrate(row) : null;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: HistoricalImportCommitRow): StoredHistoricalImportCommit {
    return {
        id: row.id,
        dryRunId: row.dryRunId,
        profileId: row.profileId,
        importBatchId: row.importBatchId,
        sourceNamespace: row.sourceNamespace,
        sourceGeneratedBy: row.sourceGeneratedBy,
        mode: row.mode as StoredHistoricalImportCommit["mode"],
        idempotencyKey: row.idempotencyKey,
        state: row.state as HistoricalImportCommitState,
        committedBatchKeys: row.committedBatchKeys ?? [],
        attempts: row.attempts,
        failure: (row.failure as unknown as HistoricalImportCommitFailure | null) ?? null,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
    };
}
