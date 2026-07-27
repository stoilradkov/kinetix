import { describe, expect, it, vi } from "vitest";

import {
    type TrainingProfileCommands,
    type TrainingProfileRepository,
    type TrainingProfileResource,
} from "#src/modules/training/application/index";
import { TrainingProfileController } from "#src/modules/training/presentation/index";
import { ApplicationNotFoundError, ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    trainingProfile: "0198a4db-d8da-7000-8000-0000000000b1",
    coreProfile: "0198a4db-d8da-7000-8000-0000000000b2",
};

function resource(version = 1): TrainingProfileResource {
    return {
        id: ids.trainingProfile,
        profileId: ids.coreProfile,
        status: "active",
        experience: "beginner",
        oneRepMaxRepCutoff: 12,
        hardSetRpeThreshold: 7,
        hardSetRirThreshold: 3,
        calculatorVersion: 1,
        ruleVersion: 1,
        version,
        archivedAt: null,
        createdAt: "2026-07-27T12:00:00.000Z",
        updatedAt: "2026-07-27T12:00:00.000Z",
    };
}

function repository(overrides: Partial<TrainingProfileRepository> = {}): TrainingProfileRepository {
    return { readActive: async () => resource(), ...overrides } as unknown as TrainingProfileRepository;
}

describe("TrainingProfileController", () => {
    it("validates creation, maps the resource, and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new TrainingProfileController(
            { create } as unknown as TrainingProfileCommands,
            repository(),
        );

        const result = await controller.create({ experience: "advanced" }, "request-1", undefined, response);

        expect(result).toMatchObject({ id: ids.trainingProfile, profileId: ids.coreProfile, version: 1 });
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ experience: "advanced" }),
            expect.objectContaining({ correlationId: "request-1", source: "user" }),
            undefined,
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("requires optimistic concurrency for updates", () => {
        const controller = new TrainingProfileController({} as TrainingProfileCommands, repository());
        expect(() =>
            controller.update({ ruleVersion: 2 }, undefined, "request-2", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
    });

    it("reports a missing active training profile", async () => {
        const controller = new TrainingProfileController(
            {} as TrainingProfileCommands,
            repository({ readActive: async () => null }),
        );

        await expect(controller.get({ setHeader: vi.fn() })).rejects.toBeInstanceOf(ApplicationNotFoundError);
    });
});
