import { describe, expect, it, vi } from "vitest";

import type {
    ZoneDefinitionCommands,
    ZoneDefinitionQueries,
    ZoneDefinitionResource,
} from "#src/modules/training/application/index";
import { ZoneDefinitionController } from "#src/modules/training/presentation/index";

const ids = {
    def: "0198a4db-d8da-7000-8000-000000001001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    r1: "0198a4db-d8da-7000-8000-000000001111",
};

function resource(overrides: Partial<ZoneDefinitionResource> = {}): ZoneDefinitionResource {
    return {
        id: ids.def,
        profileId: ids.profile,
        family: "heart_rate",
        method: "manual",
        config: {},
        ranges: [
            {
                id: ids.r1,
                position: 0,
                name: "Z1",
                lowerBound: "0",
                upperBound: null,
                lowerInclusive: true,
                upperInclusive: false,
            },
        ],
        source: "web",
        note: null,
        effectiveFrom: "2026-07-28T12:00:00.000Z",
        effectiveTo: null,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
        ...overrides,
    };
}

function queries(overrides: Partial<ZoneDefinitionQueries> = {}): ZoneDefinitionQueries {
    return {
        listCurrent: async () => [resource()],
        history: async () => [resource()],
        current: async () => resource(),
        asOf: async () => resource(),
        ...overrides,
    } as unknown as ZoneDefinitionQueries;
}

describe("ZoneDefinitionController", () => {
    it("lists current definitions", async () => {
        const controller = new ZoneDefinitionController({} as ZoneDefinitionCommands, queries());
        await expect(controller.list()).resolves.toMatchObject({ items: [{ id: ids.def }] });
    });

    it("records a definition and maps the body to a command", async () => {
        const record = vi.fn(async () => resource());
        const controller = new ZoneDefinitionController({ record } as unknown as ZoneDefinitionCommands, queries());
        const result = await controller.record(
            {
                family: "heart_rate",
                method: "manual",
                ranges: [{ position: 0, name: "Z1", lowerBound: 0 }],
            },
            "request-1",
            undefined,
            { setHeader: vi.fn() },
        );
        expect(result).toMatchObject({ id: ids.def });
        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({ family: "heart_rate", method: "manual" }),
            expect.objectContaining({ correlationId: "request-1" }),
            undefined,
        );
    });

    it("rejects an invalid body and a family mismatch", async () => {
        const controller = new ZoneDefinitionController(
            { record: vi.fn() } as unknown as ZoneDefinitionCommands,
            queries(),
        );
        await expect(
            controller.record({ family: "power", method: "percent_max_hr", ranges: [] }, "r", undefined, {
                setHeader: vi.fn(),
            }),
        ).rejects.toMatchObject({ status: 422 });
    });

    it("404s when no definition is effective", async () => {
        const controller = new ZoneDefinitionController(
            {} as ZoneDefinitionCommands,
            queries({ asOf: async () => null }),
        );
        await expect(controller.effective("heart_rate", "2026-07-28T12:00:00.000Z")).rejects.toMatchObject({
            status: 404,
        });
    });
});
