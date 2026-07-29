import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { inArray } from "drizzle-orm";

import {
    prescribedActivities,
    prescribedExercises,
    prescribedRunSteps,
    prescribedRunningActivities,
    prescribedSetGroupMembers,
    prescribedSetGroups,
    prescribedSets,
    prescribedStrengthActivities,
    sessionPrescriptions,
    type Database,
    type PrescribedActivityRow,
    type PrescribedExerciseRow,
    type PrescribedRunStepRow,
    type PrescribedRunningActivityRow,
    type PrescribedSetGroupMemberRow,
    type PrescribedSetGroupRow,
    type PrescribedSetRow,
    type SessionPrescriptionRow,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { SessionPrescriptionRepository } from "#src/modules/training/application/index";
import {
    DecimalValue,
    SessionPrescription,
    type ExerciseSnapshotV1,
    type PrescribedActivityState,
    type PrescribedExerciseState,
    type PrescribedRunStepState,
    type PrescribedSetGroupState,
    type PrescribedSetState,
    type PrescribedRunningActivityState,
    type PrescribedStrengthActivityState,
    type PrescribedSetType,
    type PrescribedSetGroupType,
    type PrescribedRunStepType,
    type SubstitutionPolicy,
    type PrescriptionKind,
    type SessionPrescriptionState,
    type TargetRanges,
} from "#src/modules/training/domain/index";

/** Persists whole immutable prescription trees; published rows are never updated or deleted. */
@Injectable()
export class DrizzleSessionPrescriptionRepository implements SessionPrescriptionRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async insertTree(state: SessionPrescriptionState, transaction: unknown): Promise<void> {
        SessionPrescription.rehydrate(state);
        const executor = this.executor(transaction);
        const rowIdByLogical = logicalToRowId(state);

        await executor.insert(sessionPrescriptions).values({
            id: state.id,
            kind: state.kind,
            schemaVersion: state.schemaVersion,
            expectedDurationMs: state.expectedDurationMs,
            notes: state.notes,
            sourcePrescriptionId: state.sourcePrescriptionId,
            sourceKind: state.sourceKind,
        });

        await executor.insert(prescribedActivities).values(
            state.activities.map(activity => ({
                id: activity.id,
                prescriptionId: state.id,
                logicalKey: activity.logicalKey,
                sourceLogicalKey: activity.sourceLogicalKey,
                sourceRowId: activity.sourceRowId,
                type: activity.type,
                position: activity.position,
                expectedDurationMs: activity.expectedDurationMs,
                rpeTarget: activity.rpeTarget,
                notes: activity.notes,
            })),
        );

        const detailIdByActivity = new Map<string, string>();
        const strengthDetails: Array<{ id: string; prescriptionId: string; activityId: string }> = [];
        const runningDetails: Array<Record<string, unknown>> = [];
        for (const activity of state.activities) {
            const detailId = randomUUID();
            detailIdByActivity.set(activity.id, detailId);
            if (activity.type === "strength")
                strengthDetails.push({ id: detailId, prescriptionId: state.id, activityId: activity.id });
            else
                runningDetails.push({
                    id: detailId,
                    prescriptionId: state.id,
                    activityId: activity.id,
                    runTags: [...(activity.running?.runTags ?? [])],
                    ...targetColumnValues(activity.running!.overallTargets),
                });
        }
        if (strengthDetails.length > 0) await executor.insert(prescribedStrengthActivities).values(strengthDetails);
        if (runningDetails.length > 0)
            await executor.insert(prescribedRunningActivities).values(runningDetails as never);

        const exerciseRows: Array<Record<string, unknown>> = [];
        const groupRows: Array<Record<string, unknown>> = [];
        const memberRows: Array<Record<string, unknown>> = [];
        const setRows: Array<Record<string, unknown>> = [];
        const stepRows: Array<Record<string, unknown>> = [];

        for (const activity of state.activities) {
            const detailId = detailIdByActivity.get(activity.id)!;
            for (const exercise of activity.strength?.exercises ?? []) {
                exerciseRows.push({
                    id: exercise.id,
                    prescriptionId: state.id,
                    logicalKey: exercise.logicalKey,
                    sourceLogicalKey: exercise.sourceLogicalKey,
                    sourceRowId: exercise.sourceRowId,
                    strengthActivityId: detailId,
                    exerciseId: exercise.exerciseId,
                    exerciseSnapshot: exercise.snapshot,
                    position: exercise.position,
                    purpose: exercise.purpose,
                    substitutionPolicy: exercise.substitutionPolicy,
                });
                for (const set of exercise.sets)
                    setRows.push({
                        id: set.id,
                        prescriptionId: state.id,
                        logicalKey: set.logicalKey,
                        sourceLogicalKey: set.sourceLogicalKey,
                        sourceRowId: set.sourceRowId,
                        exerciseId: exercise.id,
                        setGroupId: resolveRowId(rowIdByLogical, set.setGroupLogicalKey),
                        position: set.position,
                        round: set.round,
                        setType: set.setType,
                        ...targetColumnValues(set.targets),
                        notes: set.notes,
                    });
            }
            for (const group of orderByDepth(
                activity.strength?.setGroups ?? [],
                group => group.logicalKey,
                group => group.parentGroupLogicalKey,
            )) {
                groupRows.push({
                    id: group.id,
                    prescriptionId: state.id,
                    logicalKey: group.logicalKey,
                    sourceLogicalKey: group.sourceLogicalKey,
                    sourceRowId: group.sourceRowId,
                    strengthActivityId: detailId,
                    parentGroupId: resolveRowId(rowIdByLogical, group.parentGroupLogicalKey),
                    type: group.type,
                    position: group.position,
                    rounds: group.rounds,
                    restMs: group.restMs,
                });
                for (const member of group.members)
                    memberRows.push({
                        id: randomUUID(),
                        prescriptionId: state.id,
                        setGroupId: group.id,
                        exerciseId: rowIdByLogical.get(member.exerciseLogicalKey)!,
                        position: member.position,
                    });
            }
            for (const step of orderByDepth(
                activity.running?.steps ?? [],
                step => step.logicalKey,
                step => step.parentStepLogicalKey,
            ))
                stepRows.push({
                    id: step.id,
                    prescriptionId: state.id,
                    logicalKey: step.logicalKey,
                    sourceLogicalKey: step.sourceLogicalKey,
                    sourceRowId: step.sourceRowId,
                    runningActivityId: detailId,
                    parentStepId: resolveRowId(rowIdByLogical, step.parentStepLogicalKey),
                    type: step.type,
                    position: step.position,
                    repeatCount: step.repeatCount,
                    ...targetColumnValues(step.targets),
                    notes: step.notes,
                });
        }

        if (exerciseRows.length > 0) await executor.insert(prescribedExercises).values(exerciseRows as never);
        if (groupRows.length > 0) await executor.insert(prescribedSetGroups).values(groupRows as never);
        if (memberRows.length > 0) await executor.insert(prescribedSetGroupMembers).values(memberRows as never);
        if (setRows.length > 0) await executor.insert(prescribedSets).values(setRows as never);
        if (stepRows.length > 0) await executor.insert(prescribedRunSteps).values(stepRows as never);
    }

    async loadTree(id: string, transaction?: unknown): Promise<SessionPrescriptionState | null> {
        const trees = await this.loadTrees([id], transaction);
        return trees[0] ?? null;
    }

    async loadTrees(ids: readonly string[], transaction?: unknown): Promise<readonly SessionPrescriptionState[]> {
        if (ids.length === 0) return [];
        const executor = this.executor(transaction);
        const idList = [...ids];
        const roots = await executor
            .select()
            .from(sessionPrescriptions)
            .where(inArray(sessionPrescriptions.id, idList));
        if (roots.length === 0) return [];
        const [activities, strengthDetails, runningDetails, exercises, groups, members, sets, steps] =
            await Promise.all([
                executor
                    .select()
                    .from(prescribedActivities)
                    .where(inArray(prescribedActivities.prescriptionId, idList)),
                executor
                    .select()
                    .from(prescribedStrengthActivities)
                    .where(inArray(prescribedStrengthActivities.prescriptionId, idList)),
                executor
                    .select()
                    .from(prescribedRunningActivities)
                    .where(inArray(prescribedRunningActivities.prescriptionId, idList)),
                executor.select().from(prescribedExercises).where(inArray(prescribedExercises.prescriptionId, idList)),
                executor.select().from(prescribedSetGroups).where(inArray(prescribedSetGroups.prescriptionId, idList)),
                executor
                    .select()
                    .from(prescribedSetGroupMembers)
                    .where(inArray(prescribedSetGroupMembers.prescriptionId, idList)),
                executor.select().from(prescribedSets).where(inArray(prescribedSets.prescriptionId, idList)),
                executor.select().from(prescribedRunSteps).where(inArray(prescribedRunSteps.prescriptionId, idList)),
            ]);

        const logicalKeyByRowId = new Map<string, string>();
        for (const row of [...activities, ...exercises, ...groups, ...steps])
            logicalKeyByRowId.set(row.id, row.logicalKey);
        const context: LoadContext = {
            activities,
            strengthDetails,
            runningDetails,
            exercises,
            groups,
            members,
            sets,
            steps,
            logicalKeyByRowId,
        };
        const byId = new Map(roots.map(root => [root.id, assembleTree(root, context)]));
        return idList.map(id => byId.get(id)).filter((tree): tree is SessionPrescriptionState => tree != null);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

interface LoadContext {
    readonly activities: PrescribedActivityRow[];
    readonly strengthDetails: Array<{ id: string; activityId: string }>;
    readonly runningDetails: PrescribedRunningActivityRow[];
    readonly exercises: PrescribedExerciseRow[];
    readonly groups: PrescribedSetGroupRow[];
    readonly members: PrescribedSetGroupMemberRow[];
    readonly sets: PrescribedSetRow[];
    readonly steps: PrescribedRunStepRow[];
    readonly logicalKeyByRowId: Map<string, string>;
}

function assembleTree(root: SessionPrescriptionRow, context: LoadContext): SessionPrescriptionState {
    const activities = context.activities
        .filter(activity => activity.prescriptionId === root.id)
        .sort((a, b) => a.position - b.position)
        .map(activity => assembleActivity(activity, context));
    const state: SessionPrescriptionState = {
        id: root.id,
        kind: checkedKind(root.kind),
        schemaVersion: root.schemaVersion,
        expectedDurationMs: root.expectedDurationMs,
        notes: root.notes,
        sourcePrescriptionId: root.sourcePrescriptionId,
        sourceKind: root.sourceKind === null ? null : checkedKind(root.sourceKind),
        activities,
        createdAt: root.createdAt.toISOString(),
    };
    return SessionPrescription.rehydrate(state).state;
}

function assembleActivity(activity: PrescribedActivityRow, context: LoadContext): PrescribedActivityState {
    const type = activity.type === "running" ? "running" : "strength";
    let strength: PrescribedStrengthActivityState | null = null;
    let running: PrescribedRunningActivityState | null = null;
    if (type === "strength") {
        const detail = context.strengthDetails.find(row => row.activityId === activity.id);
        const detailId = detail?.id ?? "";
        const exercises = context.exercises
            .filter(exercise => exercise.strengthActivityId === detailId)
            .sort((a, b) => a.position - b.position)
            .map(exercise => assembleExercise(exercise, context));
        const setGroups = context.groups
            .filter(group => group.strengthActivityId === detailId)
            .sort((a, b) => a.position - b.position)
            .map(group => assembleGroup(group, context));
        strength = { exercises, setGroups };
    } else {
        const detail = context.runningDetails.find(row => row.activityId === activity.id);
        const steps = context.steps
            .filter(step => step.runningActivityId === (detail?.id ?? ""))
            .sort((a, b) => a.position - b.position)
            .map(step => assembleStep(step, context));
        running = {
            runTags: [...(detail?.runTags ?? [])],
            overallTargets: detail ? hydrateTargets(detail) : emptyTargets(),
            steps,
        };
    }
    return {
        id: activity.id,
        logicalKey: activity.logicalKey,
        sourceLogicalKey: activity.sourceLogicalKey,
        sourceRowId: activity.sourceRowId,
        type,
        position: activity.position,
        expectedDurationMs: activity.expectedDurationMs,
        rpeTarget: decimal(activity.rpeTarget),
        notes: activity.notes,
        strength,
        running,
    };
}

function assembleExercise(exercise: PrescribedExerciseRow, context: LoadContext): PrescribedExerciseState {
    const sets = context.sets
        .filter(set => set.exerciseId === exercise.id)
        .sort((a, b) => a.position - b.position)
        .map(set => assembleSet(set, context));
    return {
        id: exercise.id,
        logicalKey: exercise.logicalKey,
        sourceLogicalKey: exercise.sourceLogicalKey,
        sourceRowId: exercise.sourceRowId,
        exerciseId: exercise.exerciseId,
        snapshot: exercise.exerciseSnapshot as ExerciseSnapshotV1,
        position: exercise.position,
        purpose: exercise.purpose,
        substitutionPolicy: exercise.substitutionPolicy as SubstitutionPolicy | null,
        sets,
    };
}

function assembleSet(set: PrescribedSetRow, context: LoadContext): PrescribedSetState {
    return {
        id: set.id,
        logicalKey: set.logicalKey,
        sourceLogicalKey: set.sourceLogicalKey,
        sourceRowId: set.sourceRowId,
        setGroupLogicalKey: set.setGroupId === null ? null : (context.logicalKeyByRowId.get(set.setGroupId) ?? null),
        position: set.position,
        round: set.round,
        setType: set.setType as PrescribedSetType,
        targets: hydrateTargets(set),
        notes: set.notes,
    };
}

function assembleGroup(group: PrescribedSetGroupRow, context: LoadContext): PrescribedSetGroupState {
    const groupMembers = context.members
        .filter(member => member.setGroupId === group.id)
        .sort((a, b) => a.position - b.position)
        .map(member => ({
            exerciseLogicalKey: context.logicalKeyByRowId.get(member.exerciseId)!,
            position: member.position,
        }));
    return {
        id: group.id,
        logicalKey: group.logicalKey,
        sourceLogicalKey: group.sourceLogicalKey,
        sourceRowId: group.sourceRowId,
        parentGroupLogicalKey:
            group.parentGroupId === null ? null : (context.logicalKeyByRowId.get(group.parentGroupId) ?? null),
        type: group.type as PrescribedSetGroupType,
        position: group.position,
        rounds: group.rounds,
        restMs: group.restMs,
        members: groupMembers,
    };
}

function assembleStep(step: PrescribedRunStepRow, context: LoadContext): PrescribedRunStepState {
    return {
        id: step.id,
        logicalKey: step.logicalKey,
        sourceLogicalKey: step.sourceLogicalKey,
        sourceRowId: step.sourceRowId,
        parentStepLogicalKey:
            step.parentStepId === null ? null : (context.logicalKeyByRowId.get(step.parentStepId) ?? null),
        type: step.type as PrescribedRunStepType,
        position: step.position,
        repeatCount: step.repeatCount,
        targets: hydrateTargets(step),
        notes: step.notes,
    };
}

// --- helpers ---------------------------------------------------------------------------

function logicalToRowId(state: SessionPrescriptionState): Map<string, string> {
    const map = new Map<string, string>();
    for (const activity of state.activities) {
        map.set(activity.logicalKey, activity.id);
        for (const exercise of activity.strength?.exercises ?? []) {
            map.set(exercise.logicalKey, exercise.id);
            for (const set of exercise.sets) map.set(set.logicalKey, set.id);
        }
        for (const group of activity.strength?.setGroups ?? []) map.set(group.logicalKey, group.id);
        for (const step of activity.running?.steps ?? []) map.set(step.logicalKey, step.id);
    }
    return map;
}

function resolveRowId(map: Map<string, string>, logicalKey: string | null): string | null {
    return logicalKey === null ? null : (map.get(logicalKey) ?? null);
}

function orderByDepth<T>(nodes: readonly T[], keyOf: (node: T) => string, parentOf: (node: T) => string | null): T[] {
    const byKey = new Map(nodes.map(node => [keyOf(node), node]));
    const depthOf = (node: T): number => {
        let depth = 0;
        const seen = new Set<string>();
        let parent = parentOf(node);
        while (parent !== null && !seen.has(parent)) {
            seen.add(parent);
            depth += 1;
            const parentNode = byKey.get(parent);
            if (!parentNode) break;
            parent = parentOf(parentNode);
        }
        return depth;
    };
    return [...nodes].sort((a, b) => depthOf(a) - depthOf(b));
}

interface TargetRow {
    readonly repsMin: number | null;
    readonly repsMax: number | null;
    readonly loadKgMin: string | null;
    readonly loadKgMax: string | null;
    readonly durationMsMin: number | null;
    readonly durationMsMax: number | null;
    readonly distanceMMin: string | null;
    readonly distanceMMax: string | null;
    readonly speedMpsMin: string | null;
    readonly speedMpsMax: string | null;
    readonly powerWMin: string | null;
    readonly powerWMax: string | null;
    readonly rpeMin: string | null;
    readonly rpeMax: string | null;
    readonly rirMin: number | null;
    readonly rirMax: number | null;
    readonly hrBpmMin: number | null;
    readonly hrBpmMax: number | null;
    readonly percent1rm: string | null;
    readonly percentTrainingMax: string | null;
    readonly tempoEccentricMs: number | null;
    readonly tempoBottomPauseMs: number | null;
    readonly tempoConcentricMs: number | null;
    readonly tempoTopPauseMs: number | null;
    readonly restMsMin: number | null;
    readonly restMsMax: number | null;
    readonly enteredTargets: Record<string, unknown>;
}

function targetColumnValues(targets: TargetRanges): Record<string, unknown> {
    return {
        repsMin: targets.repsMin,
        repsMax: targets.repsMax,
        loadKgMin: targets.loadKgMin,
        loadKgMax: targets.loadKgMax,
        durationMsMin: targets.durationMsMin,
        durationMsMax: targets.durationMsMax,
        distanceMMin: targets.distanceMMin,
        distanceMMax: targets.distanceMMax,
        speedMpsMin: targets.speedMpsMin,
        speedMpsMax: targets.speedMpsMax,
        powerWMin: targets.powerWMin,
        powerWMax: targets.powerWMax,
        rpeMin: targets.rpeMin,
        rpeMax: targets.rpeMax,
        rirMin: targets.rirMin,
        rirMax: targets.rirMax,
        hrBpmMin: targets.hrBpmMin,
        hrBpmMax: targets.hrBpmMax,
        percent1rm: targets.percent1rm,
        percentTrainingMax: targets.percentTrainingMax,
        tempoEccentricMs: targets.tempo?.eccentricMs ?? null,
        tempoBottomPauseMs: targets.tempo?.bottomPauseMs ?? null,
        tempoConcentricMs: targets.tempo?.concentricMs ?? null,
        tempoTopPauseMs: targets.tempo?.topPauseMs ?? null,
        restMsMin: targets.restMsMin,
        restMsMax: targets.restMsMax,
        enteredTargets: targets.enteredTargets,
    };
}

function hydrateTargets(row: TargetRow): TargetRanges {
    const tempo =
        row.tempoEccentricMs === null &&
        row.tempoBottomPauseMs === null &&
        row.tempoConcentricMs === null &&
        row.tempoTopPauseMs === null
            ? null
            : {
                  eccentricMs: row.tempoEccentricMs,
                  bottomPauseMs: row.tempoBottomPauseMs,
                  concentricMs: row.tempoConcentricMs,
                  topPauseMs: row.tempoTopPauseMs,
              };
    return {
        repsMin: row.repsMin,
        repsMax: row.repsMax,
        loadKgMin: decimal(row.loadKgMin),
        loadKgMax: decimal(row.loadKgMax),
        durationMsMin: row.durationMsMin,
        durationMsMax: row.durationMsMax,
        distanceMMin: decimal(row.distanceMMin),
        distanceMMax: decimal(row.distanceMMax),
        speedMpsMin: decimal(row.speedMpsMin),
        speedMpsMax: decimal(row.speedMpsMax),
        powerWMin: decimal(row.powerWMin),
        powerWMax: decimal(row.powerWMax),
        rpeMin: decimal(row.rpeMin),
        rpeMax: decimal(row.rpeMax),
        rirMin: row.rirMin,
        rirMax: row.rirMax,
        hrBpmMin: row.hrBpmMin,
        hrBpmMax: row.hrBpmMax,
        percent1rm: decimal(row.percent1rm),
        percentTrainingMax: decimal(row.percentTrainingMax),
        tempo,
        restMsMin: row.restMsMin,
        restMsMax: row.restMsMax,
        enteredTargets: row.enteredTargets ?? {},
    };
}

function emptyTargets(): TargetRanges {
    return hydrateTargets({
        repsMin: null,
        repsMax: null,
        loadKgMin: null,
        loadKgMax: null,
        durationMsMin: null,
        durationMsMax: null,
        distanceMMin: null,
        distanceMMax: null,
        speedMpsMin: null,
        speedMpsMax: null,
        powerWMin: null,
        powerWMax: null,
        rpeMin: null,
        rpeMax: null,
        rirMin: null,
        rirMax: null,
        hrBpmMin: null,
        hrBpmMax: null,
        percent1rm: null,
        percentTrainingMax: null,
        tempoEccentricMs: null,
        tempoBottomPauseMs: null,
        tempoConcentricMs: null,
        tempoTopPauseMs: null,
        restMsMin: null,
        restMsMax: null,
        enteredTargets: {},
    });
}

function decimal(value: string | null): string | null {
    return value === null ? null : DecimalValue.from(value).toString();
}

function checkedKind(value: string): PrescriptionKind {
    if (value === "template" || value === "planned" || value === "resolved_execution") return value;
    throw new Error(`Invalid persisted prescription kind: ${value}`);
}
