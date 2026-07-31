import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
    programBlocks,
    programGoals,
    programPlannedSessions,
    programs,
    type Database,
    type ProgramBlockRow,
    type ProgramGoalRow,
    type ProgramRow,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    PROGRAM_ENTITY_TYPE,
    type ProgramListFilter,
    type ProgramRepository,
    type ProgramResource,
    type ProgramSummary,
} from "#src/modules/training/application/index";
import {
    Program,
    programBlockTypes,
    programScheduleModes,
    programStatuses,
    type ProgramBlockState,
    type ProgramBlockType,
    type ProgramScheduleMode,
    type ProgramState,
    type ProgramStatus,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleProgramRepository implements ProgramRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readProgram(id: EntityId, transaction?: unknown): Promise<ProgramResource | null> {
        const executor = this.executor(transaction);
        const row = (await executor.select().from(programs).where(eq(programs.id, id)).limit(1))[0];
        if (!row) return null;
        const [blockRows, goalRows] = await Promise.all([
            executor
                .select()
                .from(programBlocks)
                .where(eq(programBlocks.programId, id))
                .orderBy(asc(programBlocks.position)),
            executor.select().from(programGoals).where(eq(programGoals.programId, id)),
        ]);
        return { ...hydrate(row, blockRows, goalRows), version: row.version };
    }

    async listPrograms(filter?: ProgramListFilter): Promise<readonly ProgramSummary[]> {
        // Exclude archived programs by default; a program is archived only in the 'archived' status.
        const scoped = await this.database.db
            .select()
            .from(programs)
            .where(
                filter?.includeArchived
                    ? undefined
                    : inArray(programs.status, ["draft", "active", "paused", "completed"]),
            )
            .orderBy(asc(programs.status), asc(programs.name), asc(programs.id));
        const ids = scoped.map(row => row.id);
        const [blockCounts, sessionCounts] = await Promise.all([this.blockCounts(ids), this.sessionCounts(ids)]);
        return scoped.map(row => summary(row, blockCounts.get(row.id) ?? 0, sessionCounts.get(row.id) ?? 0));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: ProgramState; version: number } | null> {
        assertEntityType(entityType);
        const executor = this.executor(transaction);
        const row = (await executor.select().from(programs).where(eq(programs.id, id)).limit(1).for("update"))[0];
        if (!row) return null;
        const [blockRows, goalRows] = await Promise.all([
            executor
                .select()
                .from(programBlocks)
                .where(eq(programBlocks.programId, id))
                .orderBy(asc(programBlocks.position)),
            executor.select().from(programGoals).where(eq(programGoals.programId, id)),
        ]);
        return { state: hydrate(row, blockRows, goalRows), version: row.version };
    }

    async create(
        entityType: string,
        id: EntityId,
        state: ProgramState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Program state ID does not match its aggregate ID");
        Program.rehydrate(state);
        const executor = this.executor(transaction);
        await executor.insert(programs).values(rootValues(state, version));
        await this.writeChildren(state, executor);
    }

    async save(
        entityType: string,
        id: EntityId,
        state: ProgramState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Program state ID does not match its aggregate ID");
        Program.rehydrate(state);
        const executor = this.executor(transaction);
        const updated = await executor
            .update(programs)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(programs.id, id), eq(programs.version, expectedVersion)))
            .returning({ id: programs.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
        // Upsert blocks and delete only the ones removed by this edit, so `planned_session_blocks`
        // membership survives edits that don't touch a block (deleting a still-referenced block
        // would cascade its memberships away).
        const desired = new Set(state.blocks.map(block => block.id));
        const existing = await executor
            .select({ id: programBlocks.id })
            .from(programBlocks)
            .where(eq(programBlocks.programId, state.id));
        const removed = existing.map(row => row.id).filter(id => !desired.has(id));
        if (removed.length > 0) await executor.delete(programBlocks).where(inArray(programBlocks.id, removed));
        await executor.delete(programGoals).where(eq(programGoals.programId, state.id));
        await this.writeChildren(state, executor, "upsert");
    }

    private async writeChildren(
        state: ProgramState,
        executor: Database,
        mode: "insert" | "upsert" = "insert",
    ): Promise<void> {
        for (const block of orderBlocksForInsert(state.blocks)) {
            const insert = executor.insert(programBlocks).values(blockValues(state.id, block));
            await (mode === "upsert"
                ? insert.onConflictDoUpdate({ target: programBlocks.id, set: blockUpdateValues(block) })
                : insert);
        }
        if (state.goalIds.length > 0)
            await executor.insert(programGoals).values(state.goalIds.map(goalId => ({ programId: state.id, goalId })));
    }

    private async blockCounts(ids: readonly string[]): Promise<Map<string, number>> {
        if (ids.length === 0) return new Map();
        const rows = await this.database.db
            .select({ programId: programBlocks.programId, total: sql<number>`cast(count(*) as int)` })
            .from(programBlocks)
            .where(inArray(programBlocks.programId, [...ids]))
            .groupBy(programBlocks.programId);
        return new Map(rows.map(row => [row.programId, row.total]));
    }

    private async sessionCounts(ids: readonly string[]): Promise<Map<string, number>> {
        if (ids.length === 0) return new Map();
        const rows = await this.database.db
            .select({ programId: programPlannedSessions.programId, total: sql<number>`cast(count(*) as int)` })
            .from(programPlannedSessions)
            .where(inArray(programPlannedSessions.programId, [...ids]))
            .groupBy(programPlannedSessions.programId);
        return new Map(rows.map(row => [row.programId, row.total]));
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

/** Order blocks so every parent precedes its children, keeping the self-referential FK satisfiable. */
function orderBlocksForInsert(blocks: readonly ProgramBlockState[]): readonly ProgramBlockState[] {
    const remaining = new Map(blocks.map(block => [block.id, block]));
    const emitted = new Set<string>();
    const ordered: ProgramBlockState[] = [];
    while (remaining.size > 0) {
        let progressed = false;
        for (const block of remaining.values())
            if (block.parentBlockId === null || emitted.has(block.parentBlockId)) {
                ordered.push(block);
                emitted.add(block.id);
                remaining.delete(block.id);
                progressed = true;
            }
        if (!progressed) {
            // Defensive: a cycle slipped past validation — emit the rest as-is rather than loop forever.
            ordered.push(...remaining.values());
            break;
        }
    }
    return ordered;
}

function hydrate(
    row: ProgramRow,
    blockRows: readonly ProgramBlockRow[],
    goalRows: readonly ProgramGoalRow[],
): ProgramState {
    return Program.rehydrate({
        id: row.id,
        profileId: row.profileId,
        name: row.name,
        description: row.description,
        status: checkedStatus(row.status),
        scheduleMode: checkedScheduleMode(row.scheduleMode),
        startDate: row.startDate,
        endDate: row.endDate,
        focus: row.focus,
        blocks: blockRows.map(hydrateBlock),
        goalIds: goalRows.map(goal => goal.goalId),
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function hydrateBlock(row: ProgramBlockRow): ProgramBlockState {
    return {
        id: row.id,
        parentBlockId: row.parentBlockId,
        type: checkedBlockType(row.type),
        label: row.label,
        position: row.position,
        startDate: row.startDate,
        endDate: row.endDate,
        relativeStartWeek: row.relativeStartWeek,
        relativeEndWeek: row.relativeEndWeek,
        focus: row.focus,
        targetMuscles: row.targetMuscles,
        targetVolume: row.targetVolume,
        targetIntensity: row.targetIntensity,
        deload: row.deload,
        expectedAdaptations: row.expectedAdaptations,
        notes: row.notes,
        tags: row.tags,
    };
}

function summary(row: ProgramRow, blockCount: number, sessionCount: number): ProgramSummary {
    return {
        id: row.id,
        profileId: row.profileId,
        name: row.name,
        description: row.description,
        status: checkedStatus(row.status),
        scheduleMode: checkedScheduleMode(row.scheduleMode),
        startDate: row.startDate,
        endDate: row.endDate,
        focus: row.focus,
        version: row.version,
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        blockCount,
        sessionCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function rootValues(state: ProgramState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        name: state.name,
        description: state.description,
        status: state.status,
        scheduleMode: state.scheduleMode,
        startDate: state.startDate,
        endDate: state.endDate,
        focus: state.focus,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: ProgramState, version: number) {
    return {
        name: state.name,
        description: state.description,
        status: state.status,
        scheduleMode: state.scheduleMode,
        startDate: state.startDate,
        endDate: state.endDate,
        focus: state.focus,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function blockValues(programId: string, block: ProgramBlockState) {
    return {
        id: block.id,
        programId,
        parentBlockId: block.parentBlockId,
        type: block.type,
        label: block.label,
        position: block.position,
        startDate: block.startDate,
        endDate: block.endDate,
        relativeStartWeek: block.relativeStartWeek,
        relativeEndWeek: block.relativeEndWeek,
        focus: block.focus,
        targetMuscles: [...block.targetMuscles],
        targetVolume: block.targetVolume,
        targetIntensity: block.targetIntensity,
        deload: block.deload,
        expectedAdaptations: block.expectedAdaptations,
        notes: block.notes,
        tags: [...block.tags],
    };
}

/** Columns updated when an existing block is re-saved (identity and program stay fixed). */
function blockUpdateValues(block: ProgramBlockState) {
    return {
        parentBlockId: block.parentBlockId,
        type: block.type,
        label: block.label,
        position: block.position,
        startDate: block.startDate,
        endDate: block.endDate,
        relativeStartWeek: block.relativeStartWeek,
        relativeEndWeek: block.relativeEndWeek,
        focus: block.focus,
        targetMuscles: [...block.targetMuscles],
        targetVolume: block.targetVolume,
        targetIntensity: block.targetIntensity,
        deload: block.deload,
        expectedAdaptations: block.expectedAdaptations,
        notes: block.notes,
        tags: [...block.tags],
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== PROGRAM_ENTITY_TYPE) throw new Error(`Unsupported program entity type '${entityType}'`);
}

function checkedStatus(value: string): ProgramStatus {
    return (programStatuses as readonly string[]).includes(value)
        ? (value as ProgramStatus)
        : invalidPersisted("program status", value);
}

function checkedScheduleMode(value: string): ProgramScheduleMode {
    return (programScheduleModes as readonly string[]).includes(value)
        ? (value as ProgramScheduleMode)
        : invalidPersisted("program schedule mode", value);
}

function checkedBlockType(value: string): ProgramBlockType {
    return (programBlockTypes as readonly string[]).includes(value)
        ? (value as ProgramBlockType)
        : invalidPersisted("program block type", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
