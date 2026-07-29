import { describe, expect, it, vi } from "vitest";

import {
    GearItemNotFoundError,
    type GearItemCommands,
    type GearItemRepository,
    type GearItemResource,
} from "#src/modules/training/application/index";
import { GearItemController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    gear: "0198a4db-d8da-7000-8000-000000003001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
};

function resource(overrides: Partial<GearItemResource> = {}): GearItemResource {
    return {
        id: ids.gear,
        profileId: ids.profile,
        name: "Daily Trainers",
        gearType: "shoes",
        acquiredOn: null,
        retiredOn: null,
        distanceLimitM: null,
        notes: null,
        status: "active",
        archivedAt: null,
        version: 1,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
        ...overrides,
    };
}

function repository(overrides: Partial<GearItemRepository> = {}): GearItemRepository {
    return {
        readGear: async () => resource(),
        listGear: async () => [resource()],
        ...overrides,
    } as unknown as GearItemRepository;
}

describe("GearItemController", () => {
    it("lists gear items", async () => {
        const controller = new GearItemController({} as GearItemCommands, repository());
        await expect(controller.list(undefined)).resolves.toMatchObject({ items: [{ id: ids.gear }] });
    });

    it("creates gear and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new GearItemController({ create } as unknown as GearItemCommands, repository());
        const result = await controller.create(
            { name: "Daily Trainers", gearType: "shoes" },
            "request-1",
            undefined,
            response,
        );
        expect(result).toMatchObject({ id: ids.gear, version: 1 });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("archives gear through the command", async () => {
        const archive = vi.fn(async () =>
            resource({ status: "archived", archivedAt: "2026-07-28T12:00:00.000Z", version: 2 }),
        );
        const controller = new GearItemController({ archive } as unknown as GearItemCommands, repository());
        const result = await controller.archive(ids.gear, '"1"', "r", undefined, { setHeader: vi.fn() });
        expect(result).toMatchObject({ status: "archived", version: 2 });
        expect(archive).toHaveBeenCalledWith(ids.gear, 1, expect.any(Object), undefined);
    });

    it("requires If-Match on update and reports an unknown item", async () => {
        const controller = new GearItemController({} as GearItemCommands, repository({ readGear: async () => null }));
        expect(() =>
            controller.update(ids.gear, { name: "x" }, undefined, "r", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
        await expect(controller.get(ids.gear, { setHeader: vi.fn() })).rejects.toBeInstanceOf(GearItemNotFoundError);
    });
});
