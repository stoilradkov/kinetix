import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const gear = {
    id: "0198a4db-d8da-7000-8000-000000003001",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
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
};

describe("kin training gear", () => {
    it("lists gear, including archived when requested", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [gear] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "gear", "list", "--include-archived"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/gear?includeArchived=true");
        expect(output).toHaveBeenCalledWith(`${gear.id}\t1\tactive\tshoes\tDaily Trainers`);
    });

    it("archives gear with If-Match", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...gear, status: "archived", version: 2 }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "gear", "archive", gear.id, "--version", "1"]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain(`/training/gear/${gear.id}/archive`);
        expect(init?.method).toBe("POST");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
    });
});
