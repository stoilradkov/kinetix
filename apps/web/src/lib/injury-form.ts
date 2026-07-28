import {
    injurySeveritySchema,
    injuryStatusSchema,
    type CreateTrainingInjuryRequest,
    type TrainingInjuryResponse,
    type UpdateTrainingInjuryRequest,
} from "@kinetix/types";
import { z } from "zod";

export const SIDE_UNSPECIFIED = "unspecified";

function isRealDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return false;
    return date.toISOString().slice(0, 10) === value;
}

export const injuryFormSchema = z
    .object({
        name: z.string().trim().min(1, "Name is required").max(200),
        bodyArea: z.string().trim().min(1, "Body area is required").max(120),
        side: z.union([z.literal(SIDE_UNSPECIFIED), z.enum(["left", "right", "bilateral"])]),
        severity: injurySeveritySchema,
        status: injuryStatusSchema,
        onsetDate: z
            .string()
            .trim()
            .refine(value => value === "" || isRealDate(value), "Enter a real date"),
        resolvedDate: z
            .string()
            .trim()
            .refine(value => value === "" || isRealDate(value), "Enter a real date"),
        notes: z.string().max(2_000),
        muscleGroupIds: z.array(z.string()),
        exerciseIds: z.array(z.string()),
    })
    .refine(
        values =>
            values.resolvedDate.trim() === "" ||
            values.onsetDate.trim() === "" ||
            values.resolvedDate >= values.onsetDate,
        { message: "Resolved date cannot be before the onset date", path: ["resolvedDate"] },
    )
    .refine(values => (values.status === "resolved") === (values.resolvedDate.trim() !== ""), {
        message: "Set a resolved date exactly when the status is resolved",
        path: ["resolvedDate"],
    });

export type InjuryFormValues = z.infer<typeof injuryFormSchema>;

export function injuryFormDefaults(injury?: TrainingInjuryResponse | null): InjuryFormValues {
    return {
        name: injury?.name ?? "",
        bodyArea: injury?.bodyArea ?? "",
        side: injury?.side ?? SIDE_UNSPECIFIED,
        severity: injury?.severity ?? "moderate",
        status: injury?.status ?? "active",
        onsetDate: injury?.onsetDate ?? "",
        resolvedDate: injury?.resolvedDate ?? "",
        notes: injury?.notes ?? "",
        muscleGroupIds: injury ? [...injury.muscleGroupIds] : [],
        exerciseIds: injury ? [...injury.exerciseIds] : [],
    };
}

function sideValue(values: InjuryFormValues): "left" | "right" | "bilateral" | null {
    return values.side === SIDE_UNSPECIFIED ? null : values.side;
}

export function injuryCreateInput(values: InjuryFormValues): CreateTrainingInjuryRequest {
    return {
        name: values.name.trim(),
        bodyArea: values.bodyArea.trim(),
        severity: values.severity,
        side: sideValue(values),
        ...(values.status !== "active" ? { status: values.status } : {}),
        ...(values.onsetDate.trim() ? { onsetDate: values.onsetDate.trim() } : {}),
        ...(values.resolvedDate.trim() ? { resolvedDate: values.resolvedDate.trim() } : {}),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
        muscleGroupIds: values.muscleGroupIds,
        exerciseIds: values.exerciseIds,
    };
}

export function injuryUpdateInput(values: InjuryFormValues): UpdateTrainingInjuryRequest {
    return {
        name: values.name.trim(),
        bodyArea: values.bodyArea.trim(),
        severity: values.severity,
        side: sideValue(values),
        status: values.status,
        ...(values.onsetDate.trim() ? { onsetDate: values.onsetDate.trim() } : {}),
        resolvedDate: values.resolvedDate.trim() ? values.resolvedDate.trim() : null,
        notes: values.notes.trim() ? values.notes.trim() : null,
        muscleGroupIds: values.muscleGroupIds,
        exerciseIds: values.exerciseIds,
    };
}
