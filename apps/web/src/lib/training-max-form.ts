import { trainingMaxTypeSchema, trainingMaxUnitSchema, type RecordTrainingMaxRequest } from "@kinetix/types";
import { z } from "zod";

function isRealDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return false;
    return date.toISOString().slice(0, 10) === value;
}

export const trainingMaxFormSchema = z
    .object({
        exerciseId: z.string().uuid("Choose an exercise"),
        maxType: trainingMaxTypeSchema,
        customLabel: z.string().trim().max(60),
        loadValue: z
            .string()
            .trim()
            .regex(/^\d+(\.\d{1,3})?$/, "Enter a positive number")
            .refine(value => Number(value) > 0, "Enter a positive number"),
        loadUnit: trainingMaxUnitSchema,
        effectiveFrom: z
            .string()
            .trim()
            .refine(value => value === "" || isRealDate(value), "Enter a real date"),
        note: z.string().max(500),
    })
    .refine(values => values.maxType !== "custom" || values.customLabel.trim() !== "", {
        message: "A custom max needs a label",
        path: ["customLabel"],
    });

export type TrainingMaxFormValues = z.infer<typeof trainingMaxFormSchema>;

export function trainingMaxFormDefaults(exerciseId = ""): TrainingMaxFormValues {
    return {
        exerciseId,
        maxType: "training_max",
        customLabel: "",
        loadValue: "",
        loadUnit: "kg",
        effectiveFrom: "",
        note: "",
    };
}

export function trainingMaxRecordInput(values: TrainingMaxFormValues): RecordTrainingMaxRequest {
    return {
        exerciseId: values.exerciseId,
        maxType: values.maxType,
        ...(values.maxType === "custom" ? { customLabel: values.customLabel.trim() } : {}),
        load: { value: Number(values.loadValue), unit: values.loadUnit },
        ...(values.note.trim() ? { note: values.note.trim() } : {}),
        ...(values.effectiveFrom.trim() ? { effectiveFrom: `${values.effectiveFrom.trim()}T00:00:00.000Z` } : {}),
    };
}
