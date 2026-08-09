import type { CommandContext } from "#src/platform/application/command-context";
import {
    type ClaimedOutboxEvent,
    type JobHandler,
    type JobHandlerContext,
    type JobQueue,
    type OutboxHandler,
    type OutboxHandlerContext,
} from "#src/platform/application/durable-work";
import { hashRequest } from "#src/platform/application/request-hash";
import type { UnitOfWork } from "#src/platform/application/unit-of-work";
import type { Clock } from "#src/platform/domain/index";

import {
    STRENGTH_CALCULATOR_KEYS,
    STRENGTH_DIRECT_MUSCLE_SETS,
    STRENGTH_EFFECTIVE_VOLUME,
    STRENGTH_EXTERNAL_VOLUME,
    STRENGTH_FREQUENCY,
    STRENGTH_HARD_SETS,
    STRENGTH_INDIRECT_MUSCLE_SETS,
    STRENGTH_SESSION_CALCULATORS,
    STRENGTH_TIME_UNDER_TENSION,
    STRENGTH_WINDOW_CALCULATORS,
    STRENGTH_WINDOW_EXERCISE_VOLUME,
    STRENGTH_WINDOW_FREQUENCY,
    STRENGTH_WINDOW_KINDS,
    STRENGTH_WINDOW_MAX_DAYS,
    STRENGTH_WINDOW_MUSCLE_SETS,
    STRENGTH_WORK_REPS,
    addDays,
    metricFingerprintDescriptor,
    metricNaturalKeyDescriptor,
    strengthWindowBounds,
    strengthWindowPeriod,
    strengthWindowScope,
    type MetricCalculator,
    type MetricResult,
    type MetricScope,
    type MetricTarget,
    type StrengthMetricConfig,
    type StrengthSessionFacts,
    type StrengthWindowFacts,
    type StrengthWindowSessionFacts,
} from "#src/modules/training/domain/index";
import type {
    DerivedMetricRecord,
    DerivedMetricRepository,
    DerivedMetricView,
} from "#src/modules/training/application/metric-projection";

// -------------------------------------------------------------------------------------------------
// DI tokens + durable-work identifiers
// -------------------------------------------------------------------------------------------------

export const STRENGTH_METRIC_READER = Symbol("STRENGTH_METRIC_READER");
export const PROJECT_STRENGTH_METRICS = Symbol("PROJECT_STRENGTH_METRICS");

/** Durable job that projects one session's strength metrics (session scope + the windows it touches). */
export const STRENGTH_PROJECTION_JOB = "analytics.strength-project";
export const STRENGTH_PROJECTION_JOB_VERSION = 1;

/** Session lifecycle facts that create/retire strength projections (design §16.3). */
export const STRENGTH_METRIC_SESSION_EVENT_NAMES = [
    "training.session.completed",
    "training.session.revised",
    "training.session.reopened",
    "training.session.archived",
    "training.session.restored",
] as const;

// -------------------------------------------------------------------------------------------------
// Capability port
// -------------------------------------------------------------------------------------------------

/**
 * Read-only, bounded port that assembles the exact snapshot/latest facts the strength calculators score.
 * `loadSessionFacts` returns `null` when the session is not a completed, non-archived session (so its
 * projections are retired); `describeSession` still resolves the profile/date so a reopened or archived
 * session can drop out of the windows that referenced it. Drizzle rows never escape the adapter.
 */
export interface StrengthMetricReader<Transaction = unknown> {
    describeSession(
        sessionId: string,
        transaction?: Transaction,
    ): Promise<{ readonly profileId: string; readonly localDate: string } | null>;
    loadSessionFacts(sessionId: string, transaction?: Transaction): Promise<StrengthSessionFacts | null>;
    loadConfig(profileId: string, transaction?: Transaction): Promise<StrengthMetricConfig>;
    /** Distinct local-dates of the profile's completed, non-archived sessions within `[from, to]`. */
    sessionDatesInRange(
        profileId: string,
        from: string,
        to: string,
        transaction?: Transaction,
    ): Promise<readonly string[]>;
    /** The profile's completed, non-archived sessions (with strength facts) within `[from, to]`. */
    loadWindowFacts(
        profileId: string,
        from: string,
        to: string,
        transaction?: Transaction,
    ): Promise<readonly StrengthWindowSessionFacts[]>;
}

// -------------------------------------------------------------------------------------------------
// ProjectStrengthMetrics — the per-session discovery/projection use case (mirrors CalculateAdherence)
// -------------------------------------------------------------------------------------------------

interface ProjectStrengthMetricsRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly reader: StrengthMetricReader<Transaction>;
    readonly repository: DerivedMetricRepository<Transaction>;
    readonly generateId: () => string;
    readonly clock?: Clock;
}

/** A produced result tagged with the calculator that emitted it (its key/version stamp the row). */
interface TaggedResult {
    readonly calculator: MetricCalculator;
    readonly result: MetricResult;
}

/**
 * Projects the derived strength metrics for one session and the rolling windows its date touches
 * (issue #44, A2; design §16.4). This is the discovery path the generic A1 rebuild cannot cover — a
 * freshly completed session has no stored metrics for {@link DerivedMetricRepository.findAffected} to
 * recompute — so it enumerates every result the registered calculators produce and persists them
 * supersede-and-insert, keyed by the same natural keys the generic rebuild uses. Replaying identical
 * facts is a no-op: an unchanged source fingerprint clears the stale flag and skips the rewrite, and a
 * scope's previously-current strength metrics that are no longer produced are retired. Windows anchor on
 * the profile's actual training dates in `[localDate, localDate + 27]`, so a backdated session refreshes
 * the later-anchored windows that now include it while staying bounded.
 */
export class ProjectStrengthMetrics<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: ProjectStrengthMetricsRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
    }

    async recalculateForSession(
        sessionId: string,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<{ readonly recomputed: number; readonly retired: number }> {
        void metadata;
        return this.inTransaction(transaction, async activeTransaction => {
            const described = await this.runtime.reader.describeSession(sessionId, activeTransaction);
            if (described === null) {
                // Session no longer exists — retire whatever strength metrics were projected for it.
                const retired = await this.retireScope(
                    { type: "session", id: sessionId },
                    new Set(),
                    activeTransaction,
                );
                return { recomputed: 0, retired };
            }

            const config = configRecord(await this.runtime.reader.loadConfig(described.profileId, activeTransaction));
            const produced: TaggedResult[] = [];

            const facts = await this.runtime.reader.loadSessionFacts(sessionId, activeTransaction);
            if (facts !== null) produced.push(...run(STRENGTH_SESSION_CALCULATORS, facts, config));

            produced.push(
                ...(await this.projectWindows(described.profileId, described.localDate, config, activeTransaction)),
            );

            // Every session-scope target is always touched (even when facts are null → retire it).
            const touchedScopes = new Map<string, MetricScope>();
            touchedScopes.set("session|" + sessionId, { type: "session", id: sessionId });
            for (const { result } of produced) touchedScopes.set(scopeKey(result.scope), result.scope);

            return this.persist(produced, config, described.profileId, [...touchedScopes.values()], activeTransaction);
        });
    }

    /** Recompute the window projections anchored on each of the profile's training dates the session moves. */
    private async projectWindows(
        profileId: string,
        localDate: string,
        config: Readonly<Record<string, unknown>>,
        transaction: Transaction,
    ): Promise<TaggedResult[]> {
        const anchors = await this.runtime.reader.sessionDatesInRange(
            profileId,
            localDate,
            addDays(localDate, STRENGTH_WINDOW_MAX_DAYS - 1),
            transaction,
        );
        // Anchors reach back at most a 28-day window; load the union of every window's sessions once.
        const earliest = addDays(localDate, -(STRENGTH_WINDOW_MAX_DAYS - 1));
        const latest = anchors.reduce((max, anchor) => (anchor > max ? anchor : max), localDate);
        const windowSessions = await this.runtime.reader.loadWindowFacts(profileId, earliest, latest, transaction);

        const produced: TaggedResult[] = [];
        for (const anchor of dedupe([localDate, ...anchors])) {
            for (const kind of STRENGTH_WINDOW_KINDS) {
                const bounds = strengthWindowBounds(kind, anchor);
                const sessions = windowSessions.filter(
                    session => session.localDate >= bounds.start && session.localDate <= bounds.end,
                );
                if (sessions.length === 0) continue;
                const facts: StrengthWindowFacts = {
                    profileId,
                    scope: strengthWindowScope(kind, profileId, anchor),
                    period: strengthWindowPeriod(kind, anchor),
                    sessions,
                };
                produced.push(...run(STRENGTH_WINDOW_CALCULATORS, facts, config));
            }
        }
        return produced;
    }

    /** Supersede-and-insert every produced result and retire the touched scopes' obsolete strength metrics. */
    private async persist(
        produced: readonly TaggedResult[],
        config: Readonly<Record<string, unknown>>,
        profileId: string,
        touchedScopes: readonly MetricScope[],
        transaction: Transaction,
    ): Promise<{ readonly recomputed: number; readonly retired: number }> {
        const now = this.clock.now();
        const producedKeysByScope = new Map<string, Set<string>>();
        let recomputed = 0;

        for (const { calculator, result } of produced) {
            const target: MetricTarget = { scope: result.scope, period: result.period, dimensions: result.dimensions };
            const naturalKey = hashRequest(metricNaturalKeyDescriptor(calculator.key, target));
            addKeyToScope(producedKeysByScope, result.scope, naturalKey);

            const fingerprint = hashRequest(
                metricFingerprintDescriptor(calculator.key, calculator.version, config, result),
            );
            const current = await this.runtime.repository.currentByNaturalKey(naturalKey, transaction);
            if (current !== null && current.sourceFingerprint === fingerprint) {
                await this.runtime.repository.clearStale(naturalKey, transaction);
                continue;
            }
            await this.runtime.repository.supersedeAndInsert(
                naturalKey,
                toRecord(calculator, naturalKey, result, fingerprint, profileId, now, this.runtime.generateId),
                transaction,
            );
            recomputed += 1;
        }

        let retired = 0;
        for (const scope of touchedScopes) {
            retired += await this.retireScope(
                scope,
                producedKeysByScope.get(scopeKey(scope)) ?? new Set(),
                transaction,
            );
        }
        return { recomputed, retired };
    }

    /** Retire the current strength metrics for a scope whose natural key is not in `keepKeys`. */
    private async retireScope(
        scope: MetricScope,
        keepKeys: ReadonlySet<string>,
        transaction: Transaction,
    ): Promise<number> {
        const existing = await this.runtime.repository.query(
            { scopeType: scope.type, scopeId: scope.id, limit: 1_000 },
            transaction,
        );
        let retired = 0;
        for (const view of existing) {
            if (!STRENGTH_CALCULATOR_KEYS.includes(view.calculatorKey)) continue;
            const naturalKey = naturalKeyOf(view);
            if (keepKeys.has(naturalKey)) continue;
            await this.runtime.repository.supersedeAndInsert(naturalKey, null, transaction);
            retired += 1;
        }
        return retired;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }
}

// -------------------------------------------------------------------------------------------------
// Durable work: projection job + session outbox handler
// -------------------------------------------------------------------------------------------------

/** Runs {@link ProjectStrengthMetrics} for one session inside the worker's transaction (idempotent). */
export class StrengthMetricsProjectionJobHandler<Transaction = unknown> implements JobHandler<Transaction> {
    readonly name = "analytics.strength-projection-job";
    readonly jobType = STRENGTH_PROJECTION_JOB;
    readonly jobVersion = STRENGTH_PROJECTION_JOB_VERSION;

    constructor(private readonly project: ProjectStrengthMetrics<Transaction>) {}

    async handle(
        job: { readonly payload: Readonly<Record<string, unknown>>; readonly correlationId: string },
        context: JobHandlerContext<Transaction>,
    ): Promise<void> {
        const sessionId = requireString(job.payload.trainingSessionId, "trainingSessionId");
        await this.project.recalculateForSession(
            sessionId,
            { correlationId: job.correlationId, source: "system" },
            context.transaction,
        );
    }
}

/**
 * Subscribes to a training-session lifecycle fact and enqueues the strength projection for that session
 * (issue #44, A2). One handler is registered per event name; the session id keys idempotent coalescing so
 * a burst of edits collapses to a single recompute.
 */
export class StrengthMetricsOutboxHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    readonly name = "analytics.strength-invalidation";
    readonly eventVersion = 1;

    constructor(
        readonly eventName: string,
        private readonly queue: JobQueue<Transaction>,
    ) {}

    async handle(event: ClaimedOutboxEvent, context: OutboxHandlerContext<Transaction>): Promise<void> {
        const sessionId = optionalString(event.payload.trainingSessionId) ?? event.aggregateId;
        if (sessionId === null) return;
        await this.queue.enqueue(
            {
                type: STRENGTH_PROJECTION_JOB,
                version: STRENGTH_PROJECTION_JOB_VERSION,
                payload: { trainingSessionId: sessionId },
                idempotencyKey: `${STRENGTH_PROJECTION_JOB}:${sessionId}`,
                correlationId: event.correlationId,
                causationId: event.id,
            },
            context.transaction,
        );
    }
}

// -------------------------------------------------------------------------------------------------
// Calculator catalog metadata (stable, versioned display metadata — no persistence access)
// -------------------------------------------------------------------------------------------------

/** Display metadata for one registered strength calculator (mirrors the wire contract; app never imports @kinetix/types). */
export interface StrengthCalculatorMetadataView {
    readonly key: string;
    readonly version: number;
    readonly label: string;
    readonly description: string;
    readonly unit: string | null;
    readonly scopeKind: "session" | "window";
    readonly dimensions: readonly string[];
}

export interface StrengthMetricCatalogMetadata {
    readonly schemaVersion: 1;
    readonly calculators: readonly StrengthCalculatorMetadataView[];
}

const CALCULATOR_METADATA: readonly StrengthCalculatorMetadataView[] = [
    m(
        STRENGTH_WORK_REPS,
        "Work repetitions",
        "reps",
        "session",
        ["exercise", "basis"],
        "Total work repetitions per exercise; per-side movements count each side.",
    ),
    m(
        STRENGTH_EXTERNAL_VOLUME,
        "External-load volume",
        "kg",
        "session",
        ["exercise", "basis"],
        "Work reps × external load, summed per exercise; sets without external load are excluded.",
    ),
    m(
        STRENGTH_EFFECTIVE_VOLUME,
        "Effective-load volume",
        "kg",
        "session",
        ["exercise", "basis"],
        "Work reps × the load-model effective load; sets whose model yields no load (e.g. missing bodyweight) are excluded.",
    ),
    m(
        STRENGTH_DIRECT_MUSCLE_SETS,
        "Direct muscle sets",
        "sets",
        "session",
        ["muscle", "basis"],
        "Eligible sets whose exercise trains the muscle as a primary mover; counted independently, never fractionally.",
    ),
    m(
        STRENGTH_INDIRECT_MUSCLE_SETS,
        "Indirect muscle sets",
        "sets",
        "session",
        ["muscle", "basis"],
        "Eligible sets whose exercise trains the muscle as a secondary mover; kept separate from direct sets.",
    ),
    m(
        STRENGTH_HARD_SETS,
        "Hard sets",
        "sets",
        "session",
        ["exercise", "basis"],
        "Non-warm-up sets meeting the profile's configured RPE-or-RIR threshold (default RPE ≥ 7 or RIR ≤ 3).",
    ),
    m(
        STRENGTH_TIME_UNDER_TENSION,
        "Time under tension",
        "ms",
        "session",
        ["exercise", "basis"],
        "Completed reps × available tempo phases, or the explicit set duration when no tempo is recorded.",
    ),
    m(
        STRENGTH_FREQUENCY,
        "Exercise frequency",
        "occurrences",
        "session",
        ["exercise", "basis"],
        "Occurrences of the exercise that carried eligible working sets this session.",
    ),
    m(
        STRENGTH_WINDOW_EXERCISE_VOLUME,
        "Windowed exercise volume",
        "kg",
        "window",
        ["exercise", "basis"],
        "Effective volume per exercise across the rolling window; external volume travels in the evidence.",
    ),
    m(
        STRENGTH_WINDOW_MUSCLE_SETS,
        "Windowed muscle sets",
        "sets",
        "window",
        ["muscle", "role", "basis"],
        "Direct/indirect set counts per muscle across the rolling window; the hard-set count travels in the evidence.",
    ),
    m(
        STRENGTH_WINDOW_FREQUENCY,
        "Windowed muscle frequency",
        "sessions",
        "window",
        ["muscle", "basis"],
        "Distinct sessions that trained the muscle across the rolling window.",
    ),
];

/** The stable, versioned catalog of strength calculators for the analytics metadata endpoint (issue #44). */
export function strengthMetricCatalogMetadata(): StrengthMetricCatalogMetadata {
    return { schemaVersion: 1, calculators: CALCULATOR_METADATA };
}

function m(
    key: string,
    label: string,
    unit: string | null,
    scopeKind: "session" | "window",
    dimensions: readonly string[],
    description: string,
): StrengthCalculatorMetadataView {
    return { key, version: 1, label, description, unit, scopeKind, dimensions };
}

// -------------------------------------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------------------------------------

/** Reproject a config value object as a fresh record the framework/fingerprint consume identically. */
function configRecord(config: StrengthMetricConfig): Readonly<Record<string, unknown>> {
    return {
        rpeThreshold: config.rpeThreshold,
        rirThreshold: config.rirThreshold,
        calculatorVersion: config.calculatorVersion,
    };
}

function run(
    calculators: readonly MetricCalculator[],
    facts: unknown,
    config: Readonly<Record<string, unknown>>,
): TaggedResult[] {
    const produced: TaggedResult[] = [];
    const target: MetricTarget = { scope: firstScope(facts), period: firstPeriod(facts), dimensions: {} };
    for (const calculator of calculators) {
        for (const result of calculator.calculate({ target, facts, config })) produced.push({ calculator, result });
    }
    return produced;
}

/** A calculator derives scope/period from its facts, so the placeholder target only needs a valid shape. */
function firstScope(facts: unknown): MetricScope {
    const windowFacts = facts as Partial<StrengthWindowFacts>;
    if (windowFacts.scope !== undefined) return windowFacts.scope;
    const sessionFacts = facts as StrengthSessionFacts;
    return { type: "session", id: sessionFacts.sessionId };
}

function firstPeriod(facts: unknown): MetricTarget["period"] {
    const windowFacts = facts as Partial<StrengthWindowFacts>;
    if (windowFacts.period !== undefined) return windowFacts.period;
    const sessionFacts = facts as StrengthSessionFacts;
    return { kind: "point", at: sessionFacts.localDate };
}

function toRecord(
    calculator: MetricCalculator,
    naturalKey: string,
    result: MetricResult,
    fingerprint: string,
    profileId: string,
    now: Date,
    generateId: () => string,
): DerivedMetricRecord {
    return {
        id: generateId(),
        profileId,
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
        calculatedAt: now,
        inputs: result.inputs.map(input => ({ ...input })),
    };
}

function naturalKeyOf(view: DerivedMetricView): string {
    return hashRequest(
        metricNaturalKeyDescriptor(view.calculatorKey, {
            scope: view.scope,
            period: view.period,
            dimensions: view.dimensions,
        }),
    );
}

function addKeyToScope(map: Map<string, Set<string>>, scope: MetricScope, naturalKey: string): void {
    const key = scopeKey(scope);
    const set = map.get(key) ?? new Set<string>();
    set.add(naturalKey);
    map.set(key, set);
}

function scopeKey(scope: MetricScope): string {
    return `${scope.type}|${scope.id}`;
}

function dedupe(values: readonly string[]): string[] {
    return [...new Set(values)];
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Strength projection job payload is missing ${field}`);
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}
