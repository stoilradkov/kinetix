import { describe, expect, it, vi } from "vitest";

import {
    type TrainingMaxCommands,
    type TrainingMaxQueries,
    type TrainingMaxResource,
} from "#src/modules/training/application/index";
import { TrainingMaxController } from "#src/modules/training/presentation/index";

const ids = {
    max: "0198a4db-d8da-7000-8000-0000000000f1",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    exercise: "0198a4db-d8da-7000-8000-0000000000a1",
};

function resource(overrides: Partial<TrainingMaxResource> = {}): TrainingMaxResource {
    return {
        id: ids.max,
        profileId: ids.profile,
        exerciseId: ids.exercise,
        maxType: "training_max",
        customLabel: null,
        valueKg: "100",
        enteredValue: "100",
        enteredUnit: "kg",
        source: "web",
        note: null,
        effectiveFrom: "2026-07-28T12:00:00.000Z",
        effectiveTo: null,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
        ...overrides,
    };
}

function queries(overrides: Partial<TrainingMaxQueries> = {}): TrainingMaxQueries {
    return {
        listCurrent: async () => [resource()],
        history: async () => [resource()],
        current: async () => resource(),
        asOf: async () => resource(),
        ...overrides,
    } as unknown as TrainingMaxQueries;
}

describe("TrainingMaxController", () => {
    it("lists the current maxima", async () => {
        const controller = new TrainingMaxController({} as TrainingMaxCommands, queries());
        await expect(controller.list(undefined)).resolves.toMatchObject({ items: [{ id: ids.max }] });
    });

    it("returns the effective-interval history for a series", async () => {
        const controller = new TrainingMaxController({} as TrainingMaxCommands, queries());
        await expect(controller.history(ids.exercise, "training_max", undefined)).resolves.toMatchObject({
            items: [{ id: ids.max }],
        });
    });

    it("records a max, validates the body, and maps the resource", async () => {
        const record = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new TrainingMaxController({ record } as unknown as TrainingMaxCommands, queries());

        const result = await controller.record(
            { exerciseId: ids.exercise, maxType: "training_max", load: { value: 100, unit: "kg" } },
            "request-1",
            undefined,
            response,
        );

        expect(result).toMatchObject({ id: ids.max, valueKg: "100" });
        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({ exerciseId: ids.exercise, maxType: "training_max", value: 100, unit: "kg" }),
            expect.objectContaining({ correlationId: "request-1", source: "user" }),
            undefined,
        );
    });

    it("rejects an invalid record body", async () => {
        const controller = new TrainingMaxController({ record: vi.fn() } as unknown as TrainingMaxCommands, queries());
        await expect(
            controller.record({ exerciseId: "not-a-uuid", maxType: "training_max" }, "r", undefined, {
                setHeader: vi.fn(),
            }),
        ).rejects.toMatchObject({ status: 422 });
    });

    it("404s when nothing is effective at the instant", async () => {
        const controller = new TrainingMaxController({} as TrainingMaxCommands, queries({ asOf: async () => null }));
        await expect(
            controller.effective(ids.exercise, "training_max", undefined, "2026-07-28T12:00:00.000Z"),
        ).rejects.toMatchObject({ status: 404 });
    });
});
