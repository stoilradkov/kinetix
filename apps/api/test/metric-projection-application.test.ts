import { describe, expect, it } from "vitest";

import {
    METRIC_REBUILD_JOB,
    METRIC_REBUILD_JOB_KEY,
    MetricCalculatorRegistry,
    MetricInvalidationOutboxHandler,
    MetricRebuildJobHandler,
    RebuildMetrics,
    RecalculateMetric,
    type AffectedMetric,
    type AnalyticsInvalidationStore,
    type DerivedMetricRecord,
    type DerivedMetricRepository,
    type DerivedMetricView,
    type MetricContextReader,
    type MetricInvalidationReader,
    type PendingInvalidation,
} from "#src/modules/training/application/index";
import {
    invalidationScopeKey,
    type InvalidationScope,
    type MetricCalculator,
    type MetricResult,
    type MetricTarget,
} from "#src/modules/training/domain/index";
import {
    type ClaimedOutboxEvent,
    type CommandContext,
    type EnqueueJob,
    type JobQueue,
    type OutboxHandlerContext,
    type UnitOfWork,
} from "#src/platform/application/index";

const transaction = {};
const ctx: CommandContext = { correlationId: "corr-1", source: "system" };
const unitOfWork: UnitOfWork = { execute: work => work(transaction) };

// --- a pure smoke calculator: numeric value = facts.count, one input at facts.revision --------------

interface SmokeFacts {
    readonly count: number;
    readonly revision: number;
}

function smokeCalculator(version = 1): MetricCalculator<SmokeFacts> {
    return {
        key: "smoke.count",
        version,
        dependencies: ["session"],
        calculate: ({ target, facts }): readonly MetricResult[] => [
            {
                scope: target.scope,
                period: target.period,
                dimensions: target.dimensions,
                value: { numeric: facts.count, text: null, unit: "reps", details: { version } },
                inputs: [{ entityType: "training-session", entityId: target.scope.id, revision: facts.revision }],
            },
        ],
    };
}

function target(id: string): MetricTarget {
    return { scope: { type: "session", id }, period: { kind: "all_time" }, dimensions: {} };
}

// --- in-memory projection repository (supersede-and-insert) ----------------------------------------

interface StoredMetric extends DerivedMetricView {
    readonly naturalKey: string;
    readonly inputs: readonly { entityType: string; entityId: string; revision: number }[];
}

class FakeDerivedMetricRepository implements DerivedMetricRepository {
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
        const view: StoredMetric = {
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
            naturalKey,
            inputs: record.inputs,
        };
        this.rows.push(view);
        return view;
    }

    async clearStale(naturalKey: string): Promise<void> {
        for (const row of this.rows)
            if (row.naturalKey === naturalKey && row.state === "current") Object.assign(row, { stale: false });
    }

    async markStale(scopes: readonly InvalidationScope[]): Promise<number> {
        let marked = 0;
        for (const row of this.rows) {
            if (row.state !== "current") continue;
            if (this.matches(row, scopes)) {
                Object.assign(row, { stale: true });
                marked += 1;
            }
        }
        return marked;
    }

    async findAffected(scopes: readonly InvalidationScope[]): Promise<readonly AffectedMetric[]> {
        return this.rows
            .filter(row => row.state === "current" && this.matches(row, scopes))
            .map(row => ({
                calculatorKey: row.calculatorKey,
                scope: row.scope,
                period: row.period,
                dimensions: row.dimensions,
            }));
    }

    async listCurrentTargets(): Promise<readonly AffectedMetric[]> {
        return this.rows
            .filter(row => row.state === "current")
            .map(row => ({
                calculatorKey: row.calculatorKey,
                scope: row.scope,
                period: row.period,
                dimensions: row.dimensions,
            }));
    }

    async query(): Promise<readonly DerivedMetricView[]> {
        return this.rows.filter(row => row.state === "current");
    }

    private matches(row: StoredMetric, scopes: readonly InvalidationScope[]): boolean {
        return scopes.some(
            scope =>
                (row.scope.type === scope.scopeType && row.scope.id === scope.scopeId) ||
                row.inputs.some(input => input.entityType === scope.scopeType && input.entityId === scope.scopeId),
        );
    }
}

class FakeInvalidationStore implements AnalyticsInvalidationStore {
    readonly rows: PendingInvalidation[] = [];
    private seq = 0;

    async append(invalidations: readonly Omit<PendingInvalidation, "id">[]): Promise<readonly PendingInvalidation[]> {
        const created = invalidations.map(item => ({ ...item, id: `inv-${(this.seq += 1)}` }));
        this.rows.push(...created);
        return created;
    }

    async claimPending(limit: number): Promise<readonly PendingInvalidation[]> {
        return this.rows.slice(0, limit);
    }

    async markProcessed(ids: readonly string[]): Promise<void> {
        for (const id of ids) {
            const index = this.rows.findIndex(row => row.id === id);
            if (index >= 0) this.rows.splice(index, 1);
        }
    }
}

function contextReader(factsById: Map<string, SmokeFacts>): MetricContextReader {
    return {
        load: async (_key, target) => {
            const facts = factsById.get(target.scope.id);
            return facts ? { facts, config: { schema: 1 } } : null;
        },
    };
}

function recalcRuntime(
    repository: DerivedMetricRepository,
    reader: MetricContextReader,
    registry: MetricCalculatorRegistry,
) {
    let counter = 0;
    return new RecalculateMetric({
        unitOfWork,
        registry,
        contextReader: reader,
        repository,
        generateId: () => `metric-${(counter += 1)}`,
        profileIdForScope: () => "profile-1",
    });
}

describe("MetricCalculatorRegistry", () => {
    it("rejects an unknown key and an unknown version", () => {
        const registry = new MetricCalculatorRegistry();
        expect(() => registry.get("smoke.count", 1)).toThrow(/No metric calculator/);
        registry.register(smokeCalculator(1));
        expect(() => registry.get("smoke.count", 2)).toThrow(/No metric calculator/);
        expect(() => registry.getCurrent("unknown.metric")).toThrow(/No metric calculator/);
    });

    it("rejects a duplicate registration and tracks the latest version", () => {
        const registry = new MetricCalculatorRegistry();
        registry.register(smokeCalculator(1));
        expect(() => registry.register(smokeCalculator(1))).toThrow(/already registered/);
        registry.register(smokeCalculator(2));
        expect(registry.getCurrent("smoke.count").version).toBe(2);
        expect(registry.has("smoke.count", 1)).toBe(true);
    });
});

describe("RecalculateMetric", () => {
    it("creates a current projection with its input references", async () => {
        const registry = new MetricCalculatorRegistry();
        registry.register(smokeCalculator());
        const repository = new FakeDerivedMetricRepository();
        const facts = new Map([["s1", { count: 5, revision: 1 }]]);
        const recalc = recalcRuntime(repository, contextReader(facts), registry);

        const view = await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);
        expect(view?.numericValue).toBe(5);
        expect(view?.state).toBe("current");
        expect(repository.rows.filter(row => row.state === "current")).toHaveLength(1);
        expect(repository.rows[0]?.inputs).toEqual([{ entityType: "training-session", entityId: "s1", revision: 1 }]);
    });

    it("skips the rewrite and clears stale when the fingerprint is unchanged", async () => {
        const registry = new MetricCalculatorRegistry();
        registry.register(smokeCalculator());
        const repository = new FakeDerivedMetricRepository();
        const facts = new Map([["s1", { count: 5, revision: 1 }]]);
        const recalc = recalcRuntime(repository, contextReader(facts), registry);

        await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);
        await repository.markStale([{ dependency: "session", scopeType: "session", scopeId: "s1" }]);
        expect(repository.rows[0]?.stale).toBe(true);

        await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);
        expect(repository.rows).toHaveLength(1); // no new row inserted
        expect(repository.rows[0]?.stale).toBe(false); // cleared
    });

    it("supersedes the old row and inserts a new current when the facts change", async () => {
        const registry = new MetricCalculatorRegistry();
        registry.register(smokeCalculator());
        const repository = new FakeDerivedMetricRepository();
        const facts = new Map([["s1", { count: 5, revision: 1 }]]);
        const recalc = recalcRuntime(repository, contextReader(facts), registry);

        await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);
        facts.set("s1", { count: 9, revision: 2 });
        const view = await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);

        expect(view?.numericValue).toBe(9);
        expect(repository.rows).toHaveLength(2);
        expect(repository.rows.filter(row => row.state === "current")).toHaveLength(1);
        expect(repository.rows.filter(row => row.state === "superseded")).toHaveLength(1);
    });

    it("retires the current projection when the source facts are gone", async () => {
        const registry = new MetricCalculatorRegistry();
        registry.register(smokeCalculator());
        const repository = new FakeDerivedMetricRepository();
        const facts = new Map([["s1", { count: 5, revision: 1 }]]);
        const recalc = recalcRuntime(repository, contextReader(facts), registry);

        await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);
        facts.delete("s1");
        const view = await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);

        expect(view).toBeNull();
        expect(repository.rows.filter(row => row.state === "current")).toHaveLength(0);
        expect(repository.rows.filter(row => row.state === "superseded")).toHaveLength(1);
    });
});

describe("RebuildMetrics", () => {
    function setup() {
        const registry = new MetricCalculatorRegistry();
        registry.register(smokeCalculator());
        const repository = new FakeDerivedMetricRepository();
        const invalidations = new FakeInvalidationStore();
        const facts = new Map([["s1", { count: 5, revision: 1 }]]);
        const recalc = recalcRuntime(repository, contextReader(facts), registry);
        const rebuild = new RebuildMetrics({ unitOfWork, recalculate: recalc, repository, invalidations });
        return { repository, invalidations, facts, recalc, rebuild };
    }

    it("targeted rebuild drains pending invalidations and recomputes what they affect", async () => {
        const { repository, invalidations, facts, recalc, rebuild } = setup();
        await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);

        // A change stales the projection and appends a pending invalidation.
        facts.set("s1", { count: 12, revision: 2 });
        await invalidations.append([
            { dependency: "session", scopeType: "session", scopeId: "s1", reason: "test", eventId: "e1" },
        ]);

        const summary = await rebuild.fromPendingInvalidations(ctx);
        expect(summary).toEqual({ recomputed: 1, drainedInvalidations: 1 });
        expect(invalidations.rows).toHaveLength(0); // drained
        expect((await repository.query())[0]?.numericValue).toBe(12);
    });

    it("full rebuild recomputes every current projection idempotently", async () => {
        const { repository, recalc, rebuild } = setup();
        await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);
        const summary = await rebuild.full(ctx);
        expect(summary.recomputed).toBe(1);
        expect(repository.rows).toHaveLength(1); // unchanged facts → no supersession
    });

    it("full rebuild is a no-op when nothing is registered / stored", async () => {
        const { rebuild } = setup();
        expect(await rebuild.full(ctx)).toEqual({ recomputed: 0, drainedInvalidations: 0 });
    });
});

describe("MetricInvalidationOutboxHandler", () => {
    function fakeQueue(): { queue: JobQueue; enqueued: EnqueueJob[] } {
        const enqueued: EnqueueJob[] = [];
        return {
            enqueued,
            queue: { enqueue: async job => (enqueued.push(job), { id: "job-1" }) as never },
        };
    }

    const reader: MetricInvalidationReader = {
        describeSession: async () => ({ profileId: "p1", localDate: "2026-08-05", plannedSessionIds: ["pl1"] }),
        sessionsForPlan: async () => ["s1", "s2"],
        sessionsForContextDate: async () => ["s1"],
        sessionsInZoneInterval: async () => ["s1"],
    };

    const outboxContext: OutboxHandlerContext = {
        transaction,
        idempotencyKey: "idem",
        correlationId: "corr-1",
        causationId: null,
        heartbeat: async () => true,
    };

    function event(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
        return {
            id: "e1",
            name: "training.session.completed",
            version: 1,
            stableName: "training.session.completed",
            aggregateType: "training-session",
            aggregateId: "s1",
            aggregateRevision: 2,
            payload: { trainingSessionId: "s1" },
            payloadFingerprint: "f",
            state: "processing",
            attempts: 1,
            maxAttempts: 5,
            correlationId: "corr-1",
            causationId: null,
            occurredAt: new Date(),
            lease: { owner: "w", expiresAt: new Date(), heartbeatAt: new Date() },
            ...overrides,
        };
    }

    it("appends coalesced invalidations, marks matching projections stale, and enqueues a coalesced job", async () => {
        const registry = new MetricCalculatorRegistry();
        registry.register(smokeCalculator());
        const repository = new FakeDerivedMetricRepository();
        const invalidations = new FakeInvalidationStore();
        const facts = new Map([["s1", { count: 5, revision: 1 }]]);
        await recalcRuntime(repository, contextReader(facts), registry).run(
            { calculatorKey: "smoke.count", target: target("s1") },
            ctx,
        );
        const { queue, enqueued } = fakeQueue();
        const handler = new MetricInvalidationOutboxHandler("training.session.completed", "session", {
            store: invalidations,
            repository,
            queue,
            reader,
        });

        await handler.handle(event(), outboxContext);

        // The session fan-out includes the session scope plus its windows.
        expect(invalidations.rows.map(invalidationScopeKey)).toContain("session|session|s1");
        expect(invalidations.rows.map(invalidationScopeKey)).toContain("session|profile-week|p1:2026-08-03");
        expect(repository.rows[0]?.stale).toBe(true);
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0]?.type).toBe(METRIC_REBUILD_JOB);
        expect(enqueued[0]?.idempotencyKey).toBe(METRIC_REBUILD_JOB_KEY);
    });

    it("fans a plan change out to every mapped actual session", async () => {
        const repository = new FakeDerivedMetricRepository();
        const invalidations = new FakeInvalidationStore();
        const { queue } = fakeQueue();
        const handler = new MetricInvalidationOutboxHandler("training.planned-session.updated", "plan", {
            store: invalidations,
            repository,
            queue,
            reader,
        });

        await handler.handle(
            event({ name: "training.planned-session.updated", payload: { plannedSessionId: "pl1" } }),
            outboxContext,
        );
        const keys = invalidations.rows.map(invalidationScopeKey);
        expect(keys).toContain("plan|planned-session|pl1");
        expect(keys).toContain("plan|session|s1");
        expect(keys).toContain("plan|session|s2");
    });
});

describe("MetricRebuildJobHandler", () => {
    it("runs the targeted rebuild inside the worker transaction", async () => {
        const registry = new MetricCalculatorRegistry();
        registry.register(smokeCalculator());
        const repository = new FakeDerivedMetricRepository();
        const invalidations = new FakeInvalidationStore();
        const facts = new Map([["s1", { count: 5, revision: 1 }]]);
        const recalc = recalcRuntime(repository, contextReader(facts), registry);
        await recalc.run({ calculatorKey: "smoke.count", target: target("s1") }, ctx);
        facts.set("s1", { count: 20, revision: 3 });
        await invalidations.append([
            { dependency: "session", scopeType: "session", scopeId: "s1", reason: "test", eventId: "e1" },
        ]);
        const rebuild = new RebuildMetrics({ unitOfWork, recalculate: recalc, repository, invalidations });
        const handler = new MetricRebuildJobHandler(rebuild);

        await handler.handle(
            { correlationId: "corr-1" },
            {
                transaction,
                idempotencyKey: "k",
                correlationId: "corr-1",
                causationId: null,
                heartbeat: async () => true,
                reportProgress: async () => true,
            },
        );
        expect((await repository.query())[0]?.numericValue).toBe(20);
    });
});
