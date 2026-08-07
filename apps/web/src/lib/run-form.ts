import { z } from "zod";

import type { AddRunRequest, RunViewResponse, UpdateRunRequest } from "@kinetix/types";

/**
 * Form model for the manual/mixed run flow (PRD R3). Every measurement is captured as a raw string so
 * typing is never interrupted; values are converted to the run contracts on submit. A missing value
 * stays absent (never a recorded zero), matching the running domain's missing-vs-zero distinction.
 */

export const distanceUnits = ["km", "mi", "m"] as const;
export const durationUnits = ["min", "s", "h"] as const;
export const runStepTypes = ["warm_up", "work", "recovery", "repeat", "cool_down", "open"] as const;
export const painSides = ["left", "right", "bilateral"] as const;
export const mappingRelations = ["matched", "substituted", "added", "partial", "combined", "split"] as const;

const measureShape = { value: z.string(), unit: z.string() };

const stepSchema = z.object({
    id: z.string(),
    type: z.enum(runStepTypes),
    distanceValue: z.string(),
    distanceUnit: z.string(),
    durationValue: z.string(),
    durationUnit: z.string(),
});

const splitSchema = z.object({
    id: z.string(),
    distanceValue: z.string(),
    distanceUnit: z.string(),
    movingValue: z.string(),
    movingUnit: z.string(),
});

const painSchema = z.object({
    id: z.string(),
    bodyArea: z.string(),
    side: z.enum(painSides),
    severity: z.string(),
});

const mappingSchema = z.object({
    id: z.string(),
    performedRunStepId: z.string(),
    prescribedRunStepId: z.string(),
    relation: z.enum(mappingRelations),
});

export const runFormSchema = z.object({
    title: z.string(),
    localDate: z.string(),
    timeZone: z.string(),
    distance: z.object(measureShape),
    movingTime: z.object(measureShape),
    elapsedTime: z.object(measureShape),
    averageHeartRate: z.string(),
    rpe: z.string(),
    indoor: z.boolean(),
    treadmill: z.boolean(),
    runTags: z.array(z.string()),
    notes: z.string(),
    environmentSurface: z.string(),
    environmentWeather: z.string(),
    environmentTemperature: z.string(),
    gearItemId: z.string(),
    steps: z.array(stepSchema),
    splits: z.array(splitSchema),
    pain: z.array(painSchema),
    mappings: z.array(mappingSchema),
});

export type RunFormValues = z.infer<typeof runFormSchema>;
export type RunStepFormValue = z.infer<typeof stepSchema>;
export type RunSplitFormValue = z.infer<typeof splitSchema>;
export type RunPainFormValue = z.infer<typeof painSchema>;
export type RunMappingFormValue = z.infer<typeof mappingSchema>;

export function runFormDefaults(timeZone = ""): RunFormValues {
    return {
        title: "",
        localDate: "",
        timeZone,
        distance: { value: "", unit: "km" },
        movingTime: { value: "", unit: "min" },
        elapsedTime: { value: "", unit: "min" },
        averageHeartRate: "",
        rpe: "",
        indoor: false,
        treadmill: false,
        runTags: [],
        notes: "",
        environmentSurface: "",
        environmentWeather: "",
        environmentTemperature: "",
        gearItemId: "",
        steps: [],
        splits: [],
        pain: [],
        mappings: [],
    };
}

/** Build editor defaults from an existing run view (edit mode). Pain is session-level, so it is omitted. */
export function runFormValues(run: RunViewResponse): RunFormValues {
    const running = run.running;
    return {
        title: run.title ?? "",
        localDate: run.localDate,
        timeZone: run.timeZone,
        distance: measureToForm(running.distance, "km"),
        movingTime: measureToForm(running.movingTime, "min"),
        elapsedTime: measureToForm(running.elapsedTime, "min"),
        averageHeartRate: running.averageHeartRate?.toString() ?? "",
        rpe: running.rpe?.toString() ?? run.rpe?.toString() ?? "",
        indoor: running.indoor,
        treadmill: running.treadmill,
        runTags: [...running.runTags],
        notes: run.notes ?? "",
        environmentSurface: running.environment?.surface ?? "",
        environmentWeather: running.environment?.weather ?? "",
        environmentTemperature: running.environment?.temperatureCelsius?.toString() ?? "",
        gearItemId: running.gearItemId ?? "",
        steps: running.steps.map(step => ({
            id: step.id,
            type: step.type,
            distanceValue: step.measurements.distance?.value.toString() ?? "",
            distanceUnit: step.measurements.distance?.unit ?? "km",
            durationValue: step.measurements.duration?.value.toString() ?? "",
            durationUnit: step.measurements.duration?.unit ?? "min",
        })),
        splits: running.splits.map(split => ({
            id: split.id,
            distanceValue: split.distance?.value.toString() ?? "",
            distanceUnit: split.distance?.unit ?? "km",
            movingValue: split.movingTime?.value.toString() ?? "",
            movingUnit: split.movingTime?.unit ?? "min",
        })),
        pain: [],
        mappings: run.runStepMappings.map(mapping => ({
            id: mapping.id,
            performedRunStepId: mapping.performedRunStepId,
            prescribedRunStepId: mapping.prescribedRunStepId ?? "",
            relation: mapping.relation,
        })),
    };
}

/** Build the running detail payload shared by add and update. */
function runningPayload(values: RunFormValues): AddRunRequest["running"] {
    const environment =
        values.environmentSurface || values.environmentWeather || values.environmentTemperature
            ? {
                  surface: emptyToNull(values.environmentSurface),
                  weather: emptyToNull(values.environmentWeather),
                  temperatureCelsius: numberOrNull(values.environmentTemperature),
              }
            : undefined;
    return {
        distance: measureFromForm(values.distance),
        movingTime: measureFromForm(values.movingTime),
        elapsedTime: measureFromForm(values.elapsedTime),
        averageHeartRate: numberOrNull(values.averageHeartRate),
        rpe: numberOrNull(values.rpe),
        indoor: values.indoor,
        treadmill: values.treadmill,
        runTags: values.runTags,
        ...(environment ? { environment } : {}),
        gearItemId: values.gearItemId ? values.gearItemId : null,
        steps: values.steps.map((step, index) => ({
            id: step.id,
            type: step.type,
            position: index,
            measurements: {
                distance: measureFromForm({ value: step.distanceValue, unit: step.distanceUnit }),
                duration: measureFromForm({ value: step.durationValue, unit: step.durationUnit }),
            },
        })),
        splits: values.splits.map((split, index) => ({
            id: split.id,
            position: index,
            distance: measureFromForm({ value: split.distanceValue, unit: split.distanceUnit }),
            movingTime: measureFromForm({ value: split.movingValue, unit: split.movingUnit }),
        })),
        // Units are validated by `addRunRequestSchema`/`updateRunRequestSchema` on submit; the form holds
        // them as plain strings, so the run contract's unit unions are asserted here.
    } as AddRunRequest["running"];
}

/** Run-step mappings entered in the form; only included when at least one row is present. */
function mappingsPayload(values: RunFormValues): AddRunRequest["mappings"] | undefined {
    const runStepMappings = values.mappings
        .filter(mapping => mapping.performedRunStepId)
        .map(mapping => ({
            id: mapping.id,
            performedRunStepId: mapping.performedRunStepId,
            prescribedRunStepId: mapping.relation === "added" ? null : mapping.prescribedRunStepId || null,
            relation: mapping.relation,
        }));
    return runStepMappings.length > 0 ? { runStepMappings } : undefined;
}

export function addRunInput(values: RunFormValues): AddRunRequest {
    const mappings = mappingsPayload(values);
    return {
        ...(values.localDate ? { localDate: values.localDate } : {}),
        ...(values.timeZone ? { timeZone: values.timeZone } : {}),
        title: emptyToNull(values.title),
        notes: emptyToNull(values.notes),
        running: runningPayload(values),
        painRecords: values.pain
            .filter(record => record.bodyArea.trim().length > 0)
            .map(record => ({
                id: crypto.randomUUID(),
                bodyArea: record.bodyArea,
                side: record.side,
                severity: Number(record.severity || "0"),
            })),
        ...(mappings ? { mappings } : {}),
    };
}

export function updateRunInput(values: RunFormValues): UpdateRunRequest {
    const mappings = mappingsPayload(values);
    return { running: runningPayload(values), ...(mappings ? { mappings } : {}) };
}

function measureFromForm(measure: { value: string; unit: string }): { value: number; unit: string } | null {
    const trimmed = measure.value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return { value: parsed, unit: measure.unit };
}

function measureToForm(
    measure: { value: number; unit: string } | null,
    fallbackUnit: string,
): { value: string; unit: string } {
    return measure ? { value: measure.value.toString(), unit: measure.unit } : { value: "", unit: fallbackUnit };
}

function numberOrNull(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

function emptyToNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}
