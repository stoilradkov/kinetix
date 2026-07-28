import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const goal = {
    id: "0198a4db-d8da-7000-8000-0000000000d1",
    profileId: "0198a4db-d8da-7000-8000-0000000000d2",
    type: "strength",
    targetValue: "100.000",
    targetUnit: "kg",
    startDate: "2026-07-28",
    targetDate: null,
    priority: 1,
    status: "active",
    notes: null,
    programId: null,
    version: 1,
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
};

describe("kin training goals", () => {
    it("lists goals with an optional status filter", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [goal] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "goals", "list", "--status", "active"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/goals?status=active");
        expect(output).toHaveBeenCalledWith(`${goal.id}\t1\tactive\tstrength\t1`);
    });

    it("sends If-Match and the body when updating a goal", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...goal, status: "achieved", version: 2 }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "goals",
            "update",
            goal.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ status: "achieved" }),
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain(`/training/goals/${goal.id}`);
        expect(init?.method).toBe("PATCH");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect(output).toHaveBeenCalledWith(`${goal.id}\t2\tachieved\tstrength\t1`);
    });
});
