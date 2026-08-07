import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const base = {
    id: "0198a4db-d8da-7000-8000-000000007001",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    status: "in_progress",
    title: "Upper A",
    localDate: "2026-08-02",
    timeZone: "Europe/Sofia",
    startedAt: "2026-08-02T09:00:00.000Z",
    endedAt: null,
    durationMinutes: null,
    readiness: { energy: null, motivation: null, fatigue: null, soreness: null, stress: null, recovery: null },
    postWorkout: { energy: null, motivation: null, enjoyment: null, difficulty: null, fatigue: null, notes: null },
    notes: null,
    tags: [],
    sourcePlannedSessionId: null,
    version: 2,
    archivedAt: null,
    createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
};

const response = {
    ...base,
    activities: [],
    painRecords: [],
    plannedLinks: [],
    activityMappings: [],
    occurrenceMappings: [],
    setMappings: [],
    runStepMappings: [],
};

const ids = {
    session: base.id,
    activity: "0198a4db-d8da-7000-8000-0000000070a1",
    occurrence: "0198a4db-d8da-7000-8000-0000000070a2",
    set: "0198a4db-d8da-7000-8000-0000000070a3",
};

const recordSetBody = {
    activityId: ids.activity,
    occurrenceId: ids.occurrence,
    set: { id: ids.set, position: 0, setType: "working", status: "completed" },
};

describe("kin training sets", () => {
    it("adds a performed set, forwarding the If-Match version and validated body", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sets",
            "add",
            ids.session,
            "--version",
            "2",
            "--input",
            JSON.stringify(recordSetBody),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/sessions/${ids.session}/strength/sets`);
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("if-match")).toBe('"2"');
        expect(JSON.parse(String(init?.body))).toEqual(recordSetBody);
    });

    it("patches a performed set through the update verb with the set ID", async () => {
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output: vi.fn() });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sets",
            "update",
            ids.session,
            ids.set,
            "--version",
            "2",
            "--input",
            JSON.stringify({ status: "skipped" }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/sessions/${ids.session}/strength/sets/${ids.set}`);
        expect(init?.method).toBe("PATCH");
        expect(JSON.parse(String(init?.body))).toEqual({ status: "skipped" });
    });

    it("completes a performed set by merging status onto the supplied patch", async () => {
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output: vi.fn() });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sets",
            "complete",
            ids.session,
            ids.set,
            "--version",
            "2",
            "--input",
            JSON.stringify({ technique: 4 }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/sessions/${ids.session}/strength/sets/${ids.set}`);
        expect(init?.method).toBe("PATCH");
        expect(JSON.parse(String(init?.body))).toEqual({ technique: 4, status: "completed" });
    });

    it("completes a set with no patch body, sending only the status", async () => {
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output: vi.fn() });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sets",
            "complete",
            ids.session,
            ids.set,
            "--version",
            "2",
        ]);

        expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual({ status: "completed" });
    });

    it("reads the request body from a file", async () => {
        const directory = mkdtempSync(join(tmpdir(), "kin-set-"));
        const file = join(directory, "set.json");
        writeFileSync(file, JSON.stringify(recordSetBody));
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output: vi.fn() });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sets",
            "add",
            ids.session,
            "--version",
            "2",
            "--file",
            file,
        ]);

        expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual(recordSetBody);
    });

    it("sends the provenance channel and reason as headers", async () => {
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output: vi.fn() });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sets",
            "add",
            ids.session,
            "--version",
            "2",
            "--input",
            JSON.stringify(recordSetBody),
            "--source",
            "agent",
            "--reason",
            "assistant logged the set",
        ]);

        const headers = new Headers(request.mock.calls[0]![1]?.headers);
        expect(headers.get("x-kinetix-source")).toBe("agent");
        expect(headers.get("x-kinetix-reason")).toBe("assistant logged the set");
    });
});

describe("kin training sessions provenance and redaction", () => {
    it("sends the provenance channel on a lifecycle transition", async () => {
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output: vi.fn() });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sessions",
            "reopen",
            ids.session,
            "--version",
            "2",
            "--source",
            "agent",
        ]);

        expect(new Headers(request.mock.calls[0]![1]?.headers).get("x-kinetix-source")).toBe("agent");
    });

    it("redacts notes in human output but never in JSON output", async () => {
        const withNotes = { ...response, notes: "felt a tweak in the left knee" };
        const humanOutput = vi.fn();
        await createProgram({ fetch: async () => Response.json(withNotes), output: humanOutput }).parseAsync([
            "node",
            "kin",
            "training",
            "sessions",
            "show",
            ids.session,
        ]);
        expect(humanOutput).toHaveBeenCalledWith(expect.stringContaining("notes=[redacted]"));
        expect(humanOutput.mock.calls[0]![0]).not.toContain("tweak");

        const jsonOutput = vi.fn();
        await createProgram({ fetch: async () => Response.json(withNotes), output: jsonOutput }).parseAsync([
            "node",
            "kin",
            "training",
            "sessions",
            "show",
            ids.session,
            "--json",
        ]);
        expect(jsonOutput.mock.calls[0]![0]).toContain("felt a tweak in the left knee");
    });
});
