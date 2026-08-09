import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import {
    prescribedExercises,
    prescribedSets,
    programBlocks,
    programs,
    workoutTemplates,
    type Database,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import { PROFILE_READER, type ProfileReader } from "#src/modules/profile/index";
import type { ProgressionPlanningReader, ProgressionScopeDescriptor } from "#src/modules/training/application/index";
import type { RuleScope } from "#src/modules/training/domain/index";

/**
 * Resolves progression-rule scope targets against plans so the pure rule aggregate never queries
 * them itself (design 15.2, ADR 0007). Program, block, and template scopes are checked for
 * existence, active-profile ownership, and archive state; exercise/set scopes travel by logical
 * key and are checked for existence in a published prescription. Deep logical-selector resolution
 * against a specific plan version is an evaluation concern (G2), not a definition-time check.
 */
@Injectable()
export class DrizzleProgressionPlanningReader implements ProgressionPlanningReader {
    constructor(
        @Inject(DatabaseService) private readonly database: DatabaseService,
        @Inject(PROFILE_READER) private readonly profileReader: ProfileReader,
    ) {}

    async describeScope(scope: RuleScope, transaction?: unknown): Promise<ProgressionScopeDescriptor | null> {
        const executor = this.executor(transaction);
        switch (scope.type) {
            case "program":
                return this.describeProgram(executor, scope.id);
            case "template":
                return this.describeTemplate(executor, scope.id);
            case "block":
                return this.describeBlock(executor, scope.id);
            case "exercise":
                return this.describeLogicalElement(executor, prescribedExercises, scope.id);
            case "set":
                return this.describeLogicalElement(executor, prescribedSets, scope.id);
            default:
                return null;
        }
    }

    private async describeProgram(executor: Database, id: string): Promise<ProgressionScopeDescriptor | null> {
        const profileId = await this.profileReader.requireActiveProfileId();
        const row = (
            await executor
                .select({ status: programs.status })
                .from(programs)
                .where(and(eq(programs.id, id), eq(programs.profileId, profileId)))
                .limit(1)
        )[0];
        if (!row) return { exists: false, archived: false };
        return { exists: true, archived: row.status === "archived" };
    }

    private async describeTemplate(executor: Database, id: string): Promise<ProgressionScopeDescriptor | null> {
        const profileId = await this.profileReader.requireActiveProfileId();
        const row = (
            await executor
                .select({ status: workoutTemplates.status })
                .from(workoutTemplates)
                .where(and(eq(workoutTemplates.id, id), eq(workoutTemplates.profileId, profileId)))
                .limit(1)
        )[0];
        if (!row) return { exists: false, archived: false };
        return { exists: true, archived: row.status === "archived" };
    }

    private async describeBlock(executor: Database, id: string): Promise<ProgressionScopeDescriptor | null> {
        const profileId = await this.profileReader.requireActiveProfileId();
        const row = (
            await executor
                .select({ status: programs.status })
                .from(programBlocks)
                .innerJoin(programs, eq(programBlocks.programId, programs.id))
                .where(and(eq(programBlocks.id, id), eq(programs.profileId, profileId)))
                .limit(1)
        )[0];
        if (!row) return { exists: false, archived: false };
        return { exists: true, archived: row.status === "archived" };
    }

    private async describeLogicalElement(
        executor: Database,
        table: typeof prescribedExercises | typeof prescribedSets,
        logicalKey: string,
    ): Promise<ProgressionScopeDescriptor> {
        const row = (
            await executor.select({ id: table.id }).from(table).where(eq(table.logicalKey, logicalKey)).limit(1)
        )[0];
        return { exists: row !== undefined, archived: false };
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}
