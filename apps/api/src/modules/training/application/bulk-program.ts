import type { Clock } from "#src/platform/domain/index";
import {
    ApplicationValidationError,
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
import type { TrainingExerciseCatalogPort } from "#src/modules/training/application/exercises";
import { ExerciseNotFoundError } from "#src/modules/training/application/exercises";
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
}

/**
 * Capability port over the dry-run artifact store. There is no generic base repository and no raw
 * SQL in the use case; the adapter maps rows in infrastructure (ADR 0003). `save` runs inside the
 * caller's UnitOfWork so the artifact write is the single, isolated side effect.
 */
export interface BulkDryRunRepository<Transaction = unknown> {
    save(record: StoredBulkDryRun, transaction: Transaction): Promise<void>;
    findById(id: string, transaction?: Transaction): Promise<StoredBulkDryRun | null>;
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
 * Dry-run a complete bulk program (design 14.2). Resolves catalog references, normalizes entered
 * measurements, expands the schedule, and runs every Program/prescription domain invariant against
 * in-memory aggregates — never a repository — producing the canonical normalized tree, warnings,
 * required mappings, and affected versions. The only persistence is the preview artifact itself,
 * written in one UnitOfWork; there is no way for this use case to mutate a program or the catalog
 * because it holds no program/prescription/catalog write port.
 */
export class DryRunBulkProgram<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly ttlMs: number;

    constructor(private readonly runtime: DryRunRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Bulk dry-run ID generation is not configured");
            });
        this.ttlMs = runtime.ttlMs ?? BULK_DRY_RUN_TTL_MS;
    }

    async execute(
        envelope: BulkProgramEnvelope,
        _metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<BulkDryRunResponse> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const input = envelope.program;
        const blocks = input.blocks ?? [];
        const sessions = input.sessions ?? [];

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

        // ---- Resolve every exercise reference across all sessions (design 14.2 step 4-5) -----
        const resolutionBySession = new Map<string, SessionResolution>();
        for (const session of sessions) {
            const perRef: SessionResolution = new Map();
            resolutionBySession.set(session.externalId, perRef);
            for (const [activityIndex, activity] of session.prescription.activities.entries()) {
                if (activity.type !== "strength") continue;
                for (const [exerciseIndex, exercise] of activity.exercises.entries()) {
                    const path = [
                        "program",
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
                        envelope.createMissingExercises ?? false,
                        now,
                        { errors, mappings, proposedExercises, affected },
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
            errors.push(toError(["program"], error));
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
                errors.push(toError(["program", "sessions", session.externalId, "prescription"], error));
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
        const referenceHash = hashRequest(affectedVersions);
        const state: BulkDryRunState = mappings.length > 0 ? "needs_mapping" : "ready";
        const dryRunId = this.generateId();
        const record: StoredBulkDryRun = {
            id: dryRunId,
            profileId,
            schemaVersion: 1,
            sourceNamespace: envelope.source.namespace,
            sourceGeneratedBy: envelope.source.generatedBy ?? null,
            mode: envelope.mode,
            state,
            referenceHash,
            approvalToken: this.generateId(),
            normalizedProgram,
            warnings,
            errors,
            mappings,
            proposedExercises,
            affectedVersions,
            createdAt: now,
            expiresAt: new Date(now.getTime() + this.ttlMs),
        };

        // The single side effect: persist the preview artifact, joining the caller's transaction
        // (e.g. the idempotency executor's) when one is supplied.
        if (transaction === undefined)
            await this.runtime.unitOfWork.execute(active => this.runtime.repository.save(record, active));
        else await this.runtime.repository.save(record, transaction);

        return this.toResponse(record);
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
        },
    ): Promise<ResolvedRef | null> {
        const typedExercise = exercise;
        const resolution = await this.runtime.resolver.resolve(typedExercise.reference);
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
                const proposed = this.proposeExercise(typedExercise.proposed, now);
                sink.proposedExercises.push({
                    exerciseId: proposed.snapshot.exerciseId,
                    exerciseRef: typedExercise.ref,
                    sessionExternalId: session.externalId,
                    definition: typedExercise.proposed,
                });
                return { exerciseId: proposed.snapshot.exerciseId, snapshot: proposed.snapshot, proposed: true };
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

    private proposeExercise(proposed: BulkProposedExercise, now: Date): { snapshot: ExerciseSnapshotV1 } {
        const definition = ExerciseDefinition.create(
            {
                id: this.generateId(),
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
        return { snapshot: createExerciseSnapshot(definition, 1) };
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

function slugify(name: string): string {
    const slug = name
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug.length > 0 ? slug : "exercise";
}
