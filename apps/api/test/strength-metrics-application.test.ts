import { describe, expect, it } from "vitest";

import {
    ProjectStrengthMetrics,
    STRENGTH_PROJECTION_JOB,
    StrengthMetricsOutboxHandler,
    StrengthMetricsProjectionJobHandler,
    type DerivedMetricRecord,
    type DerivedMetricRepository,
    type DerivedMetricView,
    type MetricQuery,
    type StrengthMetricReader,
} from "#src/modules/training/application/index";
import {
    STRENGTH_WORK_REPS,
    STRENGTH_WINDOW_FREQUENCY,
    type ExerciseSnapshotV1,
    type PerformedSetMeasurements,
    type PerformedSetState,
    type StrengthMetricConfig,
    type StrengthOccurrenceFacts,
    type StrengthSessionFacts,
    type StrengthWindowSessionFacts,
} from "#src/modules/training/domain/index";
import {
    type ClaimedOutboxEvent,
    type CommandContext,
    type EnqueueJob,
    type JobQueue,
    type OutboxHandlerContext,
    type UnitOfWork,
} from "#src/platform/application/index";

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;
const transaction = {};
const ctx: CommandContext = { correlationId: "corr-1", source: "system" };
const unitOfWork: UnitOfWork = { execute: work => work(transaction) };

const PROFILE = id(600);
const SESSION = id(500);
const EX_A = id(1);
const EX_B = id(2);
const CHEST = id(10);

function snapshot(exerciseId: string, overrides: Partial<ExerciseSnapshotV1> = {}): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Exercise",
        equipmentTypeId: id(90),
        movementPatternId: id(91),
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "supine",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [{ muscleGroupId: CHEST, role: "primary" }],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
        ...overrides,
    };
}

function measurements(overrides: Partial<PerformedSetMeasurements>): PerformedSetMeasurements {
    return {
        reps: null,
        externalLoad: null,
        bodyweight: null,
        addedLoad: null,
        assistanceLoad: null,
        effectiveLoad: null,
        duration: null,
        distance: null,
        powerWatts: null,
        rpe: null,
        rir: null,
        tempo: null,
        restBefore: null,
        restAfter: null,
        ...overrides,
    };
}

let setSeq = 100;
function workingSet(reps: number, loadKg: number): PerformedSetState {
    return {
        id: id(setSeq++),
        setGroupId: null,
        round: null,
        position: 0,
        setType: "working",
        status: "completed",
        measurements: measurements({ reps, externalLoad: { value: loadKg, unit: "kg" } }),
        failureReason: null,
        technique: null,
        discomfort: null,
        pump: null,
        notes: null,
    };
}

let occSeq = 1000;
function occurrence(exerciseId: string, sets: PerformedSetState[]): StrengthOccurrenceFacts {
    const snap = snapshot(exerciseId);
    return {
        occurrenceId: id(occSeq++),
        exerciseId,
        historicalExerciseVersion: 1,
        latestExerciseVersion: 1,
        historical: snap,
        latest: snap,
        performedSets: sets,
    };
}

// --- filtering in-memory projection repository ----------------------------------------------------

interface StoredMetric extends DerivedMetricView {
    readonly naturalKey: string;
}

class FakeRepository implements DerivedMetricRepository {
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
        const view: StoredMetric = { ...toView(record), naturalKey };
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

function toView(record: DerivedMetricRecord): DerivedMetricView {
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

// --- configurable reader --------------------------------------------------------------------------

class FakeReader implements StrengthMetricReader {
    sessionFacts: StrengthSessionFacts | null;
    windowSessions: StrengthWindowSessionFacts[] = [];
    config: StrengthMetricConfig = { rpeThreshold: 7, rirThreshold: 3, calculatorVersion: 1 };

    constructor(sessionFacts: StrengthSessionFacts | null) {
        this.sessionFacts = sessionFacts;
    }

    async describeSession(): Promise<{ profileId: string; localDate: string } | null> {
        return { profileId: PROFILE, localDate: "2026-03-16" };
    }

    async loadSessionFacts(): Promise<StrengthSessionFacts | null> {
        return this.sessionFacts;
    }

    async loadConfig(): Promise<StrengthMetricConfig> {
        return this.config;
    }

    async sessionDatesInRange(_profileId: string, from: string, to: string): Promise<readonly string[]> {
        return [...new Set(this.windowSessions.map(s => s.localDate).filter(d => d >= from && d <= to))];
    }

    async loadWindowFacts(
        _profileId: string,
        from: string,
        to: string,
    ): Promise<readonly StrengthWindowSessionFacts[]> {
        return this.windowSessions.filter(s => s.localDate >= from && s.localDate <= to);
    }
}

function project(reader: StrengthMetricReader, repository: DerivedMetricRepository): ProjectStrengthMetrics {
    let counter = 0;
    return new ProjectStrengthMetrics({
        unitOfWork,
        reader,
        repository,
        generateId: () => `metric-${(counter += 1)}`,
        clock: { now: () => new Date("2026-03-16T12:00:00Z") },
    });
}

function sessionFacts(occurrences: StrengthOccurrenceFacts[]): StrengthSessionFacts {
    return { sessionId: SESSION, profileId: PROFILE, sessionVersion: 2, localDate: "2026-03-16", occurrences };
}

function windowSession(localDate: string, occurrences: StrengthOccurrenceFacts[]): StrengthWindowSessionFacts {
    return { sessionId: id(700 + Number(localDate.slice(-2))), sessionVersion: 1, localDate, occurrences };
}

// -------------------------------------------------------------------------------------------------

describe("ProjectStrengthMetrics", () => {
    it("projects session-scope strength metrics for a completed session", async () => {
        const reader = new FakeReader(sessionFacts([occurrence(EX_A, [workingSet(5, 100)])]));
        const repository = new FakeRepository();
        const result = await project(reader, repository).recalculateForSession(SESSION, ctx);

        expect(result.recomputed).toBeGreaterThan(0);
        const workReps = repository
            .current()
            .filter(row => row.calculatorKey === STRENGTH_WORK_REPS && row.dimensions.basis === "historical");
        expect(workReps).toHaveLength(1);
        expect(workReps[0]!.scope).toEqual({ type: "session", id: SESSION });
        expect(workReps[0]!.numericValue).toBe(5);
    });

    it("is idempotent: a replay with unchanged facts rewrites nothing", async () => {
        const reader = new FakeReader(sessionFacts([occurrence(EX_A, [workingSet(5, 100)])]));
        const repository = new FakeRepository();
        const proj = project(reader, repository);
        await proj.recalculateForSession(SESSION, ctx);
        const before = repository.current().length;
        const replay = await proj.recalculateForSession(SESSION, ctx);
        expect(replay.recomputed).toBe(0);
        expect(repository.current().length).toBe(before);
    });

    it("retires the session metrics of an exercise dropped from a later revision", async () => {
        const reader = new FakeReader(
            sessionFacts([occurrence(EX_A, [workingSet(5, 100)]), occurrence(EX_B, [workingSet(5, 80)])]),
        );
        const repository = new FakeRepository();
        const proj = project(reader, repository);
        await proj.recalculateForSession(SESSION, ctx);
        expect(repository.current().some(row => row.dimensions.exercise === EX_B)).toBe(true);

        reader.sessionFacts = sessionFacts([occurrence(EX_A, [workingSet(5, 100)])]); // EX_B removed
        await proj.recalculateForSession(SESSION, ctx);
        expect(repository.current().some(row => row.dimensions.exercise === EX_B)).toBe(false);
        expect(repository.current().some(row => row.dimensions.exercise === EX_A)).toBe(true);
    });

    it("retires session metrics when the session leaves the completed set (reopened)", async () => {
        const reader = new FakeReader(sessionFacts([occurrence(EX_A, [workingSet(5, 100)])]));
        const repository = new FakeRepository();
        const proj = project(reader, repository);
        await proj.recalculateForSession(SESSION, ctx);
        expect(repository.current().some(row => row.scope.type === "session")).toBe(true);

        reader.sessionFacts = null; // reopened / archived — no longer completed
        await proj.recalculateForSession(SESSION, ctx);
        expect(repository.current().some(row => row.scope.type === "session")).toBe(false);
    });

    it("projects rolling-window metrics across the profile's window sessions", async () => {
        const reader = new FakeReader(sessionFacts([occurrence(EX_A, [workingSet(5, 100)])]));
        reader.windowSessions = [
            windowSession("2026-03-12", [occurrence(EX_A, [workingSet(5, 100)])]),
            windowSession("2026-03-16", [occurrence(EX_A, [workingSet(5, 100)])]),
        ];
        const repository = new FakeRepository();
        await project(reader, repository).recalculateForSession(SESSION, ctx);

        const frequency = repository
            .current()
            .filter(
                row =>
                    row.calculatorKey === STRENGTH_WINDOW_FREQUENCY &&
                    row.scope.type === "profile-rolling-7" &&
                    row.dimensions.basis === "historical",
            );
        expect(frequency).toHaveLength(1);
        expect(frequency[0]!.numericValue).toBe(2);
        expect(frequency[0]!.scope.id).toBe(`${PROFILE}:2026-03-16`);
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

function outboxEvent(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
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
        ...overrides,
    } as unknown as ClaimedOutboxEvent;
}

describe("StrengthMetricsOutboxHandler", () => {
    it("enqueues a session-keyed projection job", async () => {
        const queue = new FakeJobQueue();
        await new StrengthMetricsOutboxHandler("training.session.completed", queue).handle(
            outboxEvent(),
            outboxContext(),
        );
        expect(queue.enqueued).toHaveLength(1);
        expect(queue.enqueued[0]).toMatchObject({
            type: STRENGTH_PROJECTION_JOB,
            payload: { trainingSessionId: SESSION },
            idempotencyKey: `${STRENGTH_PROJECTION_JOB}:${SESSION}`,
        });
    });
});

describe("StrengthMetricsProjectionJobHandler", () => {
    it("runs the projection for the payload session", async () => {
        const reader = new FakeReader(sessionFacts([occurrence(EX_A, [workingSet(5, 100)])]));
        const repository = new FakeRepository();
        const handler = new StrengthMetricsProjectionJobHandler(project(reader, repository));
        await handler.handle({ payload: { trainingSessionId: SESSION }, correlationId: "corr-1" } as never, {
            transaction,
            idempotencyKey: "k",
            correlationId: "corr-1",
            causationId: null,
            heartbeat: async () => true,
            reportProgress: async () => true,
        });
        expect(repository.current().length).toBeGreaterThan(0);
    });
});
