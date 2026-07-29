import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const max = {
    id: "0198a4db-d8da-7000-8000-0000000000f1",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    exerciseId: "0198a4db-d8da-7000-8000-0000000000a1",
    maxType: "training_max",
    customLabel: null,
    valueKg: "100",
    enteredValue: "100",
    enteredUnit: "kg",
    source: "web",
    note: null,
    effectiveFrom: "2026-07-28T12:00:00.000Z",
    effectiveTo: null,
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
};

describe("kin training maxes", () => {
    it("lists current maxima filtered by exercise", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [max] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "maxes", "list", "--exercise", max.exerciseId]);

        expect(request.mock.calls[0]?.[0]).toContain(`/training/maxes?exerciseId=${max.exerciseId}`);
        expect(output).toHaveBeenCalledWith(`${max.id}\ttraining_max\t100kg\t${max.effectiveFrom}\tcurrent`);
    });

    it("requests the series history", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [max] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "maxes",
            "history",
            "--exercise",
            max.exerciseId,
            "--type",
            "training_max",
        ]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/maxes/history?");
        expect(request.mock.calls[0]?.[0]).toContain(`exerciseId=${max.exerciseId}`);
    });

    it("posts a recorded max from inline JSON", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(max));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "maxes",
            "record",
            "--input",
            JSON.stringify({ exerciseId: max.exerciseId, maxType: "training_max", load: { value: 100, unit: "kg" } }),
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain("/training/maxes");
        expect(init?.method).toBe("POST");
        expect(output).toHaveBeenCalledWith(`${max.id}\ttraining_max\t100kg\t${max.effectiveFrom}\tcurrent`);
    });
});
