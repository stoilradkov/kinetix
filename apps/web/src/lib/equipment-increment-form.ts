import {
    equipmentIncrementScopeSchema,
    type CreateEquipmentIncrementRequest,
    type EquipmentIncrementResponse,
    type UpdateEquipmentIncrementRequest,
} from "@kinetix/types";
import { z } from "zod";

const massUnits = ["kg", "lb"] as const;

export const equipmentIncrementFormSchema = z
    .object({
        scope: equipmentIncrementScopeSchema,
        exerciseId: z.string().trim(),
        equipmentTypeId: z.string().trim(),
        incrementValue: z
            .string()
            .trim()
            .regex(/^\d+(\.\d{1,3})?$/, "Enter a positive number")
            .refine(value => Number(value) > 0, "Enter a positive number"),
        incrementUnit: z.enum(massUnits),
        minimumValue: z
            .string()
            .trim()
            .regex(/^(\d+(\.\d{1,3})?)?$/, "Enter a non-negative number"),
        minimumUnit: z.enum(massUnits),
        label: z.string().trim().max(80),
    })
    .refine(values => values.scope !== "exercise" || values.exerciseId.trim() !== "", {
        message: "Choose an exercise",
        path: ["exerciseId"],
    })
    .refine(values => values.scope !== "equipment" || values.equipmentTypeId.trim() !== "", {
        message: "Choose an equipment type",
        path: ["equipmentTypeId"],
    });

export type EquipmentIncrementFormValues = z.infer<typeof equipmentIncrementFormSchema>;

export function equipmentIncrementFormDefaults(
    increment?: EquipmentIncrementResponse | null,
): EquipmentIncrementFormValues {
    return {
        scope: increment?.scope ?? "default",
        exerciseId: increment?.exerciseId ?? "",
        equipmentTypeId: increment?.equipmentTypeId ?? "",
        incrementValue: increment?.incrementKg ?? "",
        incrementUnit: "kg",
        minimumValue: increment?.minimumKg ?? "",
        minimumUnit: "kg",
        label: increment?.label ?? "",
    };
}

function minimum(values: EquipmentIncrementFormValues): { value: number; unit: (typeof massUnits)[number] } | null {
    return values.minimumValue.trim() ? { value: Number(values.minimumValue.trim()), unit: values.minimumUnit } : null;
}

export function equipmentIncrementCreateInput(values: EquipmentIncrementFormValues): CreateEquipmentIncrementRequest {
    const minimumInput = minimum(values);
    return {
        scope: values.scope,
        ...(values.scope === "exercise" ? { exerciseId: values.exerciseId.trim() } : {}),
        ...(values.scope === "equipment" ? { equipmentTypeId: values.equipmentTypeId.trim() } : {}),
        increment: { value: Number(values.incrementValue.trim()), unit: values.incrementUnit },
        ...(minimumInput ? { minimum: minimumInput } : {}),
        ...(values.label.trim() ? { label: values.label.trim() } : {}),
    };
}

export function equipmentIncrementUpdateInput(values: EquipmentIncrementFormValues): UpdateEquipmentIncrementRequest {
    return {
        increment: { value: Number(values.incrementValue.trim()), unit: values.incrementUnit },
        minimum: minimum(values),
        label: values.label.trim() ? values.label.trim() : null,
    };
}
