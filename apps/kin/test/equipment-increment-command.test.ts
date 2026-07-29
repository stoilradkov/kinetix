import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const increment = {
    id: "0198a4db-d8da-7000-8000-000000002001",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    scope: "default",
    exerciseId: null,
    equipmentTypeId: null,
    incrementKg: "2.5",
    minimumKg: null,
    label: null,
    version: 1,
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
};

describe("kin training equipment-increments", () => {
    it("lists increments", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [increment] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "equipment-increments", "list"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/equipment-increments");
        expect(output).toHaveBeenCalledWith(`${increment.id}\t1\tdefault\t2.5kg\t-`);
    });

    it("sends If-Match when updating an increment", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...increment, incrementKg: "5", version: 2 }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "equipment-increments",
            "update",
            increment.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ increment: { value: 5, unit: "kg" } }),
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain(`/training/equipment-increments/${increment.id}`);
        expect(init?.method).toBe("PATCH");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
    });
});
