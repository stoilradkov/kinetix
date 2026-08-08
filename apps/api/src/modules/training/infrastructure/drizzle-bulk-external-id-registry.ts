import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { bulkExternalIds, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import { ExternalIdConflictError } from "#src/platform/application/index";
import type {
    BulkExternalEntityType,
    BulkExternalIdEntry,
    BulkExternalIdMapping,
    BulkExternalIdRegistry,
} from "#src/modules/training/application/index";

/**
 * Maps the namespaced external-ID registry to and from `bulk_external_ids`. `register` batch-inserts
 * the `(namespace, entityType, externalId) → entityId` links for a committed tree; the DB unique index
 * makes a repeated import or a colliding external ID fail as {@link ExternalIdConflictError} rather
 * than silently duplicate an entity. `resolve` powers upsert addressing. Drizzle rows never escape
 * this boundary (ADR 0003), and every write runs inside the caller's commit transaction.
 */
@Injectable()
export class DrizzleBulkExternalIdRegistry implements BulkExternalIdRegistry {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async register(
        input: {
            profileId: string;
            namespace: string;
            importBatchId?: string | null;
            entries: readonly BulkExternalIdEntry[];
        },
        transaction: unknown,
    ): Promise<void> {
        if (input.entries.length === 0) return;
        try {
            await this.executor(transaction)
                .insert(bulkExternalIds)
                .values(
                    input.entries.map(entry => ({
                        profileId: input.profileId,
                        importBatchId: input.importBatchId ?? null,
                        sourceNamespace: input.namespace,
                        entityType: entry.entityType,
                        externalId: entry.externalId,
                        entityId: entry.entityId,
                    })),
                );
        } catch (error) {
            throw mapRegisterError(error, input.namespace, input.entries);
        }
    }

    async resolve(
        namespace: string,
        entityType: BulkExternalEntityType,
        externalId: string,
        transaction: unknown,
    ): Promise<string | null> {
        const row = (
            await this.executor(transaction)
                .select({ entityId: bulkExternalIds.entityId })
                .from(bulkExternalIds)
                .where(
                    and(
                        eq(bulkExternalIds.sourceNamespace, namespace),
                        eq(bulkExternalIds.entityType, entityType),
                        eq(bulkExternalIds.externalId, externalId),
                    ),
                )
                .limit(1)
        )[0];
        return row?.entityId ?? null;
    }

    async listByBatch(importBatchId: string, transaction?: unknown): Promise<readonly BulkExternalIdMapping[]> {
        const rows = await this.executor(transaction)
            .select({
                entityType: bulkExternalIds.entityType,
                externalId: bulkExternalIds.externalId,
                entityId: bulkExternalIds.entityId,
            })
            .from(bulkExternalIds)
            .where(eq(bulkExternalIds.importBatchId, importBatchId))
            .orderBy(asc(bulkExternalIds.entityType), asc(bulkExternalIds.externalId));
        return rows.map(row => ({
            entityType: row.entityType as BulkExternalEntityType,
            externalId: row.externalId,
            entityId: row.entityId,
        }));
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function mapRegisterError(error: unknown, namespace: string, entries: readonly BulkExternalIdEntry[]): unknown {
    const databaseError = postgresError(error);
    if (databaseError?.code === "23505") {
        // The batch insert is atomic, so we cannot know which row collided; report the first entry as
        // a representative, with the namespace, so the caller gets an actionable message.
        const entry = entries[0]!;
        return new ExternalIdConflictError(namespace, entry.entityType, entry.externalId);
    }
    return error;
}

function postgresError(error: unknown): { code?: unknown } | null {
    if (typeof error !== "object" || error === null) return null;
    const candidate = error as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && candidate.code.startsWith("23")) return candidate;
    return postgresError(candidate.cause);
}
