import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
    painRecords,
    sessionActivities,
    trainingSessions,
    type Database,
    type PainRecordRow,
    type SessionActivityRow,
    type TrainingSessionRow,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    TRAINING_SESSION_ENTITY_TYPE,
    type TrainingSessionListFilter,
    type TrainingSessionRepository,
    type TrainingSessionResource,
    type TrainingSessionSummary,
} from "#src/modules/training/application/index";
import {
    TrainingSession,
    painSides,
    sessionActivityTypes,
    type PainRecordState,
    type PainSide,
    type SessionActivityState,
    type SessionActivityType,
    type TrainingSessionState,
    type TrainingSessionStatus,
    trainingSessionStatuses,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleTrainingSessionRepository implements TrainingSessionRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readSession(id: EntityId, transaction?: unknown): Promise<TrainingSessionResource | null> {
        const executor = this.executor(transaction);
        const row = (await executor.select().from(trainingSessions).where(eq(trainingSessions.id, id)).limit(1))[0];
        if (!row) return null;
        const [activityRows, painRows] = await this.loadChildren(id, executor);
        return { ...hydrate(row, activityRows, painRows), version: row.version };
    }

    async listSessions(filter?: TrainingSessionListFilter): Promise<readonly TrainingSessionSummary[]> {
        const rows = await this.database.db
            .select()
            .from(trainingSessions)
            .where(filter?.includeArchived ? undefined : isNull(trainingSessions.archivedAt))
            .orderBy(asc(trainingSessions.localDate), asc(trainingSessions.createdAt), asc(trainingSessions.id));
        const ids = rows.map(row => row.id);
        const [activityCounts, painCounts] = await Promise.all([
            this.childCounts(sessionActivities.sessionId, sessionActivities, ids),
            this.childCounts(painRecords.sessionId, painRecords, ids),
        ]);
        return rows.map(row => summary(row, activityCounts.get(row.id) ?? 0, painCounts.get(row.id) ?? 0));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: TrainingSessionState; version: number } | null> {
        assertEntityType(entityType);
        const executor = this.executor(transaction);
        const row = (
            await executor.select().from(trainingSessions).where(eq(trainingSessions.id, id)).limit(1).for("update")
        )[0];
        if (!row) return null;
        const [activityRows, painRows] = await this.loadChildren(id, executor);
        return { state: hydrate(row, activityRows, painRows), version: row.version };
    }

    async create(
        entityType: string,
        id: EntityId,
        state: TrainingSessionState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Training session state ID does not match its aggregate ID");
        TrainingSession.rehydrate(state);
        const executor = this.executor(transaction);
        await executor.insert(trainingSessions).values(rootValues(state, version));
        await this.writeChildren(state, executor, "insert");
    }

    async save(
        entityType: string,
        id: EntityId,
        state: TrainingSessionState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Training session state ID does not match its aggregate ID");
        TrainingSession.rehydrate(state);
        const executor = this.executor(transaction);
        const updated = await executor
            .update(trainingSessions)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(trainingSessions.id, id), eq(trainingSessions.version, expectedVersion)))
            .returning({ id: trainingSessions.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
        await this.reconcileChildren(state, executor);
    }

    private async loadChildren(
        id: EntityId,
        executor: Database,
    ): Promise<[readonly SessionActivityRow[], readonly PainRecordRow[]]> {
        return Promise.all([
            executor
                .select()
                .from(sessionActivities)
                .where(eq(sessionActivities.sessionId, id))
                .orderBy(asc(sessionActivities.position)),
            executor
                .select()
                .from(painRecords)
                .where(eq(painRecords.sessionId, id))
                .orderBy(asc(painRecords.createdAt)),
        ]);
    }

    /** Upsert the desired activity/pain rows and delete only those removed by this edit. */
    private async reconcileChildren(state: TrainingSessionState, executor: Database): Promise<void> {
        const desiredActivityIds = new Set(state.activities.map(activity => activity.id));
        const desiredPainIds = new Set(state.painRecords.map(record => record.id));
        const [existingActivities, existingPain] = await Promise.all([
            executor
                .select({ id: sessionActivities.id })
                .from(sessionActivities)
                .where(eq(sessionActivities.sessionId, state.id)),
            executor.select({ id: painRecords.id }).from(painRecords).where(eq(painRecords.sessionId, state.id)),
        ]);
        const removedPain = existingPain.map(row => row.id).filter(rowId => !desiredPainIds.has(rowId));
        if (removedPain.length > 0) await executor.delete(painRecords).where(inArray(painRecords.id, removedPain));
        const removedActivities = existingActivities.map(row => row.id).filter(rowId => !desiredActivityIds.has(rowId));
        if (removedActivities.length > 0)
            await executor.delete(sessionActivities).where(inArray(sessionActivities.id, removedActivities));
        await this.writeChildren(state, executor, "upsert");
    }

    private async writeChildren(
        state: TrainingSessionState,
        executor: Database,
        mode: "insert" | "upsert",
    ): Promise<void> {
        // Activities must land before pain records, which reference them by activity_id.
        for (const activity of state.activities) {
            const insert = executor.insert(sessionActivities).values(activityValues(state.id, activity));
            await (mode === "upsert"
                ? insert.onConflictDoUpdate({ target: sessionActivities.id, set: activityUpdateValues(activity) })
                : insert);
        }
        for (const record of state.painRecords) {
            const insert = executor.insert(painRecords).values(painValues(state.id, record));
            await (mode === "upsert"
                ? insert.onConflictDoUpdate({ target: painRecords.id, set: painUpdateValues(record) })
                : insert);
        }
    }

    private async childCounts(
        sessionColumn: typeof sessionActivities.sessionId | typeof painRecords.sessionId,
        table: typeof sessionActivities | typeof painRecords,
        ids: readonly string[],
    ): Promise<Map<string, number>> {
        if (ids.length === 0) return new Map();
        const rows = await this.database.db
            .select({ sessionId: sessionColumn, total: sql<number>`cast(count(*) as int)` })
            .from(table)
            .where(inArray(sessionColumn, [...ids]))
            .groupBy(sessionColumn);
        return new Map(rows.map(row => [row.sessionId, row.total]));
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(
    row: TrainingSessionRow,
    activityRows: readonly SessionActivityRow[],
    painRows: readonly PainRecordRow[],
): TrainingSessionState {
    return TrainingSession.rehydrate({
        id: row.id,
        profileId: row.profileId,
        status: checkedStatus(row.status),
        title: row.title,
        localDate: row.localDate,
        timeZone: row.timeZone,
        startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
        endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
        durationMinutes: row.durationMinutes,
        readiness: {
            energy: row.readinessEnergy,
            motivation: row.readinessMotivation,
            fatigue: row.readinessFatigue,
            soreness: row.readinessSoreness,
            stress: row.readinessStress,
            recovery: row.readinessRecovery,
        },
        postWorkout: {
            energy: row.postEnergy,
            motivation: row.postMotivation,
            enjoyment: row.postEnjoyment,
            difficulty: row.postDifficulty,
            fatigue: row.postFatigue,
            notes: row.postNotes,
        },
        notes: row.notes,
        tags: row.tags,
        sourcePlannedSessionId: row.sourcePlannedSessionId,
        activities: activityRows.map(hydrateActivity),
        painRecords: painRows.map(hydratePain),
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function hydrateActivity(row: SessionActivityRow): SessionActivityState {
    return {
        id: row.id,
        type: checkedActivityType(row.type),
        position: row.position,
        startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
        endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
        durationSeconds: row.durationSeconds,
        rpe: row.rpe,
        feeling: row.feeling,
        notes: row.notes,
        tags: row.tags,
    };
}

function hydratePain(row: PainRecordRow): PainRecordState {
    return {
        id: row.id,
        activityId: row.activityId,
        exerciseOccurrenceId: row.exerciseOccurrenceId,
        performedSetId: row.performedSetId,
        bodyArea: row.bodyArea,
        side: checkedSide(row.side),
        severity: row.severity,
        painType: row.painType,
        onsetDuringSession: row.onsetDuringSession,
        stoppedActivity: row.stoppedActivity,
        notes: row.notes,
    };
}

function summary(row: TrainingSessionRow, activityCount: number, painRecordCount: number): TrainingSessionSummary {
    return {
        id: row.id,
        profileId: row.profileId,
        status: checkedStatus(row.status),
        title: row.title,
        localDate: row.localDate,
        timeZone: row.timeZone,
        startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
        endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
        durationMinutes: row.durationMinutes,
        readiness: {
            energy: row.readinessEnergy,
            motivation: row.readinessMotivation,
            fatigue: row.readinessFatigue,
            soreness: row.readinessSoreness,
            stress: row.readinessStress,
            recovery: row.readinessRecovery,
        },
        postWorkout: {
            energy: row.postEnergy,
            motivation: row.postMotivation,
            enjoyment: row.postEnjoyment,
            difficulty: row.postDifficulty,
            fatigue: row.postFatigue,
            notes: row.postNotes,
        },
        notes: row.notes,
        tags: row.tags,
        sourcePlannedSessionId: row.sourcePlannedSessionId,
        version: row.version,
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        activityCount,
        painRecordCount,
    };
}

function rootValues(state: TrainingSessionState, version: number) {
    return {
        ...rootUpdateValues(state, version),
        id: state.id,
        profileId: state.profileId,
        createdAt: new Date(state.createdAt),
    };
}

function rootUpdateValues(state: TrainingSessionState, version: number) {
    return {
        status: state.status,
        title: state.title,
        localDate: state.localDate,
        timeZone: state.timeZone,
        startedAt: state.startedAt === null ? null : new Date(state.startedAt),
        endedAt: state.endedAt === null ? null : new Date(state.endedAt),
        durationMinutes: state.durationMinutes,
        readinessEnergy: state.readiness.energy,
        readinessMotivation: state.readiness.motivation,
        readinessFatigue: state.readiness.fatigue,
        readinessSoreness: state.readiness.soreness,
        readinessStress: state.readiness.stress,
        readinessRecovery: state.readiness.recovery,
        postEnergy: state.postWorkout.energy,
        postMotivation: state.postWorkout.motivation,
        postEnjoyment: state.postWorkout.enjoyment,
        postDifficulty: state.postWorkout.difficulty,
        postFatigue: state.postWorkout.fatigue,
        postNotes: state.postWorkout.notes,
        notes: state.notes,
        tags: [...state.tags],
        sourcePlannedSessionId: state.sourcePlannedSessionId,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function activityValues(sessionId: string, activity: SessionActivityState) {
    return { id: activity.id, sessionId, ...activityUpdateValues(activity) };
}

function activityUpdateValues(activity: SessionActivityState) {
    return {
        type: activity.type,
        position: activity.position,
        startedAt: activity.startedAt === null ? null : new Date(activity.startedAt),
        endedAt: activity.endedAt === null ? null : new Date(activity.endedAt),
        durationSeconds: activity.durationSeconds,
        rpe: activity.rpe,
        feeling: activity.feeling,
        notes: activity.notes,
        tags: [...activity.tags],
    };
}

function painValues(sessionId: string, record: PainRecordState) {
    return { id: record.id, sessionId, ...painUpdateValues(record) };
}

function painUpdateValues(record: PainRecordState) {
    return {
        activityId: record.activityId,
        exerciseOccurrenceId: record.exerciseOccurrenceId,
        performedSetId: record.performedSetId,
        bodyArea: record.bodyArea,
        side: record.side,
        severity: record.severity,
        painType: record.painType,
        onsetDuringSession: record.onsetDuringSession,
        stoppedActivity: record.stoppedActivity,
        notes: record.notes,
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== TRAINING_SESSION_ENTITY_TYPE)
        throw new Error(`Unsupported training session entity type '${entityType}'`);
}

function checkedStatus(value: string): TrainingSessionStatus {
    return (trainingSessionStatuses as readonly string[]).includes(value)
        ? (value as TrainingSessionStatus)
        : invalidPersisted("training session status", value);
}

function checkedActivityType(value: string): SessionActivityType {
    return (sessionActivityTypes as readonly string[]).includes(value)
        ? (value as SessionActivityType)
        : invalidPersisted("session activity type", value);
}

function checkedSide(value: string): PainSide {
    return (painSides as readonly string[]).includes(value)
        ? (value as PainSide)
        : invalidPersisted("pain side", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
