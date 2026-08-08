import type { Clock } from "#src/platform/domain/index";
import {
    ApplicationError,
    ApplicationValidationError,
    DryRunConsumedError,
    DryRunExpiredError,
    DryRunStaleError,
    DryRunTokenInvalidError,
    hashRequest,
    type CommandContext,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    ExerciseDefinition,
    Program,
    SessionPrescription,
    assertWithinBulkLimits,
    assignBulkTreeIds,
    createExerciseSnapshot,
    evaluateProgramWarnings,
    expandProgramSchedule,
    normalizeRunStepTargets,
    normalizeStrengthSetTargets,
    type ImportEntityType,
    type EnteredRunStepTargets,
    type EnteredStrengthTargets,
    type ExerciseClassification,
    type ExerciseLaterality,
    type ExerciseLoadModel,
    type ExerciseMeasurementType,
    type ExerciseMuscleRole,
    type ExerciseSnapshotV1,
    type IdMinter,
    type PlanningWarning,
    type ProgramBlockInput,
    type ProgramBlockType,
    type ProgramScheduleMode,
    type PrescribedActivityDraft,
    type PrescribedRunStepDraft,
    type PrescribedRunStepType,
    type PrescribedSetDraft,
    type PrescribedSetGroupDraft,
    type PrescribedSetGroupType,
    type PrescribedSetType,
    type PublishPrescriptionDraft,
    type RepetitionSemantics,
    type SessionScheduleInput,
    type SessionPrescriptionState,
    type SubstitutionPolicy,
} from "#src/modules/training/domain/index";
import type { ExerciseCatalogCommands, TrainingExerciseCatalogPort } from "#src/modules/training/application/exercises";
import { ExerciseNotFoundError } from "#src/modules/training/application/exercises";
import type { ProgramCommands, ProgramMembershipRepository } from "#src/modules/training/application/programs";
import type { PlannedSessionCommands } from "#src/modules/training/application/planned-sessions";
import type { PrescriptionPublisher } from "#src/modules/training/application/session-prescriptions";
import type { ProfileReader } from "#src/modules/profile/index";

// ---------------------------------------------------------------------------------------------
// Application-facing input/output types (mirrors of the wire contract). The application layer
// never imports the public wire schema (@kinetix/types); the controller parses the Zod envelope
// and passes the structurally-compatible parsed object here, then maps the result back out.
// ---------------------------------------------------------------------------------------------

export type BulkDryRunState = "ready" | "needs_mapping";

export type BulkExerciseReference =
    | { readonly by: "id"; readonly exerciseId: string }
    | { readonly by: "externalId"; readonly provider: string; readonly externalId: string }
    | { readonly by: "alias"; readonly alias: string };

export interface BulkProposedExercise {
    readonly name: string;
    readonly slug?: string;
    readonly equipmentTypeId: string;
    readonly movementPatternId: string;
    readonly classification: ExerciseClassification;
    readonly laterality: ExerciseLaterality;
    readonly bodyPosition: string;
    readonly repetitionSemantics: RepetitionSemantics;
    readonly loadModel: ExerciseLoadModel;
    readonly supportedMeasurements: readonly ExerciseMeasurementType[];
    readonly muscles?: readonly { readonly muscleGroupId: string; readonly role: ExerciseMuscleRole }[];
}

export interface BulkSet {
    readonly externalId?: string;
    readonly ref?: string;
    readonly setGroupRef?: string | null;
    readonly position: number;
    readonly round?: number | null;
    readonly setType: PrescribedSetType;
    readonly targets?: EnteredStrengthTargets;
    readonly notes?: string | null;
}

export interface BulkStrengthExercise {
    readonly externalId?: string;
    readonly ref: string;
    readonly reference: BulkExerciseReference;
    readonly proposed?: BulkProposedExercise;
    readonly position: number;
    readonly purpose?: string | null;
    readonly substitutionPolicy?: SubstitutionPolicy | null;
    readonly sets: readonly BulkSet[];
}

export interface BulkSetGroup {
    readonly externalId?: string;
    readonly ref: string;
    readonly parentGroupRef?: string | null;
    readonly type: PrescribedSetGroupType;
    readonly position: number;
    readonly rounds?: number | null;
    readonly restMs?: number | null;
    readonly members: readonly { readonly exerciseRef: string; readonly position: number }[];
}

export interface BulkRunStep {
    readonly externalId?: string;
    readonly ref: string;
    readonly parentStepRef?: string | null;
    readonly type: PrescribedRunStepType;
    readonly position: number;
    readonly repeatCount?: number | null;
    readonly targets?: EnteredRunStepTargets;
    readonly notes?: string | null;
}

interface BulkActivityBase {
    readonly externalId?: string;
    readonly position: number;
    readonly expectedDurationMs?: number | null;
    readonly rpeTarget?: string | null;
    readonly notes?: string | null;
}

export type BulkActivity =
    | (BulkActivityBase & {
          readonly type: "strength";
          readonly exercises: readonly BulkStrengthExercise[];
          readonly setGroups?: readonly BulkSetGroup[];
      })
    | (BulkActivityBase & {
          readonly type: "running";
          readonly runTags?: readonly string[];
          readonly overallTargets?: EnteredRunStepTargets;
          readonly steps: readonly BulkRunStep[];
      });

export interface BulkPrescription {
    readonly expectedDurationMs?: number | null;
    readonly notes?: string | null;
    readonly activities: readonly BulkActivity[];
}

export interface BulkProgramBlock {
    readonly externalId: string;
    readonly parentExternalId?: string | null;
    readonly type: ProgramBlockType;
    readonly label?: string | null;
    readonly position: number;
    readonly startDate?: string | null;
    readonly endDate?: string | null;
    readonly relativeStartWeek?: number | null;
    readonly relativeEndWeek?: number | null;
    readonly focus?: string | null;
    readonly targetMuscles?: readonly string[];
    readonly targetVolume?: string | null;
    readonly targetIntensity?: string | null;
    readonly deload?: boolean;
    readonly expectedAdaptations?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
}

export interface BulkProgramSession {
    readonly externalId: string;
    readonly title?: string | null;
    readonly sequence: number;
    readonly relativeWeek?: number | null;
    readonly relativeDay?: number | null;
    readonly preferredTime?: string | null;
    readonly timeZone?: string | null;
    readonly expectedDurationMinutes?: number | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly blockExternalIds?: readonly string[];
    readonly prescription: BulkPrescription;
}

export interface BulkProgramInput {
    readonly externalId?: string;
    readonly name: string;
    readonly description?: string | null;
    readonly scheduleMode?: ProgramScheduleMode;
    readonly startDate?: string | null;
    readonly endDate?: string | null;
    readonly focus?: string | null;
    readonly goalIds?: readonly string[];
    readonly blocks?: readonly BulkProgramBlock[];
    readonly sessions?: readonly BulkProgramSession[];
}

export interface BulkProgramEnvelope {
    readonly schemaVersion: 1;
    readonly source: { readonly namespace: string; readonly generatedBy?: string };
    readonly mode: "create" | "upsert";
    readonly createMissingExercises?: boolean;
    readonly program: BulkProgramInput;
}

export interface BulkDryRunError {
    readonly path: readonly (string | number)[];
    readonly code: string;
    readonly message: string;
}

export interface BulkExerciseMapping {
    readonly path: readonly (string | number)[];
    readonly sessionExternalId: string;
    readonly exerciseRef: string;
    readonly status: "missing" | "ambiguous";
    readonly requested: BulkExerciseReference;
    readonly candidates?: readonly { readonly exerciseId: string; readonly slug: string; readonly name: string }[];
}

export interface BulkProposedExercisePreview {
    readonly exerciseId: string;
    readonly exerciseRef: string;
    readonly sessionExternalId: string;
    readonly definition: BulkProposedExercise;
}

export interface BulkAffectedVersion {
    readonly entityType: string;
    readonly entityId: string;
    readonly version: number;
}

export interface BulkNormalizedBlock {
    readonly id: string;
    readonly externalId: string;
    readonly parentBlockId: string | null;
    readonly type: ProgramBlockType;
    readonly label: string | null;
    readonly position: number;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly relativeStartWeek: number | null;
    readonly relativeEndWeek: number | null;
    readonly focus: string | null;
    readonly targetMuscles: readonly string[];
    readonly targetVolume: string | null;
    readonly targetIntensity: string | null;
    readonly deload: boolean;
    readonly expectedAdaptations: string | null;
    readonly notes: string | null;
    readonly tags: readonly string[];
}

export interface BulkNormalizedSession {
    readonly id: string;
    readonly externalId: string;
    readonly title: string | null;
    readonly sequence: number;
    readonly relativeWeek: number | null;
    readonly relativeDay: number | null;
    readonly localDate: string | null;
    readonly preferredTime: string | null;
    readonly timeZone: string | null;
    readonly expectedDurationMinutes: number | null;
    readonly notes: string | null;
    readonly tags: readonly string[];
    readonly blockIds: readonly string[];
    readonly prescription: SessionPrescriptionState | null;
}

export interface BulkNormalizedProgram {
    readonly id: string;
    readonly externalId: string | null;
    readonly profileId: string;
    readonly name: string;
    readonly description: string | null;
    readonly scheduleMode: ProgramScheduleMode;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly focus: string | null;
    readonly goalIds: readonly string[];
    readonly blocks: readonly BulkNormalizedBlock[];
    readonly sessions: readonly BulkNormalizedSession[];
}

export interface BulkDryRunResponse {
    readonly dryRunId: string;
    readonly approvalToken: string;
    readonly referenceHash: string;
    readonly schemaVersion: 1;
    readonly mode: "create" | "upsert";
    readonly source: { readonly namespace: string; readonly generatedBy: string | null };
    readonly state: BulkDryRunState;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly program: BulkNormalizedProgram;
    readonly generatedSessionCount: number;
    readonly warnings: readonly PlanningWarning[];
    readonly errors: readonly BulkDryRunError[];
    readonly mappings: readonly BulkExerciseMapping[];
    readonly proposedExercises: readonly BulkProposedExercisePreview[];
    readonly affectedVersions: readonly BulkAffectedVersion[];
}

export const BULK_DRY_RUN_REPOSITORY = Symbol("BULK_DRY_RUN_REPOSITORY");
export const BULK_CATALOG_RESOLVER = Symbol("BULK_CATALOG_RESOLVER");
export const EXERCISE_EXTERNAL_ID_RESOLVER = Symbol("EXERCISE_EXTERNAL_ID_RESOLVER");
export const DRY_RUN_BULK_PROGRAM = Symbol("DRY_RUN_BULK_PROGRAM");
export const BULK_DRY_RUN_ENTITY_TYPE = "training.bulk-dry-run";

/** How long a persisted dry-run stays valid for a follow-up commit (design 14.2/14.3). */
export const BULK_DRY_RUN_TTL_MS = 60 * 60 * 1_000;

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

/** The persisted preview artifact — the only thing a dry-run writes (design 14.2 step 9). */
export interface StoredBulkDryRun {
    readonly id: string;
    readonly profileId: string;
    readonly schemaVersion: 1;
    readonly sourceNamespace: string;
    readonly sourceGeneratedBy: string | null;
    readonly mode: "create" | "upsert";
    readonly state: BulkDryRunState;
    readonly referenceHash: string;
    readonly approvalToken: string;
    readonly normalizedProgram: BulkNormalizedProgram;
    readonly warnings: readonly PlanningWarning[];
    readonly errors: readonly BulkDryRunError[];
    readonly mappings: readonly BulkExerciseMapping[];
    readonly proposedExercises: readonly BulkProposedExercisePreview[];
    readonly affectedVersions: readonly BulkAffectedVersion[];
    readonly createdAt: Date;
    readonly expiresAt: Date;
    /** Set on the commit transaction; a non-null value means the dry-run was already consumed. */
    readonly consumedAt: Date | null;
}

/**
 * Capability port over the dry-run artifact store. There is no generic base repository and no raw
 * SQL in the use case; the adapter maps rows in infrastructure (ADR 0003). `save` runs inside the
 * caller's UnitOfWork so the artifact write is the single, isolated side effect.
 */
export interface BulkDryRunRepository<Transaction = unknown> {
    save(record: StoredBulkDryRun, transaction: Transaction): Promise<void>;
    findById(id: string, transaction?: Transaction): Promise<StoredBulkDryRun | null>;
    /**
     * Lock the dry-run row for the commit transaction (SELECT … FOR UPDATE), serializing concurrent
     * commits of the same dry-run so the consumed check below cannot race (design 14.3 step 1).
     */
    lockForCommit(id: string, transaction: Transaction): Promise<StoredBulkDryRun | null>;
    /** Mark the dry-run consumed and record the committed program, in the commit transaction. */
    markConsumed(
        id: string,
        input: { committedProgramId: string; consumedAt: Date },
        transaction: Transaction,
    ): Promise<void>;
}

export const BULK_EXTERNAL_ID_REGISTRY = Symbol("BULK_EXTERNAL_ID_REGISTRY");
export const COMMIT_BULK_PROGRAM = Symbol("COMMIT_BULK_PROGRAM");

/**
 * The registry addresses every import-addressable aggregate kind (design §14.4), not just the plan
 * side. The single-program bulk commit (14.3) uses the `program`/`program-block`/`planned-session`
 * subset; historical import (HI2/#56) adds the completed-session performance entities.
 */
export type BulkExternalEntityType = ImportEntityType;

export interface BulkExternalIdEntry {
    readonly entityType: BulkExternalEntityType;
    readonly externalId: string;
    readonly entityId: string;
    /**
     * The normalized content fingerprint recorded for this entity (issue #57, HI3). A later import
     * compares its recomputed fingerprint against this to detect `skip-identical`. Optional — the
     * single-program bulk commit registers without one until it carries per-entity fingerprints.
     */
    readonly contentFingerprint?: string | null;
}

/** One persisted external-ID → Kinetix-ID mapping, as read back for a batch. */
export interface BulkExternalIdMapping {
    readonly entityType: BulkExternalEntityType;
    readonly externalId: string;
    readonly entityId: string;
}

/**
 * Namespaced registry mapping a caller's stable external ID to the authoritative entity it addresses
 * (design 14.1/14.3, §14.4). `register` enforces `(namespace, entityType, externalId)` uniqueness at
 * the DB level so a repeated import cannot silently duplicate an entity; `resolve` powers upsert
 * addressing; `listByBatch` reads back a batch's deterministic mappings. An entry may be owned by an
 * `importBatchId`, so every committed entity is traceable to the batch that created it.
 */
export interface BulkExternalIdRegistry<Transaction = unknown> {
    register(
        input: {
            profileId: string;
            namespace: string;
            importBatchId?: string | null;
            entries: readonly BulkExternalIdEntry[];
        },
        transaction: Transaction,
    ): Promise<void>;
    resolve(
        namespace: string,
        entityType: BulkExternalEntityType,
        externalId: string,
        transaction: Transaction,
    ): Promise<string | null>;
    listByBatch(importBatchId: string, transaction?: Transaction): Promise<readonly BulkExternalIdMapping[]>;
}

// ---------------------------------------------------------------------------------------------
// Commit response (design 14.3) — application-facing mirror of the wire contract
// ---------------------------------------------------------------------------------------------

export interface BulkCommitRequest {
    readonly dryRunId: string;
    readonly approvalToken: string;
}

export interface BulkCommittedExercise {
    readonly exerciseId: string;
    readonly exerciseRef: string;
    readonly sessionExternalId: string;
}

export interface BulkCommittedSession {
    readonly id: string;
    readonly externalId: string;
    readonly prescriptionId: string | null;
}

export interface BulkCommitResponse {
    readonly dryRunId: string;
    readonly programId: string;
    readonly programVersion: number;
    readonly mode: "create" | "upsert";
    readonly source: { readonly namespace: string; readonly generatedBy: string | null };
    readonly committedAt: string;
    readonly sessions: readonly BulkCommittedSession[];
    readonly createdExercises: readonly BulkCommittedExercise[];
    readonly affectedVersions: readonly BulkAffectedVersion[];
    readonly warnings: readonly PlanningWarning[];
}

/** Resolve a caller-provided `{ provider, externalId }` pair to a catalog exercise id (BI-3). */
export interface ExerciseExternalIdResolver {
    resolveByExternalId(provider: string, externalId: string): Promise<string | null>;
}

export type BulkExerciseResolution =
    | {
          readonly status: "resolved";
          readonly exerciseId: string;
          readonly exerciseVersion: number;
          readonly snapshot: ExerciseSnapshotV1;
      }
    | { readonly status: "missing" }
    | {
          readonly status: "ambiguous";
          readonly candidates: readonly { readonly exerciseId: string; readonly slug: string; readonly name: string }[];
      };

/**
 * Resolves bulk exercise references against the catalog (design 14.2 step 4). References by id or
 * external id follow merge redirects to the canonical exercise; an alias is resolved to its unique
 * exercise, falling back to a bounded name search so multiple matches surface as `ambiguous`. All
 * lookups are read-only — the resolver never writes.
 */
export class BulkCatalogResolver {
    constructor(
        private readonly catalog: TrainingExerciseCatalogPort,
        private readonly externalIds: ExerciseExternalIdResolver,
        private readonly ambiguityLimit = 5,
    ) {}

    async resolve(reference: BulkExerciseReference): Promise<BulkExerciseResolution> {
        if (reference.by === "id") return this.resolveById(reference.exerciseId);
        if (reference.by === "externalId") {
            const exerciseId = await this.externalIds.resolveByExternalId(reference.provider, reference.externalId);
            return exerciseId === null ? { status: "missing" } : this.resolveById(exerciseId);
        }
        return this.resolveByAlias(reference.alias);
    }

    private async resolveById(exerciseId: string): Promise<BulkExerciseResolution> {
        try {
            const resolved = await this.catalog.resolveCurrentExercise(exerciseId);
            const snapshot = await this.catalog.currentSnapshot(resolved.resolvedExerciseId);
            return {
                status: "resolved",
                exerciseId: resolved.resolvedExerciseId,
                exerciseVersion: resolved.exercise.version,
                snapshot,
            };
        } catch (error) {
            if (error instanceof ExerciseNotFoundError) return { status: "missing" };
            throw error;
        }
    }

    private async resolveByAlias(alias: string): Promise<BulkExerciseResolution> {
        const exact = await this.catalog.resolveAlias(alias);
        if (exact) {
            const snapshot = await this.catalog.currentSnapshot(exact.id);
            return { status: "resolved", exerciseId: exact.id, exerciseVersion: exact.version, snapshot };
        }
        const page = await this.catalog.listExercises({ search: alias, status: "active", limit: this.ambiguityLimit });
        if (page.items.length === 0) return { status: "missing" };
        if (page.items.length === 1) {
            const only = page.items[0]!;
            const snapshot = await this.catalog.currentSnapshot(only.id);
            return { status: "resolved", exerciseId: only.id, exerciseVersion: only.version, snapshot };
        }
        return {
            status: "ambiguous",
            candidates: page.items.map(item => ({ exerciseId: item.id, slug: item.slug, name: item.name })),
        };
    }
}

// ---------------------------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------------------------

interface DryRunRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: BulkDryRunRepository<Transaction>;
    readonly resolver: BulkCatalogResolver;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
    readonly ttlMs?: number;
}

/** Per-session resolution of an exercise reference, keyed by its draft-local `ref`. */
type SessionResolution = Map<string, ResolvedRef>;
interface ResolvedRef {
    readonly exerciseId: string;
    readonly snapshot: ExerciseSnapshotV1;
    readonly proposed: boolean;
}

/**
 * The reusable, side-effect-free result of normalizing one bulk program (design 14.2). Both the
 * single-program dry-run and the multi-program historical import (issue #58, HI4) consume it: the
 * canonical normalized tree, path-anchored errors, required catalog mappings, proposed exercises, and
 * the affected catalog versions (sorted) that seed the reference fingerprint.
 */
export interface BulkProgramNormalization {
    readonly normalizedProgram: BulkNormalizedProgram;
    readonly warnings: readonly PlanningWarning[];
    readonly errors: readonly BulkDryRunError[];
    readonly mappings: readonly BulkExerciseMapping[];
    readonly proposedExercises: readonly BulkProposedExercisePreview[];
    readonly affected: readonly BulkAffectedVersion[];
}

/** Options controlling one program normalization: where its errors anchor, and catalog-create policy. */
export interface BulkProgramNormalizeOptions {
    /** The payload location this program sits at, so errors/mappings anchor correctly (e.g. `["program"]`). */
    readonly basePath: readonly (string | number)[];
    readonly createMissingExercises: boolean;
    readonly proposedExerciseRegistry?: ProposedExerciseRegistry;
}

interface RegisteredProposedExercise {
    readonly definitionFingerprint: string;
    readonly snapshot: ExerciseSnapshotV1;
    readonly preview: BulkProposedExercisePreview;
    readonly firstPath: readonly (string | number)[];
}

export type ProposedExerciseRegistration =
    | {
          readonly status: "created";
          readonly snapshot: ExerciseSnapshotV1;
          readonly preview: BulkProposedExercisePreview;
      }
    | { readonly status: "reused"; readonly snapshot: ExerciseSnapshotV1 }
    | { readonly status: "conflict"; readonly identity: string; readonly firstPath: readonly (string | number)[] };

/**
 * Payload-scoped registry for not-yet-catalogued exercises. A canonical proposed slug is minted once
 * and reused by every program/session occurrence; conflicting definitions are rejected deterministically.
 */
export class ProposedExerciseRegistry {
    private readonly entries = new Map<string, RegisteredProposedExercise>();

    constructor(private readonly generateId: () => string) {}

    register(
        proposed: BulkProposedExercise,
        provenance: { readonly exerciseRef: string; readonly sessionExternalId: string },
        path: readonly (string | number)[],
        now: Date,
    ): ProposedExerciseRegistration {
        const identity = proposed.slug ?? slugify(proposed.name);
        const definitionFingerprint = hashRequest(canonicalProposedExercise(proposed, identity));
        const existing = this.entries.get(identity);
        if (existing) {
            if (existing.definitionFingerprint !== definitionFingerprint)
                return { status: "conflict", identity, firstPath: existing.firstPath };
            return { status: "reused", snapshot: existing.snapshot };
        }

        const snapshot = proposeExerciseSnapshot({ ...proposed, slug: identity }, this.generateId, now);
        const preview: BulkProposedExercisePreview = {
            exerciseId: snapshot.exerciseId,
            exerciseRef: provenance.exerciseRef,
            sessionExternalId: provenance.sessionExternalId,
            definition: { ...proposed, slug: identity },
        };
        this.entries.set(identity, {
            definitionFingerprint,
            snapshot,
            preview,
            firstPath: [...path],
        });
        return { status: "created", snapshot, preview };
    }
}

/**
 * Pure-of-persistence normalization of a single bulk program (design 14.2 steps 3–8). Resolves catalog
 * references, normalizes entered measurements, builds and validates the Program aggregate and each
 * session prescription entirely in memory, and expands the schedule — never touching a repository. It
 * holds only a read-only {@link BulkCatalogResolver} and an ID minter, so it cannot mutate a program or
 * the catalog. {@link DryRunBulkProgram} wraps it with artifact persistence; {@link HistoricalImportDryRun}
 * runs it once per program in a multi-program archive.
 */
export class BulkProgramNormalizer {
    constructor(
        private readonly resolver: BulkCatalogResolver,
        private readonly generateId: () => string,
    ) {}

    async normalize(
        input: BulkProgramInput,
        options: BulkProgramNormalizeOptions,
        profileId: string,
        now: Date,
    ): Promise<BulkProgramNormalization> {
        const blocks = input.blocks ?? [];
        const sessions = input.sessions ?? [];
        const basePath = options.basePath;

        assertWithinBulkLimits(countBulkInput(input));

        const ids = assignBulkTreeIds(
            blocks.map(block => ({ externalId: block.externalId, parentExternalId: block.parentExternalId ?? null })),
            sessions.map(session => session.externalId),
            this.generateId,
        );

        const errors: BulkDryRunError[] = [];
        const mappings: BulkExerciseMapping[] = [];
        const proposedExercises: BulkProposedExercisePreview[] = [];
        const affected = new Map<string, BulkAffectedVersion>();
        const proposedExerciseRegistry =
            options.proposedExerciseRegistry ?? new ProposedExerciseRegistry(this.generateId);

        // ---- Resolve every exercise reference across all sessions (design 14.2 step 4-5) -----
        const resolutionBySession = new Map<string, SessionResolution>();
        for (const session of sessions) {
            const perRef: SessionResolution = new Map();
            resolutionBySession.set(session.externalId, perRef);
            for (const [activityIndex, activity] of session.prescription.activities.entries()) {
                if (activity.type !== "strength") continue;
                for (const [exerciseIndex, exercise] of activity.exercises.entries()) {
                    const path = [
                        ...basePath,
                        "sessions",
                        session.externalId,
                        "activities",
                        activityIndex,
                        "exercises",
                        exerciseIndex,
                    ];
                    const resolved = await this.resolveExercise(
                        session,
                        exercise,
                        path,
                        options.createMissingExercises,
                        now,
                        { errors, mappings, proposedExercises, affected, proposedExerciseRegistry },
                    );
                    if (resolved) perRef.set(exercise.ref, resolved);
                }
            }
        }

        // ---- Build the Program aggregate for validation + block-overlap warnings -------------
        const blockInputs = this.programBlocks(input, ids);
        let programState: Program["state"] | null = null;
        try {
            programState = Program.create(
                {
                    id: ids.programId,
                    profileId,
                    name: input.name,
                    description: input.description ?? null,
                    scheduleMode: input.scheduleMode ?? "ordered",
                    startDate: input.startDate ?? null,
                    endDate: input.endDate ?? null,
                    focus: input.focus ?? null,
                    goalIds: input.goalIds ?? [],
                    blocks: blockInputs,
                },
                now,
            ).state;
        } catch (error) {
            errors.push(toError([...basePath], error));
        }

        // ---- Build (and validate) each session prescription without persisting ---------------
        const prescriptionBySession = new Map<string, SessionPrescriptionState>();
        for (const session of sessions) {
            const perRef = resolutionBySession.get(session.externalId)!;
            if (!this.sessionFullyResolved(session, perRef)) continue;
            try {
                const draft = this.prescriptionDraft(session, perRef);
                prescriptionBySession.set(session.externalId, this.publishInMemory(draft, now));
            } catch (error) {
                errors.push(toError([...basePath, "sessions", session.externalId, "prescription"], error));
            }
        }

        // ---- Expand the schedule → generated dates + collision warnings ----------------------
        const scheduleContext = {
            scheduleMode: programState?.scheduleMode ?? input.scheduleMode ?? "ordered",
            startDate: programState?.startDate ?? input.startDate ?? null,
            blocks: programState?.blocks ?? [],
        };
        const schedulePlans: SessionScheduleInput[] = sessions.map(session => ({
            key: session.externalId,
            sequence: session.sequence,
            relativeWeek: session.relativeWeek ?? null,
            relativeDay: session.relativeDay ?? null,
            preferredTime: session.preferredTime ?? null,
            blockIds: (session.blockExternalIds ?? [])
                .map(externalId => ids.blockIdByExternalId.get(externalId))
                .filter((value): value is string => value !== undefined),
        }));
        const expansion = expandProgramSchedule(scheduleContext, schedulePlans);
        const localDateByKey = new Map(expansion.sessions.map(session => [session.key, session.localDate]));

        const warnings: PlanningWarning[] = [
            ...(programState ? evaluateProgramWarnings(programState) : []),
            ...expansion.warnings,
        ];

        // ---- Assemble the normalized preview tree --------------------------------------------
        const normalizedProgram = this.normalizedProgram(
            input,
            ids,
            profileId,
            programState,
            sessions,
            localDateByKey,
            prescriptionBySession,
        );

        const affectedVersions = [...affected.values()].sort((a, b) => a.entityId.localeCompare(b.entityId));
        return { normalizedProgram, warnings, errors, mappings, proposedExercises, affected: affectedVersions };
    }

    private async resolveExercise(
        session: BulkProgramSession,
        exercise: {
            readonly ref: string;
            readonly reference: BulkExerciseReference;
            readonly proposed?: BulkProposedExercise;
        },
        path: (string | number)[],
        createMissing: boolean,
        now: Date,
        sink: {
            errors: BulkDryRunError[];
            mappings: BulkExerciseMapping[];
            proposedExercises: BulkProposedExercisePreview[];
            affected: Map<string, BulkAffectedVersion>;
            proposedExerciseRegistry: ProposedExerciseRegistry;
        },
    ): Promise<ResolvedRef | null> {
        const typedExercise = exercise;
        const resolution = await this.resolver.resolve(typedExercise.reference);
        if (resolution.status === "resolved") {
            sink.affected.set(resolution.exerciseId, {
                entityType: "training.exercise",
                entityId: resolution.exerciseId,
                version: resolution.exerciseVersion,
            });
            return { exerciseId: resolution.exerciseId, snapshot: resolution.snapshot, proposed: false };
        }

        // Missing and the caller asked to create it with an explicit definition → propose it (BI-5).
        if (resolution.status === "missing" && createMissing && typedExercise.proposed) {
            try {
                const registration = sink.proposedExerciseRegistry.register(
                    typedExercise.proposed,
                    { exerciseRef: typedExercise.ref, sessionExternalId: session.externalId },
                    path,
                    now,
                );
                if (registration.status === "conflict") {
                    sink.errors.push(proposedExerciseConflict([...path, "proposed"], registration));
                    return null;
                }
                if (registration.status === "created") sink.proposedExercises.push(registration.preview);
                return {
                    exerciseId: registration.snapshot.exerciseId,
                    snapshot: registration.snapshot,
                    proposed: true,
                };
            } catch (error) {
                sink.errors.push(toError([...path, "proposed"], error));
                return null;
            }
        }

        sink.mappings.push({
            path,
            sessionExternalId: session.externalId,
            exerciseRef: typedExercise.ref,
            status: resolution.status === "missing" ? "missing" : "ambiguous",
            requested: typedExercise.reference,
            ...(resolution.status === "ambiguous" ? { candidates: [...resolution.candidates] } : {}),
        });
        sink.errors.push({
            path,
            code: "CATALOG_MAPPING_REQUIRED",
            message:
                resolution.status === "missing"
                    ? `Exercise reference '${typedExercise.ref}' did not match any catalog exercise`
                    : `Exercise reference '${typedExercise.ref}' matched multiple catalog exercises`,
        });
        return null;
    }

    private sessionFullyResolved(session: BulkProgramSession, perRef: SessionResolution): boolean {
        for (const activity of session.prescription.activities) {
            if (activity.type !== "strength") continue;
            for (const exercise of activity.exercises) if (!perRef.has(exercise.ref)) return false;
        }
        return true;
    }

    private prescriptionDraft(session: BulkProgramSession, perRef: SessionResolution): PublishPrescriptionDraft {
        const activities: PrescribedActivityDraft[] = session.prescription.activities.map((activity, index) => {
            const ref = activity.externalId ?? `activity-${index}`;
            if (activity.type === "strength") {
                const exercises = activity.exercises.map(exercise => {
                    const resolved = perRef.get(exercise.ref)!;
                    const sets: PrescribedSetDraft[] = exercise.sets.map((set, setIndex) => ({
                        ref: set.ref ?? `${exercise.ref}#s${setIndex}`,
                        setGroupRef: set.setGroupRef ?? null,
                        position: set.position,
                        round: set.round ?? null,
                        setType: set.setType,
                        ...(set.targets ? { targets: normalizeStrengthSetTargets(set.targets) } : {}),
                        notes: set.notes ?? null,
                    }));
                    return {
                        ref: exercise.ref,
                        exerciseId: resolved.exerciseId,
                        snapshot: resolved.snapshot,
                        position: exercise.position,
                        purpose: exercise.purpose ?? null,
                        substitutionPolicy: exercise.substitutionPolicy ?? null,
                        sets,
                    };
                });
                const setGroups: PrescribedSetGroupDraft[] = (activity.setGroups ?? []).map(group => ({
                    ref: group.ref,
                    parentGroupRef: group.parentGroupRef ?? null,
                    type: group.type,
                    position: group.position,
                    rounds: group.rounds ?? null,
                    restMs: group.restMs ?? null,
                    members: group.members.map(member => ({
                        exerciseRef: member.exerciseRef,
                        position: member.position,
                    })),
                }));
                return {
                    ref,
                    type: "strength",
                    position: activity.position,
                    expectedDurationMs: activity.expectedDurationMs ?? null,
                    rpeTarget: activity.rpeTarget ?? null,
                    notes: activity.notes ?? null,
                    strength: { exercises, setGroups },
                };
            }
            const steps: PrescribedRunStepDraft[] = activity.steps.map((step, stepIndex) => ({
                ref: step.ref ?? `${ref}#step${stepIndex}`,
                parentStepRef: step.parentStepRef ?? null,
                type: step.type,
                position: step.position,
                repeatCount: step.repeatCount ?? null,
                ...(step.targets ? { targets: normalizeRunStepTargets(step.targets) } : {}),
                notes: step.notes ?? null,
            }));
            return {
                ref,
                type: "running",
                position: activity.position,
                expectedDurationMs: activity.expectedDurationMs ?? null,
                rpeTarget: activity.rpeTarget ?? null,
                notes: activity.notes ?? null,
                running: {
                    runTags: activity.runTags ?? [],
                    ...(activity.overallTargets
                        ? { overallTargets: normalizeRunStepTargets(activity.overallTargets) }
                        : {}),
                    steps,
                },
            };
        });
        return {
            kind: "planned",
            expectedDurationMs: session.prescription.expectedDurationMs ?? null,
            notes: session.prescription.notes ?? null,
            activities,
        };
    }

    /** Publish a draft entirely in memory — pure domain validation, never a repository. */
    private publishInMemory(draft: PublishPrescriptionDraft, now: Date): SessionPrescriptionState {
        const minter: IdMinter = { rowId: () => this.generateId(), logicalKey: () => this.generateId() };
        return SessionPrescription.publishDraft(draft, minter, now).state;
    }

    private programBlocks(input: BulkProgramInput, ids: ReturnType<typeof assignBulkTreeIds>): ProgramBlockInput[] {
        const parentByExternalId = new Map(ids.blocks.map(block => [block.externalId, block.parentBlockId]));
        return (input.blocks ?? []).map(block => ({
            id: ids.blockIdByExternalId.get(block.externalId)!,
            parentBlockId: parentByExternalId.get(block.externalId) ?? null,
            type: block.type,
            label: block.label ?? null,
            position: block.position,
            startDate: block.startDate ?? null,
            endDate: block.endDate ?? null,
            relativeStartWeek: block.relativeStartWeek ?? null,
            relativeEndWeek: block.relativeEndWeek ?? null,
            focus: block.focus ?? null,
            targetMuscles: block.targetMuscles ?? [],
            targetVolume: block.targetVolume ?? null,
            targetIntensity: block.targetIntensity ?? null,
            deload: block.deload ?? false,
            expectedAdaptations: block.expectedAdaptations ?? null,
            notes: block.notes ?? null,
            tags: block.tags ?? [],
        }));
    }

    private normalizedProgram(
        input: BulkProgramInput,
        ids: ReturnType<typeof assignBulkTreeIds>,
        profileId: string,
        programState: Program["state"] | null,
        sessions: readonly BulkProgramSession[],
        localDateByKey: ReadonlyMap<string, string | null>,
        prescriptionBySession: ReadonlyMap<string, SessionPrescriptionState>,
    ): BulkNormalizedProgram {
        const externalIdByBlockId = new Map(ids.blocks.map(block => [block.id, block.externalId]));
        const blocks = (programState?.blocks ?? this.programBlocks(input, ids)).map(block => ({
            id: block.id,
            externalId: externalIdByBlockId.get(block.id) ?? block.id,
            parentBlockId: block.parentBlockId ?? null,
            type: block.type,
            label: block.label ?? null,
            position: block.position,
            startDate: block.startDate ?? null,
            endDate: block.endDate ?? null,
            relativeStartWeek: block.relativeStartWeek ?? null,
            relativeEndWeek: block.relativeEndWeek ?? null,
            focus: block.focus ?? null,
            targetMuscles: [...(block.targetMuscles ?? [])],
            targetVolume: block.targetVolume ?? null,
            targetIntensity: block.targetIntensity ?? null,
            deload: block.deload ?? false,
            expectedAdaptations: block.expectedAdaptations ?? null,
            notes: block.notes ?? null,
            tags: [...(block.tags ?? [])],
        }));
        return {
            id: ids.programId,
            externalId: input.externalId ?? null,
            profileId,
            name: programState?.name ?? input.name,
            description: programState?.description ?? input.description ?? null,
            scheduleMode: programState?.scheduleMode ?? input.scheduleMode ?? "ordered",
            startDate: programState?.startDate ?? input.startDate ?? null,
            endDate: programState?.endDate ?? input.endDate ?? null,
            focus: programState?.focus ?? input.focus ?? null,
            goalIds: [...(programState?.goalIds ?? input.goalIds ?? [])],
            blocks,
            sessions: sessions.map(session => ({
                id: ids.sessionIdByExternalId.get(session.externalId)!,
                externalId: session.externalId,
                title: session.title ?? null,
                sequence: session.sequence,
                relativeWeek: session.relativeWeek ?? null,
                relativeDay: session.relativeDay ?? null,
                localDate: localDateByKey.get(session.externalId) ?? null,
                preferredTime: session.preferredTime ?? null,
                timeZone: session.timeZone ?? null,
                expectedDurationMinutes: session.expectedDurationMinutes ?? null,
                notes: session.notes ?? null,
                tags: [...(session.tags ?? [])],
                blockIds: (session.blockExternalIds ?? [])
                    .map(externalId => ids.blockIdByExternalId.get(externalId))
                    .filter((value): value is string => value !== undefined),
                // The published prescription state is structurally the response tree, validated
                // by sessionPrescriptionResponseSchema at the controller boundary.
                prescription: prescriptionBySession.get(session.externalId) ?? null,
            })),
        };
    }
}

/**
 * Dry-run a complete bulk program (design 14.2). Delegates the whole normalization to
 * {@link BulkProgramNormalizer} (catalog resolution, in-memory Program/prescription validation,
 * schedule expansion) and adds only the reference fingerprint, dry-run state, and the single side
 * effect: persisting the preview artifact in one UnitOfWork. It holds no program/prescription/catalog
 * write port, so it cannot mutate authoritative state.
 */
export class DryRunBulkProgram<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly ttlMs: number;
    private readonly normalizer: BulkProgramNormalizer;

    constructor(private readonly runtime: DryRunRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Bulk dry-run ID generation is not configured");
            });
        this.ttlMs = runtime.ttlMs ?? BULK_DRY_RUN_TTL_MS;
        this.normalizer = new BulkProgramNormalizer(runtime.resolver, this.generateId);
    }

    async execute(
        envelope: BulkProgramEnvelope,
        _metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<BulkDryRunResponse> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();

        const normalization = await this.normalizer.normalize(
            envelope.program,
            { basePath: ["program"], createMissingExercises: envelope.createMissingExercises ?? false },
            profileId,
            now,
        );

        const affectedVersions = [...normalization.affected];
        const referenceHash = hashRequest(affectedVersions);
        const state: BulkDryRunState = normalization.mappings.length > 0 ? "needs_mapping" : "ready";
        const record: StoredBulkDryRun = {
            id: this.generateId(),
            profileId,
            schemaVersion: 1,
            sourceNamespace: envelope.source.namespace,
            sourceGeneratedBy: envelope.source.generatedBy ?? null,
            mode: envelope.mode,
            state,
            referenceHash,
            approvalToken: this.generateId(),
            normalizedProgram: normalization.normalizedProgram,
            warnings: [...normalization.warnings],
            errors: [...normalization.errors],
            mappings: [...normalization.mappings],
            proposedExercises: [...normalization.proposedExercises],
            affectedVersions,
            createdAt: now,
            expiresAt: new Date(now.getTime() + this.ttlMs),
            consumedAt: null,
        };

        // The single side effect: persist the preview artifact, joining the caller's transaction
        // (e.g. the idempotency executor's) when one is supplied.
        if (transaction === undefined)
            await this.runtime.unitOfWork.execute(active => this.runtime.repository.save(record, active));
        else await this.runtime.repository.save(record, transaction);

        return this.toResponse(record);
    }

    private toResponse(record: StoredBulkDryRun): BulkDryRunResponse {
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
            program: record.normalizedProgram,
            generatedSessionCount: record.normalizedProgram.sessions.length,
            warnings: record.warnings.map(warning => ({
                code: warning.code,
                message: warning.message,
                evidence: warning.evidence,
            })),
            errors: [...record.errors],
            mappings: [...record.mappings],
            proposedExercises: [...record.proposedExercises],
            affectedVersions: [...record.affectedVersions],
        };
    }
}

// ---------------------------------------------------------------------------------------------
// Commit use case (design 14.3)
// ---------------------------------------------------------------------------------------------

interface CommitRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: BulkDryRunRepository<Transaction>;
    readonly externalIds: BulkExternalIdRegistry<Transaction>;
    readonly catalog: Pick<TrainingExerciseCatalogPort, "resolveCurrentExercise">;
    readonly exercises: ExerciseCatalogCommands<Transaction>;
    readonly programCommands: ProgramCommands<Transaction>;
    readonly plannedSessions: PlannedSessionCommands<Transaction>;
    readonly publisher: PrescriptionPublisher<Transaction>;
    readonly membership: ProgramMembershipRepository<Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
}

/**
 * Commit an approved bulk dry-run into authoritative Training state, exactly once and all-or-nothing
 * (design 14.3). This is where agent-generated data crosses into the system, so it re-validates the
 * dry-run's identity, freshness, and reference hash before writing, and consumes the dry-run in the
 * same transaction so it can never double-commit.
 *
 * Commit reuses the approved normalized tree stored by the dry-run — it does not re-derive anything
 * from a request body (a caller cannot supply one). Persistence reuses the ordinary aggregate
 * commands ({@link ProgramCommands}, {@link PlannedSessionCommands}, {@link ExerciseCatalogCommands})
 * and the {@link PrescriptionPublisher}, so every domain invariant, revision, and outbox event fires
 * exactly as for a hand-authored program. All work runs in one transaction (the caller's — normally
 * the idempotency executor's — or its own UnitOfWork), so any child failure rolls the whole tree back
 * and leaves the dry-run unconsumed.
 *
 * Upsert scope (MVP): namespaced external IDs are registered with DB-level uniqueness so retries and
 * duplicate imports are rejected rather than silently duplicated. Field-level merge of a pre-existing
 * program (the omitted-keeps / null-clears contract captured by `mergeUpsertPatch`) requires the
 * dry-run to carry per-field diffs and is deferred to a later increment.
 */
export class CommitBulkProgram<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: CommitRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
    }

    execute(
        request: BulkCommitRequest,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<BulkCommitResponse> {
        if (transaction === undefined)
            return this.runtime.unitOfWork.execute(active => this.commit(request, metadata, active));
        return this.commit(request, metadata, transaction);
    }

    private async commit(
        request: BulkCommitRequest,
        metadata: CommandContext,
        transaction: Transaction,
    ): Promise<BulkCommitResponse> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();

        // ---- Lock + gate the dry-run (design 14.3 step 1) ------------------------------------
        const record = await this.runtime.repository.lockForCommit(request.dryRunId, transaction);
        if (!record || record.profileId !== profileId) throw new BulkDryRunNotFoundError(request.dryRunId);
        if (record.approvalToken !== request.approvalToken) throw new DryRunTokenInvalidError(record.id);
        if (record.consumedAt !== null) throw new DryRunConsumedError(record.id);
        if (record.expiresAt.getTime() <= now.getTime()) throw new DryRunExpiredError(record.id);
        if (record.state !== "ready" || record.errors.length > 0)
            throw new ApplicationError(
                "CATALOG_MAPPING_REQUIRED",
                "This dry-run has unresolved mappings or validation errors and cannot be committed",
                undefined,
                { dryRunId: record.id },
            );

        // ---- Recheck referenced catalog versions + normalized hash (design 14.3 step 2) ------
        await this.revalidateReferences(record);

        const program = record.normalizedProgram;

        // ---- Create approved catalog entries first (prescription rows FK exercises) ----------
        const createdExercises: BulkCommittedExercise[] = [];
        for (const proposed of record.proposedExercises) {
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
                metadata,
                transaction,
            );
            createdExercises.push({
                exerciseId: proposed.exerciseId,
                exerciseRef: proposed.exerciseRef,
                sessionExternalId: proposed.sessionExternalId,
            });
        }

        // ---- Program root + block tree -------------------------------------------------------
        const programDetail = await this.runtime.programCommands.create(
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
            metadata,
            transaction,
        );

        // ---- Each session: insert its approved prescription, materialize, wire membership ----
        const sessions: BulkCommittedSession[] = [];
        for (const session of program.sessions) {
            if (!session.prescription)
                throw new ApplicationValidationError(
                    `Session '${session.externalId}' in a ready dry-run is missing its prescription`,
                    { prescription: ["Prescription is missing"] },
                    { sessionExternalId: session.externalId },
                );
            const published = await this.runtime.publisher.publishPreparedState(
                session.prescription,
                metadata,
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
                metadata,
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
            sessions.push({ id: session.id, externalId: session.externalId, prescriptionId: published.id });
        }

        // ---- Register namespaced external IDs (unique per namespace+type+externalId) ---------
        const entries: BulkExternalIdEntry[] = [];
        if (program.externalId)
            entries.push({ entityType: "program", externalId: program.externalId, entityId: program.id });
        for (const block of program.blocks)
            entries.push({ entityType: "program-block", externalId: block.externalId, entityId: block.id });
        for (const session of program.sessions)
            entries.push({ entityType: "planned-session", externalId: session.externalId, entityId: session.id });
        await this.runtime.externalIds.register({ profileId, namespace: record.sourceNamespace, entries }, transaction);

        // ---- Consume the dry-run last, so a child failure above leaves it committable --------
        await this.runtime.repository.markConsumed(
            record.id,
            { committedProgramId: program.id, consumedAt: now },
            transaction,
        );

        return {
            dryRunId: record.id,
            programId: program.id,
            programVersion: programDetail.program.version,
            mode: record.mode,
            source: { namespace: record.sourceNamespace, generatedBy: record.sourceGeneratedBy },
            committedAt: now.toISOString(),
            sessions,
            createdExercises,
            affectedVersions: record.affectedVersions,
            warnings: record.warnings,
        };
    }

    /**
     * Recompute the reference fingerprint over the *current* versions of every catalog exercise the
     * dry-run resolved, in the same order and hash the dry-run used, and compare to the stored hash.
     * A version bump, a new merge redirect, or a deleted exercise all change the hash → the dry-run is
     * stale and must be re-run (design 14.3 step 2). Proposed (not-yet-created) exercises are absent
     * from `affectedVersions`, so they never trip this check.
     */
    private async revalidateReferences(record: StoredBulkDryRun): Promise<void> {
        const current: BulkAffectedVersion[] = [];
        for (const affected of record.affectedVersions) {
            if (affected.entityType !== "training.exercise") {
                current.push(affected);
                continue;
            }
            try {
                const resolved = await this.runtime.catalog.resolveCurrentExercise(affected.entityId);
                current.push({ ...affected, version: resolved.exercise.version });
            } catch (error) {
                if (error instanceof ExerciseNotFoundError) throw new DryRunStaleError(record.id);
                throw error;
            }
        }
        if (hashRequest(current) !== record.referenceHash) throw new DryRunStaleError(record.id);
    }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export class BulkDryRunNotFoundError extends ApplicationValidationError {
    constructor(readonly dryRunId: string) {
        super(`Bulk dry-run ${dryRunId} was not found`, undefined, { dryRunId });
        this.name = "BulkDryRunNotFoundError";
    }
}

function countBulkInput(input: BulkProgramInput) {
    const sessions = input.sessions ?? [];
    const activitiesPerSession = sessions.map(session => session.prescription.activities.length);
    const exercisesPerActivity: number[] = [];
    const setsPerExercise: number[] = [];
    const runStepsPerActivity: number[] = [];
    for (const session of sessions)
        for (const activity of session.prescription.activities)
            if (activity.type === "strength") {
                exercisesPerActivity.push(activity.exercises.length);
                for (const exercise of activity.exercises) setsPerExercise.push(exercise.sets.length);
            } else {
                runStepsPerActivity.push(activity.steps.length);
            }
    return {
        blocks: (input.blocks ?? []).length,
        sessions: sessions.length,
        activitiesPerSession,
        exercisesPerActivity,
        setsPerExercise,
        runStepsPerActivity,
    };
}

function toError(path: (string | number)[], error: unknown): BulkDryRunError {
    const message = error instanceof Error ? error.message : "Validation failed";
    const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "VALIDATION_FAILED";
    return { path, code, message };
}

function canonicalProposedExercise(proposed: BulkProposedExercise, slug: string): unknown {
    return {
        ...proposed,
        slug,
        supportedMeasurements: [...proposed.supportedMeasurements].sort(),
        muscles: [...(proposed.muscles ?? [])].sort(
            (left, right) =>
                left.muscleGroupId.localeCompare(right.muscleGroupId) || left.role.localeCompare(right.role),
        ),
    };
}

export function proposedExerciseConflict(
    path: (string | number)[],
    conflict: Extract<ProposedExerciseRegistration, { status: "conflict" }>,
): BulkDryRunError {
    return {
        path,
        code: "PROPOSED_EXERCISE_CONFLICT",
        message: `Proposed exercise '${conflict.identity}' conflicts with its first definition at ${JSON.stringify(conflict.firstPath)}`,
    };
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

/**
 * Build an in-memory exercise snapshot for a proposed (not-yet-catalogued) exercise definition, minting
 * a fresh id. Shared by the bulk-program preview and the historical-import preview (issue #58, HI4) so a
 * proposed exercise is previewed identically wherever it is referenced. Pure — it creates no catalog row.
 */
export function proposeExerciseSnapshot(
    proposed: BulkProposedExercise,
    generateId: () => string,
    now: Date,
): ExerciseSnapshotV1 {
    const definition = ExerciseDefinition.create(
        {
            id: generateId(),
            slug: proposed.slug ?? slugify(proposed.name),
            name: proposed.name,
            ownership: "user",
            forkedFromExerciseId: null,
            equipmentTypeId: proposed.equipmentTypeId,
            movementPatternId: proposed.movementPatternId,
            classification: proposed.classification,
            laterality: proposed.laterality,
            bodyPosition: proposed.bodyPosition,
            repetitionSemantics: proposed.repetitionSemantics,
            loadModel: proposed.loadModel,
            supportedMeasurements: proposed.supportedMeasurements,
            muscles: (proposed.muscles ?? []).map(muscle => ({
                muscleGroupId: muscle.muscleGroupId,
                role: muscle.role,
            })),
        },
        now,
    );
    return createExerciseSnapshot(definition, 1);
}
