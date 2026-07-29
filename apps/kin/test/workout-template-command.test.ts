import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const summaryBase = {
    id: "0198a4db-d8da-7000-8000-000000004001",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    name: "Upper A",
    description: null,
    currentPrescriptionId: "0198a4db-d8da-7000-8000-0000000040a1",
    status: "active",
    archivedAt: null,
    version: 1,
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
};

const summary = {
    ...summaryBase,
    activities: [{ type: "strength", exerciseCount: 2, setCount: 6, runStepCount: 0 }],
};

const prescription = {
    id: summaryBase.currentPrescriptionId,
    kind: "template",
    schemaVersion: 1,
    expectedDurationMs: null,
    notes: null,
    sourcePrescriptionId: null,
    sourceKind: null,
    activities: [],
    createdAt: "2026-07-29T12:00:00.000Z",
};

const detail = { ...summaryBase, prescription };

describe("kin training templates", () => {
    it("lists templates, including archived when requested", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [summary] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "templates", "list", "--include-archived"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/templates?includeArchived=true");
        expect(output).toHaveBeenCalledWith(`${summary.id}\t1\tactive\t1\tUpper A`);
    });

    it("shows a template with its prescription activity count", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(detail));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "templates", "show", summary.id]);

        expect(request.mock.calls[0]?.[0]).toContain(`/training/templates/${summary.id}`);
        expect(output).toHaveBeenCalledWith(`${summary.id}\t1\tactive\t0\tUpper A`);
    });

    it("updates a template with If-Match and idempotency key", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...detail, version: 2 }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "templates",
            "update",
            summary.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ name: "Upper A (v2)" }),
            "--idempotency-key",
            "retry-1",
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain(`/training/templates/${summary.id}`);
        expect(init?.method).toBe("PATCH");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect((init?.headers as Headers).get("idempotency-key")).toBe("retry-1");
    });

    it("archives a template with If-Match", async () => {
        const output = vi.fn();
        const request = vi.fn(async () =>
            Response.json({ ...detail, status: "archived", archivedAt: summary.createdAt, version: 2 }),
        );
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "templates", "archive", summary.id, "--version", "1"]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain(`/training/templates/${summary.id}/archive`);
        expect(init?.method).toBe("POST");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
    });
});
