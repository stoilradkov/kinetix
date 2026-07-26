import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";

import {
    exerciseExternalIds,
    exerciseMergeAliases,
    exerciseMerges,
    exerciseRelationships,
    type Database,
    type ExerciseMergeRow,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    ExerciseMergeHistoryPage,
    ExerciseMergeRecord,
    ExerciseMergeRepository,
    ExerciseReferenceUpdater,
} from "#src/modules/training/application/index";
import { normalizeCatalogValue, resolveRedirect, type ExerciseMergeIntent } from "#src/modules/training/domain/index";
import { ApplicationValidationError, VersionConflictError } from "#src/platform/application/index";
import { entityId, type EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleExerciseMergeRepository implements ExerciseMergeRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async activeRedirects(transaction?: unknown) {
        return this.executor(transaction)
            .select({
                mergedExerciseId: exerciseMerges.mergedExerciseId,
                canonicalExerciseId: exerciseMerges.canonicalExerciseId,
            })
            .from(exerciseMerges)
            .where(isNull(exerciseMerges.revertedAt))
            .orderBy(asc(exerciseMerges.appliedAt), asc(exerciseMerges.id));
    }

    async resolveCanonicalId(exerciseId: EntityId, transaction?: unknown): Promise<EntityId> {
        return entityId(resolveRedirect(exerciseId, await this.activeRedirects(transaction)));
    }

    async externalIdsFor(exerciseId: EntityId, transaction?: unknown) {
        return this.executor(transaction)
            .select({
                provider: exerciseExternalIds.provider,
                externalId: exerciseExternalIds.externalId,
            })
            .from(exerciseExternalIds)
            .where(eq(exerciseExternalIds.exerciseId, exerciseId))
            .orderBy(asc(exerciseExternalIds.provider), asc(exerciseExternalIds.externalId));
    }

    async affectedFamilyExerciseIds(exerciseIds: readonly EntityId[], transaction?: unknown): Promise<string[]> {
        const ids = [...new Set(exerciseIds)];
        if (ids.length === 0) return [];
        const rows = await this.executor(transaction)
            .select({
                sourceExerciseId: exerciseRelationships.sourceExerciseId,
                targetExerciseId: exerciseRelationships.targetExerciseId,
            })
            .from(exerciseRelationships)
            .where(
                and(
                    eq(exerciseRelationships.type, "analytics_family"),
                    isNull(exerciseRelationships.archivedAt),
                    or(
                        inArray(exerciseRelationships.sourceExerciseId, ids),
                        inArray(exerciseRelationships.targetExerciseId, ids),
                    ),
                ),
            );
        return [...new Set(rows.flatMap(row => [row.sourceExerciseId, row.targetExerciseId]))].sort();
    }

    async apply(
        intent: ExerciseMergeIntent,
        mergedExerciseVersionAfterApply: number,
        transaction: unknown,
    ): Promise<ExerciseMergeRecord> {
        const executor = this.executor(transaction);
        try {
            const rows = await executor
                .insert(exerciseMerges)
                .values({
                    id: intent.id,
                    canonicalExerciseId: intent.canonicalExerciseId,
                    mergedExerciseId: intent.mergedExerciseId,
                    canonicalExerciseName: intent.canonicalExerciseName,
                    mergedExerciseName: intent.mergedExerciseName,
                    canonicalExerciseVersion: intent.canonicalExerciseVersion,
                    mergedExerciseVersion: intent.mergedExerciseVersion,
                    mergedExerciseVersionAfterApply,
                    referenceImpact: [...intent.referenceImpact],
                    affectedExerciseIds: [...intent.affectedExerciseIds],
                    affectedFamilyExerciseIds: [...intent.affectedFamilyExerciseIds],
                    externalIds: [...intent.externalIds],
                    reason: intent.reason,
                    version: 1,
                    appliedAt: new Date(intent.appliedAt),
                    createdAt: new Date(intent.appliedAt),
                    updatedAt: new Date(intent.appliedAt),
                })
                .returning();
            const row = rows[0];
            if (!row) throw new Error("Exercise merge was not inserted");
            if (intent.redirectedAliases.length > 0)
                await executor.insert(exerciseMergeAliases).values(
                    intent.redirectedAliases.map(alias => ({
                        mergeId: intent.id,
                        canonicalExerciseId: intent.canonicalExerciseId,
                        originalExerciseId: intent.mergedExerciseId,
                        alias,
                        normalizedAlias: normalizeCatalogValue(alias),
                        isActive: true,
                        createdAt: new Date(intent.appliedAt),
                    })),
                );
            return this.record(row, executor);
        } catch (error) {
            throw mapMergeWriteError(error);
        }
    }

    async loadForUpdate(id: EntityId, transaction: unknown): Promise<ExerciseMergeRecord | null> {
        const executor = this.executor(transaction);
        const row = (
            await executor.select().from(exerciseMerges).where(eq(exerciseMerges.id, id)).limit(1).for("update")
        )[0];
        return row ? this.record(row, executor) : null;
    }

    async revert(
        input: {
            readonly id: EntityId;
            readonly expectedVersion: number;
            readonly revertedCanonicalExerciseVersion: number;
            readonly revertedMergedExerciseVersion: number;
            readonly revertedAt: Date;
            readonly reason: string | null;
        },
        transaction: unknown,
    ): Promise<ExerciseMergeRecord> {
        const executor = this.executor(transaction);
        const rows = await executor
            .update(exerciseMerges)
            .set({
                version: input.expectedVersion + 1,
                revertedCanonicalExerciseVersion: input.revertedCanonicalExerciseVersion,
                revertedMergedExerciseVersion: input.revertedMergedExerciseVersion,
                revertReason: input.reason,
                revertedAt: input.revertedAt,
                updatedAt: input.revertedAt,
            })
            .where(
                and(
                    eq(exerciseMerges.id, input.id),
                    eq(exerciseMerges.version, input.expectedVersion),
                    isNull(exerciseMerges.revertedAt),
                ),
            )
            .returning();
        const row = rows[0];
        if (!row) throw new VersionConflictError(input.expectedVersion, input.expectedVersion + 1);
        await executor
            .update(exerciseMergeAliases)
            .set({ isActive: false, deactivatedAt: input.revertedAt })
            .where(and(eq(exerciseMergeAliases.mergeId, input.id), eq(exerciseMergeAliases.isActive, true)));
        return this.record(row, executor);
    }

    async get(id: EntityId): Promise<ExerciseMergeRecord | null> {
        const row = (await this.database.db.select().from(exerciseMerges).where(eq(exerciseMerges.id, id)).limit(1))[0];
        return row ? this.record(row, this.database.db) : null;
    }

    async history(exerciseId: EntityId, limit: number, cursor = 0): Promise<ExerciseMergeHistoryPage> {
        const rows = await this.database.db
            .select()
            .from(exerciseMerges)
            .where(
                or(eq(exerciseMerges.canonicalExerciseId, exerciseId), eq(exerciseMerges.mergedExerciseId, exerciseId)),
            )
            .orderBy(desc(exerciseMerges.appliedAt), desc(exerciseMerges.id))
            .limit(limit + 1)
            .offset(cursor);
        const hasMore = rows.length > limit;
        return {
            items: await Promise.all(rows.slice(0, limit).map(row => this.record(row, this.database.db))),
            nextCursor: hasMore ? cursor + limit : null,
        };
    }

    private async record(row: ExerciseMergeRow, executor: Database): Promise<ExerciseMergeRecord> {
        const aliases = await executor
            .select({ alias: exerciseMergeAliases.alias })
            .from(exerciseMergeAliases)
            .where(eq(exerciseMergeAliases.mergeId, row.id))
            .orderBy(asc(exerciseMergeAliases.normalizedAlias));
        return {
            id: row.id,
            status: row.revertedAt === null ? "applied" : "reverted",
            version: row.version,
            canonicalExercise: {
                id: row.canonicalExerciseId,
                name: row.canonicalExerciseName,
                version: row.canonicalExerciseVersion,
            },
            mergedExercise: {
                id: row.mergedExerciseId,
                name: row.mergedExerciseName,
                version: row.mergedExerciseVersion,
            },
            mergedExerciseVersionAfterApply: row.mergedExerciseVersionAfterApply,
            revertedCanonicalExerciseVersion: row.revertedCanonicalExerciseVersion,
            revertedMergedExerciseVersion: row.revertedMergedExerciseVersion,
            redirectedAliases: aliases.map(item => item.alias),
            externalIds: checkedExternalIds(row.externalIds),
            referenceImpact: checkedReferenceImpact(row.referenceImpact),
            totalReferenceCount: row.referenceImpact.reduce((total, item) => total + item.count, 0),
            affectedExerciseIds: checkedIds(row.affectedExerciseIds, "affected exercise"),
            affectedFamilyExerciseIds: checkedIds(row.affectedFamilyExerciseIds, "affected family exercise"),
            reason: row.reason,
            revertReason: row.revertReason,
            appliedAt: row.appliedAt.toISOString(),
            revertedAt: row.revertedAt?.toISOString() ?? null,
        };
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

/**
 * The catalog slice currently owns no mutable prescription or session
 * occurrence tables. Later Training slices add their current-reference updates
 * here; immutable snapshots deliberately never enter this adapter.
 */
@Injectable()
export class DrizzleExerciseReferenceUpdater implements ExerciseReferenceUpdater {
    preview(): Promise<readonly []> {
        return Promise.resolve([]);
    }

    redirect(): Promise<readonly []> {
        return Promise.resolve([]);
    }

    revert(): Promise<void> {
        return Promise.resolve();
    }
}

function checkedExternalIds(
    values: readonly { provider: string; externalId: string }[],
): readonly { provider: string; externalId: string }[] {
    return values.map(value => {
        if (!value.provider.trim() || !value.externalId.trim())
            throw new Error("Invalid persisted exercise external ID");
        return { provider: value.provider, externalId: value.externalId };
    });
}

function checkedReferenceImpact(
    values: readonly { referenceType: string; count: number }[],
): readonly { referenceType: string; count: number }[] {
    return values.map(value => {
        if (!value.referenceType.trim() || !Number.isSafeInteger(value.count) || value.count < 0)
            throw new Error("Invalid persisted exercise reference impact");
        return { referenceType: value.referenceType, count: value.count };
    });
}

function checkedIds(values: readonly string[], kind: string): readonly string[] {
    return values.map(value => {
        try {
            return entityId(value);
        } catch {
            throw new Error(`Invalid persisted ${kind} ID`);
        }
    });
}

function mapMergeWriteError(error: unknown): unknown {
    const databaseError = postgresError(error);
    if (!databaseError) return error;
    const constraint =
        typeof databaseError.constraint_name === "string"
            ? databaseError.constraint_name
            : typeof databaseError.constraint === "string"
              ? databaseError.constraint
              : "";
    if (databaseError.code === "23505" && constraint.includes("active_merged_unique"))
        return new ApplicationValidationError("The merged exercise already redirects to a canonical exercise");
    if (databaseError.code === "23505" && constraint.includes("active_value_unique"))
        return new ApplicationValidationError("A redirected exercise alias is already active");
    if (databaseError.code === "23503") return new ApplicationValidationError("Exercise merge references are invalid");
    return error;
}

function postgresError(error: unknown): { code?: unknown; constraint_name?: unknown; constraint?: unknown } | null {
    if (typeof error !== "object" || error === null) return null;
    const candidate = error as {
        code?: unknown;
        constraint_name?: unknown;
        constraint?: unknown;
        cause?: unknown;
    };
    if (typeof candidate.code === "string" && candidate.code.startsWith("23")) return candidate;
    return postgresError(candidate.cause);
}
