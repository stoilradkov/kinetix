import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { plannedSessions, programs, trainingSessions, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    HistoricalImportEntityInspector,
    ImportedEntityState,
    RevertibleEntityType,
} from "#src/modules/training/application/index";

/**
 * Reads the current version + archived state of an import-owned aggregate root directly from its
 * current-state table (issue #60, HI6). The revert use case uses it to detect post-import edits — the
 * import creates each aggregate at version 1, so a version `> 1` means a later user edit or restore — and
 * the audit report uses it to trace each entity's current revision. It never mutates anything and returns
 * `null` when the id no longer resolves (deleted out-of-band). Drizzle rows never escape this boundary
 * (ADR 0003).
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
            return row ? { version: row.version, archived: row.archivedAt !== null } : null;
        }
        if (entityType === "planned-session") {
            const row = (
                await db
                    .select({ version: plannedSessions.version, archivedAt: plannedSessions.archivedAt })
                    .from(plannedSessions)
                    .where(eq(plannedSessions.id, entityId))
                    .limit(1)
            )[0];
            return row ? { version: row.version, archived: row.archivedAt !== null } : null;
        }
        const row = (
            await db
                .select({ version: trainingSessions.version, archivedAt: trainingSessions.archivedAt })
                .from(trainingSessions)
                .where(eq(trainingSessions.id, entityId))
                .limit(1)
        )[0];
        return row ? { version: row.version, archived: row.archivedAt !== null } : null;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}
