import { describe, expect, it, vi } from "vitest";

import {
    RunActivityNotFoundError,
    type RunListItem,
    type RunView,
    type RunningActivityService,
} from "#src/modules/training/application/index";
import { RunController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    session: "0198a4db-d8da-7000-8000-000000007001",
    activity: "0198a4db-d8da-7000-8000-0000000070a1",
};

function runView(overrides: Partial<RunView> = {}): RunView {
    return {
        sessionId: ids.session,
        version: 3,
        activityId: ids.activity,
        localDate: "2026-08-07",
        timeZone: "Europe/Sofia",
        status: "completed",
        title: "Tempo run",
        archivedAt: null,
        durationSeconds: 1_500,
        rpe: 7,
        feeling: null,
        notes: null,
        tags: ["Long run"],
        running: {
            distance: { value: 5, unit: "km" },
            movingTime: { value: 25, unit: "min" },
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
            runTags: [],
            environment: null,
            steps: [],
            splits: [],
            zoneTimes: [],
            route: null,
            gearItemId: null,
        },
        activityMapping: null,
        runStepMappings: [],
        plannedLinks: [],
        ...overrides,
    };
}

function listItem(overrides: Partial<RunListItem> = {}): RunListItem {
    return {
        sessionId: ids.session,
        activityId: ids.activity,
        version: 3,
        localDate: "2026-08-07",
        status: "completed",
        title: "Tempo run",
        archivedAt: null,
        distanceMetres: "5000.000",
        movingTimeMs: "1500000",
        runTags: ["tempo"],
        ...overrides,
    };
}

function controller(service: Partial<RunningActivityService>): RunController {
    return new RunController(service as RunningActivityService);
}

describe("RunController", () => {
    it("logs a run through the facade, attaching derived pace and an ETag", async () => {
        const addRun = vi.fn(async () => runView());
        const response = { setHeader: vi.fn() };
        const body = await controller({ addRun }).add(
            { running: { distance: { value: 5, unit: "km" }, movingTime: { value: 25, unit: "min" } } },
            "corr",
            undefined,
            response,
        );
        expect(addRun).toHaveBeenCalledOnce();
        expect(body.running.derivedPace.secondsPerKilometre).toBe(300);
        expect(body.version).toBe(3);
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"3"');
    });

    it("lists runs with a bounded projection and derived pace", async () => {
        const listRuns = vi.fn(async () => [listItem()]);
        const result = await controller({ listRuns }).list("true");
        expect(listRuns).toHaveBeenCalledWith({ includeArchived: true });
        expect(result.items[0]).toMatchObject({
            sessionId: ids.session,
            distanceMetres: "5000.000",
            derivedPaceSecondsPerKm: 300,
        });
    });

    it("shows a run and surfaces a missing one as 404", async () => {
        const shown = await controller({ showRun: async () => runView() }).show(ids.session);
        expect(shown.activityId).toBe(ids.activity);
        await expect(controller({ showRun: async () => null }).show(ids.session)).rejects.toBeInstanceOf(
            RunActivityNotFoundError,
        );
    });

    it("updates a run through the facade with the If-Match version", async () => {
        const updateRun = vi.fn(async () => runView({ version: 7 }));
        const response = { setHeader: vi.fn() };
        const body = await controller({ updateRun }).update(
            ids.session,
            ids.activity,
            { running: { distance: { value: 8, unit: "km" } } },
            '"3"',
            "corr",
            undefined,
            response,
        );
        expect(updateRun).toHaveBeenCalledWith(
            ids.session,
            ids.activity,
            3,
            expect.objectContaining({ running: expect.any(Object) }),
            expect.any(Object),
            undefined,
        );
        expect(body.version).toBe(7);
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"7"');
    });

    it("requires If-Match on update", () => {
        expect(() =>
            controller({ updateRun: vi.fn() }).update(
                ids.session,
                ids.activity,
                { running: {} },
                undefined,
                "corr",
                undefined,
                { setHeader: vi.fn() },
            ),
        ).toThrow(ExpectedVersionRequiredError);
    });

    it("rejects an unknown field in the add body", () => {
        expect(() =>
            controller({ addRun: vi.fn() }).add({ running: {}, bogus: true }, "corr", undefined, {
                setHeader: vi.fn(),
            }),
        ).toThrow(/validation/i);
    });
});
