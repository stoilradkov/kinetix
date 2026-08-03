import {
    Distance,
    Duration,
    Mass,
    type ExerciseOccurrenceState,
    type PerformedSetState,
    type PrescribedActivityDraft,
    type PrescribedExerciseDraft,
    type PrescribedSetDraft,
    type PrescribedSetGroupDraft,
    type PublishPrescriptionDraft,
    type RawTargetRanges,
    type SessionActivityState,
    type StrengthActivityState,
} from "#src/modules/training/domain/index";

/**
 * Derive a fresh `planned` prescription draft from a completed/in-progress session's performed strength
 * work, so "start from a previous workout" (PRD UX-3) can repeat what was actually done as the plan.
 *
 * The transformation is pure: every performed set's canonical measurements become a single-point target
 * range (min = max), the occurrence's immutable exercise snapshot is reused verbatim, and the set-group
 * tree is carried across by occurrence membership. Running activities are skipped (running actuals arrive
 * in a later slice). Returns `null` when the source has no repeatable strength work.
 */
export function sessionToPrescriptionDraft(activities: readonly SessionActivityState[]): PublishPrescriptionDraft | null {
    const drafts: PrescribedActivityDraft[] = [];
    let position = 0;
    for (const activity of activities) {
        if (activity.type !== "strength" || activity.strength === null) continue;
        const strength = strengthDraft(activity, activity.strength);
        if (strength === null) continue;
        drafts.push({ ref: activity.id, type: "strength", position: position++, strength });
    }
    if (drafts.length === 0) return null;
    return { kind: "planned", activities: drafts };
}

function strengthDraft(
    activity: SessionActivityState,
    strength: StrengthActivityState,
): PrescribedActivityDraft["strength"] | null {
    const exercises: PrescribedExerciseDraft[] = [];
    for (const occurrence of strength.occurrences) {
        if (occurrence.performedSets.length === 0) continue;
        exercises.push(exerciseDraft(occurrence));
    }
    if (exercises.length === 0) return null;
    const referencedOccurrenceIds = new Set(exercises.map(exercise => exercise.ref));
    const setGroups: PrescribedSetGroupDraft[] = strength.setGroups.map(group => ({
        ref: group.id,
        parentGroupRef: group.parentGroupId,
        type: group.type,
        position: group.position,
        rounds: group.rounds,
        restMs: group.restMs,
        // A set group only references occurrences that survived into the draft.
        members: group.members
            .filter(member => referencedOccurrenceIds.has(member.occurrenceId))
            .map(member => ({ exerciseRef: member.occurrenceId, position: member.position })),
    }));
    return { exercises, setGroups };
}

function exerciseDraft(occurrence: ExerciseOccurrenceState): PrescribedExerciseDraft {
    return {
        ref: occurrence.id,
        exerciseId: occurrence.exerciseId,
        snapshot: occurrence.snapshot,
        position: occurrence.position,
        purpose: occurrence.purpose,
        sets: occurrence.performedSets.map((set, index) => setDraft(occurrence, set, index)),
    };
}

function setDraft(occurrence: ExerciseOccurrenceState, set: PerformedSetState, index: number): PrescribedSetDraft {
    return {
        ref: `${occurrence.id}:${set.id}`,
        setGroupRef: set.setGroupId,
        position: set.position,
        round: set.round,
        setType: set.setType,
        targets: targetsFrom(set),
        notes: set.notes,
    };
}

/** Map a performed set's canonical measurements to a single-point (min = max) prescribed target. */
function targetsFrom(set: PerformedSetState): RawTargetRanges {
    const targets: Record<string, unknown> = {};
    const m = set.measurements;
    if (m.reps !== null) {
        targets.repsMin = m.reps;
        targets.repsMax = m.reps;
    }
    const load = m.effectiveLoad ?? m.externalLoad;
    if (load !== null) {
        const kg = Mass.from(load.value, load.unit).canonical.toString();
        targets.loadKgMin = kg;
        targets.loadKgMax = kg;
    }
    if (m.duration !== null) {
        const ms = Number(Duration.from(m.duration.value, m.duration.unit).canonical.toString());
        targets.durationMsMin = ms;
        targets.durationMsMax = ms;
    }
    if (m.distance !== null) {
        const meters = Distance.from(m.distance.value, m.distance.unit).canonical.toString();
        targets.distanceMMin = meters;
        targets.distanceMMax = meters;
    }
    if (m.rpe !== null) {
        const rpe = String(m.rpe);
        targets.rpeMin = rpe;
        targets.rpeMax = rpe;
    }
    return targets as RawTargetRanges;
}
