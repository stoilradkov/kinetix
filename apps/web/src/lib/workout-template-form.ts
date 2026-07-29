import { z } from "zod";

import type {
    CreateWorkoutTemplateRequest,
    ExerciseCatalogItemResponse,
    ExerciseSnapshotV1Response,
    UpdateWorkoutTemplateRequest,
    WorkoutTemplateResponse,
} from "@kinetix/types";

/**
 * Form model for the mixed workout-template builder. Fields are string-based so the inputs
 * stay controlled; {@link workoutTemplateCreateInput}/{@link workoutTemplateUpdateInput}
 * translate them into a prescription draft (ordered activities → exercises/groups/sets and
 * run steps) that the API republishes as a new immutable prescription.
 */

const decimalString = z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "Enter a non-negative number")
    .or(z.literal(""));
const intString = z.string().trim().regex(/^\d+$/, "Enter a whole number").or(z.literal(""));

export const strengthSetTypes = ["warm_up", "working", "back_off", "drop", "failure_amrap", "technique"] as const;
export const runStepTypes = ["warm_up", "work", "recovery", "cool_down", "open"] as const;
export const setGroupModes = ["none", "superset", "circuit"] as const;

const setFormSchema = z
    .object({
        setType: z.enum(strengthSetTypes),
        repsMin: intString,
        repsMax: intString,
        loadKg: decimalString,
        percent1rm: decimalString,
        rpe: decimalString,
        restSec: intString,
        notes: z.string().max(500),
    })
    .refine(value => !(value.repsMin && value.repsMax) || Number(value.repsMin) <= Number(value.repsMax), {
        path: ["repsMax"],
        message: "Max reps cannot be below min reps",
    })
    .refine(value => !(value.loadKg && value.percent1rm), {
        path: ["percent1rm"],
        message: "Use either an absolute load or a % of 1RM, not both",
    });

const exerciseFormSchema = z.object({
    exerciseId: z.string().uuid("Pick an exercise"),
    name: z.string().min(1),
    snapshot: z.custom<ExerciseSnapshotV1Response>(),
    sets: z.array(setFormSchema).min(1, "Add at least one set"),
});

const runStepFormSchema = z
    .object({
        type: z.enum(runStepTypes),
        distanceM: decimalString,
        durationSec: intString,
        notes: z.string().max(500),
    })
    .refine(value => value.distanceM !== "" || value.durationSec !== "", {
        path: ["distanceM"],
        message: "Set a distance or a duration",
    });

export const activityTypes = ["strength", "running"] as const;

const activityFormSchema = z
    .object({
        type: z.enum(activityTypes),
        notes: z.string().max(500),
        groupMode: z.enum(setGroupModes),
        groupRounds: intString,
        exercises: z.array(exerciseFormSchema),
        runTags: z.string().max(200),
        steps: z.array(runStepFormSchema),
    })
    .superRefine((activity, ctx) => {
        if (activity.type === "strength" && activity.exercises.length === 0)
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exercises"], message: "Add at least one exercise" });
        if (activity.type === "running" && activity.steps.length === 0)
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps"], message: "Add at least one run step" });
    });

export const workoutTemplateFormSchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().max(2_000),
    activities: z.array(activityFormSchema).min(1, "Add at least one activity"),
});

export type WorkoutTemplateFormValues = z.infer<typeof workoutTemplateFormSchema>;
export type SetFormValues = z.infer<typeof setFormSchema>;
export type RunStepFormValues = z.infer<typeof runStepFormSchema>;

export function buildExerciseSnapshot(item: ExerciseCatalogItemResponse): ExerciseSnapshotV1Response {
    return {
        schemaVersion: 1,
        exerciseId: item.id,
        exerciseVersion: item.version,
        name: item.name,
        equipmentTypeId: item.equipment.id,
        movementPatternId: item.movementPattern.id,
        classification: item.classification,
        laterality: item.laterality,
        bodyPosition: item.bodyPosition,
        repetitionSemantics: item.repetitionSemantics,
        loadModel: item.loadModel,
        supportedMeasurements: item.supportedMeasurements,
        muscles: item.muscles.map(entry => ({ muscleGroupId: entry.muscle.id, role: entry.role })),
        tagIds: item.tags.map(tag => tag.id),
        analyticsFamilyExerciseIds: [],
    };
}

export function emptySet(): SetFormValues {
    return {
        setType: "working",
        repsMin: "",
        repsMax: "",
        loadKg: "",
        percent1rm: "",
        rpe: "",
        restSec: "",
        notes: "",
    };
}

export function emptyRunStep(): RunStepFormValues {
    return { type: "work", distanceM: "", durationSec: "", notes: "" };
}

export type ActivityFormValues = z.infer<typeof activityFormSchema>;

export function emptyStrengthActivity(): ActivityFormValues {
    return { type: "strength", notes: "", groupMode: "none", groupRounds: "", exercises: [], runTags: "", steps: [] };
}

export function emptyRunningActivity(): ActivityFormValues {
    return { type: "running", notes: "", groupMode: "none", groupRounds: "", exercises: [], runTags: "", steps: [] };
}

export function workoutTemplateFormDefaults(): WorkoutTemplateFormValues {
    return { name: "", description: "", activities: [emptyStrengthActivity()] };
}

function intOrUndefined(value: string): number | undefined {
    return value.trim() === "" ? undefined : Number(value);
}

function decimalOrUndefined(value: string): string | undefined {
    return value.trim() === "" ? undefined : value.trim();
}

function strengthTargets(set: SetFormValues) {
    const targets: Record<string, unknown> = {};
    const repsMin = intOrUndefined(set.repsMin);
    const repsMax = intOrUndefined(set.repsMax);
    if (repsMin !== undefined) targets.repsMin = repsMin;
    if (repsMax !== undefined) targets.repsMax = repsMax;
    const loadKg = decimalOrUndefined(set.loadKg);
    if (loadKg !== undefined) {
        targets.loadKgMin = loadKg;
        targets.loadKgMax = loadKg;
    }
    const percent1rm = decimalOrUndefined(set.percent1rm);
    if (percent1rm !== undefined) targets.percent1rm = percent1rm;
    const rpe = decimalOrUndefined(set.rpe);
    if (rpe !== undefined) {
        targets.rpeMin = rpe;
        targets.rpeMax = rpe;
    }
    const restSec = intOrUndefined(set.restSec);
    if (restSec !== undefined) {
        targets.restMsMin = restSec * 1_000;
        targets.restMsMax = restSec * 1_000;
    }
    return Object.keys(targets).length > 0 ? targets : undefined;
}

function runTargets(step: RunStepFormValues) {
    const targets: Record<string, unknown> = {};
    const distance = decimalOrUndefined(step.distanceM);
    if (distance !== undefined) {
        targets.distanceMMin = distance;
        targets.distanceMMax = distance;
    }
    const duration = intOrUndefined(step.durationSec);
    if (duration !== undefined) {
        targets.durationMsMin = duration * 1_000;
        targets.durationMsMax = duration * 1_000;
    }
    return Object.keys(targets).length > 0 ? targets : undefined;
}

function buildPrescription(values: WorkoutTemplateFormValues): CreateWorkoutTemplateRequest["prescription"] {
    const activities = values.activities.map((activity, activityIndex) => {
        const base = { ref: `a${activityIndex}`, position: activityIndex, notes: activity.notes.trim() || null };
        if (activity.type === "strength") {
            const grouped = activity.groupMode !== "none";
            const groupRef = `a${activityIndex}-grp`;
            const exercises = activity.exercises.map((exercise, exerciseIndex) => ({
                ref: `a${activityIndex}-e${exerciseIndex}`,
                exerciseId: exercise.exerciseId,
                snapshot: exercise.snapshot,
                position: exerciseIndex,
                sets: exercise.sets.map((set, setIndex) => ({
                    ref: `a${activityIndex}-e${exerciseIndex}-s${setIndex}`,
                    ...(grouped ? { setGroupRef: groupRef } : {}),
                    position: setIndex,
                    setType: set.setType,
                    targets: strengthTargets(set),
                    notes: set.notes.trim() || null,
                })),
            }));
            const setGroups = grouped
                ? [
                      {
                          ref: groupRef,
                          type: activity.groupMode,
                          position: 0,
                          rounds: intOrUndefined(activity.groupRounds) ?? null,
                          members: activity.exercises.map((_, exerciseIndex) => ({
                              exerciseRef: `a${activityIndex}-e${exerciseIndex}`,
                              position: exerciseIndex,
                          })),
                      },
                  ]
                : undefined;
            return { ...base, type: "strength" as const, strength: { exercises, ...(setGroups ? { setGroups } : {}) } };
        }
        const runTags = activity.runTags
            .split(",")
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
        const steps = activity.steps.map((step, stepIndex) => ({
            ref: `a${activityIndex}-st${stepIndex}`,
            type: step.type,
            position: stepIndex,
            targets: runTargets(step),
            notes: step.notes.trim() || null,
        }));
        return { ...base, type: "running" as const, running: { runTags, steps } };
    });
    return { activities } as CreateWorkoutTemplateRequest["prescription"];
}

export function workoutTemplateCreateInput(values: WorkoutTemplateFormValues): CreateWorkoutTemplateRequest {
    return {
        name: values.name.trim(),
        description: values.description.trim() || null,
        prescription: buildPrescription(values),
    };
}

export function workoutTemplateUpdateInput(values: WorkoutTemplateFormValues): UpdateWorkoutTemplateRequest {
    return {
        name: values.name.trim(),
        description: values.description.trim() || null,
        prescription: buildPrescription(values),
    };
}

/** Rehydrate a published template back into editable form values (design 5.5 round-trip). */
export function workoutTemplateFormValues(template: WorkoutTemplateResponse): WorkoutTemplateFormValues {
    const activities: ActivityFormValues[] = template.prescription.activities.map(activity => {
        if (activity.type === "strength") {
            const group = activity.strength.setGroups[0];
            return {
                type: "strength",
                notes: activity.notes ?? "",
                groupMode: group?.type === "superset" || group?.type === "circuit" ? group.type : "none",
                groupRounds: group?.rounds != null ? String(group.rounds) : "",
                runTags: "",
                steps: [],
                exercises: activity.strength.exercises.map(exercise => ({
                    exerciseId: exercise.exerciseId,
                    name: exercise.snapshot.name,
                    snapshot: exercise.snapshot,
                    sets: exercise.sets.map(set => ({
                        setType: (strengthSetTypes as readonly string[]).includes(set.setType)
                            ? (set.setType as (typeof strengthSetTypes)[number])
                            : "working",
                        repsMin: set.targets.repsMin != null ? String(set.targets.repsMin) : "",
                        repsMax: set.targets.repsMax != null ? String(set.targets.repsMax) : "",
                        loadKg: set.targets.loadKgMin ?? "",
                        percent1rm: set.targets.percent1rm ?? "",
                        rpe: set.targets.rpeMin ?? "",
                        restSec: set.targets.restMsMin != null ? String(Math.round(set.targets.restMsMin / 1_000)) : "",
                        notes: set.notes ?? "",
                    })),
                })),
            };
        }
        return {
            type: "running",
            notes: activity.notes ?? "",
            groupMode: "none",
            groupRounds: "",
            exercises: [],
            runTags: activity.running.runTags.join(", "),
            steps: activity.running.steps
                .filter(step => (runStepTypes as readonly string[]).includes(step.type))
                .map(step => ({
                    type: step.type as (typeof runStepTypes)[number],
                    distanceM: step.targets.distanceMMin ?? "",
                    durationSec:
                        step.targets.durationMsMin != null
                            ? String(Math.round(step.targets.durationMsMin / 1_000))
                            : "",
                    notes: step.notes ?? "",
                })),
        };
    });
    return { name: template.name, description: template.description ?? "", activities };
}
