import type {
    ActiveTrainingSessionResponse,
    MappingRelationValue,
    PrescriptionTargetRanges,
    RecordPerformedSetRequest,
    SessionActivityResponse,
} from "@kinetix/types";

type Occurrence = NonNullable<SessionActivityResponse["strength"]>["occurrences"][number];
type PerformedSetResponse = Occurrence["performedSets"][number];

/**
 * Pure view-model helpers that join a live session's frozen plan (prescribed sets) to its performed
 * sets via the session's mappings, so the active-workout UI can render planned-versus-actual rows and
 * turn set entry into a `RecordPerformedSetRequest`. All logic lives here (not in components/hooks).
 */

export interface PlannedActualRow {
    /** Stable React key. */
    readonly key: string;
    /** The prescribed set this row targets, if any (null for freely added work). */
    readonly prescribedSetId: string | null;
    /** Human-readable prescribed target (e.g. "5 × 100 kg"), or null when unplanned. */
    readonly prescribedLabel: string | null;
    /** The performed set filling this row, if the athlete has logged it. */
    readonly performedSet: PerformedSetResponse | null;
    /** The mapping relation recorded for the performed set, if mapped. */
    readonly relation: MappingRelationValue | null;
}

export interface OccurrenceGrid {
    /** The parent activity's id — needed to address the occurrence in granular set/substitute commands. */
    readonly activityId: string;
    readonly occurrence: Occurrence;
    readonly rows: readonly PlannedActualRow[];
}

export interface ActivityGrid {
    readonly activityId: string;
    readonly occurrences: readonly OccurrenceGrid[];
}

/** Group occurrence grids under their activity, preserving activity order (for reorder + rendering). */
export function buildActivityGrids(view: ActiveTrainingSessionResponse): ActivityGrid[] {
    const grids = buildOccurrenceGrids(view);
    return view.activities
        .map(activity => ({
            activityId: activity.id,
            occurrences: grids.filter(grid => grid.activityId === activity.id),
        }))
        .filter(group => group.occurrences.length > 0);
}

/** Format a prescribed target range compactly for display; returns null when nothing is prescribed. */
export function describeTarget(targets: PrescriptionTargetRanges): string | null {
    const parts: string[] = [];
    const reps = range(targets.repsMin, targets.repsMax);
    const load = range(targets.loadKgMin, targets.loadKgMax);
    if (reps !== null) parts.push(load !== null ? `${reps} × ${load} kg` : `${reps} reps`);
    else if (load !== null) parts.push(`${load} kg`);
    if (targets.percent1rm !== null) parts.push(`${targets.percent1rm}% 1RM`);
    if (targets.percentTrainingMax !== null) parts.push(`${targets.percentTrainingMax}% TM`);
    const rpe = range(targets.rpeMin, targets.rpeMax);
    if (rpe !== null) parts.push(`RPE ${rpe}`);
    return parts.length > 0 ? parts.join(" · ") : null;
}

function range(
    min: string | number | null | undefined,
    max: string | number | null | undefined,
): string | null {
    if (min == null && max == null) return null;
    if (min != null && max != null) return String(min) === String(max) ? String(min) : `${min}–${max}`;
    return String(min ?? max);
}

/** Build one planned-versus-actual grid per strength occurrence in the session. */
export function buildOccurrenceGrids(view: ActiveTrainingSessionResponse): OccurrenceGrid[] {
    // Index prescribed exercises (by row id) and their sets across every frozen plan.
    const prescribedExerciseSets = new Map<string, { id: string; targets: PrescriptionTargetRanges }[]>();
    for (const plan of view.plans)
        for (const activity of plan.prescription.activities)
            for (const exercise of activity.strength?.exercises ?? [])
                prescribedExerciseSets.set(
                    exercise.id,
                    exercise.sets.map(set => ({ id: set.id, targets: set.targets })),
                );

    const prescribedExerciseByOccurrence = new Map<string, string>();
    for (const mapping of view.occurrenceMappings)
        if (mapping.prescribedExerciseId !== null)
            prescribedExerciseByOccurrence.set(mapping.occurrenceId, mapping.prescribedExerciseId);

    const performedByPrescribedSet = new Map<string, { performedSetId: string; relation: MappingRelationValue }>();
    const mappingByPerformedSet = new Map<string, { prescribedSetId: string | null; relation: MappingRelationValue }>();
    for (const mapping of view.setMappings) {
        mappingByPerformedSet.set(mapping.performedSetId, {
            prescribedSetId: mapping.prescribedSetId,
            relation: mapping.relation,
        });
        if (mapping.prescribedSetId !== null)
            performedByPrescribedSet.set(mapping.prescribedSetId, {
                performedSetId: mapping.performedSetId,
                relation: mapping.relation,
            });
    }

    const grids: OccurrenceGrid[] = [];
    for (const activity of view.activities)
        for (const occurrence of activity.strength?.occurrences ?? []) {
            const performedById = new Map(occurrence.performedSets.map(set => [set.id, set]));
            const usedPerformedIds = new Set<string>();
            const rows: PlannedActualRow[] = [];

            const prescribedExerciseId = prescribedExerciseByOccurrence.get(occurrence.id);
            const prescribedSets = prescribedExerciseId ? (prescribedExerciseSets.get(prescribedExerciseId) ?? []) : [];
            for (const prescribed of prescribedSets) {
                const match = performedByPrescribedSet.get(prescribed.id);
                const performedSet = match ? (performedById.get(match.performedSetId) ?? null) : null;
                if (performedSet) usedPerformedIds.add(performedSet.id);
                rows.push({
                    key: prescribed.id,
                    prescribedSetId: prescribed.id,
                    prescribedLabel: describeTarget(prescribed.targets),
                    performedSet,
                    relation: match?.relation ?? null,
                });
            }
            // Performed sets not tied to a prescribed row are additions/free work.
            for (const set of occurrence.performedSets)
                if (!usedPerformedIds.has(set.id))
                    rows.push({
                        key: set.id,
                        prescribedSetId: null,
                        prescribedLabel: null,
                        performedSet: set,
                        relation: mappingByPerformedSet.get(set.id)?.relation ?? null,
                    });

            grids.push({ activityId: activity.id, occurrence, rows });
        }
    return grids;
}

export type SetEntryStatus = "completed" | "partial" | "skipped";

export interface SetEntryValues {
    readonly reps: string;
    readonly loadKg: string;
    readonly rpe: string;
    readonly status: SetEntryStatus;
}

export const emptySetEntry: SetEntryValues = { reps: "", loadKg: "", rpe: "", status: "completed" };

/** Map a set-entry form to a RecordPerformedSetRequest, including the plan mapping when prescribed. */
export function recordSetRequestFrom(params: {
    readonly activityId: string;
    readonly occurrenceId: string;
    readonly setId: string;
    readonly position: number;
    readonly prescribedSetId: string | null;
    readonly values: SetEntryValues;
}): RecordPerformedSetRequest {
    const { values } = params;
    const measurements: RecordPerformedSetRequest["set"]["measurements"] = {};
    if (values.reps.trim() !== "") measurements.reps = Number(values.reps);
    if (values.loadKg.trim() !== "") measurements.externalLoad = { value: Number(values.loadKg), unit: "kg" };
    if (values.rpe.trim() !== "") measurements.rpe = Number(values.rpe);
    return {
        activityId: params.activityId,
        occurrenceId: params.occurrenceId,
        set: {
            id: params.setId,
            position: params.position,
            setType: "working",
            status: values.status,
            measurements,
        },
        mapping: {
            prescribedSetId: params.prescribedSetId,
            relation: relationForStatus(values.status, params.prescribedSetId !== null),
        },
    };
}

/** A completed set matches its prescribed target; anything less is partial; unplanned work is added. */
export function relationForStatus(status: SetEntryStatus, hasPrescribed: boolean): MappingRelationValue {
    if (!hasPrescribed) return "added";
    return status === "completed" ? "matched" : "partial";
}
