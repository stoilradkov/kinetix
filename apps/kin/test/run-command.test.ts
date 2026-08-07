import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const ids = {
    session: "0198a4db-d8da-7000-8000-000000007001",
    activity: "0198a4db-d8da-7000-8000-0000000070a1",
    step: "0198a4db-d8da-7000-8000-0000000070b1",
    mapping: "0198a4db-d8da-7000-8000-0000000070c1",
};

const running = {
    distance: { value: 10, unit: "km" },
    movingTime: { value: 45, unit: "min" },
    elapsedTime: null,
    averageHeartRate: null,
    maxHeartRate: null,
    averageCadence: null,
    maxCadence: null,
    averagePower: null,
    maxPower: null,
    elevationGain: null,
    elevationLoss: null,
    calories: null,
    strideLength: null,
    groundContactTime: null,
    verticalOscillation: null,
    vo2Max: null,
    rpe: null,
    indoor: false,
    treadmill: false,
    runTags: ["tempo"],
    environment: null,
    steps: [],
    splits: [],
    zoneTimes: [],
    route: null,
    gearItemId: null,
    derivedPace: {
        source: "distance_and_moving_time",
        speedMetresPerSecond: "3.704",
        secondsPerKilometre: 270,
        secondsPerMile: 434.5,
        exclusions: [],
    },
};

const runView = {
    sessionId: ids.session,
    version: 3,
    activityId: ids.activity,
    localDate: "2026-08-07",
    timeZone: "Europe/Sofia",
    status: "completed",
    title: "Tempo run",
    archivedAt: null,
    durationSeconds: 2_700,
    rpe: 7,
    feeling: null,
    notes: null,
    tags: ["Long run"],
    running,
    activityMapping: null,
    runStepMappings: [],
    plannedLinks: [],
};

const listResponse = {
    items: [
        {
            sessionId: ids.session,
            activityId: ids.activity,
            version: 3,
            localDate: "2026-08-07",
            status: "completed",
            title: "Tempo run",
            archivedAt: null,
            distanceMetres: "10000.000",
            movingTimeMs: "2700000",
            derivedPaceSecondsPerKm: 270,
            runTags: ["tempo"],
        },
    ],
};

describe("kin run", () => {
    it("logs a run with POST /training/runs and renders its derived pace", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(runView));
        const program = createProgram({ fetch: request, output });
        const body = { title: "Tempo run", running: { distance: { value: 10, unit: "km" } } };

        await program.parseAsync([
            "node",
            "kin",
            "run",
            "add",
            "--input",
            JSON.stringify(body),
            "--idempotency-key",
            "k1",
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain("/training/runs");
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("idempotency-key")).toBe("k1");
        expect(JSON.parse(String(init?.body))).toEqual(body);
        expect(output).toHaveBeenCalledWith(expect.stringContaining("pace=4:30/km"));
    });

    it("reads the add body from a file (--file <path>)", async () => {
        const request = vi.fn(async () => Response.json(runView));
        const program = createProgram({ fetch: request, output: vi.fn() });
        const body = { running: { distance: { value: 10, unit: "km" } } };
        const file = join(mkdtempSync(join(tmpdir(), "kin-run-")), "run.json");
        writeFileSync(file, JSON.stringify(body));

        await program.parseAsync(["node", "kin", "run", "add", "--file", file]);

        expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual(body);
    });

    it("updates a run with PUT, forwarding the If-Match version, a run-step mapping, and provenance", async () => {
        const request = vi.fn(async () => Response.json(runView));
        const program = createProgram({ fetch: request, output: vi.fn() });
        const body = {
            running: { distance: { value: 8, unit: "km" } },
            mappings: { runStepMappings: [{ id: ids.mapping, performedRunStepId: ids.step, relation: "added" }] },
        };

        await program.parseAsync([
            "node",
            "kin",
            "run",
            "update",
            ids.session,
            ids.activity,
            "--version",
            "3",
            "--input",
            JSON.stringify(body),
            "--source",
            "agent",
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/runs/${ids.session}/${ids.activity}`);
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("if-match")).toBe('"3"');
        expect(new Headers(init?.headers).get("x-kinetix-source")).toBe("agent");
        expect(JSON.parse(String(init?.body))).toEqual(body);
    });

    it("shows a run by session id", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(runView));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "run", "show", ids.session]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/runs/${ids.session}`);
        expect(init?.method ?? "GET").toBe("GET");
        expect(output).toHaveBeenCalledWith(expect.stringContaining(ids.activity));
    });

    it("shows a specific run activity when an activity id is given", async () => {
        const request = vi.fn(async () => Response.json(runView));
        const program = createProgram({ fetch: request, output: vi.fn() });

        await program.parseAsync(["node", "kin", "run", "show", ids.session, ids.activity]);

        expect(request.mock.calls[0]![0]).toContain(`/training/runs/${ids.session}/${ids.activity}`);
    });

    it("lists runs with distance and derived pace", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(listResponse));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "run", "list", "--include-archived"]);

        expect(request.mock.calls[0]![0]).toContain("/training/runs?includeArchived=true");
        expect(output).toHaveBeenCalledWith(expect.stringContaining("distance=10.00km"));
        expect(output).toHaveBeenCalledWith(expect.stringContaining("pace=4:30/km"));
    });
});
