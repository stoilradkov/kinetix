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
    RECORD_RUNNING_BEST_PACE,
    RECORD_RUNNING_HIGHEST_POWER,
    RECORD_RUNNING_LONGEST_DISTANCE,
    RECORD_RUNNING_LONGEST_DURATION,
    RECORD_RUNNING_STANDARD_DISTANCE,
    RECORD_SCOPE_RUNNING,
    RUNNING_RECORD_DEFAULT_TOLERANCE,
    RUNNING_RECORD_KEYS,
    computeRunningRecords,
    findingFingerprintDescriptor,
    findingNaturalKeyDescriptor,
    type MetricScope,
    type RecordFinding,
    type RunRecordInput,
    type RunningRecordsConfig,
} from "#src/modules/training/domain/index";
import type { FindingRecord, FindingRepository } from "#src/modules/training/application/personal-records";

// -------------------------------------------------------------------------------------------------
// DI tokens + durable-work identifiers
// -------------------------------------------------------------------------------------------------

export const RUNNING_RECORDS_READER = Symbol("RUNNING_RECORDS_READER");
export const PROJECT_RUNNING_RECORDS = Symbol("PROJECT_RUNNING_RECORDS");

/** Durable job that projects a profile's running records off one session's change. */
export const RUNNING_RECORDS_PROJECTION_JOB = "analytics.running-records-project";
export const RUNNING_RECORDS_PROJECTION_JOB_VERSION = 1;

/** Session lifecycle facts that create/retire running-record findings (design §16.3, §16.8). */
export const RUNNING_RECORD_SESSION_EVENT_NAMES = [
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
 * Read-only, bounded port that assembles the run history a running-record computation scores (design §16.8).
 * `describeSession` names the profile the session belongs to (any status, so an archived session still
 * triggers a recompute of the profile's records); `loadRunHistory` returns every completed, non-archived run
 * with the canonical facts each record scores. Drizzle rows never escape the adapter.
 */
export interface RunningRecordsReader<Transaction = unknown> {
    describeSession(sessionId: string, transaction?: Transaction): Promise<{ readonly profileId: string } | null>;
    loadConfig(profileId: string, transaction?: Transaction): Promise<RunningRecordsConfig>;
    loadRunHistory(profileId: string, transaction?: Transaction): Promise<readonly RunRecordInput[]>;
}

// -------------------------------------------------------------------------------------------------
// ProjectRunningRecords — the per-session records discovery/projection use case
// -------------------------------------------------------------------------------------------------

interface ProjectRunningRecordsRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly reader: RunningRecordsReader<Transaction>;
    readonly repository: FindingRepository<Transaction>;
    readonly generateId: () => string;
    readonly clock?: Clock;
}

/**
 * Projects the running-record findings for the profile a session belongs to (issue #46, A4; design §16.6,
 * §16.8). Records are cross-session by nature — the best comparable run over the profile's whole history — so,
 * like {@link ProjectPersonalRecords}, this recomputes the profile's running-record scope by scanning the run
 * history, then persists supersede-and-insert. An unchanged best is a no-op on replay (fingerprint match →
 * skip); an improved record supersedes the old one; a record whose source run vanished is retired.
 */
export class ProjectRunningRecords<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: ProjectRunningRecordsRuntime<Transaction>) {
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
            if (described === null) return { recomputed: 0, retired: 0 };

            const config = await this.runtime.reader.loadConfig(described.profileId, activeTransaction);
            const runs = await this.runtime.reader.loadRunHistory(described.profileId, activeTransaction);
            const produced = computeRunningRecords(described.profileId, runs, config);

            const scope: MetricScope = { type: RECORD_SCOPE_RUNNING, id: described.profileId };
            return this.persist(produced, described.profileId, config, scope, activeTransaction);
        });
    }

    /** Supersede-and-insert every produced record and retire the scope's obsolete running-record findings. */
    private async persist(
        produced: readonly RecordFinding[],
        profileId: string,
        config: RunningRecordsConfig,
        scope: MetricScope,
        transaction: Transaction,
    ): Promise<{ readonly recomputed: number; readonly retired: number }> {
        const now = this.clock.now();
        const configRecord = runningRecordsConfigRecord(config);
        const producedKeys = new Set<string>();
        let recomputed = 0;

        for (const finding of produced) {
            const naturalKey = hashRequest(
                findingNaturalKeyDescriptor(finding.findingKey, finding.scope, finding.dimensions),
            );
            producedKeys.add(naturalKey);

            const fingerprint = hashRequest(
                findingFingerprintDescriptor(
                    finding.findingKey,
                    finding.version,
                    configRecord,
                    finding.scope,
                    finding.dimensions,
                    { numeric: finding.numeric, unit: finding.unit },
                    finding.inputs,
                ),
            );
            const current = await this.runtime.repository.currentByNaturalKey(naturalKey, transaction);
            if (current !== null && current.sourceFingerprint === fingerprint) continue;

            await this.runtime.repository.supersedeAndInsert(
                naturalKey,
                toRecord(finding, naturalKey, fingerprint, profileId, now, this.runtime.generateId),
                transaction,
            );
            recomputed += 1;
        }

        const retired = await this.retireScope(scope, producedKeys, transaction);
        return { recomputed, retired };
    }

    /** Retire the current running-record findings for the scope whose natural key is not in `keepKeys`. */
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
            if (!RUNNING_RECORD_KEYS.includes(view.findingKey)) continue;
            const naturalKey = hashRequest(findingNaturalKeyDescriptor(view.findingKey, view.scope, view.dimensions));
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

/** Runs {@link ProjectRunningRecords} for one session inside the worker's transaction (idempotent). */
export class RunningRecordsProjectionJobHandler<Transaction = unknown> implements JobHandler<Transaction> {
    readonly name = "analytics.running-records-projection-job";
    readonly jobType = RUNNING_RECORDS_PROJECTION_JOB;
    readonly jobVersion = RUNNING_RECORDS_PROJECTION_JOB_VERSION;

    constructor(private readonly project: ProjectRunningRecords<Transaction>) {}

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
 * Subscribes to a training-session lifecycle fact and enqueues the running-records projection for that
 * session (issue #46, A4). One handler is registered per event name; the session id keys idempotent
 * coalescing so a burst of edits collapses to a single recompute.
 */
export class RunningRecordsOutboxHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    readonly name = "analytics.running-records-invalidation";
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
                type: RUNNING_RECORDS_PROJECTION_JOB,
                version: RUNNING_RECORDS_PROJECTION_JOB_VERSION,
                payload: { trainingSessionId: sessionId },
                idempotencyKey: `${RUNNING_RECORDS_PROJECTION_JOB}:${sessionId}`,
                correlationId: event.correlationId,
                causationId: event.id,
            },
            context.transaction,
        );
    }
}

// -------------------------------------------------------------------------------------------------
// Record catalog metadata (stable, versioned display metadata — no persistence access)
// -------------------------------------------------------------------------------------------------

/** Display metadata for one running-record type (mirrors the wire contract; app never imports @kinetix/types). */
export interface RunningRecordMetadataView {
    readonly key: string;
    readonly version: number;
    readonly label: string;
    readonly description: string;
    readonly unit: string;
    readonly dimensions: readonly string[];
}

export interface RunningRecordCatalogMetadata {
    readonly schemaVersion: 1;
    readonly records: readonly RunningRecordMetadataView[];
}

const RECORD_METADATA: readonly RunningRecordMetadataView[] = [
    r(
        RECORD_RUNNING_STANDARD_DISTANCE,
        "Fastest standard distance",
        "ms",
        ["distance"],
        "Fastest moving time at each standard distance category (1km, 1mi, 5km, 10km, half, marathon) within a comparability tolerance.",
    ),
    r(
        RECORD_RUNNING_BEST_PACE,
        "Best average pace",
        "s/km",
        [],
        "Fastest average pace (seconds per kilometre) over any run with a distance and moving time.",
    ),
    r(RECORD_RUNNING_LONGEST_DISTANCE, "Longest distance", "m", [], "Greatest single-run distance in metres."),
    r(
        RECORD_RUNNING_LONGEST_DURATION,
        "Longest duration",
        "ms",
        [],
        "Greatest single-run duration in milliseconds (moving time, or elapsed time when moving time is absent).",
    ),
    r(
        RECORD_RUNNING_HIGHEST_POWER,
        "Highest power",
        "W",
        [],
        "Highest average running power in watts; maximum power travels in the evidence.",
    ),
];

/** The stable, versioned catalog of running-record types for the analytics metadata endpoint (issue #46). */
export function runningRecordCatalogMetadata(): RunningRecordCatalogMetadata {
    return { schemaVersion: 1, records: RECORD_METADATA };
}

function r(
    key: string,
    label: string,
    unit: string,
    dimensions: readonly string[],
    description: string,
): RunningRecordMetadataView {
    return { key, version: 1, label, description, unit, dimensions };
}

// -------------------------------------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------------------------------------

/** The config record folded into a record's fingerprint (a tolerance change invalidates standard records). */
function runningRecordsConfigRecord(config: RunningRecordsConfig): Readonly<Record<string, unknown>> {
    return { standardToleranceFraction: config.standardToleranceFraction ?? RUNNING_RECORD_DEFAULT_TOLERANCE };
}

function toRecord(
    finding: RecordFinding,
    naturalKey: string,
    fingerprint: string,
    profileId: string,
    now: Date,
    generateId: () => string,
): FindingRecord {
    return {
        id: generateId(),
        profileId,
        findingKey: finding.findingKey,
        findingVersion: finding.version,
        scope: finding.scope,
        naturalKey,
        status: "active",
        evidence: {
            ...finding.evidence,
            dimensions: finding.dimensions,
            numericValue: finding.numeric,
            unit: finding.unit,
        },
        reviewAt: null,
        expiresAt: null,
        sourceFingerprint: fingerprint,
        calculatedAt: now,
    };
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Running-records projection job payload is missing ${field}`);
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}
