import { and, desc, eq, lt } from "drizzle-orm";

import { entityRevisions, type Database, type EntityRevisionRow } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import type { EntityRevision, RevisionPage, RevisionStore } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

export class DrizzleRevisionStore implements RevisionStore {
    constructor(private readonly database: DatabaseService) {}

    async append(revision: EntityRevision, transaction: unknown): Promise<void> {
        await this.executor(transaction).insert(entityRevisions).values({
            entityType: revision.entityType,
            entityId: revision.entityId,
            version: revision.version,
            schemaVersion: revision.schemaVersion,
            snapshot: revision.snapshot,
            source: revision.source,
            actorId: revision.actorId,
            reason: revision.reason,
            summary: revision.summary,
            correlationId: revision.correlationId,
            createdAt: revision.createdAt,
        });
    }

    async find(entityType: string, id: ReturnType<typeof entityId>, version: number, transaction?: unknown) {
        const rows = await this.executor(transaction)
            .select()
            .from(entityRevisions)
            .where(
                and(
                    eq(entityRevisions.entityType, entityType),
                    eq(entityRevisions.entityId, id),
                    eq(entityRevisions.version, version),
                ),
            )
            .limit(1);
        return rows[0] ? mapRevision(rows[0]) : null;
    }

    async history(
        entityType: string,
        id: ReturnType<typeof entityId>,
        limit: number,
        beforeVersion?: number,
    ): Promise<RevisionPage> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw new Error("History limit must be between 1 and 100");
        const cursor = beforeVersion === undefined ? undefined : lt(entityRevisions.version, beforeVersion);
        const rows = await this.database.db
            .select()
            .from(entityRevisions)
            .where(and(eq(entityRevisions.entityType, entityType), eq(entityRevisions.entityId, id), cursor))
            .orderBy(desc(entityRevisions.version))
            .limit(limit + 1);
        const hasMore = rows.length > limit;
        const items = rows.slice(0, limit).map(mapRevision);
        return { items, nextCursor: hasMore ? (items.at(-1)?.version ?? null) : null };
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function mapRevision(row: EntityRevisionRow): EntityRevision {
    return {
        entityType: row.entityType,
        entityId: entityId(row.entityId),
        version: row.version,
        schemaVersion: row.schemaVersion,
        snapshot: row.snapshot,
        source: row.source,
        actorId: row.actorId,
        reason: row.reason,
        summary: row.summary,
        correlationId: row.correlationId,
        createdAt: row.createdAt,
    };
}
