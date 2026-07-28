import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const record = {
    id: "0198a4db-d8da-7000-8000-0000000000b1",
    profileId: "0198a4db-d8da-7000-8000-0000000000b9",
    type: "body_weight",
    source: "manual",
    effectiveAt: "2026-07-28T06:30:00.000Z",
    timeZone: null,
    notes: null,
    body: { type: "body_weight", massKg: 82.1 },
    bodySchemaVersion: 1,
    archivedAt: null,
    version: 1,
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
};

describe("kin health records", () => {
    it("lists records with a type and window filter", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [record] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "health",
            "records",
            "list",
            "--type",
            "body_weight",
            "--from",
            "2026-07-01T00:00:00.000Z",
        ]);

        const url = String(request.mock.calls[0]?.[0]);
        expect(url).toContain("/health/records?");
        expect(url).toContain("type=body_weight");
        expect(url).toContain("from=2026-07-01");
        expect(output).toHaveBeenCalledWith(`${record.id}\t1\tbody_weight\t2026-07-28T06:30:00.000Z\tactive`);
    });

    it("sends If-Match when archiving a record", async () => {
        const output = vi.fn();
        const request = vi.fn(async () =>
            Response.json({ ...record, archivedAt: "2026-07-29T00:00:00.000Z", version: 2 }),
        );
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "health", "records", "archive", record.id, "--version", "1"]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(String(url)).toContain(`/health/records/${record.id}/archive`);
        expect(init?.method).toBe("POST");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect(output).toHaveBeenCalledWith(`${record.id}\t2\tbody_weight\t2026-07-28T06:30:00.000Z\tarchived`);
    });
});
