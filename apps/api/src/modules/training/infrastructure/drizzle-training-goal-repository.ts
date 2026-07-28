import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { trainingGoals, type Database, type TrainingGoalRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    TRAINING_GOAL_ENTITY_TYPE,
    type TrainingGoalListFilter,
    type TrainingGoalRepository,
    type TrainingGoalResource,
} from "#src/modules/training/application/index";
import {
    TrainingGoal,
    goalStatuses,
    goalTypes,
    type GoalStatus,
    type GoalType,
    type TrainingGoalState,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleTrainingGoalRepository implements TrainingGoalRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readGoal(id: EntityId, transaction?: unknown): Promise<TrainingGoalResource | null> {
        const row = (
            await this.executor(transaction).select().from(trainingGoals).where(eq(trainingGoals.id, id)).limit(1)
        )[0];
        return row ? { ...hydrate(row), version: row.version } : null;
    }

    async listGoals(filter?: TrainingGoalListFilter): Promise<readonly TrainingGoalResource[]> {
        const rows = await this.database.db
            .select()
            .from(trainingGoals)
            .where(filter?.status === undefined ? undefined : and(eq(trainingGoals.status, filter.status)))
            .orderBy(asc(trainingGoals.priority), asc(trainingGoals.createdAt), asc(trainingGoals.id));
        return rows.map(row => ({ ...hydrate(row), version: row.version }));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: TrainingGoalState; version: number } | null> {
        assertEntityType(entityType);
        const row = (
            await this.executor(transaction)
                .select()
                .from(trainingGoals)
                .where(eq(trainingGoals.id, id))
                .limit(1)
                .for("update")
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async create(
        entityType: string,
        id: EntityId,
        state: TrainingGoalState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Training goal state ID does not match its aggregate ID");
        TrainingGoal.rehydrate(state);
        await this.executor(transaction).insert(trainingGoals).values(rootValues(state, version));
    }

    async save(
        entityType: string,
        id: EntityId,
        state: TrainingGoalState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Training goal state ID does not match its aggregate ID");
        TrainingGoal.rehydrate(state);
        const updated = await this.executor(transaction)
            .update(trainingGoals)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(trainingGoals.id, id), eq(trainingGoals.version, expectedVersion)))
            .returning({ id: trainingGoals.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: TrainingGoalRow): TrainingGoalState {
    return TrainingGoal.rehydrate({
        id: row.id,
        profileId: row.profileId,
        type: checkedType(row.type),
        targetValue: row.targetValue,
        targetUnit: row.targetUnit,
        startDate: row.startDate,
        targetDate: row.targetDate,
        priority: row.priority,
        status: checkedStatus(row.status),
        notes: row.notes,
        programId: row.programId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: TrainingGoalState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        type: state.type,
        targetValue: state.targetValue,
        targetUnit: state.targetUnit,
        startDate: state.startDate,
        targetDate: state.targetDate,
        priority: state.priority,
        status: state.status,
        notes: state.notes,
        programId: state.programId,
        version,
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: TrainingGoalState, version: number) {
    return {
        type: state.type,
        targetValue: state.targetValue,
        targetUnit: state.targetUnit,
        startDate: state.startDate,
        targetDate: state.targetDate,
        priority: state.priority,
        status: state.status,
        notes: state.notes,
        programId: state.programId,
        version,
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== TRAINING_GOAL_ENTITY_TYPE)
        throw new Error(`Unsupported training goal entity type '${entityType}'`);
}

function checkedType(value: string): GoalType {
    return (goalTypes as readonly string[]).includes(value)
        ? (value as GoalType)
        : invalidPersisted("training goal type", value);
}

function checkedStatus(value: string): GoalStatus {
    return (goalStatuses as readonly string[]).includes(value)
        ? (value as GoalStatus)
        : invalidPersisted("training goal status", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
