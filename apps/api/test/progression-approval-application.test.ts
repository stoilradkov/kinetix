import { describe, expect, it } from "vitest";

import {
    ProgressionAlreadyResolvedError,
    ProgressionApprovalService,
    ProgressionEvaluationNotFoundError,
    ProgressionNotApplicableError,
    ProgressionStaleError,
    type ApplicableProgressionRuleReader,
    type ApproveProgressionCommand,
    type ProgressionApplicationExecutor,
    type ProgressionContextReader,
    type ProgressionDecisionRecord,
    type ProgressionEvaluationRepository,
    type ProgressionEvaluationSubject,
    type ProgressionEvaluationView,
    type ProgressionResultRevisionView,
    type ProgressionRuleResource,
    type ResolvedProgressionTarget,
} from "#src/modules/training/application/index";
import {
    SessionPrescription,
    type IdMinter,
    type PublishPrescriptionDraft,
    type SessionPrescriptionState,
    type TrainingSessionState,
} from "#src/modules/training/domain/index";
import type { CommandContext, EnqueueJob, OutboxWriter, QueuedJob, UnitOfWork } from "#src/platform/application/index";
import type { DomainEvent } from "#src/platform/domain/index";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/exercise-definition";

const transaction = {};
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;
const PROFILE = id(1);
const SESSION = id(2);
const TEMPLATE = id(3);
const RULE = id(4);
const EVALUATION = id(5);
const EXERCISE = id(6);
const now = new Date("2026-08-10T09:00:00.000Z");
const metadata: CommandContext = { correlationId: "corr-1", actorId: "user-1", source: "user" };

const unitOfWork: UnitOfWork = { execute: work => work(transaction) };

function makeMinter(seed = 0x2000): IdMinter {
    let counter = seed;
    const next = () => {
        counter += 1;
        return `0198a4db-d8da-7000-8000-${counter.toString(16).padStart(12, "0")}`;
    };
    return { rowId: next, logicalKey: next };
}

function snapshot(): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId: EXERCISE,
        exerciseVersion: 1,
        name: "Back Squat",
        equipmentTypeId: id(0xe1),
        movementPatternId: id(0xe2),
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

function templatePrescription(): SessionPrescriptionState {
    const draft: PublishPrescriptionDraft = {
        kind: "template",
        activities: [
            {
                ref: "a",
                type: "strength",
                position: 0,
                strength: {
                    exercises: [
                        {
                            ref: "e",
                            exerciseId: EXERCISE,
                            snapshot: snapshot(),
                            position: 0,
                            sets: [
                                {
                                    ref: "s",
                                    position: 0,
                                    setType: "working",
                                    targets: { loadKgMin: "100", loadKgMax: "100" },
                                },
                            ],
                        },
                    ],
                },
            },
        ],
    };
    return SessionPrescription.publishDraft(draft, makeMinter(), now).state;
}

function sessionState(overrides: Partial<TrainingSessionState> = {}): TrainingSessionState {
    return {
        id: SESSION,
        profileId: PROFILE,
        status: "completed",
        title: null,
        localDate: "2026-08-10",
        timeZone: "UTC",
        startedAt: null,
        endedAt: null,
        durationMinutes: null,
        readiness: { energy: 4, motivation: 4, fatigue: null, soreness: null, stress: null, recovery: null },
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
        createdAt: "2026-08-10T09:00:00.000Z",
        updatedAt: "2026-08-10T09:00:00.000Z",
        ...overrides,
    } as TrainingSessionState;
}

function subjectFor(overrides: Partial<ProgressionEvaluationSubject> = {}): ProgressionEvaluationSubject {
    return {
        sessionId: SESSION,
        profileId: PROFILE,
        sessionVersion: 1,
        completed: true,
        scope: { programIds: [], blockIds: [], templateIds: [TEMPLATE], exerciseLogicalKeys: [], setLogicalKeys: [] },
        recoveryIntervalHours: 48,
        weeklyVolume: null,
        ...overrides,
    };
}

function evaluationView(overrides: Partial<ProgressionEvaluationView> = {}): ProgressionEvaluationView {
    return {
        id: EVALUATION,
        profileId: PROFILE,
        ruleId: RULE,
        ruleVersion: 1,
        ruleName: "Progress on low RPE",
        trainingSessionId: SESSION,
        trainingSessionVersion: 1,
        trigger: "session_completed",
        scopeType: "template",
        scopeId: TEMPLATE,
        target: { mode: "template", selector: { kind: "scope" } },
        matched: true,
        status: "pending",
        explanation: {
            kind: "metric",
            matched: true,
            metricKey: "rpe",
            canonicalKey: "rpe|session|w:-|f:-",
            operator: "lte",
            comparand: 8,
            observed: 7,
            missing: false,
            sourceRevision: 1,
        },
        missingMetrics: [],
        contextRevisions: { session: 1 },
        contextFacts: {},
        contextFingerprint: "a".repeat(64),
        safety: { outcome: "requires_approval", findings: [], missingInputs: [] },
        conflict: { conflicting: false, ruleIds: [], fields: [] },
        autoApplyEligible: false,
        autoApplyReason: "Template changes always require approval",
        stale: false,
        decidedAt: null,
        decidedBy: null,
        decisionReason: null,
        resultRevisions: [],
        evaluatedAt: now,
        actions: [
            {
                position: 0,
                actionType: "adjust_load",
                action: { type: "adjust_load", mode: "percent", value: 5 },
                status: "proposed",
            },
        ],
        ...overrides,
    };
}

function ruleFor(overrides: Partial<ProgressionRuleResource> = {}): ProgressionRuleResource {
    return {
        id: RULE,
        profileId: PROFILE,
        name: "Progress on low RPE",
        description: null,
        scope: { type: "template", id: TEMPLATE },
        target: { mode: "template", selector: { kind: "scope" } },
        conditionSchemaVersion: 1,
        condition: { kind: "metric", metric: { key: "rpe", scope: "session" }, operator: "lte", value: 8 },
        actionSchemaVersion: 1,
        actions: [{ type: "adjust_load", mode: "percent", value: 5 }],
        triggers: ["session_completed"],
        enabled: true,
        autoApply: false,
        safetyPolicy: { policyKey: null, config: {} },
        status: "active",
        archivedAt: null,
        createdAt: "2026-08-10T09:00:00.000Z",
        updatedAt: "2026-08-10T09:00:00.000Z",
        version: 1,
        ...overrides,
    };
}

// --- fakes ---------------------------------------------------------------------------------------

class FakeRepository implements Partial<ProgressionEvaluationRepository> {
    decisions: ProgressionDecisionRecord[] = [];
    staled: string[] = [];
    constructor(private view: ProgressionEvaluationView) {}
    loadForUpdate(): Promise<ProgressionEvaluationView | null> {
        return Promise.resolve(this.view);
    }
    recordDecision(decision: ProgressionDecisionRecord): Promise<ProgressionEvaluationView> {
        this.decisions.push(decision);
        this.view = {
            ...this.view,
            status: decision.status,
            decidedAt: decision.decidedAt,
            decidedBy: decision.decidedBy,
            decisionReason: decision.decisionReason,
            resultRevisions: decision.resultRevisions,
            actions: this.view.actions.map(action => ({ ...action, status: decision.actionStatus })),
        };
        return Promise.resolve(this.view);
    }
    markStale(evaluationId: string): Promise<void> {
        this.staled.push(evaluationId);
        return Promise.resolve();
    }
}

class FakeContextReader implements ProgressionContextReader {
    constructor(
        private readonly subject: ProgressionEvaluationSubject | null,
        private readonly session: TrainingSessionState,
    ) {}
    loadSubject(): Promise<{ subject: ProgressionEvaluationSubject; session: TrainingSessionState } | null> {
        return Promise.resolve(this.subject ? { subject: this.subject, session: this.session } : null);
    }
}

class FakeRuleReader implements ApplicableProgressionRuleReader {
    constructor(private readonly rule: ProgressionRuleResource | null) {}
    findEnabledByTrigger(): Promise<readonly ProgressionRuleResource[]> {
        return Promise.resolve(this.rule ? [this.rule] : []);
    }
    findById(): Promise<ProgressionRuleResource | null> {
        return Promise.resolve(this.rule);
    }
}

class FakeExecutor implements ProgressionApplicationExecutor {
    applied: { ownerId: string; prescription: SessionPrescriptionState }[] = [];
    constructor(
        private readonly targets: readonly ResolvedProgressionTarget[],
        private readonly failOnIndex: number | null = null,
    ) {}
    resolveTargets(): Promise<readonly ResolvedProgressionTarget[]> {
        return Promise.resolve(this.targets);
    }
    applyTarget(input: {
        target: ResolvedProgressionTarget;
        prescription: SessionPrescriptionState;
    }): Promise<ProgressionResultRevisionView> {
        const index = this.applied.length;
        if (this.failOnIndex !== null && index === this.failOnIndex) throw new Error("apply failed");
        this.applied.push({ ownerId: input.target.ownerId, prescription: input.prescription });
        return Promise.resolve({
            entityType: "training.workout-template",
            entityId: input.target.ownerId,
            version: input.target.ownerVersion + 1,
            prescriptionId: input.prescription.id,
        });
    }
}

class FakeQueue {
    enqueued: EnqueueJob[] = [];
    enqueue(job: EnqueueJob): Promise<QueuedJob> {
        this.enqueued.push(job);
        return Promise.resolve({ id: "job-1", type: job.type, deduplicated: false } as unknown as QueuedJob);
    }
}

class FakeOutbox implements OutboxWriter {
    events: DomainEvent[] = [];
    publish(events: readonly DomainEvent[]): Promise<void> {
        this.events.push(...events);
        return Promise.resolve();
    }
}

const profileReader = { requireActiveProfileId: () => Promise.resolve(PROFILE) };

function build(options: {
    view: ProgressionEvaluationView;
    subject?: ProgressionEvaluationSubject | null;
    session?: TrainingSessionState;
    rule?: ProgressionRuleResource | null;
    targets?: readonly ResolvedProgressionTarget[];
    failOnIndex?: number | null;
    profileId?: string;
}) {
    const repository = new FakeRepository(options.view);
    const queue = new FakeQueue();
    const outbox = new FakeOutbox();
    const executor = new FakeExecutor(
        options.targets ?? [
            {
                ownerType: "workout-template",
                ownerId: TEMPLATE,
                ownerVersion: 1,
                ownerProfileId: PROFILE,
                prescription: templatePrescription(),
            },
        ],
        options.failOnIndex ?? null,
    );
    const service = new ProgressionApprovalService({
        unitOfWork,
        repository: repository as unknown as ProgressionEvaluationRepository,
        contextReader: new FakeContextReader(
            options.subject === undefined ? subjectFor() : options.subject,
            options.session ?? sessionState(),
        ),
        ruleReader: new FakeRuleReader(options.rule === undefined ? ruleFor() : options.rule),
        executor,
        queue: queue as never,
        outbox,
        profileReader:
            options.profileId !== undefined
                ? { requireActiveProfileId: () => Promise.resolve(options.profileId!) }
                : profileReader,
        generateId: () => id(0x900),
        clock: { now: () => now },
    });
    return { service, repository, queue, outbox, executor };
}

const approveCmd: ApproveProgressionCommand = { evaluationId: EVALUATION, reason: "Looks good" };

describe("ProgressionApprovalService.approve", () => {
    it("applies a matched template proposal and records the decision + result revision + event", async () => {
        const { service, repository, executor, outbox } = build({ view: evaluationView() });
        const result = await service.approve(approveCmd, metadata);

        expect(result.status).toBe("applied");
        expect(executor.applied).toHaveLength(1);
        // The applied prescription reflects the +5% load bump.
        const set = executor.applied[0]!.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(set.targets.loadKgMin).toBe("105");
        expect(repository.decisions[0]).toMatchObject({
            status: "applied",
            actionStatus: "applied",
            decidedBy: "user-1",
        });
        expect(repository.decisions[0]!.resultRevisions[0]).toMatchObject({
            entityType: "training.workout-template",
            version: 2,
        });
        expect(outbox.events[0]!.name).toBe("training.progression-evaluation.applied");
    });

    it("marks the proposal stale and enqueues a reevaluation when the session version moved", async () => {
        const { service, repository, queue, executor } = build({
            view: evaluationView({ contextRevisions: { session: 1 } }),
            subject: subjectFor({ sessionVersion: 2 }),
        });
        await expect(service.approve(approveCmd, metadata)).rejects.toBeInstanceOf(ProgressionStaleError);
        expect(repository.staled).toEqual([EVALUATION]);
        expect(queue.enqueued[0]).toMatchObject({ type: "progression.evaluate" });
        expect(executor.applied).toHaveLength(0);
        expect(repository.decisions).toHaveLength(0);
    });

    it("refuses to approve an already-resolved proposal", async () => {
        const { service } = build({ view: evaluationView({ status: "applied" }) });
        await expect(service.approve(approveCmd, metadata)).rejects.toBeInstanceOf(ProgressionAlreadyResolvedError);
    });

    it("refuses when a fresh safety policy blocks the change", async () => {
        const { service, executor } = build({
            view: evaluationView({ status: "blocked" }),
            session: sessionState({
                painRecords: [
                    {
                        id: id(0x77),
                        bodyArea: "knee",
                        severity: 6,
                        onsetDuringSession: false,
                        stoppedActivity: false,
                        notes: null,
                    } as never,
                ],
            }),
        });
        await expect(service.approve(approveCmd, metadata)).rejects.toBeInstanceOf(ProgressionNotApplicableError);
        expect(executor.applied).toHaveLength(0);
    });

    it("refuses to approve an evaluation owned by another profile", async () => {
        const { service } = build({ view: evaluationView(), profileId: id(0x999) });
        await expect(service.approve(approveCmd, metadata)).rejects.toBeInstanceOf(ProgressionEvaluationNotFoundError);
    });

    it("does not record a decision when a target application fails (all-or-none)", async () => {
        const targets: ResolvedProgressionTarget[] = [
            {
                ownerType: "workout-template",
                ownerId: TEMPLATE,
                ownerVersion: 1,
                ownerProfileId: PROFILE,
                prescription: templatePrescription(),
            },
            {
                ownerType: "workout-template",
                ownerId: id(0x30),
                ownerVersion: 3,
                ownerProfileId: PROFILE,
                prescription: templatePrescription(),
            },
        ];
        const { service, repository } = build({ view: evaluationView(), targets, failOnIndex: 1 });
        await expect(service.approve(approveCmd, metadata)).rejects.toThrow("apply failed");
        expect(repository.decisions).toHaveLength(0);
    });
});

describe("ProgressionApprovalService.reject", () => {
    it("records a rejection and publishes an event without touching targets", async () => {
        const { service, repository, executor, outbox } = build({ view: evaluationView() });
        const result = await service.reject({ evaluationId: EVALUATION, reason: "Not now" }, metadata);
        expect(result.status).toBe("rejected");
        expect(repository.decisions[0]).toMatchObject({ status: "rejected", actionStatus: "rejected" });
        expect(executor.applied).toHaveLength(0);
        expect(outbox.events[0]!.name).toBe("training.progression-evaluation.rejected");
    });

    it("refuses to reject an already-resolved proposal", async () => {
        const { service } = build({ view: evaluationView({ status: "rejected" }) });
        await expect(service.reject({ evaluationId: EVALUATION }, metadata)).rejects.toBeInstanceOf(
            ProgressionAlreadyResolvedError,
        );
    });
});
