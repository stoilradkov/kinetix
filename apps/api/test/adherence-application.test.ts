import { describe, expect, it } from "vitest";

import type { ClaimedOutboxEvent, JobQueue, OutboxHandlerContext } from "#src/platform/application/index";
import type { UnitOfWork } from "#src/platform/application/index";
import {
    AdherenceCalculatorRegistry,
    AdherenceRecalculationJobHandler,
    CalculateAdherence,
    PlannedSessionAdherenceOutboxHandler,
    SessionAdherenceOutboxHandler,
    adherenceFormulaMetadata,
    type AdherenceInputReader,
    type AdherenceResultRecord,
    type AdherenceResultRepository,
    type AdherenceResultView,
    type AdherenceSessionInputs,
} from "#src/modules/training/application/index";
import type {
    ExerciseSnapshotV1,
    SessionActivityState,
    SessionMappingsState,
    SessionPrescriptionState,
    TargetRanges,
} from "#src/modules/training/domain/index";

const transaction = {};
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;
const now = new Date("2026-08-09T09:00:00.000Z");
const PROFILE = id(9);

// --- minimal input builders ----------------------------------------------------------------------

function targets(overrides: Partial<TargetRanges> = {}): TargetRanges {
    return {
        repsMin: null,
        repsMax: null,
        loadKgMin: null,
        loadKgMax: null,
        durationMsMin: null,
        durationMsMax: null,
        distanceMMin: null,
        distanceMMax: null,
        speedMpsMin: null,
        speedMpsMax: null,
        powerWMin: null,
        powerWMax: null,
        rpeMin: null,
        rpeMax: null,
        rirMin: null,
        rirMax: null,
        hrBpmMin: null,
        hrBpmMax: null,
        percent1rm: null,
        percentTrainingMax: null,
        tempo: null,
        restMsMin: null,
        restMsMax: null,
        enteredTargets: {},
        ...overrides,
    };
}

function snapshot(exerciseId: string): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Ex",
        equipmentTypeId: id(1),
        movementPatternId: id(2),
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "standing",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
    };
}

function strengthPrescription(
    prescriptionId: string,
    activityId: string,
    exerciseId: string,
    setId: string,
): SessionPrescriptionState {
    return {
        id: prescriptionId,
        kind: "resolved_execution",
        schemaVersion: 1,
        expectedDurationMs: null,
        notes: null,
        sourcePrescriptionId: null,
        sourceKind: null,
        createdAt: now.toISOString(),
        activities: [
            {
                id: activityId,
                logicalKey: activityId,
                sourceLogicalKey: null,
                sourceRowId: null,
                type: "strength",
                position: 0,
                expectedDurationMs: null,
                rpeTarget: null,
                notes: null,
                running: null,
                strength: {
                    setGroups: [],
                    exercises: [
                        {
                            id: exerciseId,
                            logicalKey: exerciseId,
                            sourceLogicalKey: null,
                            sourceRowId: null,
                            exerciseId,
                            snapshot: snapshot(exerciseId),
                            position: 0,
                            purpose: null,
                            substitutionPolicy: null,
                            sets: [
                                {
                                    id: setId,
                                    logicalKey: setId,
                                    sourceLogicalKey: null,
                                    sourceRowId: null,
                                    setGroupLogicalKey: null,
                                    position: 0,
                                    round: null,
                                    setType: "working",
                                    targets: targets({ repsMin: 5, repsMax: 5, loadKgMin: "100", loadKgMax: "100" }),
                                    notes: null,
                                },
                            ],
                        },
                    ],
                },
            },
        ],
    };
}

function strengthActual(
    activityId: string,
    occurrenceId: string,
    performedSetId: string,
    reps: number,
): SessionActivityState {
    return {
        id: activityId,
        type: "strength",
        position: 0,
        startedAt: null,
        endedAt: null,
        durationSeconds: null,
        rpe: null,
        feeling: null,
        notes: null,
        tags: [],
        running: null,
        strength: {
            setGroups: [],
            occurrences: [
                {
                    id: occurrenceId,
                    exerciseId: occurrenceId,
                    snapshot: snapshot(occurrenceId),
                    position: 0,
                    purpose: null,
                    technique: null,
                    discomfort: null,
                    pump: null,
                    notes: null,
                    performedSets: [
                        {
                            id: performedSetId,
                            setGroupId: null,
                            round: null,
                            position: 0,
                            setType: "working",
                            status: "completed",
                            failureReason: null,
                            technique: null,
                            discomfort: null,
                            pump: null,
                            notes: null,
                            measurements: {
                                reps,
                                externalLoad: { value: 100, unit: "kg" },
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
                            },
                        },
                    ],
                },
            ],
        },
    };
}

function mappings(overrides: Partial<SessionMappingsState> = {}): SessionMappingsState {
    return {
        plannedLinks: [],
        activityMappings: [],
        occurrenceMappings: [],
        setMappings: [],
        runStepMappings: [],
        ...overrides,
    };
}

// --- fakes ---------------------------------------------------------------------------------------

class FakeInputReader implements AdherenceInputReader<typeof transaction> {
    findCalls: string[] = [];
    constructor(
        private readonly inputs: AdherenceSessionInputs | null,
        private readonly planSessions: readonly string[] = [],
    ) {}
    async loadInputs(): Promise<AdherenceSessionInputs | null> {
        return this.inputs;
    }
    async findSessionIdsForPlan(plannedSessionId: string): Promise<readonly string[]> {
        this.findCalls.push(plannedSessionId);
        return this.planSessions;
    }
}

class FakeResultRepository implements AdherenceResultRepository<typeof transaction> {
    replaceCalls = 0;
    stored: AdherenceResultRecord[] = [];
    async readForSession(): Promise<readonly AdherenceResultView[]> {
        return this.stored.map(toView);
    }
    async currentFingerprints(): Promise<ReadonlyMap<string, string>> {
        return new Map(this.stored.map(record => [record.resolvedPrescriptionId, record.sourceFingerprint]));
    }
    async replaceForSession(
        _sessionId: string,
        results: readonly AdherenceResultRecord[],
    ): Promise<readonly AdherenceResultView[]> {
        this.replaceCalls += 1;
        this.stored = [...results];
        return results.map(toView);
    }
}

function toView(record: AdherenceResultRecord): AdherenceResultView {
    return {
        id: record.id,
        trainingSessionId: record.trainingSessionId,
        trainingSessionVersion: record.trainingSessionVersion,
        plannedSessionId: record.plannedSessionId,
        sourcePrescriptionId: record.sourcePrescriptionId,
        resolvedPrescriptionId: record.resolvedPrescriptionId,
        formula: record.formula,
        scope: record.scope,
        overall: record.overall,
        sourceFingerprint: record.sourceFingerprint,
        components: record.components,
        exclusions: record.exclusions,
        calculatedAt: record.calculatedAt,
    };
}

class FakeJobQueue implements JobQueue<typeof transaction> {
    enqueued: { type: string; payload: Record<string, unknown>; idempotencyKey: string | null }[] = [];
    async enqueue(input: {
        type: string;
        payload: Readonly<Record<string, unknown>>;
        idempotencyKey?: string | null;
    }): Promise<never> {
        this.enqueued.push({
            type: input.type,
            payload: { ...input.payload },
            idempotencyKey: input.idempotencyKey ?? null,
        });
        return {} as never;
    }
}

function outboxContext(): OutboxHandlerContext<typeof transaction> {
    return { transaction, idempotencyKey: "k", correlationId: "c", causationId: null, heartbeat: async () => true };
}

function claimedEvent(name: string, payload: Record<string, unknown>): ClaimedOutboxEvent {
    return {
        id: id(0xe01),
        name,
        version: 1,
        stableName: name,
        aggregateType: "training.session",
        aggregateId: id(0xa01),
        aggregateRevision: 2,
        payload,
        payloadFingerprint: "f",
        state: "processing",
        attempts: 0,
        maxAttempts: 5,
        correlationId: "corr",
        causationId: null,
        occurredAt: now,
        lease: { owner: "w", expiresAt: now, heartbeatAt: now },
    };
}

function createService(inputs: AdherenceSessionInputs | null, planSessions: readonly string[] = []) {
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const reader = new FakeInputReader(inputs, planSessions);
    const repository = new FakeResultRepository();
    const registry = new AdherenceCalculatorRegistry();
    let counter = 0;
    const generateId = () => id(0xb000 + ++counter);
    const service = new CalculateAdherence({
        unitOfWork,
        reader,
        repository,
        registry,
        generateId,
        clock: { now: () => now },
    });
    return { service, reader, repository, registry };
}

function perfectInputs(sessionVersion = 2): AdherenceSessionInputs {
    const [prescriptionId, activityId, exerciseId, setId] = [id(0x100), id(0x101), id(0x102), id(0x103)];
    const [aId, oId, psId] = [id(0x201), id(0x202), id(0x203)];
    const resolved = strengthPrescription(prescriptionId, activityId, exerciseId, setId);
    return {
        sessionId: id(0x1),
        profileId: PROFILE,
        version: sessionVersion,
        plannedLinks: [
            {
                plannedSessionId: id(0x300),
                sourcePrescriptionId: prescriptionId,
                resolvedPrescriptionId: prescriptionId,
            },
        ],
        activities: [strengthActual(aId, oId, psId, 5)],
        mappings: mappings({
            activityMappings: [
                {
                    id: id(0x400),
                    relation: "matched",
                    reason: null,
                    notes: null,
                    prescribedActivityId: activityId,
                    actualActivityId: aId,
                },
            ],
            occurrenceMappings: [
                {
                    id: id(0x401),
                    relation: "matched",
                    reason: null,
                    notes: null,
                    prescribedExerciseId: exerciseId,
                    occurrenceId: oId,
                },
            ],
            setMappings: [
                {
                    id: id(0x402),
                    relation: "matched",
                    reason: null,
                    notes: null,
                    prescribedSetId: setId,
                    performedSetId: psId,
                    portion: null,
                },
            ],
        }),
        resolvedPrescriptions: new Map([[prescriptionId, resolved]]),
    };
}

// -------------------------------------------------------------------------------------------------

describe("CalculateAdherence", () => {
    it("computes and persists one result per planned link", async () => {
        const { service, repository } = createService(perfectInputs());
        const view = await service.recalculateForSession({ sessionId: id(0x1) }, { correlationId: "c" });
        expect(view.results).toHaveLength(1);
        expect(view.results[0]!.overall).toBe(100);
        expect(view.results[0]!.formula).toBe("adherence.overall.v1");
        expect(repository.replaceCalls).toBe(1);
    });

    it("computes an independent result for every planned link a session fulfils", async () => {
        const base = perfectInputs();
        const [p2, a2, e2, s2] = [id(0x500), id(0x501), id(0x502), id(0x503)];
        const resolved2 = strengthPrescription(p2, a2, e2, s2);
        const [aId2, oId2, psId2] = [id(0x601), id(0x602), id(0x603)];
        const inputs: AdherenceSessionInputs = {
            ...base,
            plannedLinks: [
                ...base.plannedLinks,
                { plannedSessionId: id(0x700), sourcePrescriptionId: p2, resolvedPrescriptionId: p2 },
            ],
            activities: [...base.activities, strengthActual(aId2, oId2, psId2, 3)],
            mappings: mappings({
                ...base.mappings,
                activityMappings: [
                    ...base.mappings.activityMappings,
                    {
                        id: id(0x800),
                        relation: "matched",
                        reason: null,
                        notes: null,
                        prescribedActivityId: a2,
                        actualActivityId: aId2,
                    },
                ],
                occurrenceMappings: [
                    ...base.mappings.occurrenceMappings,
                    {
                        id: id(0x801),
                        relation: "matched",
                        reason: null,
                        notes: null,
                        prescribedExerciseId: e2,
                        occurrenceId: oId2,
                    },
                ],
                setMappings: [
                    ...base.mappings.setMappings,
                    {
                        id: id(0x802),
                        relation: "matched",
                        reason: null,
                        notes: null,
                        prescribedSetId: s2,
                        performedSetId: psId2,
                        portion: null,
                    },
                ],
            }),
            resolvedPrescriptions: new Map([...base.resolvedPrescriptions, [p2, resolved2]]),
        };
        const { service } = createService(inputs);
        const view = await service.recalculateForSession({ sessionId: id(0x1) }, { correlationId: "c" });
        expect(view.results).toHaveLength(2);
        // Second link under-performed reps (3 of [5,5]) → distinct overall from the first.
        const first = view.results.find(
            r => r.resolvedPrescriptionId === base.plannedLinks[0]!.resolvedPrescriptionId,
        )!;
        const second = view.results.find(r => r.resolvedPrescriptionId === p2)!;
        expect(first.overall).toBe(100);
        expect(second.overall).toBeLessThan(100);
    });

    it("is idempotent: an unchanged fingerprint skips the rewrite", async () => {
        const { service, repository } = createService(perfectInputs());
        await service.recalculateForSession({ sessionId: id(0x1) }, { correlationId: "c" });
        await service.recalculateForSession({ sessionId: id(0x1) }, { correlationId: "c" });
        expect(repository.replaceCalls).toBe(1); // second call short-circuits
    });

    it("rewrites when the session version changes (fingerprint differs)", async () => {
        const { service, repository, reader } = createService(perfectInputs(2));
        await service.recalculateForSession({ sessionId: id(0x1) }, { correlationId: "c" });
        // Swap the reader's inputs to a newer version.
        (reader as unknown as { inputs: AdherenceSessionInputs }).inputs = perfectInputs(3);
        await service.recalculateForSession({ sessionId: id(0x1) }, { correlationId: "c" });
        expect(repository.replaceCalls).toBe(2);
    });

    it("selects the calculator by formula version through the registry", async () => {
        const { service, registry } = createService(perfectInputs());
        let called = 0;
        registry.register({
            name: "adherence.overall",
            version: 2,
            calculate: () => {
                called += 1;
                return {
                    formula: "adherence.overall.v1",
                    scope: "strength",
                    overall: 42,
                    components: [],
                    exclusions: [],
                };
            },
        });
        const view = await service.recalculateForSession(
            { sessionId: id(0x1), formula: "adherence.overall.v2" },
            { correlationId: "c" },
        );
        expect(called).toBe(1);
        expect(view.results[0]!.overall).toBe(42);
        expect(view.results[0]!.formula).toBe("adherence.overall.v2");
    });

    it("throws when the session cannot be loaded", async () => {
        const { service } = createService(null);
        await expect(service.recalculateForSession({ sessionId: id(0x1) }, { correlationId: "c" })).rejects.toThrow(
            /was not found/,
        );
    });
});

describe("adherence durable-work handlers", () => {
    it("enqueues a recompute when a session event marks adherence invalidated", async () => {
        const queue = new FakeJobQueue();
        const handler = new SessionAdherenceOutboxHandler("training.session.completed", queue);
        await handler.handle(
            claimedEvent("training.session.completed", {
                trainingSessionId: id(0x1),
                invalidation: { adherence: true },
            }),
            outboxContext(),
        );
        expect(queue.enqueued).toHaveLength(1);
        expect(queue.enqueued[0]!.payload.trainingSessionId).toBe(id(0x1));
        expect(queue.enqueued[0]!.idempotencyKey).toBe(`adherence.recalculate:${id(0x1)}`);
    });

    it("ignores a session event that does not invalidate adherence", async () => {
        const queue = new FakeJobQueue();
        const handler = new SessionAdherenceOutboxHandler("training.session.started", queue);
        await handler.handle(
            claimedEvent("training.session.started", {
                trainingSessionId: id(0x1),
                invalidation: { adherence: false },
            }),
            outboxContext(),
        );
        expect(queue.enqueued).toHaveLength(0);
    });

    it("fans out one recompute per linked session for a plan change", async () => {
        const queue = new FakeJobQueue();
        const reader = new FakeInputReader(null, [id(0x1), id(0x2)]);
        const handler = new PlannedSessionAdherenceOutboxHandler("training.planned-session.updated", queue, reader);
        await handler.handle(
            claimedEvent("training.planned-session.updated", { plannedSessionId: id(0x300) }),
            outboxContext(),
        );
        expect(reader.findCalls).toEqual([id(0x300)]);
        expect(queue.enqueued.map(job => job.payload.trainingSessionId)).toEqual([id(0x1), id(0x2)]);
    });

    it("runs CalculateAdherence from the job handler", async () => {
        const { service, repository } = createService(perfectInputs());
        const jobHandler = new AdherenceRecalculationJobHandler(service);
        await jobHandler.handle(
            { payload: { trainingSessionId: id(0x1) }, correlationId: "c" },
            {
                transaction,
                idempotencyKey: "k",
                correlationId: "c",
                causationId: null,
                heartbeat: async () => true,
                reportProgress: async () => true,
            },
        );
        expect(repository.replaceCalls).toBe(1);
    });
});

describe("adherenceFormulaMetadata", () => {
    it("exposes stable versioned weights that sum to 100 per activity type", () => {
        const metadata = adherenceFormulaMetadata();
        expect(metadata.formula).toBe("adherence.overall.v1");
        expect(metadata.strengthComponents.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
        expect(metadata.runningComponents.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
    });
});
