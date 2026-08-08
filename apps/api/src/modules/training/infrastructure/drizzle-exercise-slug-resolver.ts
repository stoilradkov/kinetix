import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { exercises } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { ExerciseSlugResolver } from "#src/modules/training/application/index";

/**
 * Resolves a canonical exercise `slug` to a catalog exercise id (issue #58, HI4; #55 canonical
 * references). The `exercises.slug` column is unique, so at most one row matches and no ambiguity can
 * arise from this path. Read-only; the historical dry-run never writes catalog rows.
 */
@Injectable()
export class DrizzleExerciseSlugResolver implements ExerciseSlugResolver {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async resolveBySlug(slug: string): Promise<string | null> {
        const row = (
            await this.database.db.select({ id: exercises.id }).from(exercises).where(eq(exercises.slug, slug)).limit(1)
        )[0];
        return row?.id ?? null;
    }
}
