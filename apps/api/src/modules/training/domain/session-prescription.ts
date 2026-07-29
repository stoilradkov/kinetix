import { DomainValidationError } from "#src/platform/domain/index";

import {
    DecimalValue,
    Distance,
    HeartRate,
    Mass,
    Percentage,
    Power,
    Rir,
    Rpe,
    Speed,
} from "#src/modules/training/domain/measurement";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/exercise-definition";

/**
 * Immutable, normalized workout prescription tree shared by templates and planned
 * sessions (Design §10, ADR 0003). Publishing or cloning always produces a brand-new
 * tree: row IDs identify one exact version, logical keys stay stable when an element is
 * copied into the next version of one owner, and source lineage records the template
 * element a planned element was cloned from.
 */

export const prescriptionKinds = ["template", "planned", "resolved_execution"] as const;
export const prescribedActivityTypes = ["strength", "running"] as const;
export const prescribedSetGroupTypes = ["straight", "superset", "circuit", "drop", "cluster", "rest_pause"] as const;
export const prescribedSetTypes = [
    "warm_up",
    "working",
    "back_off",
    "drop",
    "failure_amrap",
    "superset_circuit",
    "rest_pause",
    "technique",
    "cluster",
    "other",
] as const;
export const prescribedRunStepTypes = ["warm_up", "work", "recovery", "repeat", "cool_down", "open"] as const;
export const substitutionPolicies = ["none", "same_pattern", "same_muscle", "free"] as const;

export type PrescriptionKind = (typeof prescriptionKinds)[number];
export type PrescribedActivityType = (typeof prescribedActivityTypes)[number];
export type PrescribedSetGroupType = (typeof prescribedSetGroupTypes)[number];
export type PrescribedSetType = (typeof prescribedSetTypes)[number];
export type PrescribedRunStepType = (typeof prescribedRunStepTypes)[number];
export type SubstitutionPolicy = (typeof substitutionPolicies)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PRESCRIPTION_SCHEMA_VERSION = 1;

/** Generates immutable identifiers before persistence (Design §7.2). */
export interface IdMinter {
    rowId(): string;
    logicalKey(): string;
}

export interface TempoPhases {
    readonly eccentricMs: number | null;
    readonly bottomPauseMs: number | null;
    readonly concentricMs: number | null;
    readonly topPauseMs: number | null;
}

/** Canonical structured target ranges shared by sets and run steps (Design §10.2). */
export interface TargetRanges {
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
    readonly tempo: TempoPhases | null;
    readonly restMsMin: number | null;
    readonly restMsMax: number | null;
    readonly enteredTargets: Readonly<Record<string, unknown>>;
}

export interface PrescribedSetState {
    readonly id: string;
    readonly logicalKey: string;
    readonly sourceLogicalKey: string | null;
    readonly sourceRowId: string | null;
    readonly setGroupLogicalKey: string | null;
    readonly position: number;
    readonly round: number | null;
    readonly setType: PrescribedSetType;
    readonly targets: TargetRanges;
    readonly notes: string | null;
}

export interface PrescribedExerciseState {
    readonly id: string;
    readonly logicalKey: string;
    readonly sourceLogicalKey: string | null;
    readonly sourceRowId: string | null;
    readonly exerciseId: string;
    readonly snapshot: ExerciseSnapshotV1;
    readonly position: number;
    readonly purpose: string | null;
    readonly substitutionPolicy: SubstitutionPolicy | null;
    readonly sets: readonly PrescribedSetState[];
}

export interface PrescribedSetGroupMember {
    readonly exerciseLogicalKey: string;
    readonly position: number;
}

export interface PrescribedSetGroupState {
    readonly id: string;
    readonly logicalKey: string;
    readonly sourceLogicalKey: string | null;
    readonly sourceRowId: string | null;
    readonly parentGroupLogicalKey: string | null;
    readonly type: PrescribedSetGroupType;
    readonly position: number;
    readonly rounds: number | null;
    readonly restMs: number | null;
    readonly members: readonly PrescribedSetGroupMember[];
}

export interface PrescribedStrengthActivityState {
    readonly exercises: readonly PrescribedExerciseState[];
    readonly setGroups: readonly PrescribedSetGroupState[];
}

export interface PrescribedRunStepState {
    readonly id: string;
    readonly logicalKey: string;
    readonly sourceLogicalKey: string | null;
    readonly sourceRowId: string | null;
    readonly parentStepLogicalKey: string | null;
    readonly type: PrescribedRunStepType;
    readonly position: number;
    readonly repeatCount: number | null;
    readonly targets: TargetRanges;
    readonly notes: string | null;
}

export interface PrescribedRunningActivityState {
    readonly runTags: readonly string[];
    readonly overallTargets: TargetRanges;
    readonly steps: readonly PrescribedRunStepState[];
}

export interface PrescribedActivityState {
    readonly id: string;
    readonly logicalKey: string;
    readonly sourceLogicalKey: string | null;
    readonly sourceRowId: string | null;
    readonly type: PrescribedActivityType;
    readonly position: number;
    readonly expectedDurationMs: number | null;
    readonly rpeTarget: string | null;
    readonly notes: string | null;
    readonly strength: PrescribedStrengthActivityState | null;
    readonly running: PrescribedRunningActivityState | null;
}

export interface SessionPrescriptionState {
    readonly id: string;
    readonly kind: PrescriptionKind;
    readonly schemaVersion: number;
    readonly expectedDurationMs: number | null;
    readonly notes: string | null;
    readonly sourcePrescriptionId: string | null;
    readonly sourceKind: PrescriptionKind | null;
    readonly activities: readonly PrescribedActivityState[];
    readonly createdAt: string;
}

/**
 * Draft node handle. `ref` is a caller-assigned, draft-local identifier used to wire
 * cross-references (a set to its group, a group member to an exercise, a child step to
 * its parent). `logicalKey` present means "retain this logical identity"; absent means a
 * new logical key is minted at publish. Source lineage passes through when present.
 */
export interface DraftNode {
    readonly ref: string;
    readonly logicalKey?: string;
    readonly sourceLogicalKey?: string | null;
    readonly sourceRowId?: string | null;
}

export type RawTargetRanges = Partial<Omit<TargetRanges, "tempo" | "enteredTargets">> & {
    readonly tempo?: Partial<TempoPhases> | null;
    readonly enteredTargets?: Readonly<Record<string, unknown>>;
};

export interface PrescribedSetDraft extends DraftNode {
    readonly setGroupRef?: string | null;
    readonly position: number;
    readonly round?: number | null;
    readonly setType: PrescribedSetType;
    readonly targets?: RawTargetRanges;
    readonly notes?: string | null;
}

export interface PrescribedExerciseDraft extends DraftNode {
    readonly exerciseId: string;
    readonly snapshot: ExerciseSnapshotV1;
    readonly position: number;
    readonly purpose?: string | null;
    readonly substitutionPolicy?: SubstitutionPolicy | null;
    readonly sets: readonly PrescribedSetDraft[];
}

export interface PrescribedSetGroupMemberDraft {
    readonly exerciseRef: string;
    readonly position: number;
}

export interface PrescribedSetGroupDraft extends DraftNode {
    readonly parentGroupRef?: string | null;
    readonly type: PrescribedSetGroupType;
    readonly position: number;
    readonly rounds?: number | null;
    readonly restMs?: number | null;
    readonly members: readonly PrescribedSetGroupMemberDraft[];
}

export interface PrescribedStrengthActivityDraft {
    readonly exercises: readonly PrescribedExerciseDraft[];
    readonly setGroups?: readonly PrescribedSetGroupDraft[];
}

export interface PrescribedRunStepDraft extends DraftNode {
    readonly parentStepRef?: string | null;
    readonly type: PrescribedRunStepType;
    readonly position: number;
    readonly repeatCount?: number | null;
    readonly targets?: RawTargetRanges;
    readonly notes?: string | null;
}

export interface PrescribedRunningActivityDraft {
    readonly runTags?: readonly string[];
    readonly overallTargets?: RawTargetRanges;
    readonly steps: readonly PrescribedRunStepDraft[];
}

export interface PrescribedActivityDraft extends DraftNode {
    readonly type: PrescribedActivityType;
    readonly position: number;
    readonly expectedDurationMs?: number | null;
    readonly rpeTarget?: string | null;
    readonly notes?: string | null;
    readonly strength?: PrescribedStrengthActivityDraft;
    readonly running?: PrescribedRunningActivityDraft;
}

export interface PublishPrescriptionDraft {
    readonly kind: PrescriptionKind;
    readonly expectedDurationMs?: number | null;
    readonly notes?: string | null;
    readonly sourcePrescriptionId?: string | null;
    readonly sourceKind?: PrescriptionKind | null;
    readonly activities: readonly PrescribedActivityDraft[];
}

export interface CloneForOwnerOptions {
    readonly targetKind: PrescriptionKind;
    /** Keep logical keys (planned → resolved_execution) or mint new ones (template → planned). */
    readonly preserveLogicalKeys: boolean;
}

interface MintedRef {
    readonly rowId: string;
    readonly logicalKey: string;
}

export class SessionPrescription {
    private constructor(private readonly current: SessionPrescriptionState) {}

    /** Build and validate a fresh immutable tree, minting row IDs and any new logical keys. */
    static publishDraft(draft: PublishPrescriptionDraft, ids: IdMinter, now: Date): SessionPrescription {
        const createdAt = isoTimestamp(now, "Prescription creation time");
        const state: SessionPrescriptionState = {
            id: ids.rowId(),
            kind: normalizeKind(draft.kind),
            schemaVersion: PRESCRIPTION_SCHEMA_VERSION,
            expectedDurationMs: optionalDurationMs(draft.expectedDurationMs, "Expected duration"),
            notes: optionalText(draft.notes, "Notes", 4000),
            sourcePrescriptionId: draft.sourcePrescriptionId ?? null,
            sourceKind: draft.sourceKind == null ? null : normalizeKind(draft.sourceKind),
            activities: draft.activities.map(activity => buildActivity(activity, ids)),
            createdAt,
        };
        validateState(state);
        return new SessionPrescription(immutableCopy(state));
    }

    static rehydrate(state: SessionPrescriptionState): SessionPrescription {
        const copied = immutableCopy(state);
        validateState(copied);
        return new SessionPrescription(copied);
    }

    get state(): SessionPrescriptionState {
        return immutableCopy(this.current);
    }

    /** Copy this published tree into a new immutable tree for a different owner/kind. */
    cloneForOwner(options: CloneForOwnerOptions, ids: IdMinter, now: Date): SessionPrescription {
        const targetKind = normalizeKind(options.targetKind);
        const keyMap = new Map<string, string>();
        const relogical = (logicalKey: string): string => {
            if (options.preserveLogicalKeys) return logicalKey;
            const existing = keyMap.get(logicalKey);
            if (existing) return existing;
            const minted = ids.logicalKey();
            keyMap.set(logicalKey, minted);
            return minted;
        };
        // Pre-populate the remap so intra-tree references resolve regardless of order.
        for (const activity of this.current.activities) {
            for (const logicalKey of activityLogicalKeys(activity)) relogical(logicalKey);
        }
        const cloned: SessionPrescriptionState = {
            id: ids.rowId(),
            kind: targetKind,
            schemaVersion: this.current.schemaVersion,
            expectedDurationMs: this.current.expectedDurationMs,
            notes: this.current.notes,
            sourcePrescriptionId: this.current.id,
            sourceKind: this.current.kind,
            activities: this.current.activities.map(activity => cloneActivity(activity, ids, relogical)),
            createdAt: isoTimestamp(now, "Prescription creation time"),
        };
        validateState(cloned);
        return new SessionPrescription(immutableCopy(cloned));
    }
}

/** Convert a published tree back into a draft so an owner can edit and republish it. */
export function draftFromState(state: SessionPrescriptionState): PublishPrescriptionDraft {
    return {
        kind: state.kind,
        expectedDurationMs: state.expectedDurationMs,
        notes: state.notes,
        sourcePrescriptionId: state.sourcePrescriptionId,
        sourceKind: state.sourceKind,
        activities: state.activities.map(activityToDraft),
    };
}

/** Every logical key present anywhere in the tree, mapped to its row ID and node kind. */
export function collectLogicalKeys(
    state: SessionPrescriptionState,
): ReadonlyMap<string, { readonly rowId: string; readonly nodeKind: string }> {
    const result = new Map<string, { rowId: string; nodeKind: string }>();
    for (const activity of state.activities) {
        result.set(activity.logicalKey, { rowId: activity.id, nodeKind: "activity" });
        for (const exercise of activity.strength?.exercises ?? []) {
            result.set(exercise.logicalKey, { rowId: exercise.id, nodeKind: "exercise" });
            for (const set of exercise.sets) result.set(set.logicalKey, { rowId: set.id, nodeKind: "set" });
        }
        for (const group of activity.strength?.setGroups ?? [])
            result.set(group.logicalKey, { rowId: group.id, nodeKind: "set_group" });
        for (const step of activity.running?.steps ?? [])
            result.set(step.logicalKey, { rowId: step.id, nodeKind: "run_step" });
    }
    return result;
}

// --- publishDraft builders -------------------------------------------------------------

function buildActivity(draft: PrescribedActivityDraft, ids: IdMinter): PrescribedActivityState {
    const type = normalizeActivityType(draft.type);
    const refKeys = new Map<string, MintedRef>();
    const mint = (node: DraftNode): MintedRef => {
        const minted: MintedRef = { rowId: ids.rowId(), logicalKey: node.logicalKey ?? ids.logicalKey() };
        if (refKeys.has(node.ref))
            throw new DomainValidationError(`Duplicate draft ref '${node.ref}' within an activity`);
        refKeys.set(node.ref, minted);
        return minted;
    };
    const activityRef = mint(draft);
    // Mint identity for every referenceable child before wiring cross-references.
    const exerciseMints = (draft.strength?.exercises ?? []).map(exercise => ({
        draft: exercise,
        minted: mint(exercise),
    }));
    const groupMints = (draft.strength?.setGroups ?? []).map(group => ({ draft: group, minted: mint(group) }));
    const stepMints = (draft.running?.steps ?? []).map(step => ({ draft: step, minted: mint(step) }));
    const resolve = (ref: string | null | undefined, kind: string): string | null => {
        if (ref == null) return null;
        const minted = refKeys.get(ref);
        if (!minted) throw new DomainValidationError(`Unknown ${kind} ref '${ref}'`);
        return minted.logicalKey;
    };

    const strength: PrescribedStrengthActivityState | null =
        type === "strength"
            ? {
                  exercises: exerciseMints.map(({ draft: exercise, minted }) => ({
                      id: minted.rowId,
                      logicalKey: minted.logicalKey,
                      sourceLogicalKey: exercise.sourceLogicalKey ?? null,
                      sourceRowId: exercise.sourceRowId ?? null,
                      exerciseId: requiredUuid(exercise.exerciseId, "Exercise ID"),
                      snapshot: normalizeSnapshot(exercise.snapshot, exercise.exerciseId),
                      position: exercise.position,
                      purpose: optionalText(exercise.purpose, "Exercise purpose", 500),
                      substitutionPolicy: normalizeSubstitutionPolicy(exercise.substitutionPolicy),
                      sets: exercise.sets.map(set => ({
                          id: ids.rowId(),
                          logicalKey: set.logicalKey ?? ids.logicalKey(),
                          sourceLogicalKey: set.sourceLogicalKey ?? null,
                          sourceRowId: set.sourceRowId ?? null,
                          setGroupLogicalKey: resolve(set.setGroupRef, "set group"),
                          position: set.position,
                          round: optionalPositiveInteger(set.round, "Set round"),
                          setType: normalizeSetType(set.setType),
                          targets: normalizeTargets(set.targets),
                          notes: optionalText(set.notes, "Set notes", 500),
                      })),
                  })),
                  setGroups: groupMints.map(({ draft: group, minted }) => ({
                      id: minted.rowId,
                      logicalKey: minted.logicalKey,
                      sourceLogicalKey: group.sourceLogicalKey ?? null,
                      sourceRowId: group.sourceRowId ?? null,
                      parentGroupLogicalKey: resolve(group.parentGroupRef, "parent group"),
                      type: normalizeSetGroupType(group.type),
                      position: group.position,
                      rounds: optionalPositiveInteger(group.rounds, "Group rounds"),
                      restMs: optionalDurationMs(group.restMs, "Group rest"),
                      members: group.members.map(member => ({
                          exerciseLogicalKey:
                              resolve(member.exerciseRef, "member exercise") ??
                              throwValidation("A group member must reference an exercise"),
                          position: member.position,
                      })),
                  })),
              }
            : null;

    const running: PrescribedRunningActivityState | null =
        type === "running"
            ? {
                  runTags: normalizeRunTags(draft.running?.runTags ?? []),
                  overallTargets: normalizeTargets(draft.running?.overallTargets),
                  steps: stepMints.map(({ draft: step, minted }) => ({
                      id: minted.rowId,
                      logicalKey: minted.logicalKey,
                      sourceLogicalKey: step.sourceLogicalKey ?? null,
                      sourceRowId: step.sourceRowId ?? null,
                      parentStepLogicalKey: resolve(step.parentStepRef, "parent step"),
                      type: normalizeRunStepType(step.type),
                      position: step.position,
                      repeatCount: optionalPositiveInteger(step.repeatCount, "Repeat count"),
                      targets: normalizeTargets(step.targets),
                      notes: optionalText(step.notes, "Run step notes", 500),
                  })),
              }
            : null;

    return {
        id: activityRef.rowId,
        logicalKey: activityRef.logicalKey,
        sourceLogicalKey: draft.sourceLogicalKey ?? null,
        sourceRowId: draft.sourceRowId ?? null,
        type,
        position: draft.position,
        expectedDurationMs: optionalDurationMs(draft.expectedDurationMs, "Activity expected duration"),
        rpeTarget: optionalRpe(draft.rpeTarget, "Activity RPE target"),
        notes: optionalText(draft.notes, "Activity notes", 500),
        strength,
        running,
    };
}

// --- cloneForOwner builders ------------------------------------------------------------

function cloneActivity(
    activity: PrescribedActivityState,
    ids: IdMinter,
    relogical: (logicalKey: string) => string,
): PrescribedActivityState {
    const cloneNode = <T extends { logicalKey: string; id: string }>(
        node: T,
    ): Pick<PrescribedActivityState, "id" | "logicalKey" | "sourceLogicalKey" | "sourceRowId"> => ({
        id: ids.rowId(),
        logicalKey: relogical(node.logicalKey),
        sourceLogicalKey: node.logicalKey,
        sourceRowId: node.id,
    });
    const remap = (logicalKey: string | null): string | null => (logicalKey == null ? null : relogical(logicalKey));
    return {
        ...cloneNode(activity),
        type: activity.type,
        position: activity.position,
        expectedDurationMs: activity.expectedDurationMs,
        rpeTarget: activity.rpeTarget,
        notes: activity.notes,
        strength: activity.strength
            ? {
                  exercises: activity.strength.exercises.map(exercise => ({
                      ...cloneNode(exercise),
                      exerciseId: exercise.exerciseId,
                      snapshot: exercise.snapshot,
                      position: exercise.position,
                      purpose: exercise.purpose,
                      substitutionPolicy: exercise.substitutionPolicy,
                      sets: exercise.sets.map(set => ({
                          ...cloneNode(set),
                          setGroupLogicalKey: remap(set.setGroupLogicalKey),
                          position: set.position,
                          round: set.round,
                          setType: set.setType,
                          targets: set.targets,
                          notes: set.notes,
                      })),
                  })),
                  setGroups: activity.strength.setGroups.map(group => ({
                      ...cloneNode(group),
                      parentGroupLogicalKey: remap(group.parentGroupLogicalKey),
                      type: group.type,
                      position: group.position,
                      rounds: group.rounds,
                      restMs: group.restMs,
                      members: group.members.map(member => ({
                          exerciseLogicalKey: relogical(member.exerciseLogicalKey),
                          position: member.position,
                      })),
                  })),
              }
            : null,
        running: activity.running
            ? {
                  runTags: activity.running.runTags,
                  overallTargets: activity.running.overallTargets,
                  steps: activity.running.steps.map(step => ({
                      ...cloneNode(step),
                      parentStepLogicalKey: remap(step.parentStepLogicalKey),
                      type: step.type,
                      position: step.position,
                      repeatCount: step.repeatCount,
                      targets: step.targets,
                      notes: step.notes,
                  })),
              }
            : null,
    };
}

function activityLogicalKeys(activity: PrescribedActivityState): string[] {
    const keys = [activity.logicalKey];
    for (const exercise of activity.strength?.exercises ?? []) {
        keys.push(exercise.logicalKey);
        for (const set of exercise.sets) keys.push(set.logicalKey);
    }
    for (const group of activity.strength?.setGroups ?? []) keys.push(group.logicalKey);
    for (const step of activity.running?.steps ?? []) keys.push(step.logicalKey);
    return keys;
}

// --- state → draft ---------------------------------------------------------------------

function activityToDraft(activity: PrescribedActivityState): PrescribedActivityDraft {
    return {
        ref: activity.logicalKey,
        logicalKey: activity.logicalKey,
        sourceLogicalKey: activity.sourceLogicalKey,
        sourceRowId: activity.sourceRowId,
        type: activity.type,
        position: activity.position,
        expectedDurationMs: activity.expectedDurationMs,
        rpeTarget: activity.rpeTarget,
        notes: activity.notes,
        strength: activity.strength
            ? {
                  exercises: activity.strength.exercises.map(exercise => ({
                      ref: exercise.logicalKey,
                      logicalKey: exercise.logicalKey,
                      sourceLogicalKey: exercise.sourceLogicalKey,
                      sourceRowId: exercise.sourceRowId,
                      exerciseId: exercise.exerciseId,
                      snapshot: exercise.snapshot,
                      position: exercise.position,
                      purpose: exercise.purpose,
                      substitutionPolicy: exercise.substitutionPolicy,
                      sets: exercise.sets.map(set => ({
                          ref: set.logicalKey,
                          logicalKey: set.logicalKey,
                          sourceLogicalKey: set.sourceLogicalKey,
                          sourceRowId: set.sourceRowId,
                          setGroupRef: set.setGroupLogicalKey,
                          position: set.position,
                          round: set.round,
                          setType: set.setType,
                          targets: set.targets,
                          notes: set.notes,
                      })),
                  })),
                  setGroups: activity.strength.setGroups.map(group => ({
                      ref: group.logicalKey,
                      logicalKey: group.logicalKey,
                      sourceLogicalKey: group.sourceLogicalKey,
                      sourceRowId: group.sourceRowId,
                      parentGroupRef: group.parentGroupLogicalKey,
                      type: group.type,
                      position: group.position,
                      rounds: group.rounds,
                      restMs: group.restMs,
                      members: group.members.map(member => ({
                          exerciseRef: member.exerciseLogicalKey,
                          position: member.position,
                      })),
                  })),
              }
            : undefined,
        running: activity.running
            ? {
                  runTags: activity.running.runTags,
                  overallTargets: activity.running.overallTargets,
                  steps: activity.running.steps.map(step => ({
                      ref: step.logicalKey,
                      logicalKey: step.logicalKey,
                      sourceLogicalKey: step.sourceLogicalKey,
                      sourceRowId: step.sourceRowId,
                      parentStepRef: step.parentStepLogicalKey,
                      type: step.type,
                      position: step.position,
                      repeatCount: step.repeatCount,
                      targets: step.targets,
                      notes: step.notes,
                  })),
              }
            : undefined,
    };
}

// --- validation ------------------------------------------------------------------------

function validateState(state: SessionPrescriptionState): void {
    requiredUuid(state.id, "Prescription ID");
    normalizeKind(state.kind);
    if (state.schemaVersion !== PRESCRIPTION_SCHEMA_VERSION)
        throw new DomainValidationError(`Unsupported prescription schema version ${state.schemaVersion}`);
    if ((state.sourcePrescriptionId === null) !== (state.sourceKind === null))
        throw new DomainValidationError("Source prescription ID and source kind must be set together");
    if (state.sourcePrescriptionId !== null) requiredUuid(state.sourcePrescriptionId, "Source prescription ID");
    if (state.sourceKind !== null) normalizeKind(state.sourceKind);
    isoTimestamp(new Date(state.createdAt), "Prescription creation time");

    const rowIds = new Set<string>();
    const logicalKeys = new Set<string>();
    const noteRowId = (id: string): void => {
        requiredUuid(id, "Row ID");
        if (rowIds.has(id)) throw new DomainValidationError(`Duplicate prescription row ID '${id}'`);
        rowIds.add(id);
    };
    const noteLogicalKey = (key: string): void => {
        requiredUuid(key, "Logical key");
        if (logicalKeys.has(key)) throw new DomainValidationError(`Duplicate logical key '${key}'`);
        logicalKeys.add(key);
    };

    assertContiguousPositions(state.activities, "activity");
    for (const activity of state.activities) {
        noteRowId(activity.id);
        noteLogicalKey(activity.logicalKey);
        normalizeActivityType(activity.type);
        validateLineage(activity);
        validateActivityDetail(activity, noteRowId, noteLogicalKey);
    }
}

function validateActivityDetail(
    activity: PrescribedActivityState,
    noteRowId: (id: string) => void,
    noteLogicalKey: (key: string) => void,
): void {
    if (activity.type === "strength") {
        if (!activity.strength || activity.running)
            throw new DomainValidationError("A strength activity must carry exactly one strength detail");
        validateStrength(activity.strength, noteRowId, noteLogicalKey);
    } else {
        if (!activity.running || activity.strength)
            throw new DomainValidationError("A running activity must carry exactly one running detail");
        validateRunning(activity.running, noteRowId, noteLogicalKey);
    }
}

function validateStrength(
    strength: PrescribedStrengthActivityState,
    noteRowId: (id: string) => void,
    noteLogicalKey: (key: string) => void,
): void {
    const exerciseKeys = new Set<string>();
    const groupKeys = new Set<string>();
    assertContiguousPositions(strength.exercises, "exercise");
    for (const exercise of strength.exercises) {
        noteRowId(exercise.id);
        noteLogicalKey(exercise.logicalKey);
        requiredUuid(exercise.exerciseId, "Exercise ID");
        normalizeSnapshot(exercise.snapshot, exercise.exerciseId);
        normalizeSubstitutionPolicy(exercise.substitutionPolicy);
        exerciseKeys.add(exercise.logicalKey);
        assertContiguousPositions(exercise.sets, "set");
    }
    assertContiguousPositions(strength.setGroups, "set group");
    for (const group of strength.setGroups) {
        noteRowId(group.id);
        noteLogicalKey(group.logicalKey);
        normalizeSetGroupType(group.type);
        groupKeys.add(group.logicalKey);
        assertContiguousPositions(group.members, "group member");
        for (const member of group.members)
            if (!exerciseKeys.has(member.exerciseLogicalKey))
                throw new DomainValidationError("A set group member must reference an exercise in the same activity");
    }
    for (const group of strength.setGroups)
        if (group.parentGroupLogicalKey !== null && !groupKeys.has(group.parentGroupLogicalKey))
            throw new DomainValidationError("A set group parent must be a group in the same activity");
    assertAcyclic(
        strength.setGroups.map(group => ({ key: group.logicalKey, parent: group.parentGroupLogicalKey })),
        "set group",
    );
    for (const exercise of strength.exercises)
        for (const set of exercise.sets) {
            noteRowId(set.id);
            noteLogicalKey(set.logicalKey);
            normalizeSetType(set.setType);
            validateTargets(set.targets);
            if (set.setGroupLogicalKey !== null && !groupKeys.has(set.setGroupLogicalKey))
                throw new DomainValidationError("A set's group must be a group in the same activity");
        }
}

function validateRunning(
    running: PrescribedRunningActivityState,
    noteRowId: (id: string) => void,
    noteLogicalKey: (key: string) => void,
): void {
    normalizeRunTags(running.runTags);
    validateTargets(running.overallTargets);
    const stepKeys = new Set<string>();
    assertContiguousPositions(siblings(running.steps, null), "run step");
    for (const step of running.steps) {
        noteRowId(step.id);
        noteLogicalKey(step.logicalKey);
        normalizeRunStepType(step.type);
        validateTargets(step.targets);
        stepKeys.add(step.logicalKey);
        if (step.type === "repeat") {
            if (step.repeatCount === null || step.repeatCount < 1)
                throw new DomainValidationError("A repeat run step needs a repeat count of at least one");
        } else if (step.repeatCount !== null)
            throw new DomainValidationError("Only repeat run steps may carry a repeat count");
    }
    for (const step of running.steps)
        if (step.parentStepLogicalKey !== null && !stepKeys.has(step.parentStepLogicalKey))
            throw new DomainValidationError("A run step parent must be a step in the same activity");
    for (const parent of running.steps) {
        const children = siblings(running.steps, parent.logicalKey);
        if (children.length > 0) assertContiguousPositions(children, "run step");
    }
    assertAcyclic(
        running.steps.map(step => ({ key: step.logicalKey, parent: step.parentStepLogicalKey })),
        "run step",
    );
}

function siblings<T extends { parentStepLogicalKey: string | null }>(items: readonly T[], parent: string | null): T[] {
    return items.filter(item => item.parentStepLogicalKey === parent);
}

function validateLineage(node: { sourceLogicalKey: string | null; sourceRowId: string | null }): void {
    if (node.sourceLogicalKey !== null) requiredUuid(node.sourceLogicalKey, "Source logical key");
    if (node.sourceRowId !== null) requiredUuid(node.sourceRowId, "Source row ID");
}

function validateTargets(targets: TargetRanges): void {
    normalizeTargets(targets);
}

/** Validate and canonicalize a raw target range set (Design §10.2). */
function normalizeTargets(raw: RawTargetRanges | undefined): TargetRanges {
    const input = raw ?? {};
    const reps = intRange(input.repsMin, input.repsMax, "Reps");
    const durationMs = intRange(input.durationMsMin, input.durationMsMax, "Duration", { safe: true });
    const restMs = intRange(input.restMsMin, input.restMsMax, "Rest", { safe: true });
    const rir = boundedIntRange(input.rirMin, input.rirMax, "RIR", value => Rir.from(value).value);
    const hr = boundedIntRange(input.hrBpmMin, input.hrBpmMax, "Heart rate", value => HeartRate.bpm(value).bpm);
    const loadKg = decimalRange(input.loadKgMin, input.loadKgMax, "Load", value => Mass.fromCanonical(value).canonical);
    const distanceM = decimalRange(
        input.distanceMMin,
        input.distanceMMax,
        "Distance",
        value => Distance.fromCanonical(value).canonical,
    );
    const speedMps = decimalRange(
        input.speedMpsMin,
        input.speedMpsMax,
        "Speed",
        value => Speed.fromCanonical(value).canonical,
    );
    const powerW = decimalRange(input.powerWMin, input.powerWMax, "Power", value => Power.watts(value).canonical);
    const rpe = decimalRange(input.rpeMin, input.rpeMax, "RPE", value => Rpe.from(value).value);
    const percent1rm = optionalDecimal(input.percent1rm, "Percent of 1RM", value => Percentage.from(value).value);
    const percentTrainingMax = optionalDecimal(
        input.percentTrainingMax,
        "Percent of training max",
        value => Percentage.from(value).value,
    );
    const loadModes = [
        loadKg.min !== null || loadKg.max !== null,
        percent1rm !== null,
        percentTrainingMax !== null,
    ].filter(Boolean).length;
    if (loadModes > 1)
        throw new DomainValidationError(
            "A target may use only one of absolute load, percent of 1RM, or percent of training max",
            {
                targets: ["Choose a single load target mode"],
            },
        );
    return {
        repsMin: reps.min,
        repsMax: reps.max,
        loadKgMin: loadKg.min,
        loadKgMax: loadKg.max,
        durationMsMin: durationMs.min,
        durationMsMax: durationMs.max,
        distanceMMin: distanceM.min,
        distanceMMax: distanceM.max,
        speedMpsMin: speedMps.min,
        speedMpsMax: speedMps.max,
        powerWMin: powerW.min,
        powerWMax: powerW.max,
        rpeMin: rpe.min,
        rpeMax: rpe.max,
        rirMin: rir.min,
        rirMax: rir.max,
        hrBpmMin: hr.min,
        hrBpmMax: hr.max,
        percent1rm,
        percentTrainingMax,
        tempo: normalizeTempo(input.tempo),
        restMsMin: restMs.min,
        restMsMax: restMs.max,
        enteredTargets: normalizeEnteredTargets(input.enteredTargets),
    };
}

function normalizeTempo(tempo: Partial<TempoPhases> | null | undefined): TempoPhases | null {
    if (tempo == null) return null;
    const phase = (value: number | null | undefined, name: string): number | null => optionalDurationMs(value, name);
    const normalized: TempoPhases = {
        eccentricMs: phase(tempo.eccentricMs, "Tempo eccentric"),
        bottomPauseMs: phase(tempo.bottomPauseMs, "Tempo bottom pause"),
        concentricMs: phase(tempo.concentricMs, "Tempo concentric"),
        topPauseMs: phase(tempo.topPauseMs, "Tempo top pause"),
    };
    const allNull =
        normalized.eccentricMs === null &&
        normalized.bottomPauseMs === null &&
        normalized.concentricMs === null &&
        normalized.topPauseMs === null;
    return allNull ? null : normalized;
}

function normalizeEnteredTargets(
    value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
    if (value === undefined) return {};
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new DomainValidationError("Entered targets must be a plain object");
    try {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    } catch {
        throw new DomainValidationError("Entered targets must be JSON-serializable");
    }
}

interface DecimalPair {
    readonly min: string | null;
    readonly max: string | null;
}

function decimalRange(
    minInput: string | null | undefined,
    maxInput: string | null | undefined,
    name: string,
    canonical: (value: string) => DecimalValue,
): DecimalPair {
    const min = optionalDecimal(minInput, `${name} minimum`, canonical);
    const max = optionalDecimal(maxInput, `${name} maximum`, canonical);
    if (min !== null && max !== null && DecimalValue.from(min).compare(max) > 0)
        throw new DomainValidationError(`${name} minimum cannot exceed maximum`, {
            targets: [`${name} range is reversed`],
        });
    return { min, max };
}

function optionalDecimal(
    value: string | null | undefined,
    name: string,
    canonical: (value: string) => DecimalValue,
): string | null {
    if (value == null) return null;
    try {
        return canonical(value).toString();
    } catch {
        throw new DomainValidationError(`${name} is not a valid measurement`, { targets: [`${name} is invalid`] });
    }
}

interface IntPair {
    readonly min: number | null;
    readonly max: number | null;
}

function intRange(
    minInput: number | null | undefined,
    maxInput: number | null | undefined,
    name: string,
    options: { safe?: boolean } = {},
): IntPair {
    const min = nonNegativeIntOrNull(minInput, `${name} minimum`, options.safe);
    const max = nonNegativeIntOrNull(maxInput, `${name} maximum`, options.safe);
    if (min !== null && max !== null && min > max)
        throw new DomainValidationError(`${name} minimum cannot exceed maximum`, {
            targets: [`${name} range is reversed`],
        });
    return { min, max };
}

function boundedIntRange(
    minInput: number | null | undefined,
    maxInput: number | null | undefined,
    name: string,
    check: (value: number) => number,
): IntPair {
    const min = minInput == null ? null : verifyBounded(minInput, `${name} minimum`, check);
    const max = maxInput == null ? null : verifyBounded(maxInput, `${name} maximum`, check);
    if (min !== null && max !== null && min > max)
        throw new DomainValidationError(`${name} minimum cannot exceed maximum`, {
            targets: [`${name} range is reversed`],
        });
    return { min, max };
}

function verifyBounded(value: number, name: string, check: (value: number) => number): number {
    try {
        return check(value);
    } catch {
        throw new DomainValidationError(`${name} is out of range`, { targets: [`${name} is invalid`] });
    }
}

// --- scalar normalizers ----------------------------------------------------------------

function normalizeKind(value: PrescriptionKind): PrescriptionKind {
    if (!prescriptionKinds.includes(value)) throw new DomainValidationError(`Unknown prescription kind '${value}'`);
    return value;
}

function normalizeActivityType(value: PrescribedActivityType): PrescribedActivityType {
    if (!prescribedActivityTypes.includes(value)) throw new DomainValidationError(`Unknown activity type '${value}'`);
    return value;
}

function normalizeSetGroupType(value: PrescribedSetGroupType): PrescribedSetGroupType {
    if (!prescribedSetGroupTypes.includes(value)) throw new DomainValidationError(`Unknown set group type '${value}'`);
    return value;
}

function normalizeSetType(value: PrescribedSetType): PrescribedSetType {
    if (!prescribedSetTypes.includes(value)) throw new DomainValidationError(`Unknown set type '${value}'`);
    return value;
}

function normalizeRunStepType(value: PrescribedRunStepType): PrescribedRunStepType {
    if (!prescribedRunStepTypes.includes(value)) throw new DomainValidationError(`Unknown run step type '${value}'`);
    return value;
}

function normalizeSubstitutionPolicy(value: SubstitutionPolicy | null | undefined): SubstitutionPolicy | null {
    if (value == null) return null;
    if (!substitutionPolicies.includes(value))
        throw new DomainValidationError(`Unknown substitution policy '${value}'`);
    return value;
}

function normalizeSnapshot(snapshot: ExerciseSnapshotV1, exerciseId: string): ExerciseSnapshotV1 {
    if (!snapshot || typeof snapshot !== "object")
        throw new DomainValidationError("A prescribed exercise needs an exercise snapshot");
    if (snapshot.schemaVersion !== 1) throw new DomainValidationError("Exercise snapshot schema version must be 1");
    if (snapshot.exerciseId !== requiredUuid(exerciseId, "Exercise ID"))
        throw new DomainValidationError("Exercise snapshot must match the prescribed exercise ID");
    return immutableCopy(snapshot);
}

function normalizeRunTags(tags: readonly string[]): readonly string[] {
    const normalized = tags.map(tag => {
        const trimmed = tag.trim().normalize("NFKC");
        if (trimmed.length === 0 || trimmed.length > 60)
            throw new DomainValidationError("Run tags must be 1 to 60 characters");
        return trimmed;
    });
    if (new Set(normalized).size !== normalized.length) throw new DomainValidationError("Run tags must be unique");
    return normalized;
}

function optionalRpe(value: string | null | undefined, name: string): string | null {
    if (value == null) return null;
    try {
        return Rpe.from(value).value.toString();
    } catch {
        throw new DomainValidationError(`${name} must be from 1 to 10 in 0.5 increments`);
    }
}

// --- primitive helpers -----------------------------------------------------------------

function assertContiguousPositions(items: readonly { position: number }[], label: string): void {
    const positions = items.map(item => item.position);
    for (const position of positions)
        if (!Number.isInteger(position) || position < 0)
            throw new DomainValidationError(`A ${label} position must be a non-negative integer`);
    const sorted = [...positions].sort((a, b) => a - b);
    for (let index = 0; index < sorted.length; index += 1)
        if (sorted[index] !== index)
            throw new DomainValidationError(
                `${label} positions must be contiguous from zero without gaps or duplicates`,
            );
}

function assertAcyclic(nodes: readonly { key: string; parent: string | null }[], label: string): void {
    const parents = new Map(nodes.map(node => [node.key, node.parent]));
    for (const node of nodes) {
        const seen = new Set<string>();
        let current: string | null = node.key;
        while (current !== null) {
            if (seen.has(current)) throw new DomainValidationError(`${label} hierarchy must be acyclic`);
            seen.add(current);
            current = parents.get(current) ?? null;
        }
    }
}

function nonNegativeIntOrNull(value: number | null | undefined, name: string, safe = false): number | null {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < 0 || (safe && !Number.isSafeInteger(value)))
        throw new DomainValidationError(`${name} must be a non-negative integer`, { targets: [`${name} is invalid`] });
    return value;
}

function optionalPositiveInteger(value: number | null | undefined, name: string): number | null {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < 1) throw new DomainValidationError(`${name} must be a positive integer`);
    return value;
}

function optionalDurationMs(value: number | null | undefined, name: string): number | null {
    if (value == null) return null;
    if (!Number.isSafeInteger(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative whole number of milliseconds`);
    return value;
}

function requiredUuid(value: string, name: string): string {
    const normalized = (value ?? "").trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) return null;
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function throwValidation(message: string): never {
    throw new DomainValidationError(message);
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}
