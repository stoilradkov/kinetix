import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const ids = {
    session: "0198a4db-d8da-7000-8000-000000007001",
    activity: "0198a4db-d8da-7000-8000-0000000070a1",
};

const running = {
    distance: { value: 5, unit: "km" },
    movingTime: { value: 25, unit: "min" },
    elapsedTime: null,
    averageHeartRate: 150,
    maxHeartRate: null,
    averageCadence: null,
    maxCadence: null,
    averagePower: null,
    maxPower: null,
    elevationGain: null,
    elevationLoss: null,
    calories: 0,
    strideLength: null,
    groundContactTime: null,
    verticalOscillation: null,
    vo2Max: null,
    rpe: null,
    indoor: false,
    treadmill: false,
    runTags: ["easy"],
    environment: null,
    steps: [
        {
            id: "0198a4db-d8da-7000-8000-0000000070b1",
            parentStepId: null,
            type: "work",
            position: 0,
            repeatCount: null,
            measurements: {
                distance: null,
                duration: null,
                averageHeartRate: null,
                maxHeartRate: null,
                averageCadence: null,
                maxCadence: null,
                averagePower: null,
                maxPower: null,
                elevationGain: null,
                elevationLoss: null,
                rpe: null,
            },
            notes: null,
        },
    ],
    splits: [],
    zoneTimes: [],
    route: null,
    gearItemId: null,
    derivedPace: {
        source: "distance_and_moving_time",
        speedMetresPerSecond: "3.333333333333",
        secondsPerKilometre: 300,
        secondsPerMile: 482.8032,
        exclusions: [],
    },
};

const sessionResponse = {
    id: ids.session,
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    status: "in_progress",
    title: "Long run",
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
    version: 3,
    archivedAt: null,
    createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
    activities: [],
    painRecords: [],
    plannedLinks: [],
    activityMappings: [],
    occurrenceMappings: [],
    setMappings: [],
    runStepMappings: [],
};

const summaryResponse = { activityId: ids.activity, running };

describe("kin training runs", () => {
    it("upserts a running summary with a PUT, forwarding the If-Match version and body", async () => {
        const request = vi.fn(async () => Response.json(sessionResponse));
        const program = createProgram({ fetch: request, output: vi.fn() });
        const body = { activityId: ids.activity, running: { distance: { value: 5, unit: "km" } } };

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "runs",
            "set",
            ids.session,
            "--version",
            "2",
            "--input",
            JSON.stringify(body),
        ]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/sessions/${ids.session}/running`);
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("if-match")).toBe('"2"');
        expect(JSON.parse(String(init?.body))).toEqual(body);
    });

    it("shows a running summary and renders its derived pace", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(summaryResponse));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "runs", "show", ids.session, ids.activity]);

        const [url, init] = request.mock.calls[0]!;
        expect(url).toContain(`/training/sessions/${ids.session}/running/${ids.activity}`);
        expect(init?.method ?? "GET").toBe("GET");
        expect(output).toHaveBeenCalledWith(expect.stringContaining("pace=5:00/km"));
        expect(output).toHaveBeenCalledWith(expect.stringContaining("steps=1"));
    });
});
