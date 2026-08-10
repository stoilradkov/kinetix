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
    PERSONAL_RECORD_KEYS,
    RECORD_ESTIMATED_1RM,
    RECORD_EXERCISE_VOLUME,
    RECORD_MAX_LOAD,
    RECORD_REP_MAX_AT_LOAD,
    RECORD_SCOPE_EXERCISE,
    RECORD_SCOPE_FAMILY,
    computePersonalRecords,
    familyRepresentative,
    findingFingerprintDescriptor,
    findingNaturalKeyDescriptor,
    personalRecordScope,
    type FindingStatus,
    type MetricDimensions,
    type MetricScope,
    type PersonalRecordsConfig,
    type PersonalRecordsScope,
    type RecordFinding,
    type RecordSetInput,
} from "#src/modules/training/domain/index";

// -------------------------------------------------------------------------------------------------
// DI tokens + durable-work identifiers
// -------------------------------------------------------------------------------------------------

export const FINDING_REPOSITORY = Symbol("FINDING_REPOSITORY");
export const PERSONAL_RECORDS_READER = Symbol("PERSONAL_RECORDS_READER");
export const PROJECT_PERSONAL_RECORDS = Symbol("PROJECT_PERSONAL_RECORDS");

/** Durable job that projects one session's personal records (the exercises and families it touched). */
export const PERSONAL_RECORDS_PROJECTION_JOB = "analytics.personal-records-project";
export const PERSONAL_RECORDS_PROJECTION_JOB_VERSION = 1;

/** Session lifecycle facts that create/retire personal-record findings (design §16.3, §16.8). */
export const PERSONAL_RECORD_SESSION_EVENT_NAMES = [
    "training.session.completed",
    "training.session.revised",
    "training.session.reopened",
    "training.session.archived",
    "training.session.restored",
] as const;

// -------------------------------------------------------------------------------------------------
// Application-facing views + persistence records for the findings projection store
// -------------------------------------------------------------------------------------------------

/** A persisted finding as read back for a query surface (the current, or a superseded, row). */
export interface FindingView {
    readonly id: string;
    readonly profileId: string | null;
    readonly findingKey: string;
    readonly findingVersion: number;
    readonly scope: MetricScope;
    readonly dimensions: MetricDimensions;
    readonly numericValue: number | null;
    readonly unit: string | null;
    readonly status: FindingStatus;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly sourceFingerprint: string;
    readonly state: "current" | "superseded";
    readonly reviewAt: Date | null;
    readonly expiresAt: Date | null;
    readonly calculatedAt: Date;
    readonly supersededAt: Date | null;
}

/** One finding row a projection is about to write; the service stamps the id, natural key, and fingerprint. */
export interface FindingRecord {
    readonly id: string;
    readonly profileId: string | null;
    readonly findingKey: string;
    readonly findingVersion: number;
    readonly scope: MetricScope;
    readonly naturalKey: string;
    readonly status: FindingStatus;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly reviewAt: Date | null;
    readonly expiresAt: Date | null;
    readonly sourceFingerprint: string;
    readonly calculatedAt: Date;
}

export interface FindingQuery {
    readonly findingKey?: string;
    readonly scopeType?: string;
    readonly scopeId?: string;
    readonly profileId?: string;
    readonly includeSuperseded?: boolean;
    readonly limit: number;
}

/**
 * Idempotent projection store for qualitative findings (design §16.2, §16.8). Like derived metrics, writes
 * are supersede-and-insert: `supersedeAndInsert` marks the current row for a natural key `superseded` and
 * inserts the new `current` row in the caller's transaction, so a partial unique index keeps at most one live
 * finding per natural key and superseded history is preserved. Drizzle rows never escape the adapter.
 */
export interface FindingRepository<Transaction = unknown> {
    currentByNaturalKey(naturalKey: string, transaction?: Transaction): Promise<FindingView | null>;
    supersedeAndInsert(
        naturalKey: string,
        record: FindingRecord | null,
        transaction: Transaction,
    ): Promise<FindingView | null>;
    query(query: FindingQuery, transaction?: Transaction): Promise<readonly FindingView[]>;
}

/**
 * Read-only, bounded port that assembles the history the personal-record computation scores (design §16.8).
 * `describeSession` names the profile and the exercises a session touched (any status) so the affected record
 * scopes can be recomputed; `familyMembers` resolves the current analytics-family membership (PRD AN-2);
 * `loadEligibleSets` returns every completed, non-archived working set for the given exercises with the
 * frozen model needed to score it. Drizzle rows never escape the adapter.
 */
export interface PersonalRecordsReader<Transaction = unknown> {
    describeSession(
        sessionId: string,
        transaction?: Transaction,
    ): Promise<{ readonly profileId: string; readonly exerciseIds: readonly string[] } | null>;
    familyMembers(exerciseId: string, transaction?: Transaction): Promise<readonly string[]>;
    loadConfig(profileId: string, transaction?: Transaction): Promise<PersonalRecordsConfig>;
    loadEligibleSets(
        profileId: string,
        exerciseIds: readonly string[],
        transaction?: Transaction,
    ): Promise<readonly RecordSetInput[]>;
}

// -------------------------------------------------------------------------------------------------
// ProjectPersonalRecords — the per-session records discovery/projection use case
// -------------------------------------------------------------------------------------------------

interface ProjectPersonalRecordsRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly reader: PersonalRecordsReader<Transaction>;
    readonly repository: FindingRepository<Transaction>;
    readonly generateId: () => string;
    readonly clock?: Clock;
}

/**
 * Projects the personal-record findings for the exercises (and analytics families) a session touched
 * (issue #45, A3; design §16.8). Records are cross-session by nature — the best comparable performance over
 * the profile's whole history — so, like {@link ProjectStrengthMetrics}, this recomputes every record scope
 * the session moves by scanning the eligible history, then persists supersede-and-insert. An unchanged best
 * is a no-op on replay (fingerprint match → skip); an improved record supersedes the old one; a record whose
 * source performance vanished is retired. Family scopes aggregate only over explicit analytics-family members
 * and are labelled (PRD AN-2).
 */
export class ProjectPersonalRecords<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: ProjectPersonalRecordsRuntime<Transaction>) {
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
            const scopes = await this.resolveScopes(described.profileId, described.exerciseIds, activeTransaction);
            if (scopes.length === 0) return { recomputed: 0, retired: 0 };

            const involvedExerciseIds = dedupe(scopes.flatMap(scope => scope.memberExerciseIds));
            const sets = await this.runtime.reader.loadEligibleSets(
                described.profileId,
                involvedExerciseIds,
                activeTransaction,
            );

            const produced: RecordFinding[] = [];
            for (const scope of scopes) {
                const scopeSets = sets.filter(item => scope.memberExerciseIds.includes(item.exerciseId));
                produced.push(...computePersonalRecords(scope, scopeSets, config));
            }

            return this.persist(produced, described.profileId, config, scopes, activeTransaction);
        });
    }

    /** Resolve the exercise and family record scopes a session's exercises touch (families deduped). */
    private async resolveScopes(
        profileId: string,
        exerciseIds: readonly string[],
        transaction: Transaction,
    ): Promise<PersonalRecordsScope[]> {
        const scopes: PersonalRecordsScope[] = [];
        const seen = new Set<string>();
        for (const exerciseId of dedupe(exerciseIds)) {
            const exerciseScope: PersonalRecordsScope = {
                aggregation: "exercise",
                scopeType: RECORD_SCOPE_EXERCISE,
                profileId,
                representativeId: exerciseId,
                memberExerciseIds: [exerciseId],
            };
            if (register(seen, exerciseScope)) scopes.push(exerciseScope);

            const members = dedupe(await this.runtime.reader.familyMembers(exerciseId, transaction));
            if (members.length <= 1) continue; // no explicit analytics family beyond the exercise itself
            const familyScope: PersonalRecordsScope = {
                aggregation: "family",
                scopeType: RECORD_SCOPE_FAMILY,
                profileId,
                representativeId: familyRepresentative(members),
                memberExerciseIds: members,
            };
            if (register(seen, familyScope)) scopes.push(familyScope);
        }
        return scopes;
    }

    /** Supersede-and-insert every produced record and retire each scope's obsolete record findings. */
    private async persist(
        produced: readonly RecordFinding[],
        profileId: string,
        config: PersonalRecordsConfig,
        scopes: readonly PersonalRecordsScope[],
        transaction: Transaction,
    ): Promise<{ readonly recomputed: number; readonly retired: number }> {
        const now = this.clock.now();
        const configRecord = personalRecordsConfigRecord(config);
        const producedKeysByScope = new Map<string, Set<string>>();
        let recomputed = 0;

        for (const finding of produced) {
            const naturalKey = hashRequest(
                findingNaturalKeyDescriptor(finding.findingKey, finding.scope, finding.dimensions),
            );
            addKeyToScope(producedKeysByScope, finding.scope, naturalKey);

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

        let retired = 0;
        for (const scope of scopes) {
            const metricScope = personalRecordScope(scope);
            retired += await this.retireScope(
                metricScope,
                producedKeysByScope.get(scopeKey(metricScope)) ?? new Set(),
                transaction,
            );
        }
        return { recomputed, retired };
    }

    /** Retire the current record findings for a scope whose natural key is not in `keepKeys`. */
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
            if (!PERSONAL_RECORD_KEYS.includes(view.findingKey)) continue;
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

/** Runs {@link ProjectPersonalRecords} for one session inside the worker's transaction (idempotent). */
export class PersonalRecordsProjectionJobHandler<Transaction = unknown> implements JobHandler<Transaction> {
    readonly name = "analytics.personal-records-projection-job";
    readonly jobType = PERSONAL_RECORDS_PROJECTION_JOB;
    readonly jobVersion = PERSONAL_RECORDS_PROJECTION_JOB_VERSION;

    constructor(private readonly project: ProjectPersonalRecords<Transaction>) {}

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
 * Subscribes to a training-session lifecycle fact and enqueues the personal-records projection for that
 * session (issue #45, A3). One handler is registered per event name; the session id keys idempotent
 * coalescing so a burst of edits collapses to a single recompute.
 */
export class PersonalRecordsOutboxHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    readonly name = "analytics.personal-records-invalidation";
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
                type: PERSONAL_RECORDS_PROJECTION_JOB,
                version: PERSONAL_RECORDS_PROJECTION_JOB_VERSION,
                payload: { trainingSessionId: sessionId },
                idempotencyKey: `${PERSONAL_RECORDS_PROJECTION_JOB}:${sessionId}`,
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

/** Display metadata for one personal-record type (mirrors the wire contract; app never imports @kinetix/types). */
export interface PersonalRecordMetadataView {
    readonly key: string;
    readonly version: number;
    readonly label: string;
    readonly description: string;
    readonly unit: string;
    readonly dimensions: readonly string[];
}

export interface PersonalRecordCatalogMetadata {
    readonly schemaVersion: 1;
    readonly records: readonly PersonalRecordMetadataView[];
}

const RECORD_METADATA: readonly PersonalRecordMetadataView[] = [
    r(
        RECORD_MAX_LOAD,
        "Maximum load",
        "kg",
        ["basis", "aggregation"],
        "Heaviest effective load lifted on an eligible (completed, non-warm-up) set for the exercise or analytics family.",
    ),
    r(
        RECORD_ESTIMATED_1RM,
        "Estimated 1RM record",
        "kg",
        ["basis", "aggregation"],
        "Highest primary estimated 1RM (median of the six formulas) over 1RM-eligible sets; formulas travel in the evidence.",
    ),
    r(
        RECORD_REP_MAX_AT_LOAD,
        "Repetition maximum at load",
        "reps",
        ["basis", "aggregation", "load"],
        "Most repetitions ever performed at a given load, one record per distinct load.",
    ),
    r(
        RECORD_EXERCISE_VOLUME,
        "Single-session exercise volume",
        "kg",
        ["basis", "aggregation"],
        "Highest total effective volume (Σ work reps × effective load) achieved for the exercise or family in one session.",
    ),
];

/** The stable, versioned catalog of personal-record types for the analytics metadata endpoint (issue #45). */
export function personalRecordCatalogMetadata(): PersonalRecordCatalogMetadata {
    return { schemaVersion: 1, records: RECORD_METADATA };
}

function r(
    key: string,
    label: string,
    unit: string,
    dimensions: readonly string[],
    description: string,
): PersonalRecordMetadataView {
    return { key, version: 1, label, description, unit, dimensions };
}

// -------------------------------------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------------------------------------

/** The config record folded into a finding's fingerprint (a cutoff change invalidates 1RM records). */
function personalRecordsConfigRecord(config: PersonalRecordsConfig): Readonly<Record<string, unknown>> {
    return { repMin: config.repMin, repCutoff: config.repCutoff };
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

function register(seen: Set<string>, scope: PersonalRecordsScope): boolean {
    const key = scopeKey(personalRecordScope(scope));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
        throw new Error(`Personal-records projection job payload is missing ${field}`);
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}
