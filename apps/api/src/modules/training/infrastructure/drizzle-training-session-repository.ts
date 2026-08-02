import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
    activityMappings,
    exerciseOccurrenceMappings,
    exerciseOccurrences,
    painRecords,
    performedSets,
    runStepMappings,
    sessionActivities,
    sessionMappings,
    setGroupMembers,
    setGroups,
    setMappings,
    trainingSessions,
    type ActivityMappingRow,
    type Database,
    type ExerciseOccurrenceMappingRow,
    type ExerciseOccurrenceRow,
    type PainRecordRow,
    type PerformedSetRow,
    type RunStepMappingRow,
    type SessionActivityRow,
    type SessionMappingRow,
    type SetMappingRow,
    type SetGroupMemberRow,
    type SetGroupRow,
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
    Distance,
    Duration,
    EMPTY_STRENGTH_ACTIVITY,
    Mass,
    TrainingSession,
    painSides,
    performedSetStatuses,
    performedSetTypes,
    sessionActivityTypes,
    setFailureReasons,
    setGroupTypes,
    trainingSessionStatuses,
    type DistanceValue,
    type DurationValue,
    type ExerciseOccurrenceState,
    type ExerciseSnapshotV1,
    type MassValue,
    mappingRelations,
    type ActivityMappingState,
    type MappingRelation,
    type OccurrenceMappingState,
    type PainRecordState,
    type PainSide,
    type PerformedSetMeasurements,
    type PerformedSetState,
    type RunStepMappingState,
    type SessionActivityState,
    type SessionActivityType,
    type SessionPlannedLink,
    type SetGroupMember,
    type SetGroupState,
    type SetMappingState,
    type StrengthActivityState,
    type TrainingSessionState,
    type TrainingSessionStatus,
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
        const children = await this.loadChildren(id, executor);
        return { ...hydrate(row, children), version: row.version };
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
        const children = await this.loadChildren(id, executor);
        return { state: hydrate(row, children), version: row.version };
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
        await this.insertStrength(state, executor);
        await this.insertMappings(state, executor);
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

    private async loadChildren(id: EntityId, executor: Database): Promise<SessionChildren> {
        const [activityRows, painRows, mappingRows] = await Promise.all([
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
            this.loadMappings(id, executor),
        ]);
        const strengthRows = await this.loadStrength(
            activityRows.filter(activity => activity.type === "strength").map(activity => activity.id),
            executor,
        );
        return { activityRows, painRows, strength: hydrateStrengthByActivity(strengthRows), mappings: mappingRows };
    }

    private async loadMappings(id: EntityId, executor: Database): Promise<MappingRows> {
        const [links, activity, occurrence, set, runStep] = await Promise.all([
            executor.select().from(sessionMappings).where(eq(sessionMappings.sessionId, id)),
            executor.select().from(activityMappings).where(eq(activityMappings.sessionId, id)),
            executor.select().from(exerciseOccurrenceMappings).where(eq(exerciseOccurrenceMappings.sessionId, id)),
            executor.select().from(setMappings).where(eq(setMappings.sessionId, id)),
            executor.select().from(runStepMappings).where(eq(runStepMappings.sessionId, id)),
        ]);
        return { links, activity, occurrence, set, runStep };
    }

    /** Load the whole strength tree for a set of activities in a small, bounded number of batched queries. */
    private async loadStrength(activityIds: readonly string[], executor: Database): Promise<StrengthRows> {
        if (activityIds.length === 0) return { occurrences: [], setGroups: [], members: [], performedSets: [] };
        const [occurrences, groups] = await Promise.all([
            executor
                .select()
                .from(exerciseOccurrences)
                .where(inArray(exerciseOccurrences.activityId, [...activityIds])),
            executor
                .select()
                .from(setGroups)
                .where(inArray(setGroups.activityId, [...activityIds])),
        ]);
        const occurrenceIds = occurrences.map(row => row.id);
        const groupIds = groups.map(row => row.id);
        const [members, sets] = await Promise.all([
            groupIds.length > 0
                ? executor.select().from(setGroupMembers).where(inArray(setGroupMembers.setGroupId, groupIds))
                : Promise.resolve([]),
            occurrenceIds.length > 0
                ? executor.select().from(performedSets).where(inArray(performedSets.occurrenceId, occurrenceIds))
                : Promise.resolve([]),
        ]);
        return { occurrences, setGroups: groups, members, performedSets: sets };
    }

    /** Rewrite the strength tree for a mutated session: clear the owned rows, then re-insert from state. */
    private async reconcileStrength(state: TrainingSessionState, executor: Database): Promise<void> {
        const activityIds = state.activities.map(activity => activity.id);
        if (activityIds.length > 0) {
            // Deleting occurrences cascades their performed sets and set-group members; set groups
            // (kept out of that cascade) are removed leaf-first so a parent never precedes its child.
            await executor.delete(exerciseOccurrences).where(inArray(exerciseOccurrences.activityId, activityIds));
            const existingGroups = await executor
                .select({ id: setGroups.id, parentGroupId: setGroups.parentGroupId })
                .from(setGroups)
                .where(inArray(setGroups.activityId, activityIds));
            for (const groupId of setGroupIdsLeafFirst(existingGroups))
                await executor.delete(setGroups).where(eq(setGroups.id, groupId));
        }
        await this.insertStrength(state, executor);
    }

    private async insertStrength(state: TrainingSessionState, executor: Database): Promise<void> {
        for (const activity of state.activities) {
            if (activity.type !== "strength" || activity.strength === null) continue;
            const strength = activity.strength;
            for (const occurrence of strength.occurrences)
                await executor.insert(exerciseOccurrences).values(occurrenceInsert(activity.id, occurrence));
            for (const group of setGroupsParentFirst(strength.setGroups))
                await executor.insert(setGroups).values(setGroupInsert(activity.id, group));
            for (const group of strength.setGroups) {
                const members = setGroupMemberInserts(group);
                if (members.length > 0) await executor.insert(setGroupMembers).values(members);
            }
            for (const occurrence of strength.occurrences) {
                const sets = occurrence.performedSets.map(set => performedSetInsert(occurrence.id, set));
                if (sets.length > 0) await executor.insert(performedSets).values(sets);
            }
        }
    }

    /** Upsert the desired activity/pain rows and delete only those removed by this edit. */
    private async reconcileChildren(state: TrainingSessionState, executor: Database): Promise<void> {
        // Mappings reference actual rows recreated by the strength reconcile below, so clear the whole
        // mapping tree first and re-insert it last, once the actual rows exist again.
        await this.deleteMappings(state.id, executor);
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
        await this.reconcileStrength(state, executor);
        await this.insertMappings(state, executor);
    }

    private async deleteMappings(sessionId: string, executor: Database): Promise<void> {
        await executor.delete(setMappings).where(eq(setMappings.sessionId, sessionId));
        await executor.delete(exerciseOccurrenceMappings).where(eq(exerciseOccurrenceMappings.sessionId, sessionId));
        await executor.delete(activityMappings).where(eq(activityMappings.sessionId, sessionId));
        await executor.delete(runStepMappings).where(eq(runStepMappings.sessionId, sessionId));
        await executor.delete(sessionMappings).where(eq(sessionMappings.sessionId, sessionId));
    }

    private async insertMappings(state: TrainingSessionState, executor: Database): Promise<void> {
        if (state.plannedLinks.length > 0)
            await executor
                .insert(sessionMappings)
                .values(state.plannedLinks.map(link => plannedLinkInsert(state.id, link)));
        if (state.activityMappings.length > 0)
            await executor
                .insert(activityMappings)
                .values(state.activityMappings.map(m => activityMappingInsert(state.id, m)));
        if (state.occurrenceMappings.length > 0)
            await executor
                .insert(exerciseOccurrenceMappings)
                .values(state.occurrenceMappings.map(m => occurrenceMappingInsert(state.id, m)));
        if (state.setMappings.length > 0)
            await executor.insert(setMappings).values(state.setMappings.map(m => setMappingInsert(state.id, m)));
        if (state.runStepMappings.length > 0)
            await executor
                .insert(runStepMappings)
                .values(state.runStepMappings.map(m => runStepMappingInsert(state.id, m)));
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

function hydrate(row: TrainingSessionRow, children: SessionChildren): TrainingSessionState {
    const { activityRows, painRows, strength: strengthByActivity, mappings } = children;
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
        activities: activityRows.map(activity => hydrateActivity(activity, strengthByActivity)),
        painRecords: painRows.map(hydratePain),
        plannedLinks: mappings.links.map(hydratePlannedLink),
        activityMappings: mappings.activity.map(hydrateActivityMapping),
        occurrenceMappings: mappings.occurrence.map(hydrateOccurrenceMapping),
        setMappings: mappings.set.map(hydrateSetMapping),
        runStepMappings: mappings.runStep.map(hydrateRunStepMapping),
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function hydrateActivity(
    row: SessionActivityRow,
    strengthByActivity: Map<string, StrengthActivityState>,
): SessionActivityState {
    const type = checkedActivityType(row.type);
    return {
        id: row.id,
        type,
        position: row.position,
        startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
        endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
        durationSeconds: row.durationSeconds,
        rpe: row.rpe,
        feeling: row.feeling,
        notes: row.notes,
        tags: row.tags,
        strength: type === "strength" ? (strengthByActivity.get(row.id) ?? EMPTY_STRENGTH_ACTIVITY) : null,
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

// ---------------------------------------------------------------------------------------------
// Planned/actual mapping tree (state <-> normalized rows). Inlined here for the same import-boundary
// reason as the strength mapper below.
// ---------------------------------------------------------------------------------------------

interface MappingRows {
    readonly links: readonly SessionMappingRow[];
    readonly activity: readonly ActivityMappingRow[];
    readonly occurrence: readonly ExerciseOccurrenceMappingRow[];
    readonly set: readonly SetMappingRow[];
    readonly runStep: readonly RunStepMappingRow[];
}

interface SessionChildren {
    readonly activityRows: readonly SessionActivityRow[];
    readonly painRows: readonly PainRecordRow[];
    readonly strength: Map<string, StrengthActivityState>;
    readonly mappings: MappingRows;
}

function hydratePlannedLink(row: SessionMappingRow): SessionPlannedLink {
    return {
        plannedSessionId: row.plannedSessionId,
        sourcePrescriptionId: row.sourcePrescriptionId,
        resolvedPrescriptionId: row.resolvedPrescriptionId,
    };
}

function hydrateActivityMapping(row: ActivityMappingRow): ActivityMappingState {
    return {
        id: row.id,
        prescribedActivityId: row.prescribedActivityId,
        actualActivityId: row.actualActivityId,
        relation: checkedRelation(row.relation),
        reason: row.reason,
        notes: row.notes,
    };
}

function hydrateOccurrenceMapping(row: ExerciseOccurrenceMappingRow): OccurrenceMappingState {
    return {
        id: row.id,
        prescribedExerciseId: row.prescribedExerciseId,
        occurrenceId: row.occurrenceId,
        relation: checkedRelation(row.relation),
        reason: row.reason,
        notes: row.notes,
    };
}

function hydrateSetMapping(row: SetMappingRow): SetMappingState {
    return {
        id: row.id,
        prescribedSetId: row.prescribedSetId,
        performedSetId: row.performedSetId,
        relation: checkedRelation(row.relation),
        portion: row.portion,
        reason: row.reason,
        notes: row.notes,
    };
}

function hydrateRunStepMapping(row: RunStepMappingRow): RunStepMappingState {
    return {
        id: row.id,
        prescribedRunStepId: row.prescribedRunStepId,
        performedRunStepId: row.performedRunStepId,
        relation: checkedRelation(row.relation),
        reason: row.reason,
        notes: row.notes,
    };
}

function plannedLinkInsert(sessionId: string, link: SessionPlannedLink) {
    return {
        sessionId,
        plannedSessionId: link.plannedSessionId,
        sourcePrescriptionId: link.sourcePrescriptionId,
        resolvedPrescriptionId: link.resolvedPrescriptionId,
    };
}

function activityMappingInsert(sessionId: string, mapping: ActivityMappingState) {
    return {
        id: mapping.id,
        sessionId,
        prescribedActivityId: mapping.prescribedActivityId,
        actualActivityId: mapping.actualActivityId,
        relation: mapping.relation,
        reason: mapping.reason,
        notes: mapping.notes,
    };
}

function occurrenceMappingInsert(sessionId: string, mapping: OccurrenceMappingState) {
    return {
        id: mapping.id,
        sessionId,
        prescribedExerciseId: mapping.prescribedExerciseId,
        occurrenceId: mapping.occurrenceId,
        relation: mapping.relation,
        reason: mapping.reason,
        notes: mapping.notes,
    };
}

function setMappingInsert(sessionId: string, mapping: SetMappingState) {
    return {
        id: mapping.id,
        sessionId,
        prescribedSetId: mapping.prescribedSetId,
        performedSetId: mapping.performedSetId,
        relation: mapping.relation,
        portion: mapping.portion,
        reason: mapping.reason,
        notes: mapping.notes,
    };
}

function runStepMappingInsert(sessionId: string, mapping: RunStepMappingState) {
    return {
        id: mapping.id,
        sessionId,
        prescribedRunStepId: mapping.prescribedRunStepId,
        performedRunStepId: mapping.performedRunStepId,
        relation: mapping.relation,
        reason: mapping.reason,
        notes: mapping.notes,
    };
}

function checkedRelation(value: string): MappingRelation {
    return (mappingRelations as readonly string[]).includes(value)
        ? (value as MappingRelation)
        : invalidPersisted("mapping relation", value);
}

// ---------------------------------------------------------------------------------------------
// Strength tree mapping (state <-> normalized rows). Kept in the repository module because the
// import-boundary lint rules forbid infrastructure files from importing each other.
// ---------------------------------------------------------------------------------------------

/** All strength rows for a session, keyed for assembly back into per-activity {@link StrengthActivityState}. */
interface StrengthRows {
    readonly occurrences: readonly ExerciseOccurrenceRow[];
    readonly setGroups: readonly SetGroupRow[];
    readonly members: readonly SetGroupMemberRow[];
    readonly performedSets: readonly PerformedSetRow[];
}

type EnteredValue = { readonly value: number; readonly unit: string };

function hydrateStrengthByActivity(rows: StrengthRows): Map<string, StrengthActivityState> {
    const setsByOccurrence = groupBy(rows.performedSets, row => row.occurrenceId);
    const membersByGroup = groupBy(rows.members, row => row.setGroupId);
    const occurrencesByActivity = groupBy(rows.occurrences, row => row.activityId);
    const groupsByActivity = groupBy(rows.setGroups, row => row.activityId);

    const result = new Map<string, StrengthActivityState>();
    const activityIds = new Set<string>([...occurrencesByActivity.keys(), ...groupsByActivity.keys()]);
    for (const activityId of activityIds) {
        const occurrences = (occurrencesByActivity.get(activityId) ?? [])
            .slice()
            .sort((a, b) => a.position - b.position)
            .map(row => hydrateOccurrence(row, setsByOccurrence.get(row.id) ?? []));
        const setGroups = (groupsByActivity.get(activityId) ?? [])
            .slice()
            .sort((a, b) => a.position - b.position)
            .map(row => hydrateSetGroup(row, membersByGroup.get(row.id) ?? []));
        result.set(activityId, { occurrences, setGroups });
    }
    return result;
}

function hydrateOccurrence(row: ExerciseOccurrenceRow, sets: readonly PerformedSetRow[]): ExerciseOccurrenceState {
    return {
        id: row.id,
        exerciseId: row.exerciseId,
        snapshot: row.exerciseSnapshot as ExerciseSnapshotV1,
        position: row.position,
        purpose: row.purpose,
        technique: row.technique,
        discomfort: row.discomfort,
        pump: row.pump,
        notes: row.notes,
        performedSets: sets
            .slice()
            .sort((a, b) => a.position - b.position)
            .map(hydratePerformedSet),
    };
}

function hydrateSetGroup(row: SetGroupRow, members: readonly SetGroupMemberRow[]): SetGroupState {
    return {
        id: row.id,
        parentGroupId: row.parentGroupId,
        type: checked(row.type, setGroupTypes, "set group type"),
        position: row.position,
        rounds: row.rounds,
        restMs: row.restMs,
        members: members
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((member): SetGroupMember => ({ occurrenceId: member.occurrenceId, position: member.position })),
    };
}

function hydratePerformedSet(row: PerformedSetRow): PerformedSetState {
    const entered = row.enteredMeasurements ?? {};
    const measurements: PerformedSetMeasurements = {
        reps: row.reps,
        externalLoad: enteredMass(entered.externalLoad),
        bodyweight: enteredMass(entered.bodyweight),
        addedLoad: enteredMass(entered.addedLoad),
        assistanceLoad: enteredMass(entered.assistanceLoad),
        effectiveLoad: enteredMass(entered.effectiveLoad),
        duration: enteredDuration(entered.duration),
        distance: enteredDistance(entered.distance),
        powerWatts: row.powerW === null ? null : Number(row.powerW),
        rpe: row.rpe === null ? null : Number(row.rpe),
        rir: row.rir,
        tempo: hydrateTempo(entered.tempo),
        restBefore: enteredDuration(entered.restBefore),
        restAfter: enteredDuration(entered.restAfter),
    };
    return {
        id: row.id,
        setGroupId: row.setGroupId,
        round: row.round,
        position: row.position,
        setType: checked(row.setType, performedSetTypes, "performed set type"),
        status: checked(row.status, performedSetStatuses, "performed set status"),
        measurements,
        failureReason:
            row.failureReason === null ? null : checked(row.failureReason, setFailureReasons, "set failure reason"),
        technique: row.technique,
        discomfort: row.discomfort,
        pump: row.pump,
        notes: row.notes,
    };
}

function hydrateTempo(value: unknown): PerformedSetMeasurements["tempo"] {
    if (value == null || typeof value !== "object") return null;
    const tempo = value as Record<string, unknown>;
    const phases = {
        eccentric: enteredDuration(tempo.eccentric),
        bottomPause: enteredDuration(tempo.bottomPause),
        concentric: enteredDuration(tempo.concentric),
        topPause: enteredDuration(tempo.topPause),
    };
    return phases.eccentric || phases.bottomPause || phases.concentric || phases.topPause ? phases : null;
}

function enteredMass(value: unknown): MassValue | null {
    const parsed = parseEntered(value);
    return parsed === null ? null : { value: parsed.value, unit: parsed.unit as MassValue["unit"] };
}
function enteredDistance(value: unknown): DistanceValue | null {
    const parsed = parseEntered(value);
    return parsed === null ? null : { value: parsed.value, unit: parsed.unit as DistanceValue["unit"] };
}
function enteredDuration(value: unknown): DurationValue | null {
    const parsed = parseEntered(value);
    return parsed === null ? null : { value: parsed.value, unit: parsed.unit as DurationValue["unit"] };
}

function parseEntered(value: unknown): EnteredValue | null {
    if (value == null || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.value !== "number" || typeof record.unit !== "string") return null;
    return { value: record.value, unit: record.unit };
}

function occurrenceInsert(activityId: string, occurrence: ExerciseOccurrenceState) {
    return {
        id: occurrence.id,
        activityId,
        exerciseId: occurrence.exerciseId,
        exerciseSnapshot: occurrence.snapshot as unknown as Record<string, unknown>,
        position: occurrence.position,
        purpose: occurrence.purpose,
        technique: occurrence.technique,
        discomfort: occurrence.discomfort,
        pump: occurrence.pump,
        notes: occurrence.notes,
    };
}

function setGroupInsert(activityId: string, group: SetGroupState) {
    return {
        id: group.id,
        activityId,
        parentGroupId: group.parentGroupId,
        type: group.type,
        position: group.position,
        rounds: group.rounds,
        restMs: group.restMs,
    };
}

function setGroupMemberInserts(group: SetGroupState) {
    return group.members.map(member => ({
        setGroupId: group.id,
        occurrenceId: member.occurrenceId,
        position: member.position,
    }));
}

function performedSetInsert(occurrenceId: string, set: PerformedSetState) {
    const measurements = set.measurements;
    const entered: Record<string, EnteredValue | Record<string, EnteredValue>> = {};
    const put = (key: string, value: EnteredValue | null) => {
        if (value !== null) entered[key] = value;
    };
    put("externalLoad", enteredOf(measurements.externalLoad));
    put("bodyweight", enteredOf(measurements.bodyweight));
    put("addedLoad", enteredOf(measurements.addedLoad));
    put("assistanceLoad", enteredOf(measurements.assistanceLoad));
    put("effectiveLoad", enteredOf(measurements.effectiveLoad));
    put("duration", enteredOf(measurements.duration));
    put("distance", enteredOf(measurements.distance));
    put("restBefore", enteredOf(measurements.restBefore));
    put("restAfter", enteredOf(measurements.restAfter));
    const tempo = enteredTempo(measurements.tempo);
    if (tempo !== null) entered.tempo = tempo;

    return {
        id: set.id,
        occurrenceId,
        setGroupId: set.setGroupId,
        round: set.round,
        position: set.position,
        setType: set.setType,
        status: set.status,
        reps: measurements.reps,
        externalLoadKg: massKg(measurements.externalLoad),
        bodyweightKg: massKg(measurements.bodyweight),
        addedLoadKg: massKg(measurements.addedLoad),
        assistanceLoadKg: massKg(measurements.assistanceLoad),
        effectiveLoadKg: massKg(measurements.effectiveLoad),
        durationMs: durationMs(measurements.duration),
        distanceM: distanceM(measurements.distance),
        powerW: measurements.powerWatts === null ? null : measurements.powerWatts.toString(),
        rpe: measurements.rpe === null ? null : measurements.rpe.toString(),
        rir: measurements.rir,
        tempoEccentricMs: durationMs(measurements.tempo?.eccentric ?? null),
        tempoBottomPauseMs: durationMs(measurements.tempo?.bottomPause ?? null),
        tempoConcentricMs: durationMs(measurements.tempo?.concentric ?? null),
        tempoTopPauseMs: durationMs(measurements.tempo?.topPause ?? null),
        restBeforeMs: durationMs(measurements.restBefore),
        restAfterMs: durationMs(measurements.restAfter),
        failureReason: set.failureReason,
        technique: set.technique,
        discomfort: set.discomfort,
        pump: set.pump,
        enteredMeasurements: entered as Record<string, unknown>,
        notes: set.notes,
    };
}

function massKg(value: MassValue | null): string | null {
    return value === null ? null : Mass.from(value.value, value.unit).canonical.toString();
}
function distanceM(value: DistanceValue | null): string | null {
    return value === null ? null : Distance.from(value.value, value.unit).canonical.toString();
}
function durationMs(value: DurationValue | null): number | null {
    return value === null ? null : Number(Duration.from(value.value, value.unit).milliseconds);
}
function enteredOf(value: MassValue | DistanceValue | DurationValue | null): EnteredValue | null {
    return value === null ? null : { value: value.value, unit: value.unit };
}
function enteredTempo(tempo: PerformedSetMeasurements["tempo"]): Record<string, EnteredValue> | null {
    if (tempo === null) return null;
    const phases: Record<string, EnteredValue> = {};
    if (tempo.eccentric) phases.eccentric = { value: tempo.eccentric.value, unit: tempo.eccentric.unit };
    if (tempo.bottomPause) phases.bottomPause = { value: tempo.bottomPause.value, unit: tempo.bottomPause.unit };
    if (tempo.concentric) phases.concentric = { value: tempo.concentric.value, unit: tempo.concentric.unit };
    if (tempo.topPause) phases.topPause = { value: tempo.topPause.value, unit: tempo.topPause.unit };
    return Object.keys(phases).length > 0 ? phases : null;
}

/** Set groups ordered so a parent always precedes its children (safe insert order). */
function setGroupsParentFirst(groups: readonly SetGroupState[]): readonly SetGroupState[] {
    return [...groups].sort((a, b) => depthOf(a, groups) - depthOf(b, groups));
}

/** Set-group ids ordered so children are deleted before their parent (safe delete order). */
function setGroupIdsLeafFirst(rows: ReadonlyArray<{ id: string; parentGroupId: string | null }>): string[] {
    const byId = new Map(rows.map(row => [row.id, row]));
    const depth = (row: { id: string; parentGroupId: string | null }): number => {
        let current: { id: string; parentGroupId: string | null } | undefined = row;
        let steps = 0;
        const seen = new Set<string>();
        while (current && current.parentGroupId !== null && !seen.has(current.id)) {
            seen.add(current.id);
            current = byId.get(current.parentGroupId);
            steps += 1;
        }
        return steps;
    };
    return [...rows].sort((a, b) => depth(b) - depth(a)).map(row => row.id);
}

function depthOf(group: SetGroupState, groups: readonly SetGroupState[]): number {
    const byId = new Map(groups.map(item => [item.id, item]));
    let current: SetGroupState | undefined = group;
    let steps = 0;
    const seen = new Set<string>();
    while (current && current.parentGroupId !== null && !seen.has(current.id)) {
        seen.add(current.id);
        current = byId.get(current.parentGroupId);
        steps += 1;
    }
    return steps;
}

function groupBy<Row, Key>(rows: readonly Row[], key: (row: Row) => Key): Map<Key, Row[]> {
    const map = new Map<Key, Row[]>();
    for (const row of rows) {
        const bucket = map.get(key(row));
        if (bucket) bucket.push(row);
        else map.set(key(row), [row]);
    }
    return map;
}

function checked<T extends string>(value: string, allowed: readonly T[], kind: string): T {
    if ((allowed as readonly string[]).includes(value)) return value as T;
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
