import { describe, expect, it } from "vitest";

import { WorkoutTemplate, type CreateWorkoutTemplateInput } from "#src/modules/training/domain/index";

const ids = {
    template: "0198a4db-d8da-7000-8000-000000004001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    prescriptionA: "0198a4db-d8da-7000-8000-0000000040a1",
    prescriptionB: "0198a4db-d8da-7000-8000-0000000040b2",
} as const;
const now = new Date("2026-07-29T12:00:00.000Z");
const later = new Date("2026-07-29T13:00:00.000Z");

function input(overrides: Partial<CreateWorkoutTemplateInput> = {}): CreateWorkoutTemplateInput {
    return {
        id: ids.template,
        profileId: ids.profile,
        name: "Upper A",
        currentPrescriptionId: ids.prescriptionA,
        ...overrides,
    };
}

describe("WorkoutTemplate domain", () => {
    it("creates an active template pointing at its current prescription", () => {
        const state = WorkoutTemplate.create(input({ description: "  Push focus  " }), now).state;
        expect(state).toMatchObject({
            status: "active",
            archivedAt: null,
            currentPrescriptionId: ids.prescriptionA,
            description: "Push focus",
        });
    });

    it("rejects a blank name and a non-UUID prescription pointer", () => {
        expect(() => WorkoutTemplate.create(input({ name: "   " }), now)).toThrow();
        expect(() => WorkoutTemplate.create(input({ currentPrescriptionId: "not-a-uuid" }), now)).toThrow();
    });

    it("advances the current pointer on edit without touching the prior prescription id", () => {
        const created = WorkoutTemplate.create(input(), now);
        const edited = WorkoutTemplate.rehydrate(created.state).update(
            { name: "Upper A (v2)", currentPrescriptionId: ids.prescriptionB },
            later,
        ).state;
        expect(edited.currentPrescriptionId).toBe(ids.prescriptionB);
        expect(edited.name).toBe("Upper A (v2)");
        // The prior aggregate snapshot still references the original prescription.
        expect(created.state.currentPrescriptionId).toBe(ids.prescriptionA);
    });

    it("clears description with an explicit null and preserves it when untouched", () => {
        const created = WorkoutTemplate.create(input({ description: "Notes" }), now);
        const cleared = WorkoutTemplate.rehydrate(created.state).update({ description: null }, later).state;
        expect(cleared.description).toBeNull();
        const untouched = WorkoutTemplate.rehydrate(created.state).update({ name: "Renamed" }, later).state;
        expect(untouched.description).toBe("Notes");
    });

    it("archives and restores, toggling the archive timestamp", () => {
        const created = WorkoutTemplate.create(input(), now);
        const archived = WorkoutTemplate.rehydrate(created.state).archive(now).state;
        expect(archived).toMatchObject({ status: "archived" });
        expect(archived.archivedAt).not.toBeNull();
        const restored = WorkoutTemplate.rehydrate(archived).restore(now).state;
        expect(restored).toMatchObject({ status: "active", archivedAt: null });
    });
});
