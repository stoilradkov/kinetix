import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const zone = {
    id: "0198a4db-d8da-7000-8000-000000001001",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    family: "heart_rate",
    method: "manual",
    config: {},
    ranges: [
        {
            id: "0198a4db-d8da-7000-8000-000000001111",
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
};

describe("kin training zones", () => {
    it("lists current zone definitions", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [zone] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "zones", "list"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/zones");
        expect(output).toHaveBeenCalledWith(`${zone.id}\theart_rate\tmanual\t1 ranges\t${zone.effectiveFrom}\tcurrent`);
    });

    it("records a zone definition from inline JSON", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(zone));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "zones",
            "record",
            "--input",
            JSON.stringify({
                family: "heart_rate",
                method: "manual",
                ranges: [{ position: 0, name: "Z1", lowerBound: 0 }],
            }),
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain("/training/zones");
        expect(init?.method).toBe("POST");
    });
});
