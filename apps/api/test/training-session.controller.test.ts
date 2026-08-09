import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type {
    TrainingSessionCommands,
    TrainingSessionRepository,
    TrainingSessionResource,
    TrainingSessionSummary,
} from "#src/modules/training/application/index";
import { TrainingSessionNotFoundError } from "#src/modules/training/application/index";
import { TrainingSessionController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    session: "0198a4db-d8da-7000-8000-000000007001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    activity: "0198a4db-d8da-7000-8000-0000000070a1",
};

function resource(overrides: Partial<TrainingSessionResource> = {}): TrainingSessionResource {
    return {
        id: ids.session,
        profileId: ids.profile,
        status: "draft",
        title: null,
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
        activities: [],
        painRecords: [],
        plannedLinks: [],
        activityMappings: [],
        occurrenceMappings: [],
        setMappings: [],
        runStepMappings: [],
        archivedAt: null,
        version: 1,
        createdAt: "2026-08-02T09:00:00.000Z",
        updatedAt: "2026-08-02T09:00:00.000Z",
        ...overrides,
    };
}

function runningActivity(): TrainingSessionResource["activities"][number] {
    return {
        id: ids.activity,
        type: "running",
        position: 0,
        startedAt: null,
        endedAt: null,
        durationSeconds: null,
        rpe: null,
        feeling: null,
        notes: null,
        tags: [],
        strength: null,
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
    };
}

function summary(overrides: Partial<TrainingSessionSummary> = {}): TrainingSessionSummary {
    const {
        activities,
        painRecords,
        plannedLinks,
        activityMappings,
        occurrenceMappings,
        setMappings,
        runStepMappings,
        ...core
    } = resource();
    void activities;
    void painRecords;
    void plannedLinks;
    void activityMappings;
    void occurrenceMappings;
    void setMappings;
    void runStepMappings;
    return {
        ...core,
        activityCount: 2,
        painRecordCount: 1,
        programId: null,
        programName: null,
        activityKinds: ["strength"],
        totalSetCount: 0,
        ...overrides,
    };
}

function repository(overrides: Partial<TrainingSessionRepository> = {}): TrainingSessionRepository {
    return {
        listSessions: async () => ({ items: [summary()], nextCursor: null }),
        readSession: async () => resource(),
        readSessionDetail: async () => ({ ...resource(), plannedLinks: [] }),
        loadForUpdate: async () => null,
        create: async () => undefined,
        save: async () => undefined,
        ...overrides,
    } as unknown as TrainingSessionRepository;
}

function controller(overrides: {
    commands?: Partial<TrainingSessionCommands>;
    repository?: TrainingSessionRepository;
}): TrainingSessionController {
    return new TrainingSessionController(
        (overrides.commands ?? {}) as TrainingSessionCommands,
        overrides.repository ?? repository(),
    );
}

describe("TrainingSessionController", () => {
    it("lists session summaries with counts and no nested trees", async () => {
        const result = await controller({}).list({});
        expect(result.items[0]).toMatchObject({ id: ids.session, activityCount: 2, painRecordCount: 1 });
        expect(result.items[0]).not.toHaveProperty("activities");
        expect(result.nextCursor).toBeNull();
    });

    it("passes validated pagination and filter params through to the repository", async () => {
        const listSessions = vi.fn(async () => ({ items: [summary()], nextCursor: "next-token" }));
        const result = await controller({
            repository: repository({ listSessions } as Partial<TrainingSessionRepository>),
        }).list({ limit: "10", status: "completed", search: "squat", includeArchived: "true", cursor: "abc" });
        expect(listSessions).toHaveBeenCalledWith({
            limit: 10,
            status: "completed",
            search: "squat",
            includeArchived: true,
            cursor: "abc",
        });
        expect(result.nextCursor).toBe("next-token");
    });

    it("rejects an out-of-range limit with the validation envelope", async () => {
        try {
            await controller({}).list({ limit: "500" });
            throw new Error("expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(HttpException);
            expect((error as HttpException).getResponse()).toMatchObject({ code: "VALIDATION_FAILED" });
        }
    });

    it("gets a session with its trees and ETag", async () => {
        const response = { setHeader: vi.fn() };
        const result = await controller({}).get(ids.session, response);
        expect(result).toMatchObject({ id: ids.session, activities: [], painRecords: [] });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("surfaces a missing session on get", async () => {
        await expect(
            controller({ repository: repository({ readSessionDetail: async () => null }) }).get(ids.session, {
                setHeader: vi.fn(),
            }),
        ).rejects.toBeInstanceOf(TrainingSessionNotFoundError);
    });

    it("creates a session, returning its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const result = await controller({ commands: { create } }).create({}, "request-1", undefined, response);
        expect(result).toMatchObject({ id: ids.session, version: 1 });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("starts from a planned session through the command", async () => {
        const startPlanned = vi.fn(async () =>
            resource({
                status: "in_progress",
                version: 1,
                plannedLinks: [
                    {
                        plannedSessionId: ids.profile,
                        sourcePrescriptionId: ids.session,
                        resolvedPrescriptionId: ids.session,
                    },
                ],
            }),
        );
        const response = { setHeader: vi.fn() };
        const result = await controller({ commands: { startPlanned } as never }).startPlanned(
            { plannedSessionId: ids.profile },
            "r",
            undefined,
            response,
        );
        expect(result.plannedLinks).toHaveLength(1);
        expect(startPlanned).toHaveBeenCalledWith({ plannedSessionId: ids.profile }, expect.any(Object), undefined);
    });

    it("records mappings through the command with the If-Match version", async () => {
        const recordMappings = vi.fn(async () => resource({ version: 2 }));
        const result = await controller({ commands: { recordMappings } as never }).recordMappings(
            ids.session,
            { setMappings: [{ id: ids.activity, performedSetId: ids.activity, relation: "added" }] },
            '"1"',
            "r",
            undefined,
            { setHeader: vi.fn() },
        );
        expect(result).toMatchObject({ version: 2 });
        expect(recordMappings).toHaveBeenCalledWith(
            ids.session,
            1,
            { setMappings: [{ id: ids.activity, performedSetId: ids.activity, relation: "added" }] },
            expect.any(Object),
            undefined,
        );
    });

    it("starts through the command with the If-Match version", async () => {
        const start = vi.fn(async () =>
            resource({ status: "in_progress", version: 2, startedAt: "2026-08-02T10:00:00.000Z" }),
        );
        const response = { setHeader: vi.fn() };
        const result = await controller({ commands: { start } }).start(
            ids.session,
            {},
            '"1"',
            "r",
            undefined,
            response,
        );
        expect(result).toMatchObject({ status: "in_progress", version: 2 });
        expect(start).toHaveBeenCalledWith(ids.session, 1, expect.any(Object), undefined);
    });

    it("completes through the command, forwarding the body", async () => {
        const complete = vi.fn(async () =>
            resource({
                status: "completed",
                version: 3,
                startedAt: "2026-08-02T10:00:00.000Z",
                endedAt: "2026-08-02T11:00:00.000Z",
            }),
        );
        const result = await controller({ commands: { complete } }).complete(
            ids.session,
            { durationMinutes: 60 },
            '"2"',
            "r",
            undefined,
            { setHeader: vi.fn() },
        );
        expect(result).toMatchObject({ status: "completed", version: 3 });
        expect(complete).toHaveBeenCalledWith(ids.session, 2, { durationMinutes: 60 }, expect.any(Object), undefined);
    });

    it("archives and restores through their commands", async () => {
        const archive = vi.fn(async () => resource({ archivedAt: "2026-08-02T12:00:00.000Z", version: 2 }));
        const restore = vi.fn(async () => resource({ version: 3 }));
        await controller({ commands: { archive } }).archive(ids.session, '"1"', "r", undefined, { setHeader: vi.fn() });
        await controller({ commands: { restore } }).restore(ids.session, '"2"', "r", undefined, { setHeader: vi.fn() });
        expect(archive).toHaveBeenCalledWith(ids.session, 1, expect.any(Object), undefined);
        expect(restore).toHaveBeenCalledWith(ids.session, 2, expect.any(Object), undefined);
    });

    it("threads the x-kinetix-source and x-kinetix-reason headers into the command metadata", async () => {
        const archive = vi.fn(async () => resource({ archivedAt: "2026-08-02T12:00:00.000Z", version: 2 }));
        await controller({ commands: { archive } }).archive(
            ids.session,
            '"1"',
            "r",
            undefined,
            { setHeader: vi.fn() },
            "agent",
            "nightly cleanup",
        );
        expect(archive).toHaveBeenCalledWith(
            ids.session,
            1,
            expect.objectContaining({ source: "agent", reason: "nightly cleanup" }),
            undefined,
        );
    });

    it("falls back to the user source when the provenance header is absent or unrecognised", async () => {
        const reopen = vi.fn(async () => resource({ status: "in_progress", version: 2 }));
        await controller({ commands: { reopen } }).reopen(
            ids.session,
            '"1"',
            "r",
            undefined,
            { setHeader: vi.fn() },
            "spoofed-channel",
            undefined,
        );
        expect(reopen).toHaveBeenCalledWith(ids.session, 1, expect.objectContaining({ source: "user" }), undefined);
    });

    it("requires If-Match on update", () => {
        expect(() =>
            controller({}).update(ids.session, { notes: "x" }, undefined, "r", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
    });

    it("rejects an unknown field in the create body", () => {
        expect(() =>
            controller({}).create({ startedAt: "2026-08-02T10:00:00.000Z" }, "r", undefined, { setHeader: vi.fn() }),
        ).toThrow(expect.objectContaining({ status: 422 }));
    });

    it("rejects a bad readiness value in the update body", () => {
        expect(() =>
            controller({}).update(ids.session, { readiness: { energy: 9 } }, '"1"', "r", undefined, {
                setHeader: vi.fn(),
            }),
        ).toThrow(expect.objectContaining({ status: 422 }));
    });

    it("starts empty and start-from-template through the commands", async () => {
        const startEmpty = vi.fn(async () => resource({ status: "in_progress", version: 1 }));
        const startFromTemplate = vi.fn(async () => resource({ status: "in_progress", version: 1 }));
        await controller({ commands: { startEmpty } as never }).startEmpty({}, "r", undefined, { setHeader: vi.fn() });
        await controller({ commands: { startFromTemplate } as never }).startTemplate(
            { templateId: ids.session },
            "r",
            undefined,
            { setHeader: vi.fn() },
        );
        expect(startEmpty).toHaveBeenCalled();
        expect(startFromTemplate).toHaveBeenCalledWith({ templateId: ids.session }, expect.any(Object), undefined);
    });

    it("returns the active view with its ETag", async () => {
        const readActiveView = vi.fn(async () => ({ ...resource({ version: 4 }), plans: [] }));
        const response = { setHeader: vi.fn() };
        const result = await controller({ commands: { readActiveView } as never }).active(ids.session, response);
        expect(result).toMatchObject({ id: ids.session, plans: [] });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"4"');
    });

    it("surfaces a missing session on the active view", async () => {
        const readActiveView = vi.fn(async () => null);
        await expect(
            controller({ commands: { readActiveView } as never }).active(ids.session, { setHeader: vi.fn() }),
        ).rejects.toBeInstanceOf(TrainingSessionNotFoundError);
    });

    it("returns a completion preview", async () => {
        const previewCompletion = vi.fn(async () => ({
            issues: [
                {
                    code: "empty_activity",
                    severity: "warning" as const,
                    message: "No sets",
                    activityId: ids.activity,
                    occurrenceId: null,
                },
            ],
            plannedOutcomes: [],
        }));
        const result = await controller({ commands: { previewCompletion } as never }).completionPreview(ids.session);
        expect(result.issues[0]).toMatchObject({ code: "empty_activity", severity: "warning" });
    });

    it("records a set through the command with the If-Match version", async () => {
        const recordPerformedSet = vi.fn(async () => resource({ version: 5 }));
        const result = await controller({ commands: { recordPerformedSet } as never }).recordSet(
            ids.session,
            {
                activityId: ids.activity,
                occurrenceId: ids.activity,
                set: { id: ids.activity, position: 0, setType: "working", status: "completed" },
            },
            '"4"',
            "r",
            undefined,
            { setHeader: vi.fn() },
        );
        expect(result).toMatchObject({ version: 5 });
        expect(recordPerformedSet).toHaveBeenCalledWith(
            ids.session,
            4,
            expect.any(Object),
            expect.any(Object),
            undefined,
        );
    });

    it("patches a set through the command with the set ID and If-Match version", async () => {
        const updatePerformedSet = vi.fn(async () => resource({ version: 6 }));
        await controller({ commands: { updatePerformedSet } as never }).updateSet(
            ids.session,
            ids.activity,
            { status: "skipped" },
            '"5"',
            "r",
            undefined,
            { setHeader: vi.fn() },
        );
        expect(updatePerformedSet).toHaveBeenCalledWith(
            ids.session,
            5,
            ids.activity,
            { status: "skipped" },
            expect.any(Object),
            undefined,
        );
    });

    it("gets a session, deriving the running pace as a query-only projection", async () => {
        const withRun = repository({
            readSessionDetail: async () => ({ ...resource({ activities: [runningActivity()] }), plannedLinks: [] }),
        });
        const result = await controller({ repository: withRun }).get(ids.session, { setHeader: vi.fn() });
        const running = result.activities[0]!.running!;
        expect(running.derivedPace.secondsPerKilometre).toBe(300);
        expect(running.derivedPace.exclusions).toEqual([]);
    });

    it("upserts a running summary through the command with the If-Match version", async () => {
        const setRunning = vi.fn(async () => resource({ version: 7, activities: [runningActivity()] }));
        const result = await controller({ commands: { setRunning } as never }).setRunning(
            ids.session,
            { activityId: ids.activity, running: { distance: { value: 5, unit: "km" } } },
            '"6"',
            "r",
            undefined,
            { setHeader: vi.fn() },
        );
        expect(result).toMatchObject({ version: 7 });
        expect(setRunning).toHaveBeenCalledWith(ids.session, 6, expect.any(Object), expect.any(Object), undefined);
    });

    it("returns the running summary with its derived pace", async () => {
        const readRunningSummary = vi.fn(async () => ({
            activityId: ids.activity,
            running: runningActivity().running!,
        }));
        const result = await controller({ commands: { readRunningSummary } as never }).runningSummary(
            ids.session,
            ids.activity,
        );
        expect(result.activityId).toBe(ids.activity);
        expect(result.running.derivedPace.secondsPerKilometre).toBe(300);
    });

    it("surfaces a missing running summary as not found", async () => {
        const readRunningSummary = vi.fn(async () => null);
        await expect(
            controller({ commands: { readRunningSummary } as never }).runningSummary(ids.session, ids.activity),
        ).rejects.toBeInstanceOf(TrainingSessionNotFoundError);
    });

    it("requires If-Match on record-set", () => {
        expect(() =>
            controller({}).recordSet(
                ids.session,
                {
                    activityId: ids.activity,
                    occurrenceId: ids.activity,
                    set: { id: ids.activity, position: 0, setType: "working", status: "completed" },
                },
                undefined,
                "r",
                undefined,
                { setHeader: vi.fn() },
            ),
        ).toThrow(ExpectedVersionRequiredError);
    });
});
