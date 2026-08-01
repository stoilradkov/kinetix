import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { bulkDryRuns, type BulkDryRunRow, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    BulkAffectedVersion,
    BulkDryRunError,
    BulkDryRunRepository,
    BulkDryRunState,
    BulkExerciseMapping,
    BulkNormalizedProgram,
    BulkProposedExercisePreview,
    StoredBulkDryRun,
} from "#src/modules/training/application/index";
import type { PlanningWarning } from "#src/modules/training/domain/index";

/**
 * Maps the bulk dry-run artifact to and from its `bulk_dry_runs` row. The normalized tree, warnings,
 * errors, mappings, proposals, and affected versions ride as validated JSON columns; Drizzle rows
 * never escape this boundary (ADR 0003). `save` threads the caller's UnitOfWork transaction so the
 * artifact write is the dry-run's single, isolated side effect.
 */
@Injectable()
export class DrizzleBulkDryRunRepository implements BulkDryRunRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async save(record: StoredBulkDryRun, transaction: unknown): Promise<void> {
        await this.executor(transaction)
            .insert(bulkDryRuns)
            .values({
                id: record.id,
                profileId: record.profileId,
                schemaVersion: record.schemaVersion,
                sourceNamespace: record.sourceNamespace,
                sourceGeneratedBy: record.sourceGeneratedBy,
                mode: record.mode,
                state: record.state,
                referenceHash: record.referenceHash,
                approvalToken: record.approvalToken,
                normalizedProgram: record.normalizedProgram as unknown as Record<string, unknown>,
                warnings: [...record.warnings],
                errors: [...record.errors],
                mappings: [...record.mappings],
                proposedExercises: [...record.proposedExercises],
                affectedVersions: [...record.affectedVersions],
                createdAt: record.createdAt,
                expiresAt: record.expiresAt,
            });
    }

    async findById(id: string, transaction?: unknown): Promise<StoredBulkDryRun | null> {
        const row = (
            await this.executor(transaction).select().from(bulkDryRuns).where(eq(bulkDryRuns.id, id)).limit(1)
        )[0];
        return row ? this.hydrate(row) : null;
    }

    private hydrate(row: BulkDryRunRow): StoredBulkDryRun {
        return {
            id: row.id,
            profileId: row.profileId,
            schemaVersion: 1,
            sourceNamespace: row.sourceNamespace,
            sourceGeneratedBy: row.sourceGeneratedBy,
            mode: row.mode as StoredBulkDryRun["mode"],
            state: row.state as BulkDryRunState,
            referenceHash: row.referenceHash,
            approvalToken: row.approvalToken,
            normalizedProgram: row.normalizedProgram as unknown as BulkNormalizedProgram,
            warnings: row.warnings as PlanningWarning[],
            errors: row.errors as BulkDryRunError[],
            mappings: row.mappings as BulkExerciseMapping[],
            proposedExercises: row.proposedExercises as BulkProposedExercisePreview[],
            affectedVersions: row.affectedVersions as BulkAffectedVersion[],
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
        };
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}
