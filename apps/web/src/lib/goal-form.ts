import {
    goalStatusSchema,
    goalTypeSchema,
    type CreateTrainingGoalRequest,
    type TrainingGoalResponse,
    type UpdateTrainingGoalRequest,
} from "@kinetix/types";
import { z } from "zod";

function isRealDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return false;
    // Round-trip rejects impossible dates like 9999-99-99 or 2020-02-30.
    return date.toISOString().slice(0, 10) === value;
}

export const goalFormSchema = z
    .object({
        type: goalTypeSchema,
        targetValue: z
            .string()
            .trim()
            .regex(/^(\d+(\.\d{1,3})?)?$/, "Enter a non-negative number"),
        targetUnit: z.string().trim().max(40),
        startDate: z
            .string()
            .trim()
            .refine(value => value === "" || isRealDate(value), "Enter a real date"),
        targetDate: z
            .string()
            .trim()
            .refine(value => value === "" || isRealDate(value), "Enter a real date"),
        priority: z
            .string()
            .trim()
            .refine(value => {
                const parsed = Number(value);
                return value !== "" && Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000;
            }, "Enter a whole number from 1 to 1000"),
        status: goalStatusSchema,
        notes: z.string().max(2_000),
    })
    .refine(values => (values.targetValue.trim() === "") === (values.targetUnit.trim() === ""), {
        message: "Set both a target value and unit, or leave both blank",
        path: ["targetUnit"],
    })
    .refine(
        values =>
            values.startDate.trim() === "" || values.targetDate.trim() === "" || values.targetDate >= values.startDate,
        { message: "Target date cannot be before the start date", path: ["targetDate"] },
    );

export type GoalFormValues = z.infer<typeof goalFormSchema>;

export function goalFormDefaults(goal?: TrainingGoalResponse | null): GoalFormValues {
    return {
        type: goal?.type ?? "strength",
        targetValue: goal?.targetValue ?? "",
        targetUnit: goal?.targetUnit ?? "",
        startDate: goal?.startDate ?? "",
        targetDate: goal?.targetDate ?? "",
        priority: String(goal?.priority ?? 1),
        status: goal?.status ?? "active",
        notes: goal?.notes ?? "",
    };
}

function targetFields(values: GoalFormValues): { targetValue: string; targetUnit: string } | null {
    return values.targetValue.trim()
        ? { targetValue: values.targetValue.trim(), targetUnit: values.targetUnit.trim() }
        : null;
}

export function goalCreateInput(values: GoalFormValues): CreateTrainingGoalRequest {
    const target = targetFields(values);
    return {
        type: values.type,
        priority: Number(values.priority),
        ...(target ?? {}),
        ...(values.startDate.trim() ? { startDate: values.startDate.trim() } : {}),
        ...(values.targetDate.trim() ? { targetDate: values.targetDate.trim() } : {}),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
    };
}

export function goalUpdateInput(values: GoalFormValues): UpdateTrainingGoalRequest {
    const target = targetFields(values);
    return {
        type: values.type,
        priority: Number(values.priority),
        status: values.status,
        targetValue: target?.targetValue ?? null,
        targetUnit: target?.targetUnit ?? null,
        ...(values.startDate.trim() ? { startDate: values.startDate.trim() } : {}),
        targetDate: values.targetDate.trim() ? values.targetDate.trim() : null,
        notes: values.notes.trim() ? values.notes.trim() : null,
    };
}
