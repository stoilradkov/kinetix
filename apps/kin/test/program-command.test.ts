import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const base = {
    id: "0198a4db-d8da-7000-8000-000000005001",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    name: "Off-season",
    description: null,
    status: "draft",
    scheduleMode: "ordered",
    startDate: null,
    endDate: null,
    focus: null,
    version: 1,
    archivedAt: null,
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
};

const summary = { ...base, blockCount: 2, sessionCount: 0 };
const response = { ...base, blocks: [], goalIds: [], warnings: [] };

describe("kin training programs", () => {
    it("lists programs, including archived when requested", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [summary] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "programs", "list", "--include-archived"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/programs?includeArchived=true");
        expect(output).toHaveBeenCalledWith(`${summary.id}\t1\tdraft\tordered\t2\t0\tOff-season`);
    });

    it("creates a program from inline JSON", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(response));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "programs",
            "create",
            "--input",
            JSON.stringify({ name: "Off-season" }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain("/training/programs");
        expect(init?.method).toBe("POST");
        expect(output).toHaveBeenCalledWith(`${response.id}\t1\tdraft\tordered\t0\t0\tOff-season`);
    });

    it("activates a program with If-Match and echoes generated sessions", async () => {
        const output = vi.fn();
        const activated = {
            ...response,
            status: "active",
            version: 2,
            generatedSessions: [
                {
                    id: "0198a4db-d8da-7000-8000-000000006001",
                    profileId: base.profileId,
                    title: "Upper A",
                    status: "planned",
                    localDate: "2026-08-01",
                    timeZone: null,
                    preferredTime: null,
                    expectedDurationMinutes: null,
                    notes: null,
                    tags: [],
                    skipReason: null,
                    skipNotes: null,
                    currentPrescriptionId: "0198a4db-d8da-7000-8000-0000000060a1",
                    sourceTemplateId: "0198a4db-d8da-7000-8000-0000000060c3",
                    sourceTemplateVersion: 1,
                    version: 1,
                    archivedAt: null,
                    createdAt: base.createdAt,
                    updatedAt: base.updatedAt,
                    prescription: {
                        id: "0198a4db-d8da-7000-8000-0000000060a1",
                        kind: "planned",
                        schemaVersion: 1,
                        expectedDurationMs: null,
                        notes: null,
                        sourcePrescriptionId: "0198a4db-d8da-7000-8000-0000000060aa",
                        sourceKind: "template",
                        activities: [],
                        createdAt: base.createdAt,
                    },
                },
            ],
        };
        const request = vi.fn(async () => Response.json(activated));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "programs",
            "activate",
            base.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ sessions: [{ templateId: "0198a4db-d8da-7000-8000-0000000060c3", sequence: 0 }] }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/programs/${base.id}/activate`);
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect(output).toHaveBeenCalledWith(`${base.id}\t2\tactive\tordered\t0\t0\tOff-season`);
        expect(output).toHaveBeenCalledWith(`0198a4db-d8da-7000-8000-000000006001\t1\tplanned\t2026-08-01\tUpper A`);
    });

    it("changes a program's start date and prints the moved sessions", async () => {
        const output = vi.fn();
        const changed = {
            ...response,
            startDate: "2026-08-08",
            version: 2,
            movedSessions: [
                { id: "0198a4db-d8da-7000-8000-000000006001", fromDate: "2026-08-05", toDate: "2026-08-12" },
            ],
        };
        const request = vi.fn(async () => Response.json(changed));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "programs",
            "change-start-date",
            base.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ startDate: "2026-08-08" }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/programs/${base.id}/change-start-date`);
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect(output).toHaveBeenCalledWith("moved\t0198a4db-d8da-7000-8000-000000006001\t2026-08-05\t→\t2026-08-12");
    });

    it("pauses a program through the lifecycle endpoint", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...response, status: "paused", version: 3 }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "programs", "pause", base.id, "--version", "2"]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/programs/${base.id}/pause`);
        expect((init?.headers as Headers).get("if-match")).toBe('"2"');
        expect(output).toHaveBeenCalledWith(`${base.id}\t3\tpaused\tordered\t0\t0\tOff-season`);
    });
});

describe("kin training planned-sessions", () => {
    const session = {
        id: "0198a4db-d8da-7000-8000-000000006001",
        profileId: base.profileId,
        title: "Upper A",
        status: "planned",
        localDate: "2026-08-01",
        timeZone: null,
        preferredTime: null,
        expectedDurationMinutes: null,
        notes: null,
        tags: [],
        skipReason: null,
        skipNotes: null,
        currentPrescriptionId: "0198a4db-d8da-7000-8000-0000000060a1",
        sourceTemplateId: null,
        sourceTemplateVersion: null,
        version: 1,
        archivedAt: null,
        createdAt: base.createdAt,
        updatedAt: base.updatedAt,
    };

    it("lists planned sessions", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [session] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "planned-sessions", "list"]);

        expect(request.mock.calls[0]?.[0]).toContain("/training/planned-sessions");
        expect(output).toHaveBeenCalledWith(`${session.id}\t1\tplanned\t2026-08-01\tUpper A`);
    });

    it("reschedules a planned session to a new date", async () => {
        const output = vi.fn();
        const request = vi.fn(async () =>
            Response.json({ ...session, localDate: "2026-08-08", version: 2, prescription: prescription() }),
        );
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "planned-sessions",
            "reschedule",
            session.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ localDate: "2026-08-08" }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/planned-sessions/${session.id}/reschedule`);
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect(output).toHaveBeenCalledWith(`${session.id}\t2\tplanned\t2026-08-08\tUpper A`);
    });

    it("skips a planned session with a structured reason", async () => {
        const output = vi.fn();
        const request = vi.fn(async () =>
            Response.json({
                ...session,
                status: "skipped",
                skipReason: "illness",
                version: 2,
                prescription: prescription(),
            }),
        );
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "planned-sessions",
            "skip",
            session.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ reason: "illness" }),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/planned-sessions/${session.id}/skip`);
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
        expect(output).toHaveBeenCalledWith(`${session.id}\t2\tskipped\t2026-08-01\tUpper A`);
    });
});

function prescription() {
    return {
        id: "0198a4db-d8da-7000-8000-0000000060a1",
        kind: "planned",
        schemaVersion: 1,
        expectedDurationMs: null,
        notes: null,
        sourcePrescriptionId: null,
        sourceKind: null,
        activities: [],
        createdAt: "2026-07-29T12:00:00.000Z",
    };
}
