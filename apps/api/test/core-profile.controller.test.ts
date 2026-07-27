import { describe, expect, it, vi } from "vitest";

import {
    type CoreProfileCommands,
    type CoreProfileRepository,
    type CoreProfileResource,
} from "#src/modules/profile/application/index";
import { CoreProfileController } from "#src/modules/profile/presentation/index";
import { ApplicationNotFoundError, ExpectedVersionRequiredError } from "#src/platform/application/index";

const profileId = "0198a4db-d8da-7000-8000-000000000001";

function resource(version = 1): CoreProfileResource {
    return {
        id: profileId,
        status: "active",
        birthDate: null,
        sex: null,
        heightMeters: null,
        timeZone: "Europe/Sofia",
        unitPreferences: { mass: "kg", distance: "km", length: "cm" },
        archivedAt: null,
        createdAt: "2026-07-27T12:00:00.000Z",
        updatedAt: "2026-07-27T12:00:00.000Z",
        version,
    };
}

function request() {
    return { timeZone: "Europe/Sofia", unitPreferences: { mass: "kg", distance: "km", length: "cm" } };
}

function repository(overrides: Partial<CoreProfileRepository> = {}): CoreProfileRepository {
    return { readActive: async () => resource(), ...overrides } as unknown as CoreProfileRepository;
}

describe("CoreProfileController", () => {
    it("validates creation, maps the resource, and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new CoreProfileController({ create } as unknown as CoreProfileCommands, repository());

        const result = await controller.create(request(), "request-1", undefined, response);

        expect(result).toMatchObject({ id: profileId, timeZone: "Europe/Sofia", version: 1 });
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ timeZone: "Europe/Sofia" }),
            expect.objectContaining({ correlationId: "request-1", source: "user" }),
            undefined,
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("requires optimistic concurrency for updates", () => {
        const controller = new CoreProfileController({} as CoreProfileCommands, repository());
        expect(() =>
            controller.update({ timeZone: "UTC" }, undefined, "request-2", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
    });

    it("returns the active profile with its ETag", async () => {
        const response = { setHeader: vi.fn() };
        const controller = new CoreProfileController({} as CoreProfileCommands, repository());

        await expect(controller.get(response)).resolves.toMatchObject({ id: profileId, version: 1 });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("reports a missing active profile", async () => {
        const controller = new CoreProfileController(
            {} as CoreProfileCommands,
            repository({ readActive: async () => null }),
        );

        await expect(controller.get({ setHeader: vi.fn() })).rejects.toBeInstanceOf(ApplicationNotFoundError);
    });
});
