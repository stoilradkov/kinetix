import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, inArray } from "drizzle-orm";

import { analyticsInvalidations, type AnalyticsInvalidationRow, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { AnalyticsInvalidationStore, PendingInvalidation } from "#src/modules/training/application/index";
import type { MetricDependency } from "#src/modules/training/domain/index";

/**
 * Drizzle-backed coalescing invalidation queue (issue #43, A1; design §16.2–16.3). `append` converges
 * duplicate pending `(dependency, scope)` rows through the partial unique index (`ON CONFLICT DO NOTHING`),
 * so overlapping invalidations coalesce. `claimPending` locks the pending batch with `SKIP LOCKED` so two
 * workers never process the same rows, and `markProcessed` retires the drained batch.
 */
@Injectable()
export class DrizzleAnalyticsInvalidationStore implements AnalyticsInvalidationStore {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async append(
        invalidations: readonly Omit<PendingInvalidation, "id">[],
        transaction: unknown,
    ): Promise<readonly PendingInvalidation[]> {
        if (invalidations.length === 0) return [];
        const executor = this.executor(transaction);
        const rows = await executor
            .insert(analyticsInvalidations)
            .values(
                invalidations.map(item => ({
                    dependency: item.dependency,
                    scopeType: item.scopeType,
                    scopeId: item.scopeId,
                    reason: item.reason,
                    eventId: item.eventId,
                    status: "pending",
                })),
            )
            // The only unique constraint is the partial pending index, so a bare DO NOTHING coalesces
            // duplicate pending (dependency, scope) rows without touching processed history.
            .onConflictDoNothing()
            .returning();
        return rows.map(hydrate);
    }

    async claimPending(limit: number, transaction: unknown): Promise<readonly PendingInvalidation[]> {
        const executor = this.executor(transaction);
        const rows = await executor
            .select()
            .from(analyticsInvalidations)
            .where(eq(analyticsInvalidations.status, "pending"))
            .orderBy(asc(analyticsInvalidations.createdAt), asc(analyticsInvalidations.id))
            .limit(limit)
            .for("update", { skipLocked: true });
        return rows.map(hydrate);
    }

    async markProcessed(ids: readonly string[], processedAt: Date, transaction: unknown): Promise<void> {
        if (ids.length === 0) return;
        const executor = this.executor(transaction);
        await executor
            .update(analyticsInvalidations)
            .set({ status: "processed", processedAt })
            .where(inArray(analyticsInvalidations.id, [...ids]));
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: AnalyticsInvalidationRow): PendingInvalidation {
    return {
        id: row.id,
        dependency: row.dependency as MetricDependency,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        reason: row.reason,
        eventId: row.eventId,
    };
}
