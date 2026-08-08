import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";

import { bulkExternalIds, plannedSessions, programs, trainingSessions, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    AggregateVersionRecord,
    AggregateVersionRef,
    ExternalIdMappingRecord,
    ImportEntityRef,
    ImportStorageReadPort,
} from "#src/modules/training/application/index";
import type { ImportEntityType } from "#src/modules/training/domain/index";

/**
 * Batched, read-only persistence backing storage reconciliation (issue #57, HI3; design §14.2). Two
 * lookups resolve an entire archive in a bounded number of round-trips:
 *
 *  - `readExternalIdMappings` reads `bulk_external_ids` for every requested `(entityType, externalId)`
 *    within one namespace in a single statement (one `inArray` per entity type, OR-combined), returning
 *    the bound Kinetix ID and the content fingerprint recorded at import.
 *  - `readAggregateVersions` reads the current live version for the version-tracked *root* aggregates
 *    (program, planned session, training session) in one statement per type. Child entities (blocks,
 *    occurrences, set groups, sets, run detail, pain records) are versioned via their root, so they
 *    resolve to no independent version and are version-gated through it.
 *
 * There is no source-specific lookup, fuzzy search, or heuristic here — only exact key reads. Drizzle
 * rows never escape this boundary (ADR 0003), and every read joins the caller's transaction when one is
 * supplied so a dry-run and its commit observe a consistent snapshot.
 */
@Injectable()
export class DrizzleImportStorageReadPort implements ImportStorageReadPort {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readExternalIdMappings(
        namespace: string,
        refs: readonly ImportEntityRef[],
        transaction?: unknown,
    ): Promise<readonly ExternalIdMappingRecord[]> {
        if (refs.length === 0) return [];
        const byType = groupBy(refs, ref => ref.entityType);
        const perType: SQL[] = [];
        for (const [entityType, entries] of byType)
            perType.push(
                and(
                    eq(bulkExternalIds.entityType, entityType),
                    inArray(
                        bulkExternalIds.externalId,
                        entries.map(entry => entry.externalId),
                    ),
                )!,
            );

        const rows = await this.executor(transaction)
            .select({
                entityType: bulkExternalIds.entityType,
                externalId: bulkExternalIds.externalId,
                entityId: bulkExternalIds.entityId,
                contentFingerprint: bulkExternalIds.contentFingerprint,
            })
            .from(bulkExternalIds)
            .where(and(eq(bulkExternalIds.sourceNamespace, namespace), or(...perType)));

        return rows.map(row => ({
            entityType: row.entityType as ImportEntityType,
            externalId: row.externalId,
            entityId: row.entityId,
            contentFingerprint: row.contentFingerprint,
        }));
    }

    async readAggregateVersions(
        refs: readonly AggregateVersionRef[],
        transaction?: unknown,
    ): Promise<readonly AggregateVersionRecord[]> {
        if (refs.length === 0) return [];
        const byType = groupBy(refs, ref => ref.entityType);
        const executor = this.executor(transaction);
        const results: AggregateVersionRecord[] = [];

        for (const [entityType, entries] of byType) {
            const table = versionedRootTable(entityType);
            if (!table) continue; // Child entity: versioned via its root, no independent version.
            const ids = entries.map(entry => entry.entityId);
            const rows = await executor
                .select({ entityId: table.id, version: table.version })
                .from(table.table)
                .where(inArray(table.id, ids));
            for (const row of rows) results.push({ entityType, entityId: row.entityId, version: row.version });
        }

        return results;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

/** Map an import entity type to its versioned root aggregate table, or `null` for child entities. */
function versionedRootTable(entityType: ImportEntityType) {
    switch (entityType) {
        case "program":
            return { table: programs, id: programs.id, version: programs.version };
        case "planned-session":
            return { table: plannedSessions, id: plannedSessions.id, version: plannedSessions.version };
        case "training-session":
            return { table: trainingSessions, id: trainingSessions.id, version: trainingSessions.version };
        default:
            return null;
    }
}

function groupBy<Item, Key>(items: readonly Item[], keyOf: (item: Item) => Key): Map<Key, Item[]> {
    const groups = new Map<Key, Item[]>();
    for (const item of items) {
        const key = keyOf(item);
        const bucket = groups.get(key) ?? [];
        bucket.push(item);
        groups.set(key, bucket);
    }
    return groups;
}
