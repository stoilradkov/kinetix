import { z } from "zod";

import type {
    CreateTrainingSessionRequest,
    TrainingSessionResponse,
    UpdateTrainingSessionRequest,
} from "@kinetix/types";

/**
 * String-based form model for the training-session editor. Inputs stay controlled as strings (empty
 * string = unset); the mappers below convert to/from the typed wire contract. Readiness values are
 * 1–5 selects where "" clears the rating; tags are free-form chips normalized server-side.
 */

const localDateForm = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")]);
const scaleForm = z.union([z.literal(""), z.enum(["1", "2", "3", "4", "5"])]);

const readinessFormSchema = z.object({
    energy: scaleForm,
    motivation: scaleForm,
    fatigue: scaleForm,
    soreness: scaleForm,
    stress: scaleForm,
    recovery: scaleForm,
});

export const sessionFormSchema = z.object({
    title: z.string().max(160),
    localDate: localDateForm,
    timeZone: z.string().max(80),
    notes: z.string().max(4_000),
    tags: z.array(z.string().trim().min(1).max(80)),
    readiness: readinessFormSchema,
});

export type SessionFormValues = z.infer<typeof sessionFormSchema>;
export type ReadinessFormValues = z.infer<typeof readinessFormSchema>;

export const readinessFields = ["energy", "motivation", "fatigue", "soreness", "stress", "recovery"] as const;

export function sessionFormDefaults(timeZone = ""): SessionFormValues {
    return {
        title: "",
        localDate: "",
        timeZone,
        notes: "",
        tags: [],
        readiness: { energy: "", motivation: "", fatigue: "", soreness: "", stress: "", recovery: "" },
    };
}

function readinessPayload(values: ReadinessFormValues) {
    return Object.fromEntries(
        readinessFields.map(field => [field, values[field] === "" ? null : Number(values[field])]),
    ) as Record<(typeof readinessFields)[number], number | null>;
}

function tagsPayload(values: SessionFormValues): string[] {
    return values.tags.map(tag => tag.trim()).filter(tag => tag.length > 0);
}

export function sessionCreateInput(values: SessionFormValues): CreateTrainingSessionRequest {
    return {
        title: values.title.trim() === "" ? null : values.title.trim(),
        ...(values.localDate === "" ? {} : { localDate: values.localDate }),
        ...(values.timeZone.trim() === "" ? {} : { timeZone: values.timeZone.trim() }),
        notes: values.notes.trim() === "" ? null : values.notes.trim(),
        tags: tagsPayload(values),
        readiness: readinessPayload(values.readiness),
    };
}

export function sessionUpdateInput(values: SessionFormValues): UpdateTrainingSessionRequest {
    return {
        title: values.title.trim() === "" ? null : values.title.trim(),
        ...(values.localDate === "" ? {} : { localDate: values.localDate }),
        ...(values.timeZone.trim() === "" ? {} : { timeZone: values.timeZone.trim() }),
        notes: values.notes.trim() === "" ? null : values.notes.trim(),
        tags: tagsPayload(values),
        readiness: readinessPayload(values.readiness),
    };
}

export function sessionFormValues(response: TrainingSessionResponse): SessionFormValues {
    return {
        title: response.title ?? "",
        localDate: response.localDate,
        timeZone: response.timeZone,
        notes: response.notes ?? "",
        tags: [...response.tags],
        readiness: {
            energy: scaleToForm(response.readiness.energy),
            motivation: scaleToForm(response.readiness.motivation),
            fatigue: scaleToForm(response.readiness.fatigue),
            soreness: scaleToForm(response.readiness.soreness),
            stress: scaleToForm(response.readiness.stress),
            recovery: scaleToForm(response.readiness.recovery),
        },
    };
}

function scaleToForm(value: number | null): ReadinessFormValues[keyof ReadinessFormValues] {
    return value === null ? "" : (String(value) as "1" | "2" | "3" | "4" | "5");
}
