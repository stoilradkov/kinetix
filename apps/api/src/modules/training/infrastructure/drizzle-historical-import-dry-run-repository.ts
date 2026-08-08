import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { historicalImportDryRuns, type Database, type HistoricalImportDryRunRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    BulkAffectedVersion,
    BulkDryRunError,
    BulkDryRunState,
    BulkExerciseMapping,
    BulkNormalizedProgram,
    BulkProposedExercisePreview,
    HistoricalImportDryRunRepository,
    HistoricalImportSummary,
    HistoricalNormalizedSession,
    StoredHistoricalImportDryRun,
} from "#src/modules/training/application/index";
import type { PlanningWarning } from "#src/modules/training/domain/index";
import type { StorageReconciliationPlan } from "#src/modules/training/application/index";

/**
 * Maps the historical-import dry-run artifact to and from its `historical_import_dry_runs` row (issue
 * #58, HI4). The normalized program/session trees, the storage plan, the summary, and every diagnostic
 * ride as validated JSON columns; Drizzle rows never escape this boundary (ADR 0003). `save` threads the
 * caller's UnitOfWork transaction so the artifact write shares the reconciliation reads' snapshot and is
 * the dry-run's single, isolated side effect.
 */
@Injectable()
export class DrizzleHistoricalImportDryRunRepository implements HistoricalImportDryRunRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async save(record: StoredHistoricalImportDryRun, transaction: unknown): Promise<void> {
        await this.executor(transaction)
            .insert(historicalImportDryRuns)
            .values({
                id: record.id,
                profileId: record.profileId,
                schemaVersion: record.schemaVersion,
                sourceNamespace: record.sourceNamespace,
                sourceGeneratedBy: record.sourceGeneratedBy,
                payloadId: record.payloadId,
                checksum: record.checksum,
                mode: record.mode,
                state: record.state,
                referenceHash: record.referenceHash,
                approvalToken: record.approvalToken,
                programs: [...record.programs] as unknown[],
                completedSessions: [...record.completedSessions] as unknown[],
                storagePlan: record.storagePlan as unknown as Record<string, unknown>,
                summary: record.summary as unknown as Record<string, unknown>,
                warnings: [...record.warnings] as unknown[],
                errors: [...record.errors] as unknown[],
                mappings: [...record.mappings] as unknown[],
                proposedExercises: [...record.proposedExercises] as unknown[],
                affectedVersions: [...record.affectedVersions] as unknown[],
                createdAt: record.createdAt,
                expiresAt: record.expiresAt,
                consumedAt: record.consumedAt,
            });
    }

    async findById(id: string, transaction?: unknown): Promise<StoredHistoricalImportDryRun | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(historicalImportDryRuns)
                .where(eq(historicalImportDryRuns.id, id))
                .limit(1)
        )[0];
        return row ? this.hydrate(row) : null;
    }

    async lockForCommit(id: string, transaction: unknown): Promise<StoredHistoricalImportDryRun | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(historicalImportDryRuns)
                .where(eq(historicalImportDryRuns.id, id))
                .limit(1)
                .for("update")
        )[0];
        return row ? this.hydrate(row) : null;
    }

    async markConsumed(id: string, input: { consumedAt: Date }, transaction: unknown): Promise<void> {
        await this.executor(transaction)
            .update(historicalImportDryRuns)
            .set({ consumedAt: input.consumedAt })
            .where(eq(historicalImportDryRuns.id, id));
    }

    private hydrate(row: HistoricalImportDryRunRow): StoredHistoricalImportDryRun {
        return {
            id: row.id,
            profileId: row.profileId,
            schemaVersion: 1,
            sourceNamespace: row.sourceNamespace,
            sourceGeneratedBy: row.sourceGeneratedBy,
            payloadId: row.payloadId,
            checksum: row.checksum,
            mode: row.mode as StoredHistoricalImportDryRun["mode"],
            state: row.state as BulkDryRunState,
            referenceHash: row.referenceHash,
            approvalToken: row.approvalToken,
            programs: row.programs as BulkNormalizedProgram[],
            completedSessions: row.completedSessions as HistoricalNormalizedSession[],
            storagePlan: row.storagePlan as unknown as StorageReconciliationPlan,
            summary: row.summary as unknown as HistoricalImportSummary,
            warnings: row.warnings as PlanningWarning[],
            errors: row.errors as BulkDryRunError[],
            mappings: row.mappings as BulkExerciseMapping[],
            proposedExercises: row.proposedExercises as BulkProposedExercisePreview[],
            affectedVersions: row.affectedVersions as BulkAffectedVersion[],
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            consumedAt: row.consumedAt,
        };
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}
