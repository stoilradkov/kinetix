import { describe, expect, it } from "vitest";

import {
    EquipmentIncrement,
    roundLoadToIncrement,
    type CreateEquipmentIncrementInput,
} from "#src/modules/training/domain/index";

const ids = {
    inc: "0198a4db-d8da-7000-8000-000000002001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    exercise: "0198a4db-d8da-7000-8000-0000000000a1",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function input(overrides: Partial<CreateEquipmentIncrementInput> = {}): CreateEquipmentIncrementInput {
    return {
        id: ids.inc,
        profileId: ids.profile,
        scope: "default",
        increment: { value: 2.5, unit: "kg" },
        ...overrides,
    };
}

describe("EquipmentIncrement domain", () => {
    it("creates a default increment and converts entered units to kg", () => {
        const state = EquipmentIncrement.create(input({ increment: { value: 5, unit: "lb" } }), now).state;
        expect(state.scope).toBe("default");
        expect(state.incrementKg).toBe("2.26796185");
    });

    it("requires the target that matches the scope", () => {
        expect(() => EquipmentIncrement.create(input({ scope: "exercise" }), now)).toThrow();
        expect(
            EquipmentIncrement.create(input({ scope: "exercise", exerciseId: ids.exercise }), now).state.exerciseId,
        ).toBe(ids.exercise);
        expect(() => EquipmentIncrement.create(input({ scope: "default", exerciseId: ids.exercise }), now)).toThrow();
    });

    it("rounds to the nearest achievable load with ties going up", () => {
        const increment = { incrementKg: "2.5", minimumKg: null };
        expect(roundLoadToIncrement("101.25", increment)).toBe("102.5");
        expect(roundLoadToIncrement("101.24", increment)).toBe("100");
        expect(roundLoadToIncrement("100", increment)).toBe("100");
    });

    it("never rounds below the configured minimum bar weight", () => {
        const barbell = { incrementKg: "2.5", minimumKg: "20" };
        expect(roundLoadToIncrement("5", barbell)).toBe("20");
        expect(roundLoadToIncrement("61.3", barbell)).toBe("62.5");
    });
});
