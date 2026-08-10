import { beforeEach, describe, expect, it } from "vitest";

import {
    PERSONAL_RECORDS_PROJECTION_JOB,
    PersonalRecordsOutboxHandler,
    PersonalRecordsProjectionJobHandler,
    ProjectPersonalRecords,
    personalRecordCatalogMetadata,
    type FindingQuery,
    type FindingRecord,
    type FindingRepository,
    type FindingView,
    type PersonalRecordsReader,
} from "#src/modules/training/application/index";
import {
    RECORD_ESTIMATED_1RM,
    RECORD_EXERCISE_VOLUME,
    RECORD_MAX_LOAD,
    RECORD_REP_MAX_AT_LOAD,
    RECORD_SCOPE_EXERCISE,
    RECORD_SCOPE_FAMILY,
    findingNaturalKeyDescriptor,
    type PerformedSetMeasurements,
    type PerformedSetState,
    type PerformedSetType,
    type PersonalRecordsConfig,
    type RecordSetInput,
} from "#src/modules/training/domain/index";
import { hashRequest } from "#src/platform/application/request-hash";

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;
const PROFILE = id(600);
const EX_A = id(1);
const EX_B = id(2);

// --- fixtures -------------------------------------------------------------------------------------

function measurements(overrides: Partial<PerformedSetMeasurements> = {}): PerformedSetMeasurements {
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

let setCounter = 100;
function performedSet(loadKg: number, reps: number, overrides: Partial<PerformedSetState> = {}): PerformedSetState {
    return {
        id: id(setCounter++),
        setGroupId: null,
        round: null,
        position: 0,
        setType: "working" as PerformedSetType,
        status: "completed",
        measurements: measurements({ externalLoad: { value: loadKg, unit: "kg" }, reps }),
        failureReason: null,
        technique: null,
        discomfort: null,
        pump: null,
        notes: null,
        ...overrides,
    };
}

function recordSet(loadKg: number, reps: number, overrides: Partial<RecordSetInput> = {}): RecordSetInput {
    return {
        sessionId: id(500),
        sessionVersion: 1,
        localDate: "2026-03-16",
        exerciseId: EX_A,
        exerciseVersion: 1,
        loadModel: "external_only",
        repetitionSemantics: "total",
        set: performedSet(loadKg, reps),
        ...overrides,
    };
}

// --- fakes ----------------------------------------------------------------------------------------

class FakeFindingRepository implements FindingRepository {
    rows: FindingView[] = [];
    private counter = 0;

    async currentByNaturalKey(naturalKey: string): Promise<FindingView | null> {
        return this.rows.find(row => row.state === "current" && naturalKeyOf(row) === naturalKey) ?? null;
    }

    async supersedeAndInsert(naturalKey: string, record: FindingRecord | null): Promise<FindingView | null> {
        for (const row of this.rows)
            if (row.state === "current" && naturalKeyOf(row) === naturalKey)
                this.rows[this.rows.indexOf(row)] = { ...row, state: "superseded", supersededAt: new Date() };
        if (record === null) return null;
        const view = toView(record);
        this.rows.push(view);
        this.counter += 1;
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

function toView(record: FindingRecord): FindingView {
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

class FakeReader implements PersonalRecordsReader {
    sets: RecordSetInput[] = [];
    families = new Map<string, readonly string[]>();
    exercises: readonly string[] = [EX_A];
    config: PersonalRecordsConfig = { repMin: 1, repCutoff: 12 };
    describe: { profileId: string; exerciseIds: readonly string[] } | null = null;

    async describeSession(): Promise<{ profileId: string; exerciseIds: readonly string[] } | null> {
        return this.describe ?? { profileId: PROFILE, exerciseIds: this.exercises };
    }
    async familyMembers(exerciseId: string): Promise<readonly string[]> {
        return this.families.get(exerciseId) ?? [exerciseId];
    }
    async loadConfig(): Promise<PersonalRecordsConfig> {
        return this.config;
    }
    async loadEligibleSets(_profileId: string, exerciseIds: readonly string[]): Promise<readonly RecordSetInput[]> {
        return this.sets.filter(set => exerciseIds.includes(set.exerciseId));
    }
}

const unitOfWork = { execute: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}) };
let idCounter = 0;

function project(reader: FakeReader, repository: FakeFindingRepository): ProjectPersonalRecords {
    return new ProjectPersonalRecords({
        unitOfWork,
        reader,
        repository,
        generateId: () => id(9000 + idCounter++),
        clock: { now: () => new Date("2026-03-16T12:00:00.000Z") },
    });
}

// --- tests ----------------------------------------------------------------------------------------

describe("ProjectPersonalRecords", () => {
    beforeEach(() => {
        idCounter = 0;
    });

    it("projects the four record types for a session's exercise", async () => {
        const reader = new FakeReader();
        reader.sets = [recordSet(100, 5), recordSet(140, 1), recordSet(100, 8)];
        const repository = new FakeFindingRepository();

        const summary = await project(reader, repository).recalculateForSession(id(500), meta());

        expect(summary.retired).toBe(0);
        const current = repository.current();
        expect(current.find(f => f.findingKey === RECORD_MAX_LOAD)!.numericValue).toBe(140);
        expect(
            current.find(f => f.findingKey === RECORD_REP_MAX_AT_LOAD && f.dimensions.load === "100.00")!.numericValue,
        ).toBe(8);
        expect(current.some(f => f.findingKey === RECORD_ESTIMATED_1RM)).toBe(true);
        expect(current.some(f => f.findingKey === RECORD_EXERCISE_VOLUME)).toBe(true);
        expect(current.every(f => f.scope.type === RECORD_SCOPE_EXERCISE)).toBe(true);
    });

    it("is idempotent — replaying identical facts rewrites nothing", async () => {
        const reader = new FakeReader();
        reader.sets = [recordSet(100, 5)];
        const repository = new FakeFindingRepository();
        const projector = project(reader, repository);

        const first = await projector.recalculateForSession(id(500), meta());
        const second = await projector.recalculateForSession(id(500), meta());

        expect(first.recomputed).toBeGreaterThan(0);
        expect(second.recomputed).toBe(0);
        expect(repository.rows.every(row => row.state === "current")).toBe(true);
    });

    it("supersedes a beaten record and preserves history", async () => {
        const reader = new FakeReader();
        reader.sets = [recordSet(100, 5, { sessionId: id(500) })];
        const repository = new FakeFindingRepository();
        const projector = project(reader, repository);
        await projector.recalculateForSession(id(500), meta());

        reader.sets = [...reader.sets, recordSet(160, 5, { sessionId: id(501), localDate: "2026-04-01" })];
        await projector.recalculateForSession(id(501), meta());

        const maxLoad = repository.current().find(f => f.findingKey === RECORD_MAX_LOAD)!;
        expect(maxLoad.numericValue).toBe(160);
        const superseded = repository.rows.filter(f => f.findingKey === RECORD_MAX_LOAD && f.state === "superseded");
        expect(superseded).toHaveLength(1);
        expect(superseded[0]!.numericValue).toBe(100);
    });

    it("retires a record whose source set no longer exists", async () => {
        const reader = new FakeReader();
        reader.sets = [recordSet(100, 5), recordSet(120, 3)];
        const repository = new FakeFindingRepository();
        const projector = project(reader, repository);
        await projector.recalculateForSession(id(500), meta());
        expect(repository.current().filter(f => f.findingKey === RECORD_REP_MAX_AT_LOAD)).toHaveLength(2);

        // the 120 kg set is gone; its rep-max-at-load record should be retired
        reader.sets = [recordSet(100, 5)];
        const summary = await projector.recalculateForSession(id(500), meta());

        expect(summary.retired).toBeGreaterThan(0);
        const repMax = repository.current().filter(f => f.findingKey === RECORD_REP_MAX_AT_LOAD);
        expect(repMax).toHaveLength(1);
        expect(repMax[0]!.dimensions.load).toBe("100.00");
    });

    it("projects a labelled family scope over member exercises", async () => {
        const reader = new FakeReader();
        reader.exercises = [EX_A];
        reader.families.set(EX_A, [EX_A, EX_B]);
        reader.sets = [
            recordSet(100, 5, { exerciseId: EX_A }),
            recordSet(150, 3, { exerciseId: EX_B, sessionId: id(501) }),
        ];
        const repository = new FakeFindingRepository();

        await project(reader, repository).recalculateForSession(id(500), meta());

        const familyMax = repository
            .current()
            .find(f => f.findingKey === RECORD_MAX_LOAD && f.scope.type === RECORD_SCOPE_FAMILY)!;
        expect(familyMax.numericValue).toBe(150);
        expect(familyMax.dimensions.aggregation).toBe("family");
        expect(familyMax.evidence).toMatchObject({ familyExerciseIds: [EX_A, EX_B] });
    });

    it("does nothing when the session cannot be described", async () => {
        const reader = new FakeReader();
        reader.describe = null;
        reader.describeSession = async () => null;
        const repository = new FakeFindingRepository();
        const summary = await project(reader, repository).recalculateForSession(id(999), meta());
        expect(summary).toEqual({ recomputed: 0, retired: 0 });
    });
});

describe("PersonalRecords durable work", () => {
    it("enqueues a session-keyed projection job from a lifecycle event", async () => {
        const enqueued: { idempotencyKey?: string; type: string }[] = [];
        const queue = {
            enqueue: async (job: { idempotencyKey?: string; type: string }) => {
                enqueued.push(job);
                return { id: "j", status: "pending" } as never;
            },
        };
        const handler = new PersonalRecordsOutboxHandler("training.session.completed", queue as never);
        await handler.handle(
            { id: "e", aggregateId: id(500), correlationId: "c", payload: {} } as never,
            { transaction: {} } as never,
        );
        expect(enqueued).toEqual([
            expect.objectContaining({
                type: PERSONAL_RECORDS_PROJECTION_JOB,
                idempotencyKey: `${PERSONAL_RECORDS_PROJECTION_JOB}:${id(500)}`,
            }),
        ]);
    });

    it("runs the projection for the job's session", async () => {
        const reader = new FakeReader();
        reader.sets = [recordSet(100, 5)];
        const repository = new FakeFindingRepository();
        const handler = new PersonalRecordsProjectionJobHandler(project(reader, repository));
        await handler.handle({ payload: { trainingSessionId: id(500) }, correlationId: "c" }, {
            transaction: {},
        } as never);
        expect(repository.current().length).toBeGreaterThan(0);
    });
});

describe("personalRecordCatalogMetadata", () => {
    it("lists the four record types with stable versions", () => {
        const catalog = personalRecordCatalogMetadata();
        expect(catalog.schemaVersion).toBe(1);
        expect(catalog.records.map(record => record.key)).toEqual([
            RECORD_MAX_LOAD,
            RECORD_ESTIMATED_1RM,
            RECORD_REP_MAX_AT_LOAD,
            RECORD_EXERCISE_VOLUME,
        ]);
        expect(catalog.records.every(record => record.version === 1)).toBe(true);
    });
});

function meta() {
    return { correlationId: "c", source: "system" as const };
}
