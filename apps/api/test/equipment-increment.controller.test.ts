import { describe, expect, it, vi } from "vitest";

import type {
    EquipmentIncrementCommands,
    EquipmentIncrementQueries,
    EquipmentIncrementResource,
} from "#src/modules/training/application/index";
import { EquipmentIncrementController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    inc: "0198a4db-d8da-7000-8000-000000002001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    exercise: "0198a4db-d8da-7000-8000-0000000000a1",
};

function resource(overrides: Partial<EquipmentIncrementResource> = {}): EquipmentIncrementResource {
    return {
        id: ids.inc,
        profileId: ids.profile,
        scope: "default",
        exerciseId: null,
        equipmentTypeId: null,
        incrementKg: "2.5",
        minimumKg: null,
        label: null,
        version: 1,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
        ...overrides,
    };
}

function queries(overrides: Partial<EquipmentIncrementQueries> = {}): EquipmentIncrementQueries {
    return {
        list: async () => [resource()],
        resolveForExercise: async () => resource(),
        roundForExercise: async () => ({ valueKg: "100", incrementId: ids.inc, scope: "default" }),
        ...overrides,
    } as unknown as EquipmentIncrementQueries;
}

describe("EquipmentIncrementController", () => {
    it("lists increments", async () => {
        const controller = new EquipmentIncrementController({} as EquipmentIncrementCommands, queries());
        await expect(controller.list()).resolves.toMatchObject({ items: [{ id: ids.inc }] });
    });

    it("creates an increment and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new EquipmentIncrementController(
            { create } as unknown as EquipmentIncrementCommands,
            queries(),
        );
        const result = await controller.create(
            { scope: "default", increment: { value: 2.5, unit: "kg" } },
            "request-1",
            undefined,
            response,
        );
        expect(result).toMatchObject({ id: ids.inc, version: 1 });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("requires If-Match on update", () => {
        const controller = new EquipmentIncrementController({} as EquipmentIncrementCommands, queries());
        expect(() =>
            controller.update(ids.inc, { label: "Barbell" }, undefined, "r", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
    });

    it("404s when no increment resolves for an exercise", async () => {
        const controller = new EquipmentIncrementController(
            {} as EquipmentIncrementCommands,
            queries({ resolveForExercise: async () => null }),
        );
        await expect(controller.resolve(ids.exercise)).rejects.toMatchObject({ status: 404 });
    });
});
