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
    RUNNING_AVERAGE_CADENCE,
    RUNNING_AVERAGE_HEART_RATE,
    RUNNING_AVERAGE_PACE,
    RUNNING_AVERAGE_POWER,
    RUNNING_CALCULATOR_KEYS,
    RUNNING_DISTANCE,
    RUNNING_DURATION,
    RUNNING_EDWARDS_HR_LOAD,
    RUNNING_ELEVATION_GAIN,
    RUNNING_SESSION_CALCULATORS,
    RUNNING_SESSION_RPE_LOAD,
    RUNNING_WINDOW_CALCULATORS,
    RUNNING_WINDOW_DISTANCE,
    RUNNING_WINDOW_DURATION,
    RUNNING_WINDOW_EDWARDS_HR_LOAD,
    RUNNING_WINDOW_FREQUENCY,
    RUNNING_WINDOW_MAX_DAYS,
    RUNNING_WINDOW_SESSION_RPE_LOAD,
    RUNNING_ZONE_TIME,
    STRENGTH_WINDOW_KINDS,
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
    type RunningMetricConfig,
    type RunningSessionFacts,
    type RunningWindowFacts,
    type RunningWindowSessionFacts,
} from "#src/modules/training/domain/index";
import type {
    DerivedMetricRecord,
    DerivedMetricRepository,
    DerivedMetricView,
} from "#src/modules/training/application/metric-projection";

// -------------------------------------------------------------------------------------------------
// DI tokens + durable-work identifiers
// -------------------------------------------------------------------------------------------------

export const RUNNING_METRIC_READER = Symbol("RUNNING_METRIC_READER");
export const PROJECT_RUNNING_METRICS = Symbol("PROJECT_RUNNING_METRICS");

/** Durable job that projects one session's running metrics (session scope + the windows it touches). */
export const RUNNING_PROJECTION_JOB = "analytics.running-project";
export const RUNNING_PROJECTION_JOB_VERSION = 1;

/** Session lifecycle facts that create/retire running projections (design §16.3). */
export const RUNNING_METRIC_SESSION_EVENT_NAMES = [
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
 * Read-only, bounded port that assembles the exact running facts the running calculators score. Mirrors
 * {@link StrengthMetricReader}: `loadSessionFacts` returns `null` when the session is not a completed,
 * non-archived running session (so its projections are retired), while `describeSession` still resolves the
 * profile/date so a reopened or archived session drops out of the windows that referenced it. The reader
 * resolves each zone time's 1-based heart-rate zone number through the zone port. Drizzle rows never escape.
 */
export interface RunningMetricReader<Transaction = unknown> {
    describeSession(
        sessionId: string,
        transaction?: Transaction,
    ): Promise<{ readonly profileId: string; readonly localDate: string } | null>;
    loadSessionFacts(sessionId: string, transaction?: Transaction): Promise<RunningSessionFacts | null>;
    loadConfig(profileId: string, transaction?: Transaction): Promise<RunningMetricConfig>;
    /** Distinct local-dates of the profile's completed, non-archived running sessions within `[from, to]`. */
    sessionDatesInRange(
        profileId: string,
        from: string,
        to: string,
        transaction?: Transaction,
    ): Promise<readonly string[]>;
    /** The profile's completed, non-archived running sessions (with facts) within `[from, to]`. */
    loadWindowFacts(
        profileId: string,
        from: string,
        to: string,
        transaction?: Transaction,
    ): Promise<readonly RunningWindowSessionFacts[]>;
}

// -------------------------------------------------------------------------------------------------
// ProjectRunningMetrics — the per-session discovery/projection use case (mirrors ProjectStrengthMetrics)
// -------------------------------------------------------------------------------------------------

interface ProjectRunningMetricsRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly reader: RunningMetricReader<Transaction>;
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
 * Projects the derived running metrics for one session and the rolling windows its date touches (issue #46,
 * A4; design §16.6). This is the discovery path the generic A1 rebuild cannot cover — a freshly completed run
 * has no stored metrics for {@link DerivedMetricRepository.findAffected} to recompute — so it enumerates every
 * result the registered running calculators produce and persists them supersede-and-insert, keyed by the same
 * natural keys the generic rebuild uses. Replaying identical facts is a no-op: an unchanged source fingerprint
 * clears the stale flag and skips the rewrite, and a scope's previously-current running metrics that are no
 * longer produced are retired. Windows anchor on the profile's actual running dates in `[localDate, +27]`.
 */
export class ProjectRunningMetrics<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: ProjectRunningMetricsRuntime<Transaction>) {
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
            if (facts !== null) produced.push(...run(RUNNING_SESSION_CALCULATORS, facts, config));

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

    /** Recompute the window projections anchored on each of the profile's running dates the session moves. */
    private async projectWindows(
        profileId: string,
        localDate: string,
        config: Readonly<Record<string, unknown>>,
        transaction: Transaction,
    ): Promise<TaggedResult[]> {
        const anchors = await this.runtime.reader.sessionDatesInRange(
            profileId,
            localDate,
            addDays(localDate, RUNNING_WINDOW_MAX_DAYS - 1),
            transaction,
        );
        const earliest = addDays(localDate, -(RUNNING_WINDOW_MAX_DAYS - 1));
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
                const facts: RunningWindowFacts = {
                    profileId,
                    scope: strengthWindowScope(kind, profileId, anchor),
                    period: strengthWindowPeriod(kind, anchor),
                    sessions,
                };
                produced.push(...run(RUNNING_WINDOW_CALCULATORS, facts, config));
            }
        }
        return produced;
    }

    /** Supersede-and-insert every produced result and retire the touched scopes' obsolete running metrics. */
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

    /** Retire the current running metrics for a scope whose natural key is not in `keepKeys`. */
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
            if (!RUNNING_CALCULATOR_KEYS.includes(view.calculatorKey)) continue;
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

/** Runs {@link ProjectRunningMetrics} for one session inside the worker's transaction (idempotent). */
export class RunningMetricsProjectionJobHandler<Transaction = unknown> implements JobHandler<Transaction> {
    readonly name = "analytics.running-projection-job";
    readonly jobType = RUNNING_PROJECTION_JOB;
    readonly jobVersion = RUNNING_PROJECTION_JOB_VERSION;

    constructor(private readonly project: ProjectRunningMetrics<Transaction>) {}

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
 * Subscribes to a training-session lifecycle fact and enqueues the running projection for that session
 * (issue #46, A4). One handler is registered per event name; the session id keys idempotent coalescing so a
 * burst of edits collapses to a single recompute.
 */
export class RunningMetricsOutboxHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    readonly name = "analytics.running-invalidation";
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
                type: RUNNING_PROJECTION_JOB,
                version: RUNNING_PROJECTION_JOB_VERSION,
                payload: { trainingSessionId: sessionId },
                idempotencyKey: `${RUNNING_PROJECTION_JOB}:${sessionId}`,
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

/** Display metadata for one registered running calculator (mirrors the wire contract; app never imports @kinetix/types). */
export interface RunningCalculatorMetadataView {
    readonly key: string;
    readonly version: number;
    readonly label: string;
    readonly description: string;
    readonly unit: string | null;
    readonly scopeKind: "session" | "window";
    readonly dimensions: readonly string[];
}

export interface RunningMetricCatalogMetadata {
    readonly schemaVersion: 1;
    readonly calculators: readonly RunningCalculatorMetadataView[];
}

const CALCULATOR_METADATA: readonly RunningCalculatorMetadataView[] = [
    m(RUNNING_DISTANCE, "Run distance", "m", "session", ["activity"], "Total run distance in metres."),
    m(
        RUNNING_DURATION,
        "Run duration",
        "ms",
        "session",
        ["activity"],
        "Run duration in milliseconds; moving time preferred, elapsed time when moving time is absent.",
    ),
    m(
        RUNNING_AVERAGE_PACE,
        "Average pace",
        "s/km",
        "session",
        ["activity"],
        "Average pace in seconds per kilometre derived from moving time and distance; exclusions travel in the evidence.",
    ),
    m(
        RUNNING_AVERAGE_HEART_RATE,
        "Average heart rate",
        "bpm",
        "session",
        ["activity"],
        "Average heart rate in beats per minute; maximum heart rate travels in the evidence.",
    ),
    m(
        RUNNING_AVERAGE_POWER,
        "Average power",
        "W",
        "session",
        ["activity"],
        "Average running power in watts; maximum power travels in the evidence.",
    ),
    m(
        RUNNING_AVERAGE_CADENCE,
        "Average cadence",
        "rpm",
        "session",
        ["activity"],
        "Average cadence in revolutions per minute; maximum cadence travels in the evidence.",
    ),
    m(
        RUNNING_ELEVATION_GAIN,
        "Elevation gain",
        "m",
        "session",
        ["activity"],
        "Total elevation gain in metres; elevation loss travels in the evidence.",
    ),
    m(
        RUNNING_ZONE_TIME,
        "Zone time",
        "ms",
        "session",
        ["activity", "family", "zone"],
        "Time spent in each recorded heart-rate/pace/power zone, one result per zone-time entry.",
    ),
    m(
        RUNNING_SESSION_RPE_LOAD,
        "Session-RPE load",
        "au",
        "session",
        ["activity"],
        "Duration minutes × session/activity RPE; a separate, separately versioned load model (never combined with Edwards load).",
    ),
    m(
        RUNNING_EDWARDS_HR_LOAD,
        "Edwards heart-rate load",
        "au",
        "session",
        ["activity"],
        "Sum of heart-rate zone minutes weighted by zone number; requires zone data, kept separate from session-RPE load.",
    ),
    m(
        RUNNING_WINDOW_DISTANCE,
        "Windowed distance",
        "m",
        "window",
        [],
        "Total distance across the rolling window's runs.",
    ),
    m(
        RUNNING_WINDOW_DURATION,
        "Windowed duration",
        "ms",
        "window",
        [],
        "Total moving (or elapsed) duration across the rolling window's runs.",
    ),
    m(
        RUNNING_WINDOW_FREQUENCY,
        "Windowed run frequency",
        "runs",
        "window",
        [],
        "Number of running activities across the rolling window.",
    ),
    m(
        RUNNING_WINDOW_SESSION_RPE_LOAD,
        "Windowed session-RPE load",
        "au",
        "window",
        [],
        "Sum of each run's session-RPE load across the rolling window; retains its own calculator identity.",
    ),
    m(
        RUNNING_WINDOW_EDWARDS_HR_LOAD,
        "Windowed Edwards heart-rate load",
        "au",
        "window",
        [],
        "Sum of each run's Edwards heart-rate load across the rolling window; kept separate from session-RPE load.",
    ),
];

/** The stable, versioned catalog of running calculators for the analytics metadata endpoint (issue #46). */
export function runningMetricCatalogMetadata(): RunningMetricCatalogMetadata {
    return { schemaVersion: 1, calculators: CALCULATOR_METADATA };
}

function m(
    key: string,
    label: string,
    unit: string | null,
    scopeKind: "session" | "window",
    dimensions: readonly string[],
    description: string,
): RunningCalculatorMetadataView {
    return { key, version: 1, label, description, unit, scopeKind, dimensions };
}

// -------------------------------------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------------------------------------

/** Reproject a config value object as a fresh record the framework/fingerprint consume identically. */
function configRecord(config: RunningMetricConfig): Readonly<Record<string, unknown>> {
    return { calculatorVersion: config.calculatorVersion };
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
    const windowFacts = facts as Partial<RunningWindowFacts>;
    if (windowFacts.scope !== undefined) return windowFacts.scope;
    const sessionFacts = facts as RunningSessionFacts;
    return { type: "session", id: sessionFacts.sessionId };
}

function firstPeriod(facts: unknown): MetricTarget["period"] {
    const windowFacts = facts as Partial<RunningWindowFacts>;
    if (windowFacts.period !== undefined) return windowFacts.period;
    const sessionFacts = facts as RunningSessionFacts;
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
        throw new Error(`Running projection job payload is missing ${field}`);
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}
