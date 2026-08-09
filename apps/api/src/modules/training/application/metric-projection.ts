import type { CommandContext } from "#src/platform/application/command-context";
import {
    type ClaimedOutboxEvent,
    type EnqueueJob,
    type JobHandler,
    type JobHandlerContext,
    type JobQueue,
    type OutboxHandler,
    type OutboxHandlerContext,
    workName,
} from "#src/platform/application/durable-work";
import { hashRequest } from "#src/platform/application/request-hash";
import type { UnitOfWork } from "#src/platform/application/unit-of-work";
import type { Clock } from "#src/platform/domain/index";

import {
    coalesceInvalidations,
    expandInvalidation,
    metricFingerprintDescriptor,
    metricNaturalKeyDescriptor,
    type InvalidationScope,
    type MetricCalculator,
    type MetricDimensions,
    type MetricPeriod,
    type MetricResult,
    type MetricScope,
    type MetricTarget,
    type SourceChange,
} from "#src/modules/training/domain/index";

// -------------------------------------------------------------------------------------------------
// DI tokens
// -------------------------------------------------------------------------------------------------

export const METRIC_CALCULATOR_REGISTRY = Symbol("METRIC_CALCULATOR_REGISTRY");
export const METRIC_CONTEXT_READER = Symbol("METRIC_CONTEXT_READER");
export const DERIVED_METRIC_REPOSITORY = Symbol("DERIVED_METRIC_REPOSITORY");
export const ANALYTICS_INVALIDATION_STORE = Symbol("ANALYTICS_INVALIDATION_STORE");
export const METRIC_INVALIDATION_READER = Symbol("METRIC_INVALIDATION_READER");
export const RECALCULATE_METRIC = Symbol("RECALCULATE_METRIC");
export const REBUILD_METRICS = Symbol("REBUILD_METRICS");

/** Durable job that rebuilds the projections a batch of invalidations (or a full sweep) marked stale. */
export const METRIC_REBUILD_JOB = "analytics.metric-rebuild";
export const METRIC_REBUILD_JOB_VERSION = 1;
/** The idempotency key that coalesces every targeted rebuild enqueued between two worker ticks. */
export const METRIC_REBUILD_JOB_KEY = "analytics.metric-rebuild:pending";
/** The scheduled full-rebuild sweep uses the same calculators through a distinct job type. */
export const METRIC_FULL_REBUILD_JOB = "analytics.metric-full-rebuild";
export const METRIC_FULL_REBUILD_JOB_VERSION = 1;
export const METRIC_FULL_REBUILD_SCHEDULE = "analytics.metric-full-rebuild";

// -------------------------------------------------------------------------------------------------
// Application-facing views + persistence records
// -------------------------------------------------------------------------------------------------

/** A projected metric as read back for a query surface (the current, or a superseded, row). */
export interface DerivedMetricView {
    readonly id: string;
    readonly profileId: string | null;
    readonly calculatorKey: string;
    readonly calculatorVersion: number;
    readonly scope: MetricScope;
    readonly period: MetricPeriod;
    readonly dimensions: MetricDimensions;
    readonly numericValue: number | null;
    readonly textValue: string | null;
    readonly unit: string | null;
    readonly details: Readonly<Record<string, unknown>>;
    readonly sourceFingerprint: string;
    readonly state: "current" | "superseded";
    readonly stale: boolean;
    readonly calculatedAt: Date;
    readonly supersededAt: Date | null;
}

/** One row a recompute is about to write; the service stamps the id, natural key, and fingerprint. */
export interface DerivedMetricRecord {
    readonly id: string;
    readonly profileId: string | null;
    readonly calculatorKey: string;
    readonly calculatorVersion: number;
    readonly naturalKey: string;
    readonly scope: MetricScope;
    readonly period: MetricPeriod;
    readonly dimensions: MetricDimensions;
    readonly numericValue: number | null;
    readonly textValue: string | null;
    readonly unit: string | null;
    readonly details: Readonly<Record<string, unknown>>;
    readonly sourceFingerprint: string;
    readonly calculatedAt: Date;
    readonly inputs: readonly MetricInputRow[];
}

export interface MetricInputRow {
    readonly entityType: string;
    readonly entityId: string;
    readonly revision: number;
}

/** The natural coordinates of a stored metric — enough to recompute it through its calculator. */
export interface AffectedMetric {
    readonly calculatorKey: string;
    readonly scope: MetricScope;
    readonly period: MetricPeriod;
    readonly dimensions: MetricDimensions;
}

// -------------------------------------------------------------------------------------------------
// Capability ports
// -------------------------------------------------------------------------------------------------

/**
 * Builds the exact facts a calculator scores for one target, in bounded read-only round-trips. Returns
 * `null` when the source facts no longer exist (e.g. the session was deleted) so the recompute supersedes
 * the current projection without inserting a replacement. Drizzle rows never escape the adapter.
 */
export interface MetricContextReader<Transaction = unknown> {
    load(
        calculatorKey: string,
        target: MetricTarget,
        transaction?: Transaction,
    ): Promise<{ readonly facts: unknown; readonly config: Readonly<Record<string, unknown>> } | null>;
}

/**
 * Idempotent projection store for derived metrics. Writes are supersede-and-insert, never in-place
 * mutation: `supersedeAndInsert` marks the current row for a natural key `superseded` and inserts the new
 * `current` row (plus its input references) in the caller's transaction, so a partial unique index keeps
 * at most one live row per natural key and superseded history is preserved (ADR 0006).
 */
export interface DerivedMetricRepository<Transaction = unknown> {
    currentByNaturalKey(naturalKey: string, transaction?: Transaction): Promise<DerivedMetricView | null>;
    supersedeAndInsert(
        naturalKey: string,
        record: DerivedMetricRecord | null,
        transaction: Transaction,
    ): Promise<DerivedMetricView | null>;
    /** Clear the `stale` flag on a current row whose fingerprint was unchanged (no rewrite needed). */
    clearStale(naturalKey: string, transaction: Transaction): Promise<void>;
    /** Mark every current row matching an invalidation scope (by projection scope or input ref) stale. */
    markStale(scopes: readonly InvalidationScope[], transaction: Transaction): Promise<number>;
    /** Source-revision lookup: the current metrics an invalidation batch affects, for targeted rebuild. */
    findAffected(scopes: readonly InvalidationScope[], transaction?: Transaction): Promise<readonly AffectedMetric[]>;
    /** Every current metric's coordinates — the scheduled full rebuild recomputes them all. */
    listCurrentTargets(transaction?: Transaction): Promise<readonly AffectedMetric[]>;
    /** Read surface for the low-level metric query contract. */
    query(query: MetricQuery, transaction?: Transaction): Promise<readonly DerivedMetricView[]>;
}

export interface MetricQuery {
    readonly calculatorKey?: string;
    readonly scopeType?: string;
    readonly scopeId?: string;
    readonly includeSuperseded?: boolean;
    readonly limit: number;
}

/**
 * A pending invalidation as recorded in `analytics_invalidations` (design §16.2). The store coalesces
 * duplicate (dependency, scope) rows and the rebuild job drains them.
 */
export interface PendingInvalidation extends InvalidationScope {
    readonly id: string;
    readonly reason: string;
    readonly eventId: string | null;
}

/**
 * Durable record of coalesced invalidations. Outbox handlers append pending rows; the rebuild job reads
 * the pending batch and marks it processed after recomputing. Duplicate (dependency, scope) rows converge.
 */
export interface AnalyticsInvalidationStore<Transaction = unknown> {
    append(
        invalidations: readonly Omit<PendingInvalidation, "id">[],
        transaction: Transaction,
    ): Promise<readonly PendingInvalidation[]>;
    claimPending(limit: number, transaction: Transaction): Promise<readonly PendingInvalidation[]>;
    markProcessed(ids: readonly string[], processedAt: Date, transaction: Transaction): Promise<void>;
}

/**
 * Resolves the cross-references invalidation fan-out needs but an event payload does not carry: the
 * profile/date/plan of a session, the sessions a plan or a context date affects, and the sessions inside a
 * zone definition's effective interval (design §16.3). Read-only; rows never escape the adapter.
 */
export interface MetricInvalidationReader<Transaction = unknown> {
    describeSession(
        sessionId: string,
        transaction?: Transaction,
    ): Promise<{
        readonly profileId: string;
        readonly localDate: string | null;
        readonly plannedSessionIds: readonly string[];
    } | null>;
    sessionsForPlan(plannedSessionId: string, transaction?: Transaction): Promise<readonly string[]>;
    sessionsForContextDate(profileId: string, transaction?: Transaction): Promise<readonly string[]>;
    sessionsInZoneInterval(zoneId: string, transaction?: Transaction): Promise<readonly string[]>;
}

// -------------------------------------------------------------------------------------------------
// Calculator registry (design §16.1: calculators are code-registered and versioned)
// -------------------------------------------------------------------------------------------------

/**
 * `key.vN`-keyed registry of pure metric calculators, mirroring the durable-work handler registries. A
 * calculator may evolve to a new version without rewriting previously stored results; `getCurrent` returns
 * the highest registered version for a key so a rebuild always uses the latest formula. Unknown keys and
 * unknown/duplicate versions are rejected.
 */
export class MetricCalculatorRegistry {
    private readonly calculators = new Map<string, MetricCalculator>();
    private readonly latestVersion = new Map<string, number>();

    register(calculator: MetricCalculator): void {
        const key = workName(calculator.key, calculator.version);
        if (this.calculators.has(key)) throw new Error(`Metric calculator ${key} is already registered`);
        this.calculators.set(key, calculator);
        this.latestVersion.set(
            calculator.key,
            Math.max(this.latestVersion.get(calculator.key) ?? 0, calculator.version),
        );
    }

    /** Resolve an exact `key.vN`; throws on an unknown key or version. */
    get(key: string, version: number): MetricCalculator {
        const calculator = this.calculators.get(workName(key, version));
        if (calculator === undefined)
            throw new Error(`No metric calculator is registered for ${workName(key, version)}`);
        return calculator;
    }

    /** Resolve the highest registered version for a key; throws on an unknown key. */
    getCurrent(key: string): MetricCalculator {
        const version = this.latestVersion.get(key);
        if (version === undefined) throw new Error(`No metric calculator is registered for key ${key}`);
        return this.get(key, version);
    }

    has(key: string, version?: number): boolean {
        return version === undefined ? this.latestVersion.has(key) : this.calculators.has(workName(key, version));
    }

    keys(): readonly string[] {
        return [...this.latestVersion.keys()];
    }
}

// -------------------------------------------------------------------------------------------------
// RecalculateMetric — the idempotent primitive every rebuild path runs through
// -------------------------------------------------------------------------------------------------

export interface RecalculateMetricCommand {
    readonly calculatorKey: string;
    /** Exact version override (`vN`); defaults to the current registered version for the key. */
    readonly version?: number;
    readonly target: MetricTarget;
}

interface RecalculateMetricRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly registry: MetricCalculatorRegistry;
    readonly contextReader: MetricContextReader<Transaction>;
    readonly repository: DerivedMetricRepository<Transaction>;
    readonly generateId: () => string;
    readonly clock?: Clock;
    /** How the record's owning profile is derived from the scope, when the scope is profile-shaped. */
    readonly profileIdForScope?: (scope: MetricScope) => string | null;
}

/**
 * Recompute a single metric (one natural key) idempotently and persist it supersede-and-insert. Loads the
 * target's facts through the context reader, runs the registered calculator, and — when the new source
 * fingerprint matches the current row — clears the stale flag and skips the rewrite so replaying identical
 * facts is a no-op (design §16.3). Every targeted, scheduled, and manual rebuild runs through this one
 * primitive, so all rebuild paths share the same idempotent calculators.
 */
export class RecalculateMetric<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: RecalculateMetricRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
    }

    async run(
        command: RecalculateMetricCommand,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<DerivedMetricView | null> {
        return this.inTransaction(transaction, async activeTransaction => {
            const calculator =
                command.version === undefined
                    ? this.runtime.registry.getCurrent(command.calculatorKey)
                    : this.runtime.registry.get(command.calculatorKey, command.version);

            const naturalKey = hashRequest(metricNaturalKeyDescriptor(calculator.key, command.target));
            const loaded = await this.runtime.contextReader.load(calculator.key, command.target, activeTransaction);
            const results = loaded
                ? calculator.calculate({ target: command.target, facts: loaded.facts, config: loaded.config })
                : [];
            const match = selectResultForTarget(results, command.target);

            if (match === undefined || loaded === null) {
                // No result for this target any more (source removed or dropped) — retire the current row.
                return this.runtime.repository.supersedeAndInsert(naturalKey, null, activeTransaction);
            }

            const fingerprint = hashRequest(
                metricFingerprintDescriptor(calculator.key, calculator.version, loaded.config, match),
            );
            const current = await this.runtime.repository.currentByNaturalKey(naturalKey, activeTransaction);
            if (current !== null && current.sourceFingerprint === fingerprint) {
                await this.runtime.repository.clearStale(naturalKey, activeTransaction);
                return current;
            }

            const record = this.toRecord(calculator, naturalKey, match, fingerprint);
            return this.runtime.repository.supersedeAndInsert(naturalKey, record, activeTransaction);
        });
    }

    private toRecord(
        calculator: MetricCalculator,
        naturalKey: string,
        result: MetricResult,
        fingerprint: string,
    ): DerivedMetricRecord {
        return {
            id: this.runtime.generateId(),
            profileId: this.runtime.profileIdForScope?.(result.scope) ?? null,
            calculatorKey: calculator.key,
            calculatorVersion: calculator.version,
            naturalKey,
            scope: result.scope,
            period: result.period,
            dimensions: result.dimensions,
            numericValue: result.value.numeric,
            textValue: result.value.text,
            unit: result.value.unit,
            details: result.value.details,
            sourceFingerprint: fingerprint,
            calculatedAt: this.clock.now(),
            inputs: result.inputs.map(input => ({ ...input })),
        };
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }
}

// -------------------------------------------------------------------------------------------------
// RebuildMetrics — targeted (from invalidations), scheduled full, and manual sweeps
// -------------------------------------------------------------------------------------------------

interface RebuildMetricsRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly recalculate: RecalculateMetric<Transaction>;
    readonly repository: DerivedMetricRepository<Transaction>;
    readonly invalidations: AnalyticsInvalidationStore<Transaction>;
    readonly clock?: Clock;
    readonly batchSize?: number;
}

export interface RebuildSummary {
    readonly recomputed: number;
    readonly drainedInvalidations: number;
}

/**
 * Drains pending invalidations (targeted rebuild) or sweeps every current projection (full rebuild),
 * recomputing each affected metric through {@link RecalculateMetric}. Targeted, scheduled full, and manual
 * rebuilds therefore share the same idempotent calculators (acceptance criterion 5).
 */
export class RebuildMetrics<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly batchSize: number;

    constructor(private readonly runtime: RebuildMetricsRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.batchSize = runtime.batchSize ?? 200;
    }

    /** Targeted rebuild: drain the coalesced pending invalidation batch and recompute what it affected. */
    async fromPendingInvalidations(metadata: CommandContext, transaction?: Transaction): Promise<RebuildSummary> {
        return this.inTransaction(transaction, async activeTransaction => {
            const pending = await this.runtime.invalidations.claimPending(this.batchSize, activeTransaction);
            if (pending.length === 0) return { recomputed: 0, drainedInvalidations: 0 };
            const affected = await this.runtime.repository.findAffected(pending, activeTransaction);
            const recomputed = await this.recomputeEach(affected, metadata, activeTransaction);
            await this.runtime.invalidations.markProcessed(
                pending.map(item => item.id),
                this.clock.now(),
                activeTransaction,
            );
            return { recomputed, drainedInvalidations: pending.length };
        });
    }

    /** Manual/targeted rebuild for one explicit scope, without touching the invalidation queue. */
    async fromScope(
        scope: InvalidationScope,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<RebuildSummary> {
        return this.inTransaction(transaction, async activeTransaction => {
            const affected = await this.runtime.repository.findAffected([scope], activeTransaction);
            const recomputed = await this.recomputeEach(affected, metadata, activeTransaction);
            return { recomputed, drainedInvalidations: 0 };
        });
    }

    /** Scheduled full rebuild: recompute every current projection through its (latest) calculator. */
    async full(metadata: CommandContext, transaction?: Transaction): Promise<RebuildSummary> {
        return this.inTransaction(transaction, async activeTransaction => {
            const targets = await this.runtime.repository.listCurrentTargets(activeTransaction);
            const recomputed = await this.recomputeEach(targets, metadata, activeTransaction);
            return { recomputed, drainedInvalidations: 0 };
        });
    }

    private async recomputeEach(
        targets: readonly AffectedMetric[],
        metadata: CommandContext,
        transaction: Transaction,
    ): Promise<number> {
        let recomputed = 0;
        for (const target of targets) {
            await this.runtime.recalculate.run(
                {
                    calculatorKey: target.calculatorKey,
                    target: { scope: target.scope, period: target.period, dimensions: target.dimensions },
                },
                metadata,
                transaction,
            );
            recomputed += 1;
        }
        return recomputed;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }
}

// -------------------------------------------------------------------------------------------------
// Durable work: rebuild job handlers
// -------------------------------------------------------------------------------------------------

/** Runs the targeted rebuild for the coalesced pending invalidation batch inside the worker transaction. */
export class MetricRebuildJobHandler<Transaction = unknown> implements JobHandler<Transaction> {
    readonly name = "analytics.metric-rebuild-job";
    readonly jobType = METRIC_REBUILD_JOB;
    readonly jobVersion = METRIC_REBUILD_JOB_VERSION;

    constructor(private readonly rebuild: RebuildMetrics<Transaction>) {}

    async handle(job: { readonly correlationId: string }, context: JobHandlerContext<Transaction>): Promise<void> {
        await this.rebuild.fromPendingInvalidations(
            { correlationId: job.correlationId, source: "system" },
            context.transaction,
        );
    }
}

/** Runs the scheduled full rebuild sweep inside the worker transaction. */
export class MetricFullRebuildJobHandler<Transaction = unknown> implements JobHandler<Transaction> {
    readonly name = "analytics.metric-full-rebuild-job";
    readonly jobType = METRIC_FULL_REBUILD_JOB;
    readonly jobVersion = METRIC_FULL_REBUILD_JOB_VERSION;

    constructor(private readonly rebuild: RebuildMetrics<Transaction>) {}

    async handle(job: { readonly correlationId: string }, context: JobHandlerContext<Transaction>): Promise<void> {
        await this.rebuild.full({ correlationId: job.correlationId, source: "system" }, context.transaction);
    }
}

// -------------------------------------------------------------------------------------------------
// Outbox handlers: committed fact → coalesced invalidations + stale + rebuild job
// -------------------------------------------------------------------------------------------------

/** The rebuild job every invalidation trigger enqueues; a fixed idempotency key coalesces the batch. */
function rebuildJob(event: ClaimedOutboxEvent): EnqueueJob {
    return {
        type: METRIC_REBUILD_JOB,
        version: METRIC_REBUILD_JOB_VERSION,
        payload: {},
        idempotencyKey: METRIC_REBUILD_JOB_KEY,
        correlationId: event.correlationId,
        causationId: event.id,
    };
}

/**
 * Translates one committed fact into invalidation scopes (design §16.3): it builds an enriched
 * {@link SourceChange} using the event payload plus the {@link MetricInvalidationReader} cross-references,
 * expands and coalesces it, appends the coalesced scopes to the durable invalidation store, marks the
 * affected current projections stale, and enqueues a (coalesced) rebuild job. One instance is registered
 * per event name; the `kind` selects how the change is built.
 */
export class MetricInvalidationOutboxHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    readonly name: string;
    readonly eventVersion = 1;

    constructor(
        readonly eventName: string,
        private readonly kind: SourceChange["kind"],
        private readonly deps: {
            readonly store: AnalyticsInvalidationStore<Transaction>;
            readonly repository: Pick<DerivedMetricRepository<Transaction>, "markStale">;
            readonly queue: JobQueue<Transaction>;
            readonly reader: MetricInvalidationReader<Transaction>;
        },
    ) {
        this.name = `analytics.invalidation.${kind}`;
    }

    async handle(event: ClaimedOutboxEvent, context: OutboxHandlerContext<Transaction>): Promise<void> {
        const change = await this.buildChange(event, context.transaction);
        if (change === null) return;
        const scopes = coalesceInvalidations(expandInvalidation(change));
        if (scopes.length === 0) return;

        await this.deps.store.append(
            scopes.map(scope => ({ ...scope, reason: this.eventName, eventId: event.id })),
            context.transaction,
        );
        await this.deps.repository.markStale(scopes, context.transaction);
        await this.deps.queue.enqueue(rebuildJob(event), context.transaction);
    }

    private async buildChange(event: ClaimedOutboxEvent, transaction: Transaction): Promise<SourceChange | null> {
        const payload = event.payload;
        switch (this.kind) {
            case "session": {
                const sessionId = optionalString(payload.trainingSessionId) ?? event.aggregateId;
                if (sessionId === null) return null;
                const described = await this.deps.reader.describeSession(sessionId, transaction);
                return {
                    kind: "session",
                    sessionId,
                    profileId: described?.profileId ?? optionalString(payload.profileId) ?? "",
                    localDate: described?.localDate ?? optionalString(payload.localDate) ?? null,
                    plannedSessionIds: described?.plannedSessionIds ?? [],
                };
            }
            case "exercise": {
                const exerciseId = optionalString(payload.exerciseId) ?? event.aggregateId;
                if (exerciseId === null) return null;
                return { kind: "exercise", exerciseId, familyId: optionalString(payload.familyId) };
            }
            case "context": {
                const profileId = optionalString(payload.profileId) ?? event.aggregateId;
                if (profileId === null) return null;
                const affectedSessionIds = await this.deps.reader.sessionsForContextDate(profileId, transaction);
                return { kind: "context", profileId, affectedSessionIds };
            }
            case "zone": {
                const zoneId =
                    optionalString(payload.zoneDefinitionId) ?? optionalString(payload.zoneId) ?? event.aggregateId;
                if (zoneId === null) return null;
                const affectedSessionIds = await this.deps.reader.sessionsInZoneInterval(zoneId, transaction);
                return { kind: "zone", zoneId, affectedSessionIds };
            }
            case "plan": {
                const plannedSessionId = optionalString(payload.plannedSessionId) ?? event.aggregateId;
                if (plannedSessionId === null) return null;
                const affectedSessionIds = await this.deps.reader.sessionsForPlan(plannedSessionId, transaction);
                return { kind: "plan", plannedSessionId, affectedSessionIds };
            }
        }
    }
}

/** Session/mapping facts that stale session-, window-, and mapping-derived metrics (design §16.3). */
export const METRIC_SESSION_EVENT_NAMES = [
    "training.session.completed",
    "training.session.revised",
    "training.session.reopened",
    "training.session.archived",
    "training.session.restored",
    "training.mapping.changed",
] as const;

/**
 * Exercise definition facts that stale exercise-family and historical/latest-basis metrics. Merges arrive
 * as `training.catalog.changed`; that broader source is wired alongside the exercise-scoped calculators
 * (A2) that consume it, so A1 subscribes only to the clean per-exercise edit event.
 */
export const METRIC_EXERCISE_EVENT_NAMES = ["training.exercise.updated"] as const;

/**
 * Manual-context facts (bodyweight and other training-profile context) that stale the sessions/windows
 * whose calculations reference them; the profile aggregate carries this context, so its change is the
 * signal (design §16.3).
 */
export const METRIC_CONTEXT_EVENT_NAMES = ["training.profile.updated"] as const;

/** Zone definition facts that stale only the runs inside the definition's effective interval. */
export const METRIC_ZONE_EVENT_NAMES = ["training.zone-definition.changed"] as const;

/** Planned-revision/mapping facts that stale the plan and every actual session mapped to it. */
export const METRIC_PLAN_EVENT_NAMES = [
    "training.planned-session.updated",
    "training.planned-session.recomputed",
] as const;

// -------------------------------------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------------------------------------

/**
 * Pick the calculator result that matches the requested target. A targeted recompute names one natural
 * key; a calculator that returns a single result for the target uses it directly, otherwise the result
 * whose scope/period/dimensions equal the target is selected (and any others are ignored for this key).
 */
function selectResultForTarget(results: readonly MetricResult[], target: MetricTarget): MetricResult | undefined {
    if (results.length === 0) return undefined;
    const exact = results.find(result => sameTarget(result, target));
    if (exact !== undefined) return exact;
    return results.length === 1 ? results[0] : undefined;
}

function sameTarget(result: MetricResult, target: MetricTarget): boolean {
    return (
        result.scope.type === target.scope.type &&
        result.scope.id === target.scope.id &&
        hashRequest(result.period) === hashRequest(target.period) &&
        hashRequest(result.dimensions) === hashRequest(target.dimensions)
    );
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}
