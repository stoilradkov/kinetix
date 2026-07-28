import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const injury = {
    id: "0198a4db-d8da-7000-8000-0000000000f1",
    profileId: "0198a4db-d8da-7000-8000-0000000000f2",
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
    version: 1,
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
};

describe("kin training injuries", () => {
    it("lists injuries with an optional status filter", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [injury] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "injuries", "list", "--status", "active"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/injuries?status=active");
        expect(output).toHaveBeenCalledWith(`${injury.id}\t1\tactive\tmoderate\tLeft shoulder strain`);
    });

    it("sends If-Match and the body when updating an injury", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...injury, status: "resolved", version: 2 }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "injuries",
            "update",
            injury.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ status: "resolved", resolvedDate: "2026-07-28" }),
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain(`/training/injuries/${injury.id}`);
        expect(init?.method).toBe("PATCH");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect(output).toHaveBeenCalledWith(`${injury.id}\t2\tresolved\tmoderate\tLeft shoulder strain`);
    });
});
