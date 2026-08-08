import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, ne } from "drizzle-orm";

import { entityRevisions, plannedSessions, programs, trainingSessions, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    HistoricalImportEntityInspector,
    ImportedEntityState,
    RevertibleEntityType,
} from "#src/modules/training/application/index";

/**
 * Reads the current version + archived state of an import-owned aggregate root directly from its
 * current-state table (issue #60, HI6), plus whether every revision after creation was import-owned. The
 * revert use case uses that provenance to allow its own planned-outcome recomputation while still blocking
 * any later user/agent/system edit or restore. The audit report uses the current revision for its trace. It
 * never mutates anything and returns `null` when the id no longer resolves (deleted out-of-band). Drizzle
 * rows never escape this boundary (ADR 0003).
 */
@Injectable()
export class DrizzleHistoricalImportEntityInspector implements HistoricalImportEntityInspector {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async inspect(
        entityType: RevertibleEntityType,
        entityId: string,
        transaction?: unknown,
    ): Promise<ImportedEntityState | null> {
        const db = this.executor(transaction);
        if (entityType === "program") {
            const row = (
                await db
                    .select({ version: programs.version, archivedAt: programs.archivedAt })
                    .from(programs)
                    .where(eq(programs.id, entityId))
                    .limit(1)
            )[0];
            return row
                ? this.withRevisionProvenance("training.program", entityId, row.version, row.archivedAt !== null, db)
                : null;
        }
        if (entityType === "planned-session") {
            const row = (
                await db
                    .select({ version: plannedSessions.version, archivedAt: plannedSessions.archivedAt })
                    .from(plannedSessions)
                    .where(eq(plannedSessions.id, entityId))
                    .limit(1)
            )[0];
            return row
                ? this.withRevisionProvenance(
                      "training.planned-session",
                      entityId,
                      row.version,
                      row.archivedAt !== null,
                      db,
                  )
                : null;
        }
        const row = (
            await db
                .select({ version: trainingSessions.version, archivedAt: trainingSessions.archivedAt })
                .from(trainingSessions)
                .where(eq(trainingSessions.id, entityId))
                .limit(1)
        )[0];
        return row
            ? this.withRevisionProvenance("training.session", entityId, row.version, row.archivedAt !== null, db)
            : null;
    }

    private async withRevisionProvenance(
        entityType: string,
        entityId: string,
        version: number,
        archived: boolean,
        db: Database,
    ): Promise<ImportedEntityState> {
        if (version <= 1) return { version, archived, postImportRevisionsAreImport: true };
        const nonImportRevision = await db
            .select({ version: entityRevisions.version })
            .from(entityRevisions)
            .where(
                and(
                    eq(entityRevisions.entityType, entityType),
                    eq(entityRevisions.entityId, entityId),
                    gt(entityRevisions.version, 1),
                    ne(entityRevisions.source, "import"),
                ),
            )
            .limit(1);
        return { version, archived, postImportRevisionsAreImport: nonImportRevision.length === 0 };
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}
