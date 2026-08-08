import type { Clock } from "#src/platform/domain/index";
import { hashRequest, type CommandContext, type UnitOfWork } from "#src/platform/application/index";
import {
    TrainingSession,
    collectHistoricalStorageRequests,
    validateHistoricalImportIdentities,
    type ExerciseOccurrenceInput,
    type ExerciseSnapshotV1,
    type HistoricalStoragePayload,
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
    type BulkDryRunError,
    type BulkDryRunState,
    type BulkExerciseMapping,
    type BulkExerciseResolution,
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
