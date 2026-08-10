import { describe, expect, it } from "vitest";

import {
    ProjectRunningMetrics,
    ProjectRunningRecords,
    RUNNING_PROJECTION_JOB,
    RUNNING_RECORDS_PROJECTION_JOB,
    RunningMetricsOutboxHandler,
    RunningMetricsProjectionJobHandler,
    RunningRecordsOutboxHandler,
    RunningRecordsProjectionJobHandler,
    runningMetricCatalogMetadata,
    runningRecordCatalogMetadata,
    type DerivedMetricRecord,
    type DerivedMetricRepository,
    type DerivedMetricView,
    type FindingQuery,
    type FindingRecord,
    type FindingRepository,
    type FindingView,
    type MetricQuery,
    type RunningMetricReader,
    type RunningRecordsReader,
} from "#src/modules/training/application/index";
import {
    EMPTY_RUNNING_ACTIVITY,
    RECORD_RUNNING_LONGEST_DISTANCE,
    RUNNING_DISTANCE,
    RUNNING_WINDOW_FREQUENCY,
    findingNaturalKeyDescriptor,
    type RunningActivityFacts,
    type RunningActivityState,
    type RunningMetricConfig,
    type RunningRecordsConfig,
    type RunningSessionFacts,
    type RunningWindowSessionFacts,
    type RunRecordInput,
} from "#src/modules/training/domain/index";
import {
    type ClaimedOutboxEvent,
    type CommandContext,
    type EnqueueJob,
    type JobQueue,
    type OutboxHandlerContext,
    type UnitOfWork,
} from "#src/platform/application/index";
import { hashRequest } from "#src/platform/application/request-hash";

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;
const transaction = {};
const ctx: CommandContext = { correlationId: "corr-1", source: "system" };
const unitOfWork: UnitOfWork = { execute: work => work(transaction) };

const PROFILE = id(600);
const SESSION = id(500);
const ACT = id(1);

function activity(running: Partial<RunningActivityState>): RunningActivityFacts {
    return {
        activityId: ACT,
        running: { ...EMPTY_RUNNING_ACTIVITY, ...running },
        activityRpe: null,
        durationSeconds: null,
        zoneNumbers: {},
    };
}

function sessionFacts(activities: RunningActivityFacts[]): RunningSessionFacts {
    return { sessionId: SESSION, profileId: PROFILE, sessionVersion: 2, localDate: "2026-08-01", activities };
}

// --- derived-metric projection fakes --------------------------------------------------------------

interface StoredMetric extends DerivedMetricView {
    readonly naturalKey: string;
}

class FakeMetricRepository implements DerivedMetricRepository {
    readonly rows: StoredMetric[] = [];

    async currentByNaturalKey(naturalKey: string): Promise<DerivedMetricView | null> {
        return this.rows.find(row => row.naturalKey === naturalKey && row.state === "current") ?? null;
    }

    async supersedeAndInsert(
        naturalKey: string,
        record: DerivedMetricRecord | null,
    ): Promise<DerivedMetricView | null> {
        for (const row of this.rows)
            if (row.naturalKey === naturalKey && row.state === "current")
                Object.assign(row, { state: "superseded", supersededAt: new Date(), stale: false });
        if (record === null) return null;
        const view: StoredMetric = { ...toMetricView(record), naturalKey };
        this.rows.push(view);
        return view;
    }

    async clearStale(naturalKey: string): Promise<void> {
        for (const row of this.rows)
            if (row.naturalKey === naturalKey && row.state === "current") Object.assign(row, { stale: false });
    }
    async markStale(): Promise<number> {
        return 0;
    }
    async findAffected(): Promise<readonly never[]> {
        return [];
    }
    async listCurrentTargets(): Promise<readonly never[]> {
        return [];
    }
    async query(query: MetricQuery): Promise<readonly DerivedMetricView[]> {
        return this.rows.filter(
            row =>
                row.state === "current" &&
                (query.scopeType === undefined || row.scope.type === query.scopeType) &&
                (query.scopeId === undefined || row.scope.id === query.scopeId) &&
                (query.calculatorKey === undefined || row.calculatorKey === query.calculatorKey),
        );
    }

    current(): StoredMetric[] {
        return this.rows.filter(row => row.state === "current");
    }
}

function toMetricView(record: DerivedMetricRecord): DerivedMetricView {
    return {
        id: record.id,
        profileId: record.profileId,
        calculatorKey: record.calculatorKey,
        calculatorVersion: record.calculatorVersion,
        scope: record.scope,
        period: record.period,
        dimensions: record.dimensions,
        numericValue: record.numericValue,
        textValue: record.textValue,
        unit: record.unit,
        details: record.details,
        sourceFingerprint: record.sourceFingerprint,
        state: "current",
        stale: false,
        calculatedAt: record.calculatedAt,
        supersededAt: null,
    };
}

class FakeMetricReader implements RunningMetricReader {
    sessionFacts: RunningSessionFacts | null;
    windowSessions: RunningWindowSessionFacts[] = [];
    config: RunningMetricConfig = { calculatorVersion: 1 };

    constructor(sessionFacts: RunningSessionFacts | null) {
        this.sessionFacts = sessionFacts;
    }
    async describeSession(): Promise<{ profileId: string; localDate: string } | null> {
        return { profileId: PROFILE, localDate: "2026-08-01" };
    }
    async loadSessionFacts(): Promise<RunningSessionFacts | null> {
        return this.sessionFacts;
    }
    async loadConfig(): Promise<RunningMetricConfig> {
        return this.config;
    }
    async sessionDatesInRange(_p: string, from: string, to: string): Promise<readonly string[]> {
        return [...new Set(this.windowSessions.map(s => s.localDate).filter(d => d >= from && d <= to))];
    }
    async loadWindowFacts(_p: string, from: string, to: string): Promise<readonly RunningWindowSessionFacts[]> {
        return this.windowSessions.filter(s => s.localDate >= from && s.localDate <= to);
    }
}

function projectMetrics(reader: RunningMetricReader, repository: DerivedMetricRepository): ProjectRunningMetrics {
    let counter = 0;
    return new ProjectRunningMetrics({
        unitOfWork,
        reader,
        repository,
        generateId: () => `metric-${(counter += 1)}`,
        clock: { now: () => new Date("2026-08-01T12:00:00Z") },
    });
}

function windowSession(localDate: string, activities: RunningActivityFacts[]): RunningWindowSessionFacts {
    return { sessionId: id(700 + Number(localDate.slice(-2))), sessionVersion: 1, localDate, activities };
}

describe("ProjectRunningMetrics", () => {
    it("projects session-scope running metrics for a completed running session", async () => {
        const reader = new FakeMetricReader(sessionFacts([activity({ distance: { value: 5, unit: "km" } })]));
        const repository = new FakeMetricRepository();
        const result = await projectMetrics(reader, repository).recalculateForSession(SESSION, ctx);
        expect(result.recomputed).toBeGreaterThan(0);
        const distance = repository.current().filter(row => row.calculatorKey === RUNNING_DISTANCE);
        expect(distance).toHaveLength(1);
        expect(distance[0]!.numericValue).toBe(5000);
        expect(distance[0]!.scope).toEqual({ type: "session", id: SESSION });
    });

    it("is idempotent: a replay with unchanged facts rewrites nothing", async () => {
        const reader = new FakeMetricReader(sessionFacts([activity({ distance: { value: 5, unit: "km" } })]));
        const repository = new FakeMetricRepository();
        const proj = projectMetrics(reader, repository);
        await proj.recalculateForSession(SESSION, ctx);
        const before = repository.current().length;
        const replay = await proj.recalculateForSession(SESSION, ctx);
        expect(replay.recomputed).toBe(0);
        expect(repository.current().length).toBe(before);
    });

    it("retires session metrics when the session leaves the completed set", async () => {
        const reader = new FakeMetricReader(sessionFacts([activity({ distance: { value: 5, unit: "km" } })]));
        const repository = new FakeMetricRepository();
        const proj = projectMetrics(reader, repository);
        await proj.recalculateForSession(SESSION, ctx);
        expect(repository.current().some(row => row.scope.type === "session")).toBe(true);
        reader.sessionFacts = null; // reopened / archived / non-running
        await proj.recalculateForSession(SESSION, ctx);
        expect(repository.current().some(row => row.scope.type === "session")).toBe(false);
    });

    it("projects rolling-window run frequency across the profile's window sessions", async () => {
        const reader = new FakeMetricReader(sessionFacts([activity({ distance: { value: 5, unit: "km" } })]));
        reader.windowSessions = [
            windowSession("2026-07-28", [activity({ distance: { value: 5, unit: "km" } })]),
            windowSession("2026-08-01", [activity({ distance: { value: 3, unit: "km" } })]),
        ];
        const repository = new FakeMetricRepository();
        await projectMetrics(reader, repository).recalculateForSession(SESSION, ctx);
        const frequency = repository
            .current()
            .filter(row => row.calculatorKey === RUNNING_WINDOW_FREQUENCY && row.scope.type === "profile-rolling-7");
        expect(frequency).toHaveLength(1);
        expect(frequency[0]!.numericValue).toBe(2);
    });
});

// --- findings projection fakes --------------------------------------------------------------------

class FakeFindingRepository implements FindingRepository {
    rows: FindingView[] = [];

    async currentByNaturalKey(naturalKey: string): Promise<FindingView | null> {
        return this.rows.find(row => row.state === "current" && naturalKeyOf(row) === naturalKey) ?? null;
    }
    async supersedeAndInsert(naturalKey: string, record: FindingRecord | null): Promise<FindingView | null> {
        for (const row of this.rows)
            if (row.state === "current" && naturalKeyOf(row) === naturalKey)
                this.rows[this.rows.indexOf(row)] = { ...row, state: "superseded", supersededAt: new Date() };
        if (record === null) return null;
        const view = toFindingView(record);
        this.rows.push(view);
        return view;
    }
    async query(query: FindingQuery): Promise<readonly FindingView[]> {
        return this.rows.filter(
            row =>
                (query.includeSuperseded ? true : row.state === "current") &&
                (query.scopeType === undefined || row.scope.type === query.scopeType) &&
                (query.scopeId === undefined || row.scope.id === query.scopeId) &&
                (query.findingKey === undefined || row.findingKey === query.findingKey),
        );
    }
    current(): FindingView[] {
        return this.rows.filter(row => row.state === "current");
    }
}

function naturalKeyOf(view: {
    findingKey: string;
    scope: FindingView["scope"];
    dimensions: FindingView["dimensions"];
}): string {
    return hashRequest(findingNaturalKeyDescriptor(view.findingKey, view.scope, view.dimensions));
}

function toFindingView(record: FindingRecord): FindingView {
    const evidence = record.evidence as Record<string, unknown>;
    return {
        id: record.id,
        profileId: record.profileId,
        findingKey: record.findingKey,
        findingVersion: record.findingVersion,
        scope: record.scope,
        dimensions: (evidence.dimensions ?? {}) as Record<string, string>,
        numericValue: (evidence.numericValue ?? null) as number | null,
        unit: (evidence.unit ?? null) as string | null,
        status: record.status,
        evidence: record.evidence,
        sourceFingerprint: record.sourceFingerprint,
        state: "current",
        reviewAt: record.reviewAt,
        expiresAt: record.expiresAt,
        calculatedAt: record.calculatedAt,
        supersededAt: null,
    };
}

class FakeRecordsReader implements RunningRecordsReader {
    runs: RunRecordInput[] = [];
    config: RunningRecordsConfig = { standardToleranceFraction: 0.02 };
    describe: { profileId: string } | null = { profileId: PROFILE };

    async describeSession(): Promise<{ profileId: string } | null> {
        return this.describe;
    }
    async loadConfig(): Promise<RunningRecordsConfig> {
        return this.config;
    }
    async loadRunHistory(): Promise<readonly RunRecordInput[]> {
        return this.runs;
    }
}

let recordSeq = 0;
function runInput(overrides: Partial<RunRecordInput>): RunRecordInput {
    recordSeq += 1;
    return {
        sessionId: id(1000 + recordSeq),
        sessionVersion: 1,
        localDate: "2026-08-01",
        activityId: id(2000 + recordSeq),
        distanceMetres: null,
        movingTimeMs: null,
        elapsedTimeMs: null,
        averagePowerW: null,
        maxPowerW: null,
        ...overrides,
    };
}

function projectRecords(reader: RunningRecordsReader, repository: FindingRepository): ProjectRunningRecords {
    let counter = 0;
    return new ProjectRunningRecords({
        unitOfWork,
        reader,
        repository,
        generateId: () => `finding-${(counter += 1)}`,
        clock: { now: () => new Date("2026-08-01T12:00:00Z") },
    });
}

describe("ProjectRunningRecords", () => {
    it("projects a profile's running records from its run history", async () => {
        const reader = new FakeRecordsReader();
        reader.runs = [runInput({ distanceMetres: 10000, movingTimeMs: 3_000_000, averagePowerW: 220 })];
        const repository = new FakeFindingRepository();
        await projectRecords(reader, repository).recalculateForSession(SESSION, ctx);
        const longest = repository.current().filter(row => row.findingKey === RECORD_RUNNING_LONGEST_DISTANCE);
        expect(longest).toHaveLength(1);
        expect(longest[0]!.numericValue).toBe(10000);
        expect(longest[0]!.scope.id).toBe(PROFILE);
    });

    it("is idempotent and supersedes only a genuinely improved record", async () => {
        const reader = new FakeRecordsReader();
        reader.runs = [runInput({ distanceMetres: 10000, movingTimeMs: 3_000_000 })];
        const repository = new FakeFindingRepository();
        const proj = projectRecords(reader, repository);
        await proj.recalculateForSession(SESSION, ctx);
        const replay = await proj.recalculateForSession(SESSION, ctx);
        expect(replay.recomputed).toBe(0);

        reader.runs = [...reader.runs, runInput({ distanceMetres: 15000, movingTimeMs: 4_500_000 })];
        await proj.recalculateForSession(SESSION, ctx);
        const longest = repository.current().filter(row => row.findingKey === RECORD_RUNNING_LONGEST_DISTANCE);
        expect(longest).toHaveLength(1);
        expect(longest[0]!.numericValue).toBe(15000);
    });

    it("retires every running record when the history empties", async () => {
        const reader = new FakeRecordsReader();
        reader.runs = [runInput({ distanceMetres: 10000, movingTimeMs: 3_000_000 })];
        const repository = new FakeFindingRepository();
        const proj = projectRecords(reader, repository);
        await proj.recalculateForSession(SESSION, ctx);
        expect(repository.current().length).toBeGreaterThan(0);
        reader.runs = [];
        await proj.recalculateForSession(SESSION, ctx);
        expect(repository.current().length).toBe(0);
    });
});

// --- durable work ---------------------------------------------------------------------------------

class FakeJobQueue implements JobQueue {
    readonly enqueued: EnqueueJob[] = [];
    async enqueue(input: EnqueueJob): Promise<never> {
        this.enqueued.push(input);
        return undefined as never;
    }
}

const outboxContext = (): OutboxHandlerContext => ({
    transaction,
    idempotencyKey: "k",
    correlationId: "corr-1",
    causationId: null,
    heartbeat: async () => true,
});

function outboxEvent(): ClaimedOutboxEvent {
    return {
        id: "evt-1",
        aggregateId: SESSION,
        aggregateType: "training.session",
        eventName: "training.session.completed",
        eventVersion: 1,
        payload: { trainingSessionId: SESSION },
        correlationId: "corr-1",
        causationId: null,
        occurredAt: new Date(),
    } as unknown as ClaimedOutboxEvent;
}

describe("running outbox + job handlers", () => {
    it("the metrics outbox handler enqueues a session-keyed projection job", async () => {
        const queue = new FakeJobQueue();
        await new RunningMetricsOutboxHandler("training.session.completed", queue).handle(
            outboxEvent(),
            outboxContext(),
        );
        expect(queue.enqueued[0]).toMatchObject({
            type: RUNNING_PROJECTION_JOB,
            idempotencyKey: `${RUNNING_PROJECTION_JOB}:${SESSION}`,
        });
    });

    it("the records outbox handler enqueues a session-keyed projection job", async () => {
        const queue = new FakeJobQueue();
        await new RunningRecordsOutboxHandler("training.session.completed", queue).handle(
            outboxEvent(),
            outboxContext(),
        );
        expect(queue.enqueued[0]).toMatchObject({
            type: RUNNING_RECORDS_PROJECTION_JOB,
            idempotencyKey: `${RUNNING_RECORDS_PROJECTION_JOB}:${SESSION}`,
        });
    });

    it("the metrics job handler runs the projection for the payload session", async () => {
        const reader = new FakeMetricReader(sessionFacts([activity({ distance: { value: 5, unit: "km" } })]));
        const repository = new FakeMetricRepository();
        await new RunningMetricsProjectionJobHandler(projectMetrics(reader, repository)).handle(
            { payload: { trainingSessionId: SESSION }, correlationId: "corr-1" } as never,
            {
                transaction,
                idempotencyKey: "k",
                correlationId: "corr-1",
                causationId: null,
                heartbeat: async () => true,
                reportProgress: async () => true,
            },
        );
        expect(repository.current().length).toBeGreaterThan(0);
    });

    it("the records job handler runs the projection for the payload session", async () => {
        const reader = new FakeRecordsReader();
        reader.runs = [runInput({ distanceMetres: 10000, movingTimeMs: 3_000_000 })];
        const repository = new FakeFindingRepository();
        await new RunningRecordsProjectionJobHandler(projectRecords(reader, repository)).handle(
            { payload: { trainingSessionId: SESSION }, correlationId: "corr-1" } as never,
            {
                transaction,
                idempotencyKey: "k",
                correlationId: "corr-1",
                causationId: null,
                heartbeat: async () => true,
                reportProgress: async () => true,
            },
        );
        expect(repository.current().length).toBeGreaterThan(0);
    });
});

describe("running catalog metadata", () => {
    it("lists every running calculator and record type", () => {
        const calculators = runningMetricCatalogMetadata().calculators;
        expect(calculators.some(c => c.key === RUNNING_DISTANCE && c.scopeKind === "session")).toBe(true);
        expect(calculators.some(c => c.key === RUNNING_WINDOW_FREQUENCY && c.scopeKind === "window")).toBe(true);
        expect(runningRecordCatalogMetadata().records.some(r => r.key === RECORD_RUNNING_LONGEST_DISTANCE)).toBe(true);
    });
});
