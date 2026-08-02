import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const base = {
    id: "0198a4db-d8da-7000-8000-000000007001",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    status: "draft",
    title: "Upper A",
    localDate: "2026-08-02",
    timeZone: "Europe/Sofia",
    startedAt: null,
    endedAt: null,
    durationMinutes: null,
    readiness: { energy: null, motivation: null, fatigue: null, soreness: null, stress: null, recovery: null },
    postWorkout: { energy: null, motivation: null, enjoyment: null, difficulty: null, fatigue: null, notes: null },
    notes: null,
    tags: [],
    sourcePlannedSessionId: null,
    version: 1,
    archivedAt: null,
    createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
};

const summary = { ...base, activityCount: 0, painRecordCount: 0 };
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

describe("kin training sessions", () => {
    it("lists sessions, including archived when requested", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [summary] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "sessions", "list", "--include-archived"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/sessions?includeArchived=true");
        expect(output).toHaveBeenCalledWith(`${summary.id}\t1\tdraft\t2026-08-02\tUpper A`);
    });

    it("creates a session from inline JSON", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sessions",
            "create",
            "--input",
            JSON.stringify({ title: "Upper A", readiness: { energy: 4 } }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain("/training/sessions");
        expect(init?.method).toBe("POST");
        expect(output).toHaveBeenCalledWith(`${response.id}\t1\tdraft\t2026-08-02\tUpper A`);
    });

    it("starts a session with the If-Match version", async () => {
        const output = vi.fn();
        const started = { ...response, status: "in_progress", version: 2, startedAt: "2026-08-02T10:00:00.000Z" };
        const request = vi.fn(async () => Response.json(started));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "sessions", "start", base.id, "--version", "1"]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/sessions/${base.id}/start`);
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    });

    it("completes a session, forwarding the body", async () => {
        const output = vi.fn();
        const completed = {
            ...response,
            status: "completed",
            version: 3,
            startedAt: "2026-08-02T10:00:00.000Z",
            endedAt: "2026-08-02T11:00:00.000Z",
        };
        const request = vi.fn(async () => Response.json(completed));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "sessions",
            "complete",
            base.id,
            "--version",
            "2",
            "--input",
            JSON.stringify({ durationMinutes: 60 }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/sessions/${base.id}/complete`);
        expect(JSON.parse(String(init?.body))).toEqual({ durationMinutes: 60 });
    });
});
