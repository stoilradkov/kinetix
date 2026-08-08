import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { importBatches, type Database, type ImportBatchRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { ImportBatchRepository } from "#src/modules/training/application/index";
import type { ImportBatchSnapshot } from "#src/modules/training/domain/index";

/**
 * Maps the import-batch aggregate to and from `import_batches` (design §14.5, HI2). `insertIfAbsent`
 * is an `INSERT … ON CONFLICT (source_namespace, payload_id) DO NOTHING`, so a first-time registration
 * racing a concurrent one converges on a single batch without aborting the transaction — the loser
 * reads `false` and re-reads the winning row. `lockByIdentity` takes `SELECT … FOR UPDATE` so a caller
 * that already sees the row serializes against concurrent commits. Drizzle rows never escape this
 * boundary (ADR 0003), and every write runs inside the caller's transaction.
 */
@Injectable()
export class DrizzleImportBatchRepository implements ImportBatchRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async lockByIdentity(
        profileId: string,
        namespace: string,
        payloadId: string,
        transaction: unknown,
    ): Promise<ImportBatchSnapshot | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(importBatches)
                .where(
                    and(
                        eq(importBatches.profileId, profileId),
                        eq(importBatches.sourceNamespace, namespace),
                        eq(importBatches.payloadId, payloadId),
                    ),
                )
                .limit(1)
                .for("update")
        )[0];
        return row ? hydrate(row) : null;
    }

    async insertIfAbsent(record: ImportBatchSnapshot, transaction: unknown): Promise<boolean> {
        const inserted = await this.executor(transaction)
            .insert(importBatches)
            .values({
                id: record.id,
                profileId: record.profileId,
                sourceNamespace: record.namespace,
                payloadId: record.payloadId,
                schemaVersion: record.schemaVersion,
                checksum: record.checksum,
                generatedBy: record.generatedBy,
                description: record.description,
                state: record.state,
                resultChecksum: record.resultChecksum,
                createdAt: new Date(record.createdAt),
                committedAt: record.committedAt === null ? null : new Date(record.committedAt),
            })
            .onConflictDoNothing({ target: [importBatches.sourceNamespace, importBatches.payloadId] })
            .returning({ id: importBatches.id });
        return inserted.length > 0;
    }

    async findById(profileId: string, id: string, transaction?: unknown): Promise<ImportBatchSnapshot | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(importBatches)
                .where(and(eq(importBatches.profileId, profileId), eq(importBatches.id, id)))
                .limit(1)
        )[0];
        return row ? hydrate(row) : null;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: ImportBatchRow): ImportBatchSnapshot {
    return {
        id: row.id,
        profileId: row.profileId,
        namespace: row.sourceNamespace,
        payloadId: row.payloadId,
        schemaVersion: row.schemaVersion,
        checksum: row.checksum,
        generatedBy: row.generatedBy,
        description: row.description,
        state: row.state as ImportBatchSnapshot["state"],
        resultChecksum: row.resultChecksum,
        createdAt: row.createdAt.toISOString(),
        committedAt: row.committedAt === null ? null : row.committedAt.toISOString(),
    };
}
