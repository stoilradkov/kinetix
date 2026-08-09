import { describe, expect, it } from "vitest";

import type {
    ApplicableProgressionRuleReader,
    ProgressionContextReader,
    ProgressionEvaluationListFilter,
    ProgressionEvaluationRecord,
    ProgressionEvaluationRepository,
    ProgressionEvaluationSubject,
    ProgressionEvaluationView,
    ProgressionHealthReader,
    ProgressionRuleResource,
    SessionScopeChain,
} from "#src/modules/training/application/index";
import {
    EvaluateProgression,
    ProgressionEvaluationJobHandler,
    ProgressionSubjectUnavailableError,
    SessionProgressionOutboxHandler,
    deriveSessionMetricFacts,
    ruleMatchesScope,
} from "#src/modules/training/application/index";
import type {
    ClaimedJob,
    ClaimedOutboxEvent,
    JobHandlerContext,
    JobQueue,
    OutboxHandlerContext,
    UnitOfWork,
} from "#src/platform/application/index";
import type { ConditionV1, RuleTrigger, TrainingSessionState } from "#src/modules/training/domain/index";

const transaction = {};
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;
const PROFILE = id(1);
const SESSION = id(2);
const PROGRAM = id(3);
const RULE = id(4);

const unitOfWork: UnitOfWork = { execute: work => work(transaction) };

// --- builders ------------------------------------------------------------------------------------

function sessionState(overrides: Partial<TrainingSessionState> = {}): TrainingSessionState {
    return {
        id: SESSION,
        profileId: PROFILE,
        status: "completed",
        title: null,
        localDate: "2026-08-09",
        timeZone: "UTC",
        startedAt: null,
        endedAt: null,
        durationMinutes: null,
        readiness: { energy: 4, motivation: 4, fatigue: null, soreness: null, stress: null, recovery: null },
        postWorkout: { energy: null, motivation: null, enjoyment: null, difficulty: null, fatigue: null, notes: null },
        notes: null,
        tags: [],
        sourcePlannedSessionId: null,
        activities: [
            {
                id: id(20),
                type: "strength",
                position: 0,
                startedAt: null,
                endedAt: null,
                durationSeconds: null,
                rpe: 7,
                feeling: null,
                notes: null,
                tags: [],
                running: null,
                strength: {
                    setGroups: [],
                    occurrences: [
                        {
                            id: id(21),
                            exerciseId: id(22),
                            snapshot: { schemaVersion: 1 } as never,
                            position: 0,
                            purpose: null,
                            technique: null,
                            discomfort: null,
                            pump: null,
                            notes: null,
                            performedSets: [performedSet("completed", 8), performedSet("completed", 8)],
                        },
                    ],
                },
            },
        ],
        painRecords: [],
        plannedLinks: [],
        activityMappings: [],
        occurrenceMappings: [],
        setMappings: [],
        runStepMappings: [],
        archivedAt: null,
        createdAt: "2026-08-09T09:00:00.000Z",
        updatedAt: "2026-08-09T09:00:00.000Z",
        ...overrides,
    } as TrainingSessionState;
}

function performedSet(status: "completed" | "partial" | "skipped" | "added", rpe: number | null) {
    return {
        id: id(100 + rpe!),
        setGroupId: null,
        round: null,
        position: 0,
        setType: "working" as const,
        status,
        failureReason: null,
        technique: null,
        discomfort: null,
        pump: null,
        notes: null,
        measurements: {
            reps: 8,
            externalLoad: null,
            bodyweight: null,
            addedLoad: null,
            assistanceLoad: null,
            effectiveLoad: null,
            duration: null,
            distance: null,
            powerWatts: null,
            rpe,
            rir: null,
            tempo: null,
            restBefore: null,
            restAfter: null,
        },
    };
}

const scopeChain = (overrides: Partial<SessionScopeChain> = {}): SessionScopeChain => ({
    programIds: [PROGRAM],
    blockIds: [],
    templateIds: [],
    exerciseLogicalKeys: [],
    setLogicalKeys: [],
    ...overrides,
});

function rule(overrides: Partial<ProgressionRuleResource> = {}): ProgressionRuleResource {
    const condition: ConditionV1 = {
        kind: "metric",
        metric: { key: "rpe", scope: "session" },
        operator: "lte",
        value: 8,
    };
    return {
        id: RULE,
        profileId: PROFILE,
        name: "Progress on low RPE",
        description: null,
        scope: { type: "program", id: PROGRAM },
        target: { mode: "next", selector: { kind: "scope" } },
        conditionSchemaVersion: 1,
        condition,
        actionSchemaVersion: 1,
        actions: [{ type: "adjust_load", mode: "percent", value: 2.5 }],
        triggers: ["session_completed", "manual"],
        enabled: true,
        autoApply: false,
        safetyPolicy: { policyKey: null, config: {} },
        status: "active",
        archivedAt: null,
        createdAt: "2026-08-09T09:00:00.000Z",
        updatedAt: "2026-08-09T09:00:00.000Z",
        version: 1,
        ...overrides,
    };
}

// --- fakes ---------------------------------------------------------------------------------------

class FakeContextReader implements ProgressionContextReader {
    constructor(
        private readonly session: TrainingSessionState | null,
        private readonly subject: ProgressionEvaluationSubject,
    ) {}
    loadSubject(): Promise<{ subject: ProgressionEvaluationSubject; session: TrainingSessionState } | null> {
        return Promise.resolve(this.session ? { subject: this.subject, session: this.session } : null);
    }
}

class FakeRuleReader implements ApplicableProgressionRuleReader {
    constructor(private readonly rules: readonly ProgressionRuleResource[]) {}
    findEnabledByTrigger(trigger: RuleTrigger): Promise<readonly ProgressionRuleResource[]> {
        return Promise.resolve(this.rules.filter(r => r.triggers.includes(trigger)));
    }
    findById(ruleId: string): Promise<ProgressionRuleResource | null> {
        return Promise.resolve(this.rules.find(r => r.id === ruleId) ?? null);
    }
}

class FakeEvaluationRepository implements ProgressionEvaluationRepository {
    readonly inserted: ProgressionEvaluationRecord[] = [];
    existsByFingerprint(fingerprint: string): Promise<boolean> {
        return Promise.resolve(this.inserted.some(record => record.contextFingerprint === fingerprint));
    }
    insert(record: ProgressionEvaluationRecord): Promise<ProgressionEvaluationView> {
        this.inserted.push(record);
        return Promise.resolve(toView(record));
    }
    readById(evaluationId: string): Promise<ProgressionEvaluationView | null> {
        const record = this.inserted.find(entry => entry.id === evaluationId);
        return Promise.resolve(record ? toView(record) : null);
    }
    loadForUpdate(evaluationId: string): Promise<ProgressionEvaluationView | null> {
        return this.readById(evaluationId);
    }
    recordDecision(): Promise<ProgressionEvaluationView> {
        throw new Error("not used in evaluation tests");
    }
    markStale(): Promise<void> {
        return Promise.resolve();
    }
    listForSession(sessionId: string): Promise<readonly ProgressionEvaluationView[]> {
        return Promise.resolve(this.inserted.filter(r => r.trainingSessionId === sessionId).map(toView));
    }
    listForProfile(filter: ProgressionEvaluationListFilter): Promise<readonly ProgressionEvaluationView[]> {
        return Promise.resolve(
            this.inserted.filter(r => filter.status === undefined || r.status === filter.status).map(toView),
        );
    }
}

function toView(record: ProgressionEvaluationRecord): ProgressionEvaluationView {
    return { ...record };
}

function subjectFor(overrides: Partial<ProgressionEvaluationSubject> = {}): ProgressionEvaluationSubject {
    return {
        sessionId: SESSION,
        profileId: PROFILE,
        sessionVersion: 1,
        completed: true,
        scope: scopeChain(),
        recoveryIntervalHours: null,
        weeklyVolume: null,
        ...overrides,
    };
}

class FakeHealthReader implements ProgressionHealthReader {
    constructor(private readonly sleepHours: number | null = null) {}
    readSleepHours(): Promise<number | null> {
        return Promise.resolve(this.sleepHours);
    }
}

function service(
    reader: FakeContextReader,
    rules: FakeRuleReader,
    repository: FakeEvaluationRepository,
    healthReader: ProgressionHealthReader = new FakeHealthReader(),
) {
    let counter = 0;
    return new EvaluateProgression({
        unitOfWork,
        contextReader: reader,
        ruleReader: rules,
        repository,
        healthReader,
        generateId: () => id(500 + counter++),
        clock: { now: () => new Date("2026-08-09T10:00:00.000Z") },
    });
}

const metadata = { correlationId: id(999), source: "user" as const };

// --- tests ---------------------------------------------------------------------------------------

describe("deriveSessionMetricFacts", () => {
    it("derives session-scoped facts and stamps the session revision", () => {
        const { facts, revisions } = deriveSessionMetricFacts(sessionState(), 3);
        expect(revisions).toEqual({ session: 3 });
        const key = (k: string) => [...facts.entries()].find(([entry]) => entry.startsWith(`${k}|`))?.[1];
        expect(key("sets_completed")).toEqual({ value: 2, sourceRevision: 3 });
        expect(key("completed_all_sets")).toEqual({ value: true, sourceRevision: 3 });
        expect(key("readiness")).toEqual({ value: 4, sourceRevision: 3 });
    });
});

describe("ruleMatchesScope", () => {
    it("matches program scope against the resolved chain and rejects a foreign block", () => {
        expect(ruleMatchesScope({ type: "program", id: PROGRAM }, scopeChain())).toBe(true);
        expect(ruleMatchesScope({ type: "block", id: id(77) }, scopeChain())).toBe(false);
    });
});

describe("EvaluateProgression", () => {
    it("evaluates an applicable rule and persists one pending evaluation with proposed actions", async () => {
        const repository = new FakeEvaluationRepository();
        const results = await service(
            new FakeContextReader(sessionState(), subjectFor()),
            new FakeRuleReader([rule()]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);

        expect(repository.inserted).toHaveLength(1);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ matched: true, status: "pending", ruleVersion: 1 });
        expect(results[0]!.actions).toEqual([
            {
                position: 0,
                actionType: "adjust_load",
                action: { type: "adjust_load", mode: "percent", value: 2.5 },
                status: "proposed",
            },
        ]);
        expect(results[0]!.contextRevisions).toEqual({ session: 1 });
    });

    it("is replay-safe: the same rule version and context revisions never duplicate", async () => {
        const repository = new FakeEvaluationRepository();
        const svc = service(
            new FakeContextReader(sessionState(), subjectFor()),
            new FakeRuleReader([rule()]),
            repository,
        );
        await svc.evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);
        await svc.evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);
        expect(repository.inserted).toHaveLength(1);
    });

    it("re-evaluates when the session version advances", async () => {
        const repository = new FakeEvaluationRepository();
        await service(
            new FakeContextReader(sessionState(), subjectFor({ sessionVersion: 1 })),
            new FakeRuleReader([rule()]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);
        await service(
            new FakeContextReader(sessionState(), subjectFor({ sessionVersion: 2 })),
            new FakeRuleReader([rule()]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);
        expect(repository.inserted).toHaveLength(2);
    });

    it("skips a non-completed session", async () => {
        const repository = new FakeEvaluationRepository();
        const results = await service(
            new FakeContextReader(sessionState({ status: "in_progress" }), subjectFor({ completed: false })),
            new FakeRuleReader([rule()]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);
        expect(results).toHaveLength(0);
        expect(repository.inserted).toHaveLength(0);
    });

    it("ignores rules whose scope or trigger does not apply", async () => {
        const repository = new FakeEvaluationRepository();
        await service(
            new FakeContextReader(sessionState(), subjectFor()),
            new FakeRuleReader([
                rule({ id: id(40), scope: { type: "block", id: id(77) } }),
                rule({ id: id(41), triggers: ["manual"] }),
                rule({ id: id(42), enabled: false }),
            ]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);
        expect(repository.inserted).toHaveLength(0);
    });

    it("throws when the session cannot be loaded", async () => {
        const repository = new FakeEvaluationRepository();
        await expect(
            service(
                new FakeContextReader(null, subjectFor()),
                new FakeRuleReader([rule()]),
                repository,
            ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata),
        ).rejects.toBeInstanceOf(ProgressionSubjectUnavailableError);
    });

    it("blocks a matched rule whose load increase exceeds its safety limit", async () => {
        const repository = new FakeEvaluationRepository();
        const results = await service(
            new FakeContextReader(sessionState(), subjectFor()),
            new FakeRuleReader([
                rule({
                    actions: [{ type: "adjust_load", mode: "percent", value: 20 }],
                    safetyPolicy: { policyKey: null, config: { maxLoadIncreasePercent: 5 } },
                }),
            ]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);

        expect(results[0]).toMatchObject({ matched: true, status: "blocked", autoApplyEligible: false });
        expect(results[0]!.safety.outcome).toBe("block");
        expect(results[0]!.safety.findings.find(f => f.policyKey === "max_load_increase")?.outcome).toBe("block");
    });

    it("requires approval and names the missing input when active pain was not assessed", async () => {
        const repository = new FakeEvaluationRepository();
        const results = await service(
            new FakeContextReader(
                sessionState({
                    readiness: {
                        energy: null,
                        motivation: null,
                        fatigue: null,
                        soreness: null,
                        stress: null,
                        recovery: null,
                    },
                }),
                subjectFor(),
            ),
            new FakeRuleReader([rule()]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);

        expect(results[0]!.status).toBe("pending");
        expect(results[0]!.safety.outcome).toBe("requires_approval");
        expect(results[0]!.safety.missingInputs).toContain("readiness");
        expect(results[0]!.autoApplyEligible).toBe(false);
    });

    it("marks a safe, non-conflicting, enabled, non-template rule as auto-apply eligible", async () => {
        const repository = new FakeEvaluationRepository();
        const results = await service(
            new FakeContextReader(sessionState(), subjectFor()),
            new FakeRuleReader([rule({ autoApply: true })]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);

        expect(results[0]).toMatchObject({ status: "pending", autoApplyEligible: true });
        expect(results[0]!.autoApplyReason).toBeNull();
    });

    it("blocks both rules that propose overlapping changes to the same target field", async () => {
        const repository = new FakeEvaluationRepository();
        const results = await service(
            new FakeContextReader(sessionState(), subjectFor()),
            new FakeRuleReader([
                rule({ id: id(40), autoApply: true, actions: [{ type: "adjust_load", mode: "percent", value: 2.5 }] }),
                rule({ id: id(41), autoApply: true, actions: [{ type: "adjust_load", mode: "percent", value: 5 }] }),
            ]),
            repository,
        ).evaluateSession({ sessionId: SESSION, trigger: "session_completed" }, metadata);

        expect(results).toHaveLength(2);
        expect(results.every(r => r.status === "blocked")).toBe(true);
        expect(results.every(r => r.conflict.conflicting && !r.autoApplyEligible)).toBe(true);
        expect(results[0]!.conflict.ruleIds).toContain(id(41));
        expect(results[1]!.conflict.ruleIds).toContain(id(40));
    });
});

describe("SessionProgressionOutboxHandler", () => {
    const enqueued: unknown[] = [];
    const queue: JobQueue = {
        enqueue: input => {
            enqueued.push(input);
            return Promise.resolve({} as never);
        },
    };
    const context = { transaction } as OutboxHandlerContext;
    const event = (invalidation: Record<string, boolean>): ClaimedOutboxEvent =>
        ({
            id: id(200),
            name: "training.session.completed",
            aggregateId: SESSION,
            correlationId: id(201),
            payload: { trainingSessionId: SESSION, invalidation },
        }) as unknown as ClaimedOutboxEvent;

    it("enqueues an evaluation job when progression is invalidated", async () => {
        enqueued.length = 0;
        await new SessionProgressionOutboxHandler("training.session.completed", queue).handle(
            event({ progression: true }),
            context,
        );
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0]).toMatchObject({ type: "progression.evaluate", payload: { trainingSessionId: SESSION } });
    });

    it("ignores events that do not invalidate progression", async () => {
        enqueued.length = 0;
        await new SessionProgressionOutboxHandler("training.session.completed", queue).handle(
            event({ progression: false }),
            context,
        );
        expect(enqueued).toHaveLength(0);
    });
});

describe("ProgressionEvaluationJobHandler", () => {
    it("evaluates the session named in the job payload", async () => {
        const repository = new FakeEvaluationRepository();
        const handler = new ProgressionEvaluationJobHandler(
            service(new FakeContextReader(sessionState(), subjectFor()), new FakeRuleReader([rule()]), repository),
        );
        await handler.handle(
            { payload: { trainingSessionId: SESSION }, correlationId: id(3) } as unknown as ClaimedJob,
            { transaction } as JobHandlerContext,
        );
        expect(repository.inserted).toHaveLength(1);
    });
});
