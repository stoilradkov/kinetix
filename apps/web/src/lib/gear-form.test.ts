import { describe, expect, it } from "vitest";

import { createGearItemRequestSchema, updateGearItemRequestSchema } from "@kinetix/types";

import {
    gearCreateInput,
    gearFormDefaults,
    gearFormSchema,
    gearUpdateInput,
    type GearFormValues,
} from "@/lib/gear-form";

function values(overrides: Partial<GearFormValues> = {}): GearFormValues {
    return { ...gearFormDefaults(null), name: "Daily Trainers", ...overrides };
}

describe("gear form mappers", () => {
    it("maps a create request with an optional distance limit", () => {
        const input = gearCreateInput(values({ distanceLimit: "800", distanceUnit: "km" }));
        expect(input).toMatchObject({
            name: "Daily Trainers",
            gearType: "shoes",
            distanceLimit: { value: 800, unit: "km" },
        });
        expect(createGearItemRequestSchema.safeParse(input).success).toBe(true);
    });

    it("nulls cleared fields on update", () => {
        const input = gearUpdateInput(values());
        expect(input).toMatchObject({ acquiredOn: null, retiredOn: null, distanceLimit: null, notes: null });
        expect(updateGearItemRequestSchema.safeParse(input).success).toBe(true);
    });

    it("rejects a retirement before acquisition", () => {
        expect(gearFormSchema.safeParse(values({ acquiredOn: "2026-05-01", retiredOn: "2026-04-01" })).success).toBe(
            false,
        );
    });
});
