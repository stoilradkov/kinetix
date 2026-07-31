import { Inject, Injectable } from "@nestjs/common";
import { inArray } from "drizzle-orm";

import { trainingGoals, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import { type ProgramGoalValidator } from "#src/modules/training/application/index";
import { ApplicationValidationError } from "#src/platform/application/index";

/**
 * Adapter implementing the {@link ProgramGoalValidator} application port. Program-to-goal linkage
 * is validated across the aggregate boundary here (design 5.6) rather than via a foreign-key error,
 * so the application surfaces a structured validation failure listing the missing goals.
 */
@Injectable()
export class DrizzleProgramGoalValidator implements ProgramGoalValidator {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async assertGoalsExist(goalIds: readonly string[], transaction?: unknown): Promise<void> {
        if (goalIds.length === 0) return;
        const unique = [...new Set(goalIds)];
        const executor = (transaction ?? this.database.db) as Database;
        const rows = await executor
            .select({ id: trainingGoals.id })
            .from(trainingGoals)
            .where(inArray(trainingGoals.id, unique));
        const found = new Set(rows.map(row => row.id));
        const missing = unique.filter(id => !found.has(id));
        if (missing.length > 0)
            throw new ApplicationValidationError("One or more linked goals do not exist", {
                goalIds: missing.map(id => `Goal ${id} does not exist`),
            });
    }
}
