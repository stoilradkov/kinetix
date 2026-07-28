import { describe, expect, it, vi } from "vitest";

import {
    TrainingInjuryNotFoundError,
    type TrainingInjuryCommands,
    type TrainingInjuryRepository,
    type TrainingInjuryResource,
} from "#src/modules/training/application/index";
import { TrainingInjuryController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    injury: "0198a4db-d8da-7000-8000-0000000000f1",
    profile: "0198a4db-d8da-7000-8000-0000000000f2",
};

function resource(version = 1): TrainingInjuryResource {
    return {
        id: ids.injury,
        profileId: ids.profile,
        name: "Left shoulder strain",
        bodyArea: "shoulder",
        side: "left",
        severity: "moderate",
        status: "active",
        onsetDate: "2026-07-28",
        resolvedDate: null,
        notes: null,
        muscleGroupIds: [],
        exerciseIds: [],
        version,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
    };
}

function repository(overrides: Partial<TrainingInjuryRepository> = {}): TrainingInjuryRepository {
    return {
        readInjury: async () => resource(),
        listInjuries: async () => [resource()],
        ...overrides,
    } as unknown as TrainingInjuryRepository;
}

describe("TrainingInjuryController", () => {
    it("lists injuries", async () => {
        const controller = new TrainingInjuryController({} as TrainingInjuryCommands, repository());
        await expect(controller.list(undefined)).resolves.toMatchObject({ items: [{ id: ids.injury }] });
    });

    it("validates creation, maps the resource, and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new TrainingInjuryController({ create } as unknown as TrainingInjuryCommands, repository());

        const result = await controller.create(
            { name: "Left shoulder strain", bodyArea: "shoulder" },
            "request-1",
            undefined,
            response,
        );

        expect(result).toMatchObject({ id: ids.injury, name: "Left shoulder strain", version: 1 });
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ name: "Left shoulder strain", bodyArea: "shoulder" }),
            expect.objectContaining({ correlationId: "request-1", source: "user" }),
            undefined,
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("requires optimistic concurrency for updates", () => {
        const controller = new TrainingInjuryController({} as TrainingInjuryCommands, repository());
        expect(() =>
            controller.update(ids.injury, { severity: "mild" }, undefined, "request-2", undefined, {
                setHeader: vi.fn(),
            }),
        ).toThrow(ExpectedVersionRequiredError);
    });

    it("reports an unknown injury on get", async () => {
        const controller = new TrainingInjuryController(
            {} as TrainingInjuryCommands,
            repository({ readInjury: async () => null }),
        );
        await expect(controller.get(ids.injury, { setHeader: vi.fn() })).rejects.toBeInstanceOf(
            TrainingInjuryNotFoundError,
        );
    });
});
