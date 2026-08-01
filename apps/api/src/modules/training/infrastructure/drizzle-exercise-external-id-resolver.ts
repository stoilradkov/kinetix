import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { exerciseExternalIds } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { ExerciseExternalIdResolver } from "#src/modules/training/application/index";

/**
 * Resolves a caller-supplied `{ provider, externalId }` pair to a catalog exercise id (BI-3). The
 * `(provider, external_id)` unique index guarantees at most one match, so no ambiguity can arise
 * from this path. Read-only; the bulk dry-run never writes catalog rows.
 */
@Injectable()
export class DrizzleExerciseExternalIdResolver implements ExerciseExternalIdResolver {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async resolveByExternalId(provider: string, externalId: string): Promise<string | null> {
        const row = (
            await this.database.db
                .select({ exerciseId: exerciseExternalIds.exerciseId })
                .from(exerciseExternalIds)
                .where(and(eq(exerciseExternalIds.provider, provider), eq(exerciseExternalIds.externalId, externalId)))
                .limit(1)
        )[0];
        return row?.exerciseId ?? null;
    }
}
