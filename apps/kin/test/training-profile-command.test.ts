import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const profile = {
    id: "0198a4db-d8da-7000-8000-0000000000b1",
    profileId: "0198a4db-d8da-7000-8000-0000000000b2",
    status: "active",
    experience: "beginner",
    oneRepMaxRepCutoff: 12,
    hardSetRpeThreshold: 7,
    hardSetRirThreshold: 3,
    calculatorVersion: 1,
    ruleVersion: 1,
    version: 1,
    archivedAt: null,
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
};

describe("kin training profile", () => {
    it("shows the active training profile", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(profile));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "profile", "show"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/profile");
        expect(output).toHaveBeenCalledWith(`${profile.id}\t1\tactive\tbeginner`);
    });

    it("sends If-Match and the body when patching the training profile", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...profile, experience: "advanced", version: 2 }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "profile",
            "update",
            "--version",
            "1",
            "--input",
            JSON.stringify({ experience: "advanced" }),
        ]);

        const [, init] = request.mock.calls[0] ?? [];
        expect(init?.method).toBe("PATCH");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect(init?.body).toBe(JSON.stringify({ experience: "advanced" }));
        expect(output).toHaveBeenCalledWith(`${profile.id}\t2\tactive\tadvanced`);
    });
});
