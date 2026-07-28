import { describe, expect, it, vi } from "vitest";

import {
    TrainingGoalNotFoundError,
    type TrainingGoalCommands,
    type TrainingGoalRepository,
    type TrainingGoalResource,
} from "#src/modules/training/application/index";
import { TrainingGoalController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    goal: "0198a4db-d8da-7000-8000-0000000000d1",
    profile: "0198a4db-d8da-7000-8000-0000000000d2",
};

function resource(version = 1): TrainingGoalResource {
    return {
        id: ids.goal,
        profileId: ids.profile,
        type: "strength",
        targetValue: "100.000",
        targetUnit: "kg",
        startDate: "2026-07-28",
        targetDate: null,
        priority: 1,
        status: "active",
        notes: null,
        programId: null,
        version,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
    };
}

function repository(overrides: Partial<TrainingGoalRepository> = {}): TrainingGoalRepository {
    return {
        readGoal: async () => resource(),
        listGoals: async () => [resource()],
        ...overrides,
    } as unknown as TrainingGoalRepository;
}

describe("TrainingGoalController", () => {
    it("lists goals", async () => {
        const controller = new TrainingGoalController({} as TrainingGoalCommands, repository());
        await expect(controller.list(undefined)).resolves.toMatchObject({ items: [{ id: ids.goal }] });
    });

    it("validates creation, maps the resource, and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new TrainingGoalController({ create } as unknown as TrainingGoalCommands, repository());

        const result = await controller.create({ type: "strength" }, "request-1", undefined, response);

        expect(result).toMatchObject({ id: ids.goal, type: "strength", version: 1 });
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ type: "strength" }),
            expect.objectContaining({ correlationId: "request-1", source: "user" }),
            undefined,
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("requires optimistic concurrency for updates", () => {
        const controller = new TrainingGoalController({} as TrainingGoalCommands, repository());
        expect(() =>
            controller.update(ids.goal, { priority: 2 }, undefined, "request-2", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
    });

    it("reports an unknown goal on get", async () => {
        const controller = new TrainingGoalController(
            {} as TrainingGoalCommands,
            repository({ readGoal: async () => null }),
        );
        await expect(controller.get(ids.goal, { setHeader: vi.fn() })).rejects.toBeInstanceOf(
            TrainingGoalNotFoundError,
        );
    });
});
