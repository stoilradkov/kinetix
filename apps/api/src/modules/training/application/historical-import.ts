import type { Clock } from "#src/platform/domain/index";
import {
    ApplicationError,
    ApplicationNotFoundError,
    ApplicationValidationError,
    DryRunConsumedError,
    DryRunExpiredError,
    DryRunStaleError,
    DryRunTokenInvalidError,
    IdempotencyInProgressError,
    ImportNotRevertibleError,
    ImportRevertBlockedError,
    hashRequest,
    type CommandContext,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    TrainingSession,
    collectHistoricalStorageRequests,
    partitionCommitBatches,
    planCommitBatches,
    summarizeCommittedKinds,
    tallyCommitCounts,
    validateHistoricalImportIdentities,
    type CommitBatch,
    type CommitCounts,
    type ExerciseOccurrenceInput,
    type ExerciseSnapshotV1,
    type HistoricalStoragePayload,
    type ImportEntityType,
    type PainRecordInput,
    type PerformedRunStepInput,
    type PerformedSetInput,
    type RunSplitInput,
    type RunningActivityInput,
    type SessionActivityInput,
    type SetGroupInput,
    type StrengthActivityInput,
    type TrainingSessionState,
    type PlanningWarning,
} from "#src/modules/training/domain/index";
import {
    BulkProgramNormalizer,
    proposeExerciseSnapshot,
    type BulkAffectedVersion,
    type BulkCatalogResolver,
    type BulkCommittedExercise,
    type BulkDryRunError,
    type BulkDryRunState,
    type BulkExerciseMapping,
    type BulkExerciseResolution,
    type BulkExternalIdEntry,
    type BulkExternalIdMapping,
    type BulkExternalIdRegistry,
    type BulkNormalizedProgram,
    type BulkProgramInput,
    type BulkProposedExercise,
    type BulkProposedExercisePreview,
} from "#src/modules/training/application/bulk-program";
import {
    fingerprintImportContent,
    type ReconcileImportStorage,
    type StorageReconciliationPlan,
    type StorageReconciliationRequest,
} from "#src/modules/training/application/storage-reconciliation";
import type { RegisterImportBatch } from "#src/modules/training/application/import-batches";
import type { ExerciseCatalogCommands, TrainingExerciseCatalogPort } from "#src/modules/training/application/exercises";
import { ExerciseNotFoundError } from "#src/modules/training/application/exercises";
import type { ProgramCommands, ProgramMembershipRepository } from "#src/modules/training/application/programs";
import type { PlannedSessionCommands } from "#src/modules/training/application/planned-sessions";
import type { PrescriptionPublisher } from "#src/modules/training/application/session-prescriptions";
import type { TrainingSessionCommands } from "#src/modules/training/application/training-sessions";
import type { ProfileReader } from "#src/modules/profile/index";

/**
 * Preview how an already-normalized historical archive (issue #58, HI4; design §14.2) would be stored,
 * without changing any authoritative Kinetix state. Where the single-program bulk dry-run previews one
 * program, this previews **many** normalized program trees together with completed `TrainingSession`s
 * and returns the exact deterministic storage plan (#57) a later commit will execute.
 *
 * The use case interprets nothing: it validates the public contract and normal domain invariants, resolves
 * canonical identifiers, and reconciles storage. It never cleans, infers, deduplicates, or repairs — a
 * missing canonical reference, an invalid measurement or RPE, or a stale version is *rejected*, not fixed.
 * Its only side effect is persisting the expiring dry-run artifact; it holds no program/session/catalog
 * write port, so it cannot mutate authoritative state.
 */

export const HISTORICAL_IMPORT_DRY_RUN_REPOSITORY = Symbol("HISTORICAL_IMPORT_DRY_RUN_REPOSITORY");
export const HISTORICAL_CATALOG_RESOLVER = Symbol("HISTORICAL_CATALOG_RESOLVER");
export const EXERCISE_SLUG_RESOLVER = Symbol("EXERCISE_SLUG_RESOLVER");
export const HISTORICAL_IMPORT_DRY_RUN = Symbol("HISTORICAL_IMPORT_DRY_RUN");
export const HISTORICAL_IMPORT_DRY_RUN_ENTITY_TYPE = "training.historical-import-dry-run";

/** How long a persisted historical dry-run stays valid for a follow-up commit (design 14.2/14.3). */
export const HISTORICAL_IMPORT_DRY_RUN_TTL_MS = 60 * 60 * 1_000;

// ---------------------------------------------------------------------------------------------
// Application-facing input/output (mirrors of the wire contract; the app never imports @kinetix/types)
// ---------------------------------------------------------------------------------------------

/** A canonical, already-resolved reference to a catalog exercise (no fuzzy/name resolution, #55). */
export type HistoricalExerciseReference =
    | { readonly by: "id"; readonly exerciseId: string }
    | { readonly by: "slug"; readonly slug: string }
    | { readonly by: "externalId"; readonly provider: string; readonly externalId: string };

export interface HistoricalPerformedSetInput {
    readonly externalId: string;
    readonly setGroupRef?: string | null;
    readonly round?: number | null;
    readonly position: number;
    readonly setType: PerformedSetInput["setType"];
    readonly status: PerformedSetInput["status"];
    readonly measurements?: PerformedSetInput["measurements"];
    readonly failureReason?: PerformedSetInput["failureReason"];
    readonly technique?: number | null;
    readonly discomfort?: number | null;
    readonly pump?: number | null;
    readonly notes?: string | null;
}

export interface HistoricalOccurrenceInput {
    readonly externalId: string;
    readonly reference: HistoricalExerciseReference;
    readonly proposed?: BulkProposedExercise;
    readonly position: number;
    readonly purpose?: string | null;
    readonly technique?: number | null;
    readonly discomfort?: number | null;
    readonly pump?: number | null;
    readonly notes?: string | null;
    readonly performedSets?: readonly HistoricalPerformedSetInput[];
}

export interface HistoricalSetGroupInput {
    readonly externalId: string;
    readonly parentGroupRef?: string | null;
    readonly type: SetGroupInput["type"];
    readonly position: number;
    readonly rounds?: number | null;
    readonly restMs?: number | null;
    readonly members?: readonly { readonly occurrenceRef: string; readonly position: number }[];
}

export interface HistoricalRunStepInput {
    readonly externalId: string;
    readonly parentStepRef?: string | null;
    readonly type: PerformedRunStepInput["type"];
    readonly position: number;
    readonly repeatCount?: number | null;
    readonly measurements?: PerformedRunStepInput["measurements"];
    readonly notes?: string | null;
}

export interface HistoricalRunSplitInput {
    readonly externalId: string;
    readonly position: number;
    readonly distance?: RunSplitInput["distance"];
    readonly movingTime?: RunSplitInput["movingTime"];
    readonly elapsedTime?: RunSplitInput["elapsedTime"];
    readonly averageHeartRate?: number | null;
    readonly maxHeartRate?: number | null;
}

interface HistoricalActivityBase {
    readonly externalId: string;
    readonly position: number;
    readonly startedAt?: string | null;
    readonly endedAt?: string | null;
    readonly durationSeconds?: number | null;
    readonly rpe?: number | null;
    readonly feeling?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
}

export type HistoricalSessionActivityInput =
    | (HistoricalActivityBase & {
          readonly type: "strength";
          readonly strength: {
              readonly occurrences: readonly HistoricalOccurrenceInput[];
              readonly setGroups?: readonly HistoricalSetGroupInput[];
          };
      })
    | (HistoricalActivityBase & {
          readonly type: "running";
          readonly running: HistoricalRunningActivityInput;
      });

export type HistoricalRunningActivityInput = Omit<RunningActivityInput, "steps" | "splits"> & {
    readonly steps?: readonly HistoricalRunStepInput[];
    readonly splits?: readonly HistoricalRunSplitInput[];
};

export interface HistoricalPainRecordInput {
    readonly externalId: string;
    readonly activityRef?: string | null;
    readonly occurrenceRef?: string | null;
    readonly performedSetRef?: string | null;
    readonly bodyArea: string;
    readonly side: PainRecordInput["side"];
    readonly severity: number;
    readonly painType?: string | null;
    readonly onsetDuringSession?: boolean;
    readonly stoppedActivity?: boolean;
    readonly notes?: string | null;
}

export interface HistoricalCompletedSessionInput {
    readonly externalId: string;
    readonly title?: string | null;
    readonly localDate: string;
    readonly timeZone: string;
    readonly startedAt?: string | null;
    readonly endedAt?: string | null;
    readonly durationMinutes?: number | null;
    readonly readiness?: Parameters<typeof TrainingSession.create>[0]["readiness"];
    readonly postWorkout?: Parameters<typeof TrainingSession.create>[0]["postWorkout"];
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly activities: readonly HistoricalSessionActivityInput[];
    readonly painRecords?: readonly HistoricalPainRecordInput[];
}

export interface HistoricalImportEnvelopeInput {
    readonly schemaVersion: 1;
    readonly source: {
        readonly namespace: string;
        readonly generatedBy?: string;
        readonly payloadId: string;
        readonly checksum: string;
    };
    readonly mode: "create" | "upsert";
    readonly createMissingExercises?: boolean;
    readonly programs?: readonly BulkProgramInput[];
    readonly completedSessions?: readonly HistoricalCompletedSessionInput[];
}

/** The normalized completed-session tree a commit would store, plus its stable external id. */
export interface HistoricalNormalizedSession extends TrainingSessionState {
    readonly externalId: string;
}

export interface HistoricalImportSummary {
    readonly programs: number;
    readonly completedSessions: number;
    readonly entities: number;
    readonly operations: StorageReconciliationPlan["counts"];
    readonly entityTypeCounts: readonly { readonly entityType: string; readonly count: number }[];
}

export interface HistoricalImportDryRunResult {
    readonly dryRunId: string;
    readonly approvalToken: string;
    readonly referenceHash: string;
    readonly schemaVersion: 1;
    readonly mode: "create" | "upsert";
    readonly source: { readonly namespace: string; readonly generatedBy: string | null };
    readonly state: BulkDryRunState;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly programs: readonly BulkNormalizedProgram[];
    readonly completedSessions: readonly HistoricalNormalizedSession[];
    readonly storagePlan: StorageReconciliationPlan;
    readonly summary: HistoricalImportSummary;
    readonly warnings: readonly PlanningWarning[];
    readonly errors: readonly BulkDryRunError[];
    readonly mappings: readonly BulkExerciseMapping[];
    readonly proposedExercises: readonly BulkProposedExercisePreview[];
    readonly affectedVersions: readonly BulkAffectedVersion[];
}

/** The persisted preview artifact — the only thing a historical dry-run writes (design 14.2 step 9). */
export interface StoredHistoricalImportDryRun {
    readonly id: string;
    readonly profileId: string;
    readonly schemaVersion: 1;
    readonly sourceNamespace: string;
    readonly sourceGeneratedBy: string | null;
    readonly payloadId: string;
    readonly checksum: string;
    readonly mode: "create" | "upsert";
    readonly state: BulkDryRunState;
    readonly referenceHash: string;
    readonly approvalToken: string;
    readonly programs: readonly BulkNormalizedProgram[];
    readonly completedSessions: readonly HistoricalNormalizedSession[];
    readonly storagePlan: StorageReconciliationPlan;
    readonly summary: HistoricalImportSummary;
    readonly warnings: readonly PlanningWarning[];
    readonly errors: readonly BulkDryRunError[];
    readonly mappings: readonly BulkExerciseMapping[];
    readonly proposedExercises: readonly BulkProposedExercisePreview[];
    readonly affectedVersions: readonly BulkAffectedVersion[];
    readonly createdAt: Date;
    readonly expiresAt: Date;
    /** Set on a future commit transaction; a non-null value means the dry-run was already consumed. */
    readonly consumedAt: Date | null;
}

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

/**
 * Capability port over the historical dry-run artifact store. No generic base repository, no raw SQL in
 * the use case (ADR 0003). `save` runs inside the caller's UnitOfWork so the artifact write is the
 * single, isolated side effect and shares the reconciliation reads' snapshot.
 */
export interface HistoricalImportDryRunRepository<Transaction = unknown> {
    save(record: StoredHistoricalImportDryRun, transaction: Transaction): Promise<void>;
    findById(id: string, transaction?: Transaction): Promise<StoredHistoricalImportDryRun | null>;
    /**
     * Lock the dry-run row for a commit (SELECT … FOR UPDATE), serializing concurrent commits of the
     * same dry-run so its consumed/expiry gates cannot race (design §14.3 step 1, §14.7).
     */
    lockForCommit(id: string, transaction: Transaction): Promise<StoredHistoricalImportDryRun | null>;
    /** Mark the dry-run consumed once its commit run succeeded, in the finishing transaction. */
    markConsumed(id: string, input: { consumedAt: Date }, transaction: Transaction): Promise<void>;
}

/** Resolve a canonical exercise `slug` to a catalog exercise id (#55 canonical references). */
export interface ExerciseSlugResolver {
    resolveBySlug(slug: string): Promise<string | null>;
}

/**
 * Resolve a historical (canonical-only) exercise reference — by catalog `id`, `slug`, or provider
 * `externalId` — to the current exercise. There is deliberately no alias/name path: an unresolved name
 * is a rejected reference, never a fuzzy match (#55). Reuses the read-only {@link BulkCatalogResolver}
 * for id/externalId and a dedicated slug lookup for slug.
 */
export class HistoricalCatalogResolver {
    constructor(
        private readonly bulk: BulkCatalogResolver,
        private readonly slugs: ExerciseSlugResolver,
    ) {}

    async resolve(reference: HistoricalExerciseReference): Promise<BulkExerciseResolution> {
        if (reference.by === "id") return this.bulk.resolve({ by: "id", exerciseId: reference.exerciseId });
        if (reference.by === "externalId")
            return this.bulk.resolve({
                by: "externalId",
                provider: reference.provider,
                externalId: reference.externalId,
            });
        const exerciseId = await this.slugs.resolveBySlug(reference.slug);
        return exerciseId === null ? { status: "missing" } : this.bulk.resolve({ by: "id", exerciseId });
    }
}

// ---------------------------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------------------------

interface HistoricalImportDryRunRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: HistoricalImportDryRunRepository<Transaction>;
    readonly reconcile: ReconcileImportStorage<Transaction>;
    readonly resolver: BulkCatalogResolver;
    readonly slugResolver: ExerciseSlugResolver;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
    readonly ttlMs?: number;
}

interface DryRunSink {
    readonly errors: BulkDryRunError[];
    readonly mappings: BulkExerciseMapping[];
    readonly proposedExercises: BulkProposedExercisePreview[];
    readonly affected: Map<string, BulkAffectedVersion>;
}

export class HistoricalImportDryRun<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly ttlMs: number;
    private readonly normalizer: BulkProgramNormalizer;
    private readonly catalog: HistoricalCatalogResolver;

    constructor(private readonly runtime: HistoricalImportDryRunRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Historical import dry-run ID generation is not configured");
            });
        this.ttlMs = runtime.ttlMs ?? HISTORICAL_IMPORT_DRY_RUN_TTL_MS;
        this.normalizer = new BulkProgramNormalizer(runtime.resolver, this.generateId);
        this.catalog = new HistoricalCatalogResolver(runtime.resolver, runtime.slugResolver);
    }

    async execute(
        envelope: HistoricalImportEnvelopeInput,
        _metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<HistoricalImportDryRunResult> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const programs = envelope.programs ?? [];
        const completedSessions = envelope.completedSessions ?? [];

        // Cross-node identity + aggregate-boundary invariants (bounded size, per-type external-ID
        // uniqueness, mapping/structural reference resolution). Structural failures throw here (422);
        // per-entity catalog and domain validation problems are collected into `errors` below.
        validateHistoricalImportIdentities(envelope);

        const sink: DryRunSink = { errors: [], mappings: [], proposedExercises: [], affected: new Map() };
        const warnings: PlanningWarning[] = [];

        // ---- Normalize + validate every program (reusing the shipped bulk normalizer) --------
        const normalizedPrograms: BulkNormalizedProgram[] = [];
        for (const [index, program] of programs.entries()) {
            const normalization = await this.normalizer.normalize(
                program,
                { basePath: ["programs", index], createMissingExercises: envelope.createMissingExercises ?? false },
                profileId,
                now,
            );
            normalizedPrograms.push(normalization.normalizedProgram);
            sink.errors.push(...normalization.errors);
            sink.mappings.push(...normalization.mappings);
            sink.proposedExercises.push(...normalization.proposedExercises);
            warnings.push(...normalization.warnings);
            for (const version of normalization.affected) sink.affected.set(version.entityId, version);
        }

        // ---- Build + validate every completed session in memory (no persistence) -------------
        const normalizedSessions: HistoricalNormalizedSession[] = [];
        for (const [index, session] of completedSessions.entries()) {
            const normalized = await this.normalizeCompletedSession(
                session,
                ["completedSessions", index],
                profileId,
                envelope.createMissingExercises ?? false,
                now,
                sink,
            );
            if (normalized) normalizedSessions.push(normalized);
        }

        // ---- Reconcile storage for every addressable entity (#57) ----------------------------
        const requests: StorageReconciliationRequest[] = collectHistoricalStorageRequests(
            envelope as HistoricalStoragePayload,
        ).map(request => ({
            path: request.path,
            entityType: request.entityType,
            externalId: request.externalId,
            incomingFingerprint: fingerprintImportContent(request.content),
        }));

        const affectedVersions = [...sink.affected.values()].sort((a, b) => a.entityId.localeCompare(b.entityId));
        const referenceHash = hashRequest(affectedVersions);
        const state: BulkDryRunState = sink.mappings.length > 0 || sink.errors.length > 0 ? "needs_mapping" : "ready";

        const run = async (active: Transaction): Promise<StoredHistoricalImportDryRun> => {
            const storagePlan = await this.runtime.reconcile.execute(
                requests,
                { namespace: envelope.source.namespace, mode: envelope.mode },
                active,
            );
            const record: StoredHistoricalImportDryRun = {
                id: this.generateId(),
                profileId,
                schemaVersion: 1,
                sourceNamespace: envelope.source.namespace,
                sourceGeneratedBy: envelope.source.generatedBy ?? null,
                payloadId: envelope.source.payloadId,
                checksum: envelope.source.checksum,
                mode: envelope.mode,
                state,
                referenceHash,
                approvalToken: this.generateId(),
                programs: normalizedPrograms,
                completedSessions: normalizedSessions,
                storagePlan,
                summary: summarize(programs.length, completedSessions.length, requests, storagePlan),
                warnings,
                errors: sink.errors,
                mappings: sink.mappings,
                proposedExercises: sink.proposedExercises,
                affectedVersions,
                createdAt: now,
                expiresAt: new Date(now.getTime() + this.ttlMs),
                consumedAt: null,
            };
            await this.runtime.repository.save(record, active);
            return record;
        };

        const record = transaction === undefined ? await this.runtime.unitOfWork.execute(run) : await run(transaction);
        return toResult(record);
    }

    /**
     * Build one completed session as a `TrainingSession` aggregate entirely in memory, so every domain
     * invariant (measurements, RPE, pain-record targets, structural references) runs without any write.
     * External-ID references inside the session are minted to fresh UUIDs and remapped; exercise
     * references are resolved through the canonical-only catalog. A session that fails to resolve or
     * validate contributes its error(s) and is omitted from the normalized preview (its raw entities
     * still appear in the storage plan, which is derived from the payload).
     */
    private async normalizeCompletedSession(
        session: HistoricalCompletedSessionInput,
        basePath: readonly (string | number)[],
        profileId: string,
        createMissingExercises: boolean,
        now: Date,
        sink: DryRunSink,
    ): Promise<HistoricalNormalizedSession | null> {
        // Mint a fresh UUID for every addressable node, keyed by its payload external id.
        const activityId = new Map<string, string>();
        const occurrenceId = new Map<string, string>();
        const performedSetId = new Map<string, string>();
        const setGroupId = new Map<string, string>();
        const runStepId = new Map<string, string>();
        for (const activity of session.activities) {
            activityId.set(activity.externalId, this.generateId());
            if (activity.type === "strength") {
                for (const occurrence of activity.strength.occurrences)
                    occurrenceId.set(occurrence.externalId, this.generateId());
                for (const occurrence of activity.strength.occurrences)
                    for (const set of occurrence.performedSets ?? [])
                        performedSetId.set(set.externalId, this.generateId());
                for (const group of activity.strength.setGroups ?? [])
                    setGroupId.set(group.externalId, this.generateId());
            } else {
                for (const step of activity.running.steps ?? []) runStepId.set(step.externalId, this.generateId());
            }
        }

        // Resolve every occurrence's canonical exercise reference before building the aggregate.
        const resolvedOccurrence = new Map<string, { exerciseId: string; snapshot: ExerciseSnapshotV1 }>();
        let unresolved = false;
        for (const [a, activity] of session.activities.entries()) {
            if (activity.type !== "strength") continue;
            for (const [o, occurrence] of activity.strength.occurrences.entries()) {
                const path = [...basePath, "activities", a, "strength", "occurrences", o];
                const resolved = await this.resolveOccurrence(
                    session.externalId,
                    occurrence,
                    path,
                    createMissingExercises,
                    now,
                    sink,
                );
                if (resolved) resolvedOccurrence.set(occurrence.externalId, resolved);
                else unresolved = true;
            }
        }
        if (unresolved) return null;

        try {
            const activities: SessionActivityInput[] = session.activities.map(activity => {
                const base = {
                    id: activityId.get(activity.externalId)!,
                    type: activity.type,
                    position: activity.position,
                    startedAt: activity.startedAt ?? null,
                    endedAt: activity.endedAt ?? null,
                    durationSeconds: activity.durationSeconds ?? null,
                    rpe: activity.rpe ?? null,
                    feeling: activity.feeling ?? null,
                    notes: activity.notes ?? null,
                    tags: activity.tags ?? [],
                };
                if (activity.type === "strength")
                    return {
                        ...base,
                        strength: this.strengthInput(
                            activity.strength,
                            resolvedOccurrence,
                            occurrenceId,
                            performedSetId,
                            setGroupId,
                        ),
                        running: null,
                    };
                return { ...base, strength: null, running: this.runningInput(activity.running, runStepId) };
            });

            const painRecords: PainRecordInput[] = (session.painRecords ?? []).map(pain => ({
                id: this.generateId(),
                activityId: pain.activityRef != null ? (activityId.get(pain.activityRef) ?? null) : null,
                exerciseOccurrenceId:
                    pain.occurrenceRef != null ? (occurrenceId.get(pain.occurrenceRef) ?? null) : null,
                performedSetId:
                    pain.performedSetRef != null ? (performedSetId.get(pain.performedSetRef) ?? null) : null,
                bodyArea: pain.bodyArea,
                side: pain.side,
                severity: pain.severity,
                painType: pain.painType ?? null,
                onsetDuringSession: pain.onsetDuringSession ?? false,
                stoppedActivity: pain.stoppedActivity ?? false,
                notes: pain.notes ?? null,
            }));

            let aggregate = TrainingSession.create(
                {
                    id: this.generateId(),
                    profileId,
                    localDate: session.localDate,
                    timeZone: session.timeZone,
                    title: session.title ?? null,
                    notes: session.notes ?? null,
                    tags: session.tags ?? [],
                    readiness: session.readiness,
                    postWorkout: session.postWorkout,
                    activities,
                    painRecords,
                },
                now,
            );
            if (session.startedAt != null) aggregate = aggregate.update({ startedAt: session.startedAt }, now);
            aggregate = aggregate.start(now);
            aggregate = aggregate.complete(
                { endedAt: session.endedAt ?? null, durationMinutes: session.durationMinutes ?? null },
                now,
            );
            return { ...aggregate.state, externalId: session.externalId };
        } catch (error) {
            sink.errors.push(toError([...basePath], error));
            return null;
        }
    }

    private async resolveOccurrence(
        sessionExternalId: string,
        occurrence: HistoricalOccurrenceInput,
        path: readonly (string | number)[],
        createMissing: boolean,
        now: Date,
        sink: DryRunSink,
    ): Promise<{ exerciseId: string; snapshot: ExerciseSnapshotV1 } | null> {
        const resolution = await this.catalog.resolve(occurrence.reference);
        if (resolution.status === "resolved") {
            sink.affected.set(resolution.exerciseId, {
                entityType: "training.exercise",
                entityId: resolution.exerciseId,
                version: resolution.exerciseVersion,
            });
            return { exerciseId: resolution.exerciseId, snapshot: resolution.snapshot };
        }

        if (resolution.status === "missing" && createMissing && occurrence.proposed) {
            try {
                const snapshot = proposeExerciseSnapshot(occurrence.proposed, this.generateId, now);
                sink.proposedExercises.push({
                    exerciseId: snapshot.exerciseId,
                    exerciseRef: occurrence.externalId,
                    sessionExternalId,
                    definition: occurrence.proposed,
                });
                return { exerciseId: snapshot.exerciseId, snapshot };
            } catch (error) {
                sink.errors.push(toError([...path, "proposed"], error));
                return null;
            }
        }

        sink.mappings.push({
            path: [...path],
            sessionExternalId,
            exerciseRef: occurrence.externalId,
            status: resolution.status === "missing" ? "missing" : "ambiguous",
            requested: referenceForMapping(occurrence.reference),
            ...(resolution.status === "ambiguous" ? { candidates: [...resolution.candidates] } : {}),
        });
        sink.errors.push({
            path: [...path],
            code: "CATALOG_MAPPING_REQUIRED",
            message:
                resolution.status === "missing"
                    ? `Exercise reference for occurrence '${occurrence.externalId}' did not match any catalog exercise`
                    : `Exercise reference for occurrence '${occurrence.externalId}' matched multiple catalog exercises`,
        });
        return null;
    }

    private strengthInput(
        strength: { occurrences: readonly HistoricalOccurrenceInput[]; setGroups?: readonly HistoricalSetGroupInput[] },
        resolvedOccurrence: ReadonlyMap<string, { exerciseId: string; snapshot: ExerciseSnapshotV1 }>,
        occurrenceId: ReadonlyMap<string, string>,
        performedSetId: ReadonlyMap<string, string>,
        setGroupId: ReadonlyMap<string, string>,
    ): StrengthActivityInput {
        const occurrences: ExerciseOccurrenceInput[] = strength.occurrences.map(occurrence => {
            const resolved = resolvedOccurrence.get(occurrence.externalId)!;
            const performedSets: PerformedSetInput[] = (occurrence.performedSets ?? []).map(set => ({
                id: performedSetId.get(set.externalId)!,
                setGroupId: set.setGroupRef != null ? (setGroupId.get(set.setGroupRef) ?? null) : null,
                round: set.round ?? null,
                position: set.position,
                setType: set.setType,
                status: set.status,
                measurements: set.measurements,
                failureReason: set.failureReason ?? null,
                technique: set.technique ?? null,
                discomfort: set.discomfort ?? null,
                pump: set.pump ?? null,
                notes: set.notes ?? null,
            }));
            return {
                id: occurrenceId.get(occurrence.externalId)!,
                exerciseId: resolved.exerciseId,
                snapshot: resolved.snapshot,
                position: occurrence.position,
                purpose: occurrence.purpose ?? null,
                technique: occurrence.technique ?? null,
                discomfort: occurrence.discomfort ?? null,
                pump: occurrence.pump ?? null,
                notes: occurrence.notes ?? null,
                performedSets,
            };
        });
        const setGroups: SetGroupInput[] = (strength.setGroups ?? []).map(group => ({
            id: setGroupId.get(group.externalId)!,
            parentGroupId: group.parentGroupRef != null ? (setGroupId.get(group.parentGroupRef) ?? null) : null,
            type: group.type,
            position: group.position,
            rounds: group.rounds ?? null,
            restMs: group.restMs ?? null,
            members: (group.members ?? []).map(member => ({
                occurrenceId: occurrenceId.get(member.occurrenceRef)!,
                position: member.position,
            })),
        }));
        return { occurrences, setGroups };
    }

    private runningInput(
        running: HistoricalRunningActivityInput,
        runStepId: ReadonlyMap<string, string>,
    ): RunningActivityInput {
        const steps: PerformedRunStepInput[] | undefined = running.steps?.map(step => ({
            id: runStepId.get(step.externalId)!,
            parentStepId: step.parentStepRef != null ? (runStepId.get(step.parentStepRef) ?? null) : null,
            type: step.type,
            position: step.position,
            repeatCount: step.repeatCount ?? null,
            measurements: step.measurements,
            notes: step.notes ?? null,
        }));
        const splits: RunSplitInput[] | undefined = running.splits?.map(split => ({
            id: this.generateId(),
            position: split.position,
            distance: split.distance ?? null,
            movingTime: split.movingTime ?? null,
            elapsedTime: split.elapsedTime ?? null,
            averageHeartRate: split.averageHeartRate ?? null,
            maxHeartRate: split.maxHeartRate ?? null,
        }));
        // Strip the historical step/split shapes from the summary spread; re-add the mapped domain ones.
        const summary: Record<string, unknown> = { ...running };
        delete summary.steps;
        delete summary.splits;
        return {
            ...(summary as Omit<RunningActivityInput, "steps" | "splits">),
            ...(steps !== undefined ? { steps } : {}),
            ...(splits !== undefined ? { splits } : {}),
        };
    }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function summarize(
    programs: number,
    completedSessions: number,
    requests: readonly StorageReconciliationRequest[],
    plan: StorageReconciliationPlan,
): HistoricalImportSummary {
    const byType = new Map<string, number>();
    for (const request of requests) byType.set(request.entityType, (byType.get(request.entityType) ?? 0) + 1);
    const entityTypeCounts = [...byType.entries()]
        .map(([entityType, count]) => ({ entityType, count }))
        .sort((a, b) => a.entityType.localeCompare(b.entityType));
    return { programs, completedSessions, entities: requests.length, operations: plan.counts, entityTypeCounts };
}

function toResult(record: StoredHistoricalImportDryRun): HistoricalImportDryRunResult {
    return {
        dryRunId: record.id,
        approvalToken: record.approvalToken,
        referenceHash: record.referenceHash,
        schemaVersion: 1,
        mode: record.mode,
        source: { namespace: record.sourceNamespace, generatedBy: record.sourceGeneratedBy },
        state: record.state,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        programs: record.programs,
        completedSessions: record.completedSessions,
        storagePlan: record.storagePlan,
        summary: record.summary,
        warnings: record.warnings,
        errors: record.errors,
        mappings: record.mappings,
        proposedExercises: record.proposedExercises,
        affectedVersions: record.affectedVersions,
    };
}

/** Represent a historical reference for the informational mapping payload (slug surfaced as an alias). */
function referenceForMapping(reference: HistoricalExerciseReference): BulkExerciseMapping["requested"] {
    if (reference.by === "id") return { by: "id", exerciseId: reference.exerciseId };
    if (reference.by === "externalId")
        return { by: "externalId", provider: reference.provider, externalId: reference.externalId };
    return { by: "alias", alias: reference.slug };
}

function toError(path: readonly (string | number)[], error: unknown): BulkDryRunError {
    const message = error instanceof Error ? error.message : "Validation failed";
    const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "VALIDATION_FAILED";
    return { path: [...path], code, message };
}

// =============================================================================================
// Commit (issue #59, HI5; design §14.3, §14.7)
// =============================================================================================

export const HISTORICAL_IMPORT_COMMIT_REPOSITORY = Symbol("HISTORICAL_IMPORT_COMMIT_REPOSITORY");
export const COMMIT_HISTORICAL_IMPORT = Symbol("COMMIT_HISTORICAL_IMPORT");
export const HISTORICAL_IMPORT_COMMIT_QUERY_SERVICE = Symbol("HISTORICAL_IMPORT_COMMIT_QUERY_SERVICE");

/** Lifecycle of a durable commit run (mirrors the wire `historicalImportCommitStateSchema`). */
export type HistoricalImportCommitState = "pending" | "running" | "succeeded" | "failed";

/** Why a commit run stopped, anchored to the offending node in the canonical payload. */
export interface HistoricalImportCommitFailure {
    readonly path: readonly (string | number)[];
    readonly code: string;
    readonly message: string;
    readonly entityType: ImportEntityType | null;
    readonly externalId: string | null;
}

/**
 * The durable commit-run record — the source of truth for status, idempotent replay, and resume. Keyed
 * by `dryRunId` (a dry-run commits into exactly one run), it persists identity, the resolved import
 * batch, the ordered checkpoint of committed batch keys, attempt count, and a path-anchored failure.
 * Because the record is written in the same transaction as each batch it checkpoints, an interrupted
 * commit resumes from exactly the batches that durably committed — never re-applying one.
 */
export interface StoredHistoricalImportCommit {
    readonly id: string;
    readonly dryRunId: string;
    readonly profileId: string;
    readonly importBatchId: string | null;
    readonly sourceNamespace: string;
    readonly sourceGeneratedBy: string | null;
    readonly mode: "create" | "upsert";
    readonly idempotencyKey: string | null;
    readonly state: HistoricalImportCommitState;
    readonly committedBatchKeys: readonly string[];
    readonly attempts: number;
    readonly failure: HistoricalImportCommitFailure | null;
    readonly createdAt: Date;
    readonly startedAt: Date | null;
    readonly completedAt: Date | null;
    readonly updatedAt: Date;
}

/** One committed external-ID → Kinetix-ID binding surfaced in a commit result. */
export interface HistoricalImportCommitEntity {
    readonly entityType: ImportEntityType;
    readonly externalId: string;
    readonly entityId: string;
}

/** The application-facing commit run result (mirror of `historicalImportCommitResponseSchema`). */
export interface HistoricalImportCommitResult {
    readonly commitId: string;
    readonly dryRunId: string;
    readonly importBatchId: string | null;
    readonly state: HistoricalImportCommitState;
    readonly mode: "create" | "upsert";
    readonly source: { readonly namespace: string; readonly generatedBy: string | null };
    readonly programs: number;
    readonly completedSessions: number;
    readonly counts: CommitCounts;
    readonly entities: readonly HistoricalImportCommitEntity[];
    readonly createdExercises: readonly BulkCommittedExercise[];
    readonly affectedVersions: readonly BulkAffectedVersion[];
    readonly warnings: readonly PlanningWarning[];
    readonly failure: HistoricalImportCommitFailure | null;
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
}

/** Start a commit: only the dry-run identity + approval token (never a body) plus an optional key. */
export interface HistoricalImportCommitRequest {
    readonly dryRunId: string;
    readonly approvalToken: string;
    readonly idempotencyKey?: string | null;
}

/**
 * Persistence port over the durable commit-run store. `lockByDryRunId` / `lockById` serialize concurrent
 * commits (SELECT … FOR UPDATE); `insertIfAbsent` (INSERT … ON CONFLICT (dry_run_id) DO NOTHING)
 * converges concurrent first-time starts on one run; `save` rewrites the mutable lifecycle fields
 * (state, checkpoint, failure, timestamps). Identity is fixed at insert. No raw SQL in the use case
 * (ADR 0003); every write runs inside the caller's UnitOfWork.
 */
export interface HistoricalImportCommitRepository<Transaction = unknown> {
    lockByDryRunId(
        dryRunId: string,
        profileId: string,
        transaction: Transaction,
    ): Promise<StoredHistoricalImportCommit | null>;
    lockById(id: string, profileId: string, transaction: Transaction): Promise<StoredHistoricalImportCommit | null>;
    insertIfAbsent(record: StoredHistoricalImportCommit, transaction: Transaction): Promise<boolean>;
    findById(id: string, profileId: string, transaction?: Transaction): Promise<StoredHistoricalImportCommit | null>;
    /** Every commit run for the profile, newest first — the read side of `GET …/commits` (issue #60, HI6). */
    listByProfile(profileId: string, transaction?: Transaction): Promise<readonly StoredHistoricalImportCommit[]>;
    save(record: StoredHistoricalImportCommit, transaction: Transaction): Promise<void>;
}

/** A missing/foreign dry-run addressed by a commit. */
export class HistoricalImportDryRunNotFoundError extends ApplicationNotFoundError {
    constructor(readonly dryRunId: string) {
        super(`Historical import dry-run ${dryRunId} was not found`, { dryRunId });
        this.name = "HistoricalImportDryRunNotFoundError";
    }
}

/** A missing/foreign commit run addressed by a status/retry request. */
export class HistoricalImportCommitNotFoundError extends ApplicationNotFoundError {
    constructor(readonly commitId: string) {
        super(`Historical import commit ${commitId} was not found`, { commitId });
        this.name = "HistoricalImportCommitNotFoundError";
    }
}

/**
 * A commit batch failed and left the run `failed` (design §14.7). Carries the path-anchored failure so
 * the boundary can surface exactly which canonical payload node stopped the import. `JOB_FAILED` maps to
 * a 422 and CLI exit 6; the run is durably recorded and resumable via retry.
 */
export class HistoricalImportCommitFailedError extends ApplicationError {
    constructor(
        readonly commitId: string,
        readonly failure: HistoricalImportCommitFailure,
    ) {
        super("JOB_FAILED", failure.message, undefined, {
            commitId,
            path: [...failure.path],
            failureCode: failure.code,
            ...(failure.entityType ? { entityType: failure.entityType } : {}),
            ...(failure.externalId ? { externalId: failure.externalId } : {}),
        });
        this.name = "HistoricalImportCommitFailedError";
    }
}

interface CommitRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly dryRuns: HistoricalImportDryRunRepository<Transaction>;
    readonly commits: HistoricalImportCommitRepository<Transaction>;
    readonly externalIds: BulkExternalIdRegistry<Transaction>;
    readonly importBatches: RegisterImportBatch<Transaction>;
    readonly catalog: Pick<TrainingExerciseCatalogPort, "resolveCurrentExercise">;
    readonly exercises: ExerciseCatalogCommands<Transaction>;
    readonly programCommands: ProgramCommands<Transaction>;
    readonly plannedSessions: PlannedSessionCommands<Transaction>;
    readonly publisher: PrescriptionPublisher<Transaction>;
    readonly membership: ProgramMembershipRepository<Transaction>;
    readonly trainingSessions: Pick<TrainingSessionCommands<Transaction>, "commitPreparedState">;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

/**
 * Commit an approved historical dry-run into authoritative Training state — durably, idempotently, and
 * resumably (design §14.7; issue #59, HI5). Unlike the single-program bulk commit (14.3) which writes
 * one program in one transaction, a multi-year archive is applied as a sequence of **aggregate-safe
 * batches** — one transaction per program tree and per completed session — each checkpointed on a
 * durable commit-run record. So an interruption never leaves a partial aggregate, and a retry resumes
 * from exactly the batches that committed, never duplicating a program, session, activity, occurrence,
 * or set.
 *
 * Commit reuses only the approved normalized trees the dry-run stored — it accepts no body, re-derives
 * nothing, and interprets nothing. It re-verifies the dry-run's identity, token, freshness, and
 * reference hash before any write; persists each aggregate through the ordinary aggregate commands
 * ({@link ProgramCommands}, {@link PlannedSessionCommands}, {@link TrainingSessionCommands}) so every
 * revision and outbox fact fires exactly as for a hand-authored program or session, with
 * `revisionSource = "import"`; registers each aggregate's namespaced external IDs (linked to its import
 * batch) so the DB uniqueness backs safe retries; and consumes the dry-run only once every batch has
 * committed. A batch failure leaves prior batches intact, records a path-anchored failure, and stops.
 *
 * Scope (create-mode MVP, matching the shipped bulk commit): fresh entities are created and their
 * external IDs registered for safe retries; field-level upsert of pre-existing aggregates and planned↔
 * actual mapping persistence require the dry-run to carry diffs/mappings and are a later increment.
 */
export class CommitHistoricalImport<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;

    constructor(private readonly runtime: CommitRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Historical import commit ID generation is not configured");
            });
    }

    /** Start (or resume, for a byte-identical retry) the commit of an approved dry-run. */
    async execute(
        request: HistoricalImportCommitRequest,
        metadata: CommandContext,
    ): Promise<HistoricalImportCommitResult> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const claim = await this.claim(request, profileId);
        if (claim.done) return this.toResult(claim.commit, claim.dryRun);
        return this.run(claim.commit, claim.dryRun, metadata);
    }

    /** Resume a failed or interrupted commit run from its last committed checkpoint. */
    async retry(commitId: string, metadata: CommandContext): Promise<HistoricalImportCommitResult> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const claim = await this.claimForRetry(commitId, profileId);
        if (claim.done) return this.toResult(claim.commit, claim.dryRun);
        return this.run(claim.commit, claim.dryRun, metadata);
    }

    // ---- Gate + claim (one transaction) --------------------------------------------------------

    private claim(
        request: HistoricalImportCommitRequest,
        profileId: string,
    ): Promise<{ commit: StoredHistoricalImportCommit; dryRun: StoredHistoricalImportDryRun; done: boolean }> {
        return this.runtime.unitOfWork.execute(async transaction => {
            const dryRun = await this.runtime.dryRuns.lockForCommit(request.dryRunId, transaction);
            if (!dryRun || dryRun.profileId !== profileId)
                throw new HistoricalImportDryRunNotFoundError(request.dryRunId);
            if (dryRun.approvalToken !== request.approvalToken) throw new DryRunTokenInvalidError(dryRun.id);

            let commit = await this.runtime.commits.lockByDryRunId(dryRun.id, profileId, transaction);
            if (commit?.state === "succeeded") return { commit, dryRun, done: true };
            if (commit?.state === "running") throw new IdempotencyInProgressError("training.imports.commit", dryRun.id);

            // Freshness + readiness gates for a first or resumed-after-failure commit.
            if (dryRun.consumedAt !== null) throw new DryRunConsumedError(dryRun.id);
            if (dryRun.expiresAt.getTime() <= this.clock.now().getTime()) throw new DryRunExpiredError(dryRun.id);
            this.assertCommittable(dryRun);
            await this.revalidateReferences(dryRun);

            const batch = await this.runtime.importBatches.execute(
                {
                    source: {
                        namespace: dryRun.sourceNamespace,
                        payloadId: dryRun.payloadId,
                        schemaVersion: 1,
                        checksum: dryRun.checksum,
                        generatedBy: dryRun.sourceGeneratedBy,
                    },
                },
                transaction,
            );

            const now = this.clock.now();
            if (!commit) {
                const record = this.newRecord(dryRun, request, batch.id, profileId, now);
                const inserted = await this.runtime.commits.insertIfAbsent(record, transaction);
                commit = inserted
                    ? record
                    : await this.runtime.commits.lockByDryRunId(dryRun.id, profileId, transaction);
                if (!commit) throw new HistoricalImportCommitNotFoundError(dryRun.id);
                if (commit.state === "succeeded") return { commit, dryRun, done: true };
                if (commit.state === "running")
                    throw new IdempotencyInProgressError("training.imports.commit", dryRun.id);
            }

            const running: StoredHistoricalImportCommit = {
                ...commit,
                importBatchId: batch.id,
                state: "running",
                attempts: commit.attempts + 1,
                startedAt: commit.startedAt ?? now,
                failure: null,
                updatedAt: now,
            };
            await this.runtime.commits.save(running, transaction);
            return { commit: running, dryRun, done: false };
        });
    }

    private claimForRetry(
        commitId: string,
        profileId: string,
    ): Promise<{ commit: StoredHistoricalImportCommit; dryRun: StoredHistoricalImportDryRun; done: boolean }> {
        return this.runtime.unitOfWork.execute(async transaction => {
            const commit = await this.runtime.commits.lockById(commitId, profileId, transaction);
            if (!commit) throw new HistoricalImportCommitNotFoundError(commitId);
            const dryRun = await this.runtime.dryRuns.lockForCommit(commit.dryRunId, transaction);
            if (!dryRun || dryRun.profileId !== profileId)
                throw new HistoricalImportDryRunNotFoundError(commit.dryRunId);
            if (commit.state === "succeeded") return { commit, dryRun, done: true };

            this.assertCommittable(dryRun);
            await this.revalidateReferences(dryRun);
            const now = this.clock.now();
            const running: StoredHistoricalImportCommit = {
                ...commit,
                state: "running",
                attempts: commit.attempts + 1,
                startedAt: commit.startedAt ?? now,
                failure: null,
                updatedAt: now,
            };
            await this.runtime.commits.save(running, transaction);
            return { commit: running, dryRun, done: false };
        });
    }

    // ---- Batch execution (one transaction per aggregate) ---------------------------------------

    private async run(
        commit: StoredHistoricalImportCommit,
        dryRun: StoredHistoricalImportDryRun,
        metadata: CommandContext,
    ): Promise<HistoricalImportCommitResult> {
        // Every write records import provenance so revisions/outbox carry `revisionSource = "import"`.
        const writeMeta: CommandContext = { ...metadata, source: "import" };
        const profileId = commit.profileId;
        const importBatchId = commit.importBatchId;

        // Catalog entries proposed in the dry-run are created up front (prescription/occurrence rows FK
        // them), idempotently so a resumed run does not attempt to recreate an existing exercise.
        await this.commitProposedExercises(dryRun, writeMeta);

        const batches = planCommitBatches(dryRun.storagePlan.entries);
        const committedKeys = new Set(commit.committedBatchKeys);
        const { pending } = partitionCommitBatches(batches, committedKeys);

        for (const batch of pending) {
            try {
                await this.runtime.unitOfWork.execute(async transaction => {
                    if (batch.kind === "program")
                        await this.commitProgramBatch(dryRun, batch, writeMeta, profileId, importBatchId, transaction);
                    else await this.commitSessionBatch(dryRun, batch, writeMeta, profileId, importBatchId, transaction);
                    committedKeys.add(batch.key);
                    commit = { ...commit, committedBatchKeys: [...committedKeys], updatedAt: this.clock.now() };
                    await this.runtime.commits.save(commit, transaction);
                });
            } catch (error) {
                const failure = failureForBatch(batch, error);
                const now = this.clock.now();
                commit = { ...commit, state: "failed", failure, updatedAt: now };
                await this.runtime.unitOfWork.execute(transaction => this.runtime.commits.save(commit, transaction));
                throw new HistoricalImportCommitFailedError(commit.id, failure);
            }
        }

        const completedAt = this.clock.now();
        const finished = { ...commit, state: "succeeded" as const, completedAt, updatedAt: completedAt };
        await this.runtime.unitOfWork.execute(async transaction => {
            await this.runtime.dryRuns.markConsumed(dryRun.id, { consumedAt: completedAt }, transaction);
            await this.runtime.commits.save(finished, transaction);
        });
        return this.toResult(finished, dryRun);
    }

    private async commitProposedExercises(
        dryRun: StoredHistoricalImportDryRun,
        writeMeta: CommandContext,
    ): Promise<void> {
        if (dryRun.proposedExercises.length === 0) return;
        await this.runtime.unitOfWork.execute(async transaction => {
            for (const proposed of dryRun.proposedExercises) {
                if (await this.exerciseExists(proposed.exerciseId)) continue;
                await this.runtime.exercises.create(
                    {
                        id: proposed.exerciseId,
                        slug: proposed.definition.slug ?? slugify(proposed.definition.name),
                        name: proposed.definition.name,
                        equipmentTypeId: proposed.definition.equipmentTypeId,
                        movementPatternId: proposed.definition.movementPatternId,
                        classification: proposed.definition.classification,
                        laterality: proposed.definition.laterality,
                        bodyPosition: proposed.definition.bodyPosition,
                        repetitionSemantics: proposed.definition.repetitionSemantics,
                        loadModel: proposed.definition.loadModel,
                        supportedMeasurements: [...proposed.definition.supportedMeasurements],
                        muscles: (proposed.definition.muscles ?? []).map(muscle => ({
                            muscleGroupId: muscle.muscleGroupId,
                            role: muscle.role,
                        })),
                    },
                    writeMeta,
                    transaction,
                );
            }
        });
    }

    private async exerciseExists(exerciseId: string): Promise<boolean> {
        try {
            await this.runtime.catalog.resolveCurrentExercise(exerciseId);
            return true;
        } catch (error) {
            if (error instanceof ExerciseNotFoundError) return false;
            throw error;
        }
    }

    private async commitProgramBatch(
        dryRun: StoredHistoricalImportDryRun,
        batch: CommitBatch,
        writeMeta: CommandContext,
        profileId: string,
        importBatchId: string | null,
        transaction: Transaction,
    ): Promise<void> {
        const program = dryRun.programs[batch.index];
        if (!program)
            throw new ApplicationValidationError(
                `Program batch ${batch.index} is missing from the dry-run`,
                undefined,
                {
                    batch: batch.key,
                },
            );

        await this.runtime.programCommands.create(
            {
                id: program.id,
                name: program.name,
                description: program.description,
                scheduleMode: program.scheduleMode,
                startDate: program.startDate,
                endDate: program.endDate,
                focus: program.focus,
                goalIds: [...program.goalIds],
                blocks: program.blocks.map(block => ({
                    id: block.id,
                    parentBlockId: block.parentBlockId,
                    type: block.type,
                    label: block.label,
                    position: block.position,
                    startDate: block.startDate,
                    endDate: block.endDate,
                    relativeStartWeek: block.relativeStartWeek,
                    relativeEndWeek: block.relativeEndWeek,
                    focus: block.focus,
                    targetMuscles: [...block.targetMuscles],
                    targetVolume: block.targetVolume,
                    targetIntensity: block.targetIntensity,
                    deload: block.deload,
                    expectedAdaptations: block.expectedAdaptations,
                    notes: block.notes,
                    tags: [...block.tags],
                })),
            },
            writeMeta,
            transaction,
        );

        const entries: BulkExternalIdEntry[] = [];
        if (program.externalId)
            entries.push({ entityType: "program", externalId: program.externalId, entityId: program.id });
        for (const block of program.blocks)
            entries.push({ entityType: "program-block", externalId: block.externalId, entityId: block.id });

        for (const session of program.sessions) {
            if (!session.prescription)
                throw new ApplicationValidationError(
                    `Session '${session.externalId}' in a ready dry-run is missing its prescription`,
                    { prescription: ["Prescription is missing"] },
                    { sessionExternalId: session.externalId },
                );
            const published = await this.runtime.publisher.publishPreparedState(
                session.prescription,
                writeMeta,
                transaction,
            );
            await this.runtime.plannedSessions.materialize(
                {
                    id: session.id,
                    profileId,
                    currentPrescriptionId: published.id,
                    title: session.title,
                    localDate: session.localDate,
                    timeZone: session.timeZone,
                    preferredTime: session.preferredTime,
                    expectedDurationMinutes: session.expectedDurationMinutes,
                    notes: session.notes,
                    tags: [...session.tags],
                    sourceTemplateId: null,
                    sourceTemplateVersion: null,
                },
                published,
                writeMeta,
                transaction,
            );
            await this.runtime.membership.linkProgramSession(
                {
                    programId: program.id,
                    plannedSessionId: session.id,
                    relativeWeek: session.relativeWeek,
                    relativeDay: session.relativeDay,
                    sequence: session.sequence,
                },
                transaction,
            );
            for (const blockId of session.blockIds)
                await this.runtime.membership.linkSessionBlock(session.id, blockId, transaction);
            entries.push({ entityType: "planned-session", externalId: session.externalId, entityId: session.id });
        }

        await this.runtime.externalIds.register(
            { profileId, namespace: dryRun.sourceNamespace, importBatchId, entries },
            transaction,
        );
    }

    private async commitSessionBatch(
        dryRun: StoredHistoricalImportDryRun,
        batch: CommitBatch,
        writeMeta: CommandContext,
        profileId: string,
        importBatchId: string | null,
        transaction: Transaction,
    ): Promise<void> {
        const normalized = dryRun.completedSessions[batch.index];
        if (!normalized)
            throw new ApplicationValidationError(
                `Completed-session batch ${batch.index} is missing from the dry-run`,
                undefined,
                { batch: batch.key },
            );
        const { externalId, ...state } = normalized;
        await this.runtime.trainingSessions.commitPreparedState(state, writeMeta, transaction);
        await this.runtime.externalIds.register(
            {
                profileId,
                namespace: dryRun.sourceNamespace,
                importBatchId,
                entries: [{ entityType: "training-session", externalId, entityId: state.id }],
            },
            transaction,
        );
    }

    // ---- Gating helpers ------------------------------------------------------------------------

    private assertCommittable(dryRun: StoredHistoricalImportDryRun): void {
        if (dryRun.state !== "ready" || dryRun.errors.length > 0)
            throw new ApplicationError(
                "CATALOG_MAPPING_REQUIRED",
                "This dry-run has unresolved mappings or validation errors and cannot be committed",
                undefined,
                { dryRunId: dryRun.id },
            );
    }

    /**
     * Recompute the reference fingerprint over the *current* versions of every catalog exercise the
     * dry-run resolved and compare to the stored hash (design §14.3 step 2). A version bump, a new merge
     * redirect, or a deleted exercise changes the hash → the dry-run is stale and must be re-run.
     */
    private async revalidateReferences(dryRun: StoredHistoricalImportDryRun): Promise<void> {
        const current: BulkAffectedVersion[] = [];
        for (const affected of dryRun.affectedVersions) {
            if (affected.entityType !== "training.exercise") {
                current.push(affected);
                continue;
            }
            try {
                const resolved = await this.runtime.catalog.resolveCurrentExercise(affected.entityId);
                current.push({ ...affected, version: resolved.exercise.version });
            } catch (error) {
                if (error instanceof ExerciseNotFoundError) throw new DryRunStaleError(dryRun.id);
                throw error;
            }
        }
        if (hashRequest(current) !== dryRun.referenceHash) throw new DryRunStaleError(dryRun.id);
    }

    private newRecord(
        dryRun: StoredHistoricalImportDryRun,
        request: HistoricalImportCommitRequest,
        importBatchId: string | null,
        profileId: string,
        now: Date,
    ): StoredHistoricalImportCommit {
        return {
            id: this.generateId(),
            dryRunId: dryRun.id,
            profileId,
            importBatchId,
            sourceNamespace: dryRun.sourceNamespace,
            sourceGeneratedBy: dryRun.sourceGeneratedBy,
            mode: dryRun.mode,
            idempotencyKey: request.idempotencyKey ?? null,
            state: "pending",
            committedBatchKeys: [],
            attempts: 0,
            failure: null,
            createdAt: now,
            startedAt: null,
            completedAt: null,
            updatedAt: now,
        };
    }

    private async toResult(
        commit: StoredHistoricalImportCommit,
        dryRun: StoredHistoricalImportDryRun,
    ): Promise<HistoricalImportCommitResult> {
        const entities = commit.importBatchId ? await this.runtime.externalIds.listByBatch(commit.importBatchId) : [];
        return assembleCommitResult(commit, dryRun, entities);
    }
}

/**
 * Read side of the commit surface (issue #59 status + issue #60 list/report). `findById` resolves a
 * durable commit run's status/failure/counts for a poll (`GET …/commits/:id`); `list` projects every
 * commit run for the profile (`GET …/commits`); `report` assembles the immutable storage audit
 * (`GET …/commits/:id/report`); `revertStatus` reads a commit's revert run (`GET …/commits/:id/reverts`).
 * Every read is a deterministic projection over already-immutable durable records — the commit run, the
 * dry-run artifact, the append-only external-ID registry, and the revert run — and is scoped to the
 * active profile.
 */
export class HistoricalImportCommitQueryService {
    constructor(
        private readonly runtime: {
            readonly commits: HistoricalImportCommitRepository;
            readonly dryRuns: HistoricalImportDryRunRepository;
            readonly reverts: HistoricalImportRevertRepository;
            readonly externalIds: Pick<BulkExternalIdRegistry, "listByBatch">;
            readonly inspector: HistoricalImportEntityInspector;
            readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
        },
    ) {}

    async findById(commitId: string): Promise<HistoricalImportCommitResult> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const commit = await this.runtime.commits.findById(commitId, profileId);
        if (!commit) throw new HistoricalImportCommitNotFoundError(commitId);
        const dryRun = await this.runtime.dryRuns.findById(commit.dryRunId);
        if (!dryRun) throw new HistoricalImportDryRunNotFoundError(commit.dryRunId);
        const entities = commit.importBatchId ? await this.runtime.externalIds.listByBatch(commit.importBatchId) : [];
        return assembleCommitResult(commit, dryRun, entities);
    }

    /** List every historical import (commit run) for the active profile, newest first (design §14.7). */
    async list(): Promise<HistoricalImportListResult> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const commits = await this.runtime.commits.listByProfile(profileId);
        const reverts = await this.runtime.reverts.listByProfile(profileId);
        const succeededReverts = new Set(
            reverts.filter(revert => revert.state === "succeeded").map(revert => revert.commitId),
        );
        const items = commits.map(commit => {
            const kinds = summarizeCommittedKinds(commit.committedBatchKeys);
            return {
                commitId: commit.id,
                dryRunId: commit.dryRunId,
                importBatchId: commit.importBatchId,
                state: commit.state,
                mode: commit.mode,
                source: { namespace: commit.sourceNamespace, generatedBy: commit.sourceGeneratedBy },
                programs: kinds.programs,
                completedSessions: kinds.completedSessions,
                attempts: commit.attempts,
                reverted: succeededReverts.has(commit.id),
                createdAt: commit.createdAt.toISOString(),
                startedAt: commit.startedAt?.toISOString() ?? null,
                completedAt: commit.completedAt?.toISOString() ?? null,
            };
        });
        return { items, count: items.length };
    }

    /** Assemble the immutable storage audit for one committed historical import (design §14.7). */
    async report(commitId: string): Promise<HistoricalImportReportResult> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const commit = await this.runtime.commits.findById(commitId, profileId);
        if (!commit) throw new HistoricalImportCommitNotFoundError(commitId);
        const dryRun = await this.runtime.dryRuns.findById(commit.dryRunId);
        if (!dryRun) throw new HistoricalImportDryRunNotFoundError(commit.dryRunId);
        const mappings = commit.importBatchId ? await this.runtime.externalIds.listByBatch(commit.importBatchId) : [];

        // Resolve each import-owned aggregate's current version/archived state — the "revisions" trace. Only
        // versioned roots resolve; child entity types (blocks, occurrences, sets) are tracked under a root.
        const entities: HistoricalImportAuditEntity[] = [];
        for (const mapping of mappings) {
            const state = isRevertibleEntityType(mapping.entityType)
                ? await this.runtime.inspector.inspect(mapping.entityType, mapping.entityId)
                : null;
            entities.push({
                entityType: mapping.entityType,
                externalId: mapping.externalId,
                entityId: mapping.entityId,
                currentVersion: state?.version ?? null,
                archived: state?.archived ?? false,
            });
        }

        const revert = await this.runtime.reverts.findByCommitId(commitId, profileId);
        const commitResult = assembleCommitResult(commit, dryRun, mappings);
        return {
            commitId: commit.id,
            dryRunId: commit.dryRunId,
            importBatchId: commit.importBatchId,
            schemaVersion: 1,
            source: { namespace: dryRun.sourceNamespace, generatedBy: dryRun.sourceGeneratedBy },
            payloadId: dryRun.payloadId,
            checksum: dryRun.checksum,
            mode: commit.mode,
            state: commit.state,
            programs: commitResult.programs,
            completedSessions: commitResult.completedSessions,
            counts: commitResult.counts,
            storagePlan: dryRun.storagePlan,
            entities,
            affectedVersions: [...dryRun.affectedVersions],
            warnings: [...dryRun.warnings],
            failure: commit.failure,
            revert: revert
                ? {
                      revertId: revert.id,
                      state: revert.state,
                      archived: revert.archivedEntities.length,
                      blocked: revert.blockedEntities.length,
                      completedAt: revert.completedAt?.toISOString() ?? null,
                  }
                : null,
            createdAt: commit.createdAt.toISOString(),
            startedAt: commit.startedAt?.toISOString() ?? null,
            completedAt: commit.completedAt?.toISOString() ?? null,
        };
    }

    /** Read the durable revert run for a commit (`GET …/commits/:id/reverts`); 404 if none exists yet. */
    async revertStatus(commitId: string): Promise<HistoricalImportRevertResult> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const commit = await this.runtime.commits.findById(commitId, profileId);
        if (!commit) throw new HistoricalImportCommitNotFoundError(commitId);
        const revert = await this.runtime.reverts.findByCommitId(commitId, profileId);
        if (!revert) throw new HistoricalImportRevertNotFoundError(commitId);
        const total = commit.importBatchId
            ? countRevertibleEntities(await this.runtime.externalIds.listByBatch(commit.importBatchId))
            : 0;
        return assembleRevertResult(revert, total);
    }
}

// ---------------------------------------------------------------------------------------------
// Commit helpers
// ---------------------------------------------------------------------------------------------

function assembleCommitResult(
    commit: StoredHistoricalImportCommit,
    dryRun: StoredHistoricalImportDryRun,
    entities: readonly BulkExternalIdMapping[],
): HistoricalImportCommitResult {
    const batches = planCommitBatches(dryRun.storagePlan.entries);
    const committedKeys = new Set(commit.committedBatchKeys);
    const committed = batches.filter(batch => committedKeys.has(batch.key));
    const conflicted =
        commit.state === "failed" && commit.failure?.code === "EXTERNAL_ID_CONFLICT"
            ? batches.filter(batch => pathKey(batch.path) === pathKey(commit.failure!.path))
            : [];
    return {
        commitId: commit.id,
        dryRunId: commit.dryRunId,
        importBatchId: commit.importBatchId,
        state: commit.state,
        mode: commit.mode,
        source: { namespace: commit.sourceNamespace, generatedBy: commit.sourceGeneratedBy },
        programs: committed.filter(batch => batch.kind === "program").length,
        completedSessions: committed.filter(batch => batch.kind === "completed-session").length,
        counts: tallyCommitCounts({ committed, skipped: [], conflicted }),
        entities: entities.map(entity => ({
            entityType: entity.entityType,
            externalId: entity.externalId,
            entityId: entity.entityId,
        })),
        createdExercises: dryRun.proposedExercises.map(proposed => ({
            exerciseId: proposed.exerciseId,
            exerciseRef: proposed.exerciseRef,
            sessionExternalId: proposed.sessionExternalId,
        })),
        affectedVersions: [...dryRun.affectedVersions],
        warnings: [...dryRun.warnings],
        failure: commit.failure,
        createdAt: commit.createdAt.toISOString(),
        startedAt: commit.startedAt?.toISOString() ?? null,
        completedAt: commit.completedAt?.toISOString() ?? null,
    };
}

/** Classify a batch failure into a path-anchored, machine-readable failure record (design §14.7). */
function failureForBatch(batch: CommitBatch, error: unknown): HistoricalImportCommitFailure {
    const entityType: ImportEntityType = batch.kind === "program" ? "program" : "training-session";
    const message = error instanceof Error ? error.message : "Commit batch failed";
    const code =
        error instanceof ApplicationError
            ? error.code
            : error && typeof error === "object" && "code" in error && typeof error.code === "string"
              ? error.code
              : "INTERNAL_ERROR";
    return { path: [...batch.path], code, message, entityType, externalId: batch.rootExternalId };
}

function pathKey(path: readonly (string | number)[]): string {
    return path.map(String).join(" ");
}

function slugify(name: string): string {
    const slug = name
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug.length > 0 ? slug : "exercise";
}

// =============================================================================================
// List / audit report result types (issue #60, HI6; design §14.7)
// =============================================================================================

/** One row of the profile's historical-import list — projected from a durable commit run. */
export interface HistoricalImportListItem {
    readonly commitId: string;
    readonly dryRunId: string;
    readonly importBatchId: string | null;
    readonly state: HistoricalImportCommitState;
    readonly mode: "create" | "upsert";
    readonly source: { readonly namespace: string; readonly generatedBy: string | null };
    readonly programs: number;
    readonly completedSessions: number;
    readonly attempts: number;
    readonly reverted: boolean;
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
}

export interface HistoricalImportListResult {
    readonly items: readonly HistoricalImportListItem[];
    readonly count: number;
}

/** One audited import-owned entity: caller external id → stored Kinetix id + current revision/archived. */
export interface HistoricalImportAuditEntity {
    readonly entityType: ImportEntityType;
    readonly externalId: string;
    readonly entityId: string;
    readonly currentVersion: number | null;
    readonly archived: boolean;
}

export interface HistoricalImportReportResult {
    readonly commitId: string;
    readonly dryRunId: string;
    readonly importBatchId: string | null;
    readonly schemaVersion: 1;
    readonly source: { readonly namespace: string; readonly generatedBy: string | null };
    readonly payloadId: string;
    readonly checksum: string;
    readonly mode: "create" | "upsert";
    readonly state: HistoricalImportCommitState;
    readonly programs: number;
    readonly completedSessions: number;
    readonly counts: CommitCounts;
    readonly storagePlan: StorageReconciliationPlan;
    readonly entities: readonly HistoricalImportAuditEntity[];
    readonly affectedVersions: readonly BulkAffectedVersion[];
    readonly warnings: readonly PlanningWarning[];
    readonly failure: HistoricalImportCommitFailure | null;
    readonly revert: {
        readonly revertId: string;
        readonly state: HistoricalImportRevertState;
        readonly archived: number;
        readonly blocked: number;
        readonly completedAt: string | null;
    } | null;
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
}

// =============================================================================================
// Revert (issue #60, HI6; design §14.7)
// =============================================================================================

export const HISTORICAL_IMPORT_REVERT_REPOSITORY = Symbol("HISTORICAL_IMPORT_REVERT_REPOSITORY");
export const HISTORICAL_IMPORT_ENTITY_INSPECTOR = Symbol("HISTORICAL_IMPORT_ENTITY_INSPECTOR");
export const REVERT_HISTORICAL_IMPORT = Symbol("REVERT_HISTORICAL_IMPORT");

/** Lifecycle of a durable revert run (mirrors the wire `historicalImportRevertStateSchema`). */
export type HistoricalImportRevertState = "pending" | "running" | "succeeded" | "failed" | "blocked";

/** The three import-owned aggregate roots a revert compensates; child rows are owned by their root. */
export const REVERTIBLE_ENTITY_TYPES = ["program", "planned-session", "training-session"] as const;
export type RevertibleEntityType = (typeof REVERTIBLE_ENTITY_TYPES)[number];

function isRevertibleEntityType(entityType: ImportEntityType): entityType is RevertibleEntityType {
    return (REVERTIBLE_ENTITY_TYPES as readonly string[]).includes(entityType);
}

/** One aggregate the revert archived, with the version it held when archived (history-preserving). */
export interface HistoricalImportRevertedEntity {
    readonly entityType: RevertibleEntityType;
    readonly entityId: string;
    readonly externalId: string;
    readonly version: number;
}

/** One aggregate that blocked the revert because it was edited after the import. */
export interface HistoricalImportBlockedEntity {
    readonly entityType: RevertibleEntityType;
    readonly entityId: string;
    readonly externalId: string;
    readonly currentVersion: number | null;
    readonly reason: string;
}

/**
 * The durable revert-run record — the source of truth for revert status, idempotent replay, and resume.
 * Keyed by `commitId` (a commit is reverted by exactly one run), it persists the archived-entity
 * checkpoint (so a resumed run never re-archives), the blocked entities that refused the revert, attempt
 * count, and a path-anchored failure. Written in the same transaction as each aggregate it archives.
 */
export interface StoredHistoricalImportRevert {
    readonly id: string;
    readonly commitId: string;
    readonly dryRunId: string;
    readonly profileId: string;
    readonly importBatchId: string | null;
    readonly state: HistoricalImportRevertState;
    readonly archivedEntities: readonly HistoricalImportRevertedEntity[];
    readonly blockedEntities: readonly HistoricalImportBlockedEntity[];
    readonly attempts: number;
    readonly failure: HistoricalImportCommitFailure | null;
    readonly createdAt: Date;
    readonly startedAt: Date | null;
    readonly completedAt: Date | null;
    readonly updatedAt: Date;
}

export interface HistoricalImportRevertCounts {
    readonly archived: number;
    readonly blocked: number;
    readonly skipped: number;
}

export interface HistoricalImportRevertResult {
    readonly revertId: string;
    readonly commitId: string;
    readonly importBatchId: string | null;
    readonly state: HistoricalImportRevertState;
    readonly counts: HistoricalImportRevertCounts;
    readonly archivedEntities: readonly HistoricalImportRevertedEntity[];
    readonly blockedEntities: readonly HistoricalImportBlockedEntity[];
    readonly failure: HistoricalImportCommitFailure | null;
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
}

/** The current version + archived flag of an import-owned aggregate, or `null` if it no longer resolves. */
export interface ImportedEntityState {
    readonly version: number;
    readonly archived: boolean;
}

/**
 * Read the current state of an import-owned aggregate root by its Kinetix id (design §14.7, HI6). Used to
 * detect post-import edits before a revert (a version `> 1` means the aggregate was edited or restored
 * since the import created it at version 1) and to trace current revisions in the audit report. Returns
 * `null` when the entity no longer resolves. No raw SQL in the use case (ADR 0003).
 */
export interface HistoricalImportEntityInspector<Transaction = unknown> {
    inspect(
        entityType: RevertibleEntityType,
        entityId: string,
        transaction?: Transaction,
    ): Promise<ImportedEntityState | null>;
}

/**
 * Persistence port over the durable revert-run store. `lockByCommitId` serializes concurrent reverts of
 * the same commit (SELECT … FOR UPDATE); `insertIfAbsent` (INSERT … ON CONFLICT (commit_id) DO NOTHING)
 * converges concurrent first-time starts on one run; `save` rewrites the mutable lifecycle fields.
 * Identity is fixed at insert. No raw SQL in the use case (ADR 0003).
 */
export interface HistoricalImportRevertRepository<Transaction = unknown> {
    lockByCommitId(
        commitId: string,
        profileId: string,
        transaction: Transaction,
    ): Promise<StoredHistoricalImportRevert | null>;
    insertIfAbsent(record: StoredHistoricalImportRevert, transaction: Transaction): Promise<boolean>;
    findByCommitId(
        commitId: string,
        profileId: string,
        transaction?: Transaction,
    ): Promise<StoredHistoricalImportRevert | null>;
    listByProfile(profileId: string, transaction?: Transaction): Promise<readonly StoredHistoricalImportRevert[]>;
    save(record: StoredHistoricalImportRevert, transaction: Transaction): Promise<void>;
}

/** A revert-status read against a commit that was never reverted. */
export class HistoricalImportRevertNotFoundError extends ApplicationNotFoundError {
    constructor(readonly commitId: string) {
        super(`Historical import commit ${commitId} has not been reverted`, { commitId });
        this.name = "HistoricalImportRevertNotFoundError";
    }
}

interface RevertRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly commits: HistoricalImportCommitRepository<Transaction>;
    readonly reverts: HistoricalImportRevertRepository<Transaction>;
    readonly externalIds: Pick<BulkExternalIdRegistry<Transaction>, "listByBatch">;
    readonly inspector: HistoricalImportEntityInspector<Transaction>;
    readonly programCommands: Pick<ProgramCommands<Transaction>, "archive">;
    readonly plannedSessions: Pick<PlannedSessionCommands<Transaction>, "archive">;
    readonly trainingSessions: Pick<TrainingSessionCommands<Transaction>, "archive">;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

/**
 * Revert a committed historical import by scoped, history-preserving compensation (design §14.7; issue
 * #60, HI6). A revert undoes only the import's own writes — the program, planned-session, and
 * training-session aggregates the commit created — by **archiving** them through the ordinary aggregate
 * archive commands, so history is preserved (an archived aggregate is restorable) and nothing is
 * hard-deleted. It never touches unrelated data or the shared exercise catalog.
 *
 * Safety is absolute: before archiving anything, the revert inspects every import-owned aggregate. Import
 * creates each at version 1, so a current version `> 1` means the user edited (or restored) it after the
 * import — archiving it would overwrite that later edit. If **any** aggregate was edited, the whole revert
 * is refused ({@link ImportRevertBlockedError}) with the offending aggregates listed and nothing archived.
 *
 * Like the commit, the revert is durable, idempotent, and resumable: it is keyed uniquely by `commitId`,
 * archives each aggregate in its own transaction, and checkpoints the archived entity before moving on, so
 * an interruption resumes from exactly the aggregates still to archive and a replay returns the same run.
 */
export class RevertHistoricalImport<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;

    constructor(private readonly runtime: RevertRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Historical import revert ID generation is not configured");
            });
    }

    /** Start (or resume/replay) the scoped revert of a committed historical import. */
    async execute(commitId: string, metadata: CommandContext): Promise<HistoricalImportRevertResult> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const claim = await this.claim(commitId, profileId);
        if (claim.done) {
            const total = countRevertibleEntities(await this.listBatchEntities(claim.commit));
            return assembleRevertResult(claim.revert, total);
        }
        return this.run(claim.revert, claim.commit, metadata);
    }

    // ---- Gate + claim (one transaction) --------------------------------------------------------

    private claim(
        commitId: string,
        profileId: string,
    ): Promise<{ revert: StoredHistoricalImportRevert; commit: StoredHistoricalImportCommit; done: boolean }> {
        return this.runtime.unitOfWork.execute(async transaction => {
            const commit = await this.runtime.commits.lockById(commitId, profileId, transaction);
            if (!commit) throw new HistoricalImportCommitNotFoundError(commitId);
            if (commit.state !== "succeeded") throw new ImportNotRevertibleError(commitId, commit.state);

            let revert = await this.runtime.reverts.lockByCommitId(commitId, profileId, transaction);
            if (revert?.state === "succeeded") return { revert, commit, done: true };
            if (revert?.state === "running") throw new IdempotencyInProgressError("training.imports.revert", commitId);

            const now = this.clock.now();
            if (!revert) {
                const record = this.newRecord(commit, profileId, now);
                const inserted = await this.runtime.reverts.insertIfAbsent(record, transaction);
                revert = inserted
                    ? record
                    : await this.runtime.reverts.lockByCommitId(commitId, profileId, transaction);
                if (!revert) throw new HistoricalImportRevertNotFoundError(commitId);
                if (revert.state === "succeeded") return { revert, commit, done: true };
                if (revert.state === "running")
                    throw new IdempotencyInProgressError("training.imports.revert", commitId);
            }

            const running: StoredHistoricalImportRevert = {
                ...revert,
                importBatchId: commit.importBatchId,
                state: "running",
                attempts: revert.attempts + 1,
                startedAt: revert.startedAt ?? now,
                failure: null,
                updatedAt: now,
            };
            await this.runtime.reverts.save(running, transaction);
            return { revert: running, commit, done: false };
        });
    }

    // ---- Compensation (one transaction per archived aggregate) ---------------------------------

    private async run(
        revert: StoredHistoricalImportRevert,
        commit: StoredHistoricalImportCommit,
        metadata: CommandContext,
    ): Promise<HistoricalImportRevertResult> {
        const writeMeta: CommandContext = { ...metadata, source: "import" };
        const reason = `historical-import-revert:${commit.id}`;
        const mappings = await this.listBatchEntities(commit);
        const total = countRevertibleEntities(mappings);

        // Skip aggregates a prior attempt already archived (the durable checkpoint).
        const archivedIds = new Set(revert.archivedEntities.map(entity => entity.entityId));
        const targets = mappings
            .filter(mapping => isRevertibleEntityType(mapping.entityType) && !archivedIds.has(mapping.entityId))
            .map(mapping => ({ ...mapping, entityType: mapping.entityType as RevertibleEntityType }));

        // Inspect every remaining aggregate before archiving any: a version > 1 means a post-import edit.
        const pending: { mapping: (typeof targets)[number]; version: number }[] = [];
        const blocked: HistoricalImportBlockedEntity[] = [];
        for (const mapping of targets) {
            const state = await this.runtime.inspector.inspect(mapping.entityType, mapping.entityId);
            if (state === null || state.archived) continue; // already gone/archived out-of-band → skip
            if (state.version > 1) {
                blocked.push({
                    entityType: mapping.entityType,
                    entityId: mapping.entityId,
                    externalId: mapping.externalId,
                    currentVersion: state.version,
                    reason: "edited-after-import",
                });
                continue;
            }
            pending.push({ mapping, version: state.version });
        }

        if (blocked.length > 0) {
            const now = this.clock.now();
            revert = { ...revert, state: "blocked", blockedEntities: blocked, updatedAt: now };
            await this.runtime.unitOfWork.execute(transaction => this.runtime.reverts.save(revert, transaction));
            throw new ImportRevertBlockedError(
                commit.id,
                blocked.map(entry => ({ entityType: entry.entityType, entityId: entry.entityId })),
            );
        }

        // Archive innermost-first (training sessions, then planned sessions, then programs) so a program's
        // membership links are never dangling before its sessions are archived.
        pending.sort((a, b) => archiveRank(a.mapping.entityType) - archiveRank(b.mapping.entityType));

        const archived = [...revert.archivedEntities];
        for (const { mapping, version } of pending) {
            try {
                await this.runtime.unitOfWork.execute(async transaction => {
                    await this.archiveEntity(
                        mapping.entityType,
                        mapping.entityId,
                        version,
                        reason,
                        writeMeta,
                        transaction,
                    );
                    archived.push({
                        entityType: mapping.entityType,
                        entityId: mapping.entityId,
                        externalId: mapping.externalId,
                        version,
                    });
                    revert = { ...revert, archivedEntities: [...archived], updatedAt: this.clock.now() };
                    await this.runtime.reverts.save(revert, transaction);
                });
            } catch (error) {
                const failure = failureForRevert(mapping, error);
                const now = this.clock.now();
                revert = { ...revert, state: "failed", failure, updatedAt: now };
                await this.runtime.unitOfWork.execute(transaction => this.runtime.reverts.save(revert, transaction));
                throw new HistoricalImportCommitFailedError(revert.id, failure);
            }
        }

        const completedAt = this.clock.now();
        revert = { ...revert, state: "succeeded", blockedEntities: [], completedAt, updatedAt: completedAt };
        await this.runtime.unitOfWork.execute(transaction => this.runtime.reverts.save(revert, transaction));
        return assembleRevertResult(revert, total);
    }

    private async archiveEntity(
        entityType: RevertibleEntityType,
        entityId: string,
        version: number,
        reason: string,
        writeMeta: CommandContext,
        transaction: Transaction,
    ): Promise<void> {
        const meta = { ...writeMeta, reason };
        if (entityType === "program") await this.runtime.programCommands.archive(entityId, version, meta, transaction);
        else if (entityType === "planned-session")
            await this.runtime.plannedSessions.archive(entityId, version, meta, transaction);
        else await this.runtime.trainingSessions.archive(entityId, version, meta, transaction);
    }

    private listBatchEntities(commit: StoredHistoricalImportCommit): Promise<readonly BulkExternalIdMapping[]> {
        return commit.importBatchId ? this.runtime.externalIds.listByBatch(commit.importBatchId) : Promise.resolve([]);
    }

    private newRecord(
        commit: StoredHistoricalImportCommit,
        profileId: string,
        now: Date,
    ): StoredHistoricalImportRevert {
        return {
            id: this.generateId(),
            commitId: commit.id,
            dryRunId: commit.dryRunId,
            profileId,
            importBatchId: commit.importBatchId,
            state: "pending",
            archivedEntities: [],
            blockedEntities: [],
            attempts: 0,
            failure: null,
            createdAt: now,
            startedAt: null,
            completedAt: null,
            updatedAt: now,
        };
    }
}

// ---------------------------------------------------------------------------------------------
// Revert helpers
// ---------------------------------------------------------------------------------------------

/** Archive order rank: training sessions first, then planned sessions, then programs. */
function archiveRank(entityType: RevertibleEntityType): number {
    if (entityType === "training-session") return 0;
    if (entityType === "planned-session") return 1;
    return 2;
}

function countRevertibleEntities(mappings: readonly BulkExternalIdMapping[]): number {
    return mappings.filter(mapping => isRevertibleEntityType(mapping.entityType)).length;
}

function assembleRevertResult(
    revert: StoredHistoricalImportRevert,
    totalRevertible: number,
): HistoricalImportRevertResult {
    const archived = revert.archivedEntities.length;
    const blocked = revert.blockedEntities.length;
    return {
        revertId: revert.id,
        commitId: revert.commitId,
        importBatchId: revert.importBatchId,
        state: revert.state,
        counts: { archived, blocked, skipped: Math.max(0, totalRevertible - archived - blocked) },
        archivedEntities: [...revert.archivedEntities],
        blockedEntities: [...revert.blockedEntities],
        failure: revert.failure,
        createdAt: revert.createdAt.toISOString(),
        startedAt: revert.startedAt?.toISOString() ?? null,
        completedAt: revert.completedAt?.toISOString() ?? null,
    };
}

/** Classify an archive failure into a path-anchored, machine-readable failure record (design §14.7). */
function failureForRevert(mapping: BulkExternalIdMapping, error: unknown): HistoricalImportCommitFailure {
    const message = error instanceof Error ? error.message : "Revert archive failed";
    const code =
        error instanceof ApplicationError
            ? error.code
            : error && typeof error === "object" && "code" in error && typeof error.code === "string"
              ? error.code
              : "INTERNAL_ERROR";
    return {
        path: ["reverts", mapping.entityType, mapping.externalId],
        code,
        message,
        entityType: mapping.entityType,
        externalId: mapping.externalId,
    };
}
