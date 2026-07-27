import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const profile = {
    id: "0198a4db-d8da-7000-8000-000000000001",
    status: "active",
    birthDate: null,
    sex: null,
    heightMeters: null,
    timeZone: "Europe/Sofia",
    unitPreferences: { mass: "kg", distance: "km", length: "cm" },
    version: 1,
    archivedAt: null,
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
};

describe("kin profile", () => {
    it("shows the active core profile", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(profile));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "profile", "show"]);

        expect(request.mock.calls[0]?.[0]).toContain("/profile");
        expect(output).toHaveBeenCalledWith(`${profile.id}\t1\tactive\tEurope/Sofia`);
    });

    it("sends If-Match and the update body when patching the profile", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...profile, timeZone: "UTC", version: 2 }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "profile",
            "update",
            "--version",
            "1",
            "--input",
            JSON.stringify({ timeZone: "UTC" }),
            "--idempotency-key",
            "profile-1",
        ]);

        const [, init] = request.mock.calls[0] ?? [];
        expect(init?.method).toBe("PATCH");
        const headers = init?.headers as Headers;
        expect(headers.get("if-match")).toBe('"1"');
        expect(headers.get("idempotency-key")).toBe("profile-1");
        expect(init?.body).toBe(JSON.stringify({ timeZone: "UTC" }));
        expect(output).toHaveBeenCalledWith(`${profile.id}\t2\tactive\tUTC`);
    });
});
