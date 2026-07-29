import { describe, expect, it } from "vitest";

import { createEquipmentIncrementRequestSchema, updateEquipmentIncrementRequestSchema } from "@kinetix/types";

import {
    equipmentIncrementCreateInput,
    equipmentIncrementFormDefaults,
    equipmentIncrementFormSchema,
    equipmentIncrementUpdateInput,
    type EquipmentIncrementFormValues,
} from "@/lib/equipment-increment-form";

const exerciseId = "0198a4db-d8da-7000-8000-0000000000a1";

function values(overrides: Partial<EquipmentIncrementFormValues> = {}): EquipmentIncrementFormValues {
    return { ...equipmentIncrementFormDefaults(null), incrementValue: "2.5", ...overrides };
}

describe("equipment increment form mappers", () => {
    it("maps a default increment", () => {
        const input = equipmentIncrementCreateInput(values());
        expect(input).toMatchObject({ scope: "default", increment: { value: 2.5, unit: "kg" } });
        expect(input).not.toHaveProperty("exerciseId");
        expect(createEquipmentIncrementRequestSchema.safeParse(input).success).toBe(true);
    });

    it("includes the exercise for an exercise-scoped increment", () => {
        const input = equipmentIncrementCreateInput(values({ scope: "exercise", exerciseId }));
        expect(input).toMatchObject({ scope: "exercise", exerciseId });
        expect(createEquipmentIncrementRequestSchema.safeParse(input).success).toBe(true);
    });

    it("nulls the minimum on update when blank", () => {
        const input = equipmentIncrementUpdateInput(values());
        expect(input.minimum).toBeNull();
        expect(updateEquipmentIncrementRequestSchema.safeParse(input).success).toBe(true);
    });

    it("requires an exercise when the scope is exercise", () => {
        expect(equipmentIncrementFormSchema.safeParse(values({ scope: "exercise", exerciseId: "" })).success).toBe(
            false,
        );
    });
});
