import {
    gearTypeSchema,
    type CreateGearItemRequest,
    type GearItemResponse,
    type UpdateGearItemRequest,
} from "@kinetix/types";
import { z } from "zod";

function isRealDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return false;
    return date.toISOString().slice(0, 10) === value;
}

export const gearDistanceUnits = ["km", "mi", "m"] as const;

export const gearFormSchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        gearType: gearTypeSchema,
        acquiredOn: z
            .string()
            .trim()
            .refine(value => value === "" || isRealDate(value), "Enter a real date"),
        retiredOn: z
            .string()
            .trim()
            .refine(value => value === "" || isRealDate(value), "Enter a real date"),
        distanceLimit: z
            .string()
            .trim()
            .regex(/^(\d+(\.\d{1,3})?)?$/, "Enter a positive number"),
        distanceUnit: z.enum(gearDistanceUnits),
        notes: z.string().max(1_000),
    })
    .refine(values => values.acquiredOn === "" || values.retiredOn === "" || values.retiredOn >= values.acquiredOn, {
        message: "Retired date cannot be before the acquired date",
        path: ["retiredOn"],
    });

export type GearFormValues = z.infer<typeof gearFormSchema>;

export function gearFormDefaults(gear?: GearItemResponse | null): GearFormValues {
    return {
        name: gear?.name ?? "",
        gearType: gear?.gearType ?? "shoes",
        acquiredOn: gear?.acquiredOn ?? "",
        retiredOn: gear?.retiredOn ?? "",
        distanceLimit: "",
        distanceUnit: "km",
        notes: gear?.notes ?? "",
    };
}

function distanceLimit(values: GearFormValues): { value: number; unit: (typeof gearDistanceUnits)[number] } | null {
    return values.distanceLimit.trim()
        ? { value: Number(values.distanceLimit.trim()), unit: values.distanceUnit }
        : null;
}

export function gearCreateInput(values: GearFormValues): CreateGearItemRequest {
    const limit = distanceLimit(values);
    return {
        name: values.name.trim(),
        gearType: values.gearType,
        ...(values.acquiredOn.trim() ? { acquiredOn: values.acquiredOn.trim() } : {}),
        ...(values.retiredOn.trim() ? { retiredOn: values.retiredOn.trim() } : {}),
        ...(limit ? { distanceLimit: limit } : {}),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
    };
}

export function gearUpdateInput(values: GearFormValues): UpdateGearItemRequest {
    const limit = distanceLimit(values);
    return {
        name: values.name.trim(),
        gearType: values.gearType,
        acquiredOn: values.acquiredOn.trim() ? values.acquiredOn.trim() : null,
        retiredOn: values.retiredOn.trim() ? values.retiredOn.trim() : null,
        distanceLimit: limit,
        notes: values.notes.trim() ? values.notes.trim() : null,
    };
}
