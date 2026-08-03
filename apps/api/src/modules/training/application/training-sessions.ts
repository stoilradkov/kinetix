import { DomainEvent as PlatformDomainEvent, entityId, type Clock, type EntityId } from "#src/platform/domain/index";
import type { DomainEvent } from "#src/platform/domain/index";

import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    ExpectedVersionGuard,
    MigratingSnapshotSerializer,
    RevisionHistoryService,
    type CommandContext,
    type CurrentStateStore,
    type RevisionHistoryPage,
    type RevisionMetadata,
    type RevisionMutationService,
    type RevisionResourceHandler,
    type RevisionStore,
    type SnapshotResourceMapper,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    TrainingSession,
    resolveExecutionPrescription,
    roundLoadToIncrement,
    type ActivityMappingInput,
    type CompleteTrainingSessionInput,
    type CreateTrainingSessionInput,
    type ExerciseOccurrenceInput,
    type IdMinter,
    type MappingRelation,
    type MaxBasis,
    type OccurrenceMappingInput,
    type PainRecordInput,
    type PerformedSetInput,
    type PlannedActualOutcome,
    type PostWorkoutRatings,
    type PreWorkoutReadiness,
    type RunStepMappingInput,
    type SessionMappingsInput,
    type SessionPlannedLink,
    type SessionPlannedLinkInput,
    type SessionPrescriptionState,
    type SessionActivityInput,
    type SetGroupInput,
    type SetMappingInput,
    type StrengthActivityInput,
    type TargetResolutionContext,
    type TrainingSessionState,
    type UpdateTrainingSessionInput,
} from "#src/modules/training/domain/index";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/exercise-definition";
import { sessionToPrescriptionDraft } from "#src/modules/training/application/session-to-prescription";
import type { TrainingExerciseCatalogPort } from "#src/modules/training/application/exercises";
import type {
    PlannedSessionCommands,
    PlannedSessionRepository,
} from "#src/modules/training/application/planned-sessions";
import type {
    PrescriptionPublisher,
    SessionPrescriptionRepository,
} from "#src/modules/training/application/session-prescriptions";
import type { WorkoutTemplateRepository } from "#src/modules/training/application/workout-templates";
import type { TrainingTargetContextReader } from "#src/modules/training/application/training-maxes";
import type { EquipmentIncrementQueries } from "#src/modules/training/application/equipment-increments";
import type { ProfileReader } from "#src/modules/profile/index";

export const TRAINING_SESSION_REPOSITORY = Symbol("TRAINING_SESSION_REPOSITORY");
export const TRAINING_SESSION_MUTATION_SERVICE = Symbol("TRAINING_SESSION_MUTATION_SERVICE");
export const TRAINING_SESSION_COMMANDS = Symbol("TRAINING_SESSION_COMMANDS");
export const TRAINING_SESSION_REVISION_HANDLER = Symbol("TRAINING_SESSION_REVISION_HANDLER");
export const TRAINING_SESSION_ENTITY_TYPE = "training.session";

/** Full detail read model: the whole session tree plus its aggregate version. */
export interface TrainingSessionResource extends TrainingSessionState {
    readonly version: number;
}

/** Bounded list projection: scalar metadata + version + child counts, without the nested trees. */
export interface TrainingSessionSummary extends Omit<
    TrainingSessionState,
    | "activities"
    | "painRecords"
    | "plannedLinks"
    | "activityMappings"
    | "occurrenceMappings"
    | "setMappings"
    | "runStepMappings"
> {
    readonly version: number;
    readonly activityCount: number;
    readonly painRecordCount: number;
}

export interface TrainingSessionListFilter {
    readonly includeArchived?: boolean;
}

/** Capability port over the versioned training-session root plus its activity/pain child tree. */
export interface TrainingSessionRepository<Transaction = unknown> extends CurrentStateStore<
    TrainingSessionState,
    Transaction
> {
    readSession(id: EntityId, transaction?: Transaction): Promise<TrainingSessionResource | null>;
    listSessions(filter?: TrainingSessionListFilter): Promise<readonly TrainingSessionSummary[]>;
}

export interface TrainingSessionMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

/**
 * Command-level exercise occurrence: it names an `exerciseId` but carries no snapshot. The application
 * resolves the immutable exercise snapshot through the public catalog port before building the domain
 * aggregate, so callers never mint snapshots and clients cannot forge historical facts.
 */
export interface StrengthOccurrenceCommandInput {
    readonly id: string;
    readonly exerciseId: string;
    readonly position: number;
    readonly purpose?: string | null;
    readonly technique?: number | null;
    readonly discomfort?: number | null;
    readonly pump?: number | null;
    readonly notes?: string | null;
    readonly performedSets?: readonly PerformedSetInput[];
}

export interface StrengthActivityCommandInput {
    readonly occurrences?: readonly StrengthOccurrenceCommandInput[];
    readonly setGroups?: readonly SetGroupInput[];
}

export interface SessionActivityCommandInput extends Omit<SessionActivityInput, "strength"> {
    readonly strength?: StrengthActivityCommandInput | null;
}

export interface CreateTrainingSessionCommand {
    readonly id?: string;
    readonly localDate?: string;
    readonly timeZone?: string;
    readonly sourcePlannedSessionId?: string | null;
    readonly title?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly readiness?: Partial<PreWorkoutReadiness>;
    readonly postWorkout?: Partial<PostWorkoutRatings>;
    readonly activities?: readonly SessionActivityCommandInput[];
    readonly painRecords?: readonly PainRecordInput[];
}

export interface UpdateTrainingSessionCommand extends Omit<UpdateTrainingSessionInput, "activities"> {
    readonly activities?: readonly SessionActivityCommandInput[];
}
export type CompleteTrainingSessionCommand = CompleteTrainingSessionInput;

/** Raised when a new exercise occurrence references an archived catalog exercise (design §5, ST-3). */
export class ArchivedExerciseError extends ApplicationValidationError {
    constructor(readonly exerciseId: string) {
        super("Cannot record new work against an archived exercise", {
            exerciseId: ["Cannot record new work against an archived exercise"],
        });
        this.name = "ArchivedExerciseError";
    }
}

export class TrainingSessionNotFoundError extends ApplicationNotFoundError {
    constructor(readonly trainingSessionId: string) {
        super(`Training session ${trainingSessionId} was not found`, { trainingSessionId });
        this.name = "TrainingSessionNotFoundError";
    }
}

export const trainingSessionSerializer = new MigratingSnapshotSerializer<TrainingSessionState>(
    1,
    state => structuredClone(state),
    value => TrainingSession.rehydrate(value as TrainingSessionState).state,
    [],
);

/** Optional collaborators enabling planned/actual mappings + target resolution (design 11.4/11.6). */
export interface TrainingSessionPlanningPorts<Transaction> {
    readonly plannedSessions: Pick<PlannedSessionRepository<Transaction>, "readSession">;
    readonly plannedCommands: Pick<PlannedSessionCommands<Transaction>, "recomputeOutcomeWithinTransaction">;
    readonly prescriptions: Pick<SessionPrescriptionRepository<Transaction>, "loadTree" | "loadTrees">;
    readonly publisher: Pick<PrescriptionPublisher<Transaction>, "publishPreparedState" | "publish">;
    readonly templates: Pick<WorkoutTemplateRepository<Transaction>, "readTemplate">;
    readonly targetContext: TrainingTargetContextReader;
    readonly increments: Pick<EquipmentIncrementQueries, "resolveForExercise">;
}

interface TrainingSessionCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: TrainingSessionRepository<Transaction>;
    readonly mutations: RevisionMutationService<TrainingSessionState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "getActiveProfile">;
    readonly catalog: Pick<TrainingExerciseCatalogPort, "resolveCurrentExercise" | "currentSnapshot">;
    readonly planning?: TrainingSessionPlanningPorts<Transaction>;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

/** Start a training session from a planned session, freezing source + resolved-execution prescriptions. */
export interface StartPlannedSessionCommand {
    readonly plannedSessionId: string;
    readonly id?: string;
    readonly localDate?: string;
    readonly timeZone?: string;
    readonly title?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly readiness?: Partial<PreWorkoutReadiness>;
}

/** Replace the planned/actual mapping tree of a session (planned links stay frozen). */
export interface RecordSessionMappingsCommand {
    readonly activityMappings?: readonly ActivityMappingInput[];
    readonly occurrenceMappings?: readonly OccurrenceMappingInput[];
    readonly setMappings?: readonly SetMappingInput[];
    readonly runStepMappings?: readonly RunStepMappingInput[];
}

/** Metadata overrides shared by every start-from source (design 11.6; PRD UX-3). */
export interface StartTrainingSessionOverrides {
    readonly id?: string;
    readonly localDate?: string;
    readonly timeZone?: string;
    readonly title?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly readiness?: Partial<PreWorkoutReadiness>;
}

export type StartEmptyTrainingSessionCommand = StartTrainingSessionOverrides;

export interface StartTemplateTrainingSessionCommand extends StartTrainingSessionOverrides {
    readonly templateId: string;
}

export interface StartPreviousTrainingSessionCommand extends StartTrainingSessionOverrides {
    readonly sourceSessionId: string;
}

/** Append one activity to a session's ordered activity list (design 18.2 child command). */
export interface AddSessionActivityCommand {
    readonly activity: SessionActivityCommandInput;
}

/** Reorder a session's activities by supplying the complete ordered list of activity IDs. */
export interface ReorderSessionActivitiesCommand {
    readonly activityIds: readonly string[];
}

/** Substitute an occurrence's exercise, recording a `substituted` occurrence mapping (PRD AC-4). */
export interface SubstituteOccurrenceCommand {
    readonly activityId: string;
    readonly occurrenceId: string;
    readonly newExerciseId: string;
    readonly prescribedExerciseId?: string | null;
    readonly reason?: string | null;
}

/** A planned/actual set mapping attached to a recorded set; the performed set ID is filled server-side. */
export interface PerformedSetMappingDraft {
    readonly id?: string;
    readonly prescribedSetId?: string | null;
    readonly relation: MappingRelation;
    readonly portion?: string | null;
    readonly reason?: string | null;
    readonly notes?: string | null;
}

/** Record (create or replace) one performed set inside an occurrence, with an optional mapping. */
export interface RecordPerformedSetCommand {
    readonly activityId: string;
    readonly occurrenceId: string;
    readonly set: PerformedSetInput;
    readonly mapping?: PerformedSetMappingDraft | null;
}

/** Patch an existing performed set, optionally replacing its mapping. */
export interface UpdatePerformedSetCommand extends Partial<Omit<PerformedSetInput, "id">> {
    readonly mapping?: PerformedSetMappingDraft | null;
}

/** One frozen prescription a live session maps against (source planned/template + resolved execution). */
export interface ActiveSessionPlan {
    readonly referencePrescriptionId: string;
    readonly plannedSessionId: string | null;
    readonly prescription: SessionPrescriptionState;
}

/** The complete active-session view returned in a bounded query (session tree + frozen plan[s]). */
export interface ActiveTrainingSessionView extends TrainingSessionResource {
    readonly plans: readonly ActiveSessionPlan[];
}

export interface CompletionPreviewIssue {
    readonly code: string;
    readonly severity: "warning" | "blocker";
    readonly message: string;
    readonly activityId: string | null;
    readonly occurrenceId: string | null;
}

export interface CompletionPreviewOutcome {
    readonly plannedSessionId: string;
    readonly currentStatus: string | null;
    readonly projectedStatus: PlannedActualOutcome;
    readonly prescribedSetCount: number;
    readonly coveredSetCount: number;
}

/** A side-effect-free preview shown before completion (design 11.6; PRD UX-3 completion review). */
export interface CompletionPreview {
    readonly issues: readonly CompletionPreviewIssue[];
    readonly plannedOutcomes: readonly CompletionPreviewOutcome[];
}

/** Raised when starting from a template that does not exist or has no published prescription. */
export class TemplateUnavailableError extends ApplicationNotFoundError {
    constructor(readonly templateId: string) {
        super(`Workout template ${templateId} was not found`, { templateId });
        this.name = "TemplateUnavailableError";
    }
}

/** Raised when repeating a previous session that does not exist. */
export class PreviousSessionUnavailableError extends ApplicationNotFoundError {
    constructor(readonly sourceSessionId: string) {
        super(`Previous training session ${sourceSessionId} was not found`, { sourceSessionId });
        this.name = "PreviousSessionUnavailableError";
    }
}

/** Raised when planned/actual mapping features are used but their collaborators were not wired. */
export class PlanningNotConfiguredError extends ApplicationValidationError {
    constructor() {
        super("Planned/actual mapping support is not configured", {
            planning: ["Planned/actual mapping support is not configured"],
        });
        this.name = "PlanningNotConfiguredError";
    }
}

/** Raised when a mapping references a prescribed row absent from the session's linked prescriptions. */
export class SessionMappingOwnershipError extends ApplicationValidationError {
    constructor(
        readonly entityPath: string,
        readonly prescribedRowId: string,
    ) {
        super(`Mapping references a prescribed ${entityPath} that is not part of this session's prescriptions`, {
            [`mappings.${entityPath}`]: [`Unknown prescribed ${entityPath} '${prescribedRowId}'`],
        });
        this.name = "SessionMappingOwnershipError";
    }
}

/** Raised when starting from a planned session that has no recorded prescription or does not exist. */
export class PlannedSessionUnavailableError extends ApplicationNotFoundError {
    constructor(readonly plannedSessionId: string) {
        super(`Planned session ${plannedSessionId} was not found`, { plannedSessionId });
        this.name = "PlannedSessionUnavailableError";
    }
}

type TrainingSessionAction = "created" | "started" | "updated" | "completed" | "reopened" | "archived" | "restored";

type RecomputeMode = "complete" | "reopen" | "archive";

export class TrainingSessionCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: TrainingSessionCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Training session ID generation is not configured");
            });
    }

    async create(
        command: CreateTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        // Resolve Core/Training profile defaults through the public port (ADR 0005): the active
        // profile supplies the owner ID and the default time zone; the local date defaults to today
        // in that zone. Timer/time-zone calculation stays in the application layer, never in SQL.
        const profile = await this.runtime.profileReader.getActiveProfile();
        const now = this.clock.now();
        const timeZone = command.timeZone ?? profile.timeZone;
        const localDate = command.localDate ?? localDateInZone(now, timeZone);
        // No occurrence exists yet, so every strength occurrence resolves a fresh current snapshot.
        const activities = await this.enrichActivities(command.activities, new Map());
        const input: CreateTrainingSessionInput = {
            id: command.id ?? this.generateId(),
            profileId: profile.id,
            localDate,
            timeZone,
            title: command.title ?? null,
            sourcePlannedSessionId: command.sourcePlannedSessionId ?? null,
            notes: command.notes ?? null,
            tags: command.tags ?? [],
            readiness: command.readiness,
            postWorkout: command.postWorkout,
            activities,
            painRecords: command.painRecords,
        };
        return this.inTransaction(transaction, async activeTransaction => {
            const session = TrainingSession.create(input, now);
            await this.runtime.mutations.create({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: entityId(session.state.id),
                state: session.state,
                metadata: revisionMetadata(metadata, "Created training session"),
                events: [this.event("created", session.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(session.state.id, activeTransaction);
        });
    }

    start(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "started", metadata, transaction, session => session.start(now));
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        command: UpdateTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const sessionId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                TRAINING_SESSION_ENTITY_TYPE,
                sessionId,
                activeTransaction,
            );
            if (!stored) throw new TrainingSessionNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            // Reuse the immutable snapshots of occurrences that already exist; resolve fresh ones only
            // for new work so historical facts never silently re-point to a changed catalog version.
            const activities = await this.enrichActivities(command.activities, existingSnapshots(stored.state));
            const input: UpdateTrainingSessionInput = { ...command, activities };
            const result = await this.runtime.mutations.mutate({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: sessionId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = TrainingSession.rehydrate(state).update(input, now);
                    return {
                        state: next.state,
                        events: [this.event("updated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Updated training session"),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    /**
     * Resolve every strength occurrence's immutable exercise snapshot through the public catalog port,
     * rejecting new work against archived exercises. Occurrences already present in the session keep the
     * snapshot they were recorded with; unsupported-measurement rejection is enforced by the aggregate.
     */
    private async enrichActivities(
        activities: readonly SessionActivityCommandInput[] | undefined,
        existing: ReadonlyMap<string, { readonly exerciseId: string; readonly snapshot: ExerciseSnapshotV1 }>,
    ): Promise<readonly SessionActivityInput[] | undefined> {
        if (activities === undefined) return undefined;
        const result: SessionActivityInput[] = [];
        for (const activity of activities) {
            if (activity.type !== "strength" || activity.strength == null) {
                if (
                    activity.strength != null &&
                    ((activity.strength.occurrences?.length ?? 0) > 0 || (activity.strength.setGroups?.length ?? 0) > 0)
                )
                    throw new ApplicationValidationError("Only strength activities can carry strength detail", {
                        activities: ["Only strength activities can carry strength detail"],
                    });
                result.push({ ...activity, strength: null });
                continue;
            }
            const occurrences: ExerciseOccurrenceInput[] = [];
            for (const occurrence of activity.strength.occurrences ?? []) {
                const { exerciseId, snapshot } = await this.resolveOccurrence(occurrence, existing);
                occurrences.push({ ...occurrence, exerciseId, snapshot });
            }
            const strength: StrengthActivityInput = {
                occurrences,
                setGroups: activity.strength.setGroups ?? [],
            };
            result.push({ ...activity, strength });
        }
        return result;
    }

    private async resolveOccurrence(
        occurrence: StrengthOccurrenceCommandInput,
        existing: ReadonlyMap<string, { readonly exerciseId: string; readonly snapshot: ExerciseSnapshotV1 }>,
    ): Promise<{ exerciseId: string; snapshot: ExerciseSnapshotV1 }> {
        const prior = existing.get(occurrence.id);
        if (prior && prior.exerciseId === occurrence.exerciseId) return prior;
        const resolved = await this.runtime.catalog.resolveCurrentExercise(occurrence.exerciseId);
        if (resolved.exercise.status === "archived") throw new ArchivedExerciseError(occurrence.exerciseId);
        const snapshot = await this.runtime.catalog.currentSnapshot(resolved.resolvedExerciseId);
        return { exerciseId: resolved.resolvedExerciseId, snapshot };
    }

    complete(
        id: string,
        expectedVersion: number | undefined,
        command: CompleteTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(
            id,
            expectedVersion,
            "completed",
            metadata,
            transaction,
            session => session.complete(command, now),
            "complete",
        );
    }

    reopen(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(
            id,
            expectedVersion,
            "reopened",
            metadata,
            transaction,
            session => session.reopen(now),
            "reopen",
        );
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(
            id,
            expectedVersion,
            "archived",
            metadata,
            transaction,
            session => session.archive(now),
            "archive",
        );
    }

    /**
     * Start a training session directly from a planned session (design 11.6 steps 1–2). Freezes the exact
     * planned prescription, resolves percentage targets into an immutable resolved-execution prescription
     * when required, writes the session mapping, and moves the new session to `in_progress` — all
     * atomically. The frozen references are what every later mapping and adherence calculation resolves
     * against, so later max/equipment changes can never rewrite this session's targets.
     */
    async startPlanned(
        command: StartPlannedSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const planning = this.requirePlanning();
        const profile = await this.runtime.profileReader.getActiveProfile();
        const now = this.clock.now();
        const at = now.toISOString();
        const plannedId = validEntityId(command.plannedSessionId);
        return this.inTransaction(transaction, async activeTransaction => {
            const planned = await planning.plannedSessions.readSession(plannedId, activeTransaction);
            if (!planned) throw new PlannedSessionUnavailableError(command.plannedSessionId);
            const plannedTree = await planning.prescriptions.loadTree(planned.currentPrescriptionId, activeTransaction);
            if (!plannedTree) throw new PlannedSessionUnavailableError(command.plannedSessionId);
            const link = await this.freezeReferenceLink(
                plannedTree,
                planned.currentPrescriptionId,
                planned.profileId,
                planned.id,
                at,
                now,
                metadata,
                activeTransaction,
            );
            const timeZone = command.timeZone ?? planned.timeZone ?? profile.timeZone;
            return this.createStartedSession(
                {
                    id: command.id ?? this.generateId(),
                    profileId: planned.profileId,
                    localDate: command.localDate ?? localDateInZone(now, timeZone),
                    timeZone,
                    title: command.title ?? planned.title ?? null,
                    notes: command.notes ?? null,
                    tags: command.tags ?? [],
                    readiness: command.readiness,
                    sourcePlannedSessionId: planned.id,
                    mappings: { plannedLinks: [link] },
                },
                now,
                metadata,
                activeTransaction,
                "Started training session from plan",
            );
        });
    }

    /** Start an empty in-progress session (no plan or template) — create + start in one revision. */
    async startEmpty(
        command: StartEmptyTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const profile = await this.runtime.profileReader.getActiveProfile();
        const now = this.clock.now();
        const timeZone = command.timeZone ?? profile.timeZone;
        return this.createStartedSession(
            {
                id: command.id ?? this.generateId(),
                profileId: profile.id,
                localDate: command.localDate ?? localDateInZone(now, timeZone),
                timeZone,
                title: command.title ?? null,
                notes: command.notes ?? null,
                tags: command.tags ?? [],
                readiness: command.readiness,
            },
            now,
            metadata,
            transaction,
            "Started empty training session",
        );
    }

    /**
     * Start an in-progress session from a published workout template. The template's immutable
     * prescription is the frozen source; percentage targets resolve into an immutable resolved-execution
     * prescription just like {@link startPlanned}, but the reference link carries no planned session.
     */
    async startFromTemplate(
        command: StartTemplateTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const planning = this.requirePlanning();
        const profile = await this.runtime.profileReader.getActiveProfile();
        const now = this.clock.now();
        const at = now.toISOString();
        const templateId = validEntityId(command.templateId);
        return this.inTransaction(transaction, async activeTransaction => {
            const template = await planning.templates.readTemplate(templateId, activeTransaction);
            if (!template) throw new TemplateUnavailableError(command.templateId);
            const sourceTree = await planning.prescriptions.loadTree(
                template.currentPrescriptionId,
                activeTransaction,
            );
            if (!sourceTree) throw new TemplateUnavailableError(command.templateId);
            const link = await this.freezeReferenceLink(
                sourceTree,
                template.currentPrescriptionId,
                template.profileId,
                null,
                at,
                now,
                metadata,
                activeTransaction,
            );
            const timeZone = command.timeZone ?? profile.timeZone;
            return this.createStartedSession(
                {
                    id: command.id ?? this.generateId(),
                    profileId: profile.id,
                    localDate: command.localDate ?? localDateInZone(now, timeZone),
                    timeZone,
                    title: command.title ?? template.name ?? null,
                    notes: command.notes ?? null,
                    tags: command.tags ?? [],
                    readiness: command.readiness,
                    mappings: { plannedLinks: [link] },
                },
                now,
                metadata,
                activeTransaction,
                "Started training session from template",
            );
        });
    }

    /**
     * Start an in-progress session by repeating a previous session's performed strength work. The prior
     * session's actuals are synthesized into a fresh immutable `planned` prescription that becomes the
     * frozen reference; when there is nothing repeatable, the new session simply starts empty.
     */
    async startFromPrevious(
        command: StartPreviousTrainingSessionCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const planning = this.requirePlanning();
        const profile = await this.runtime.profileReader.getActiveProfile();
        const now = this.clock.now();
        const at = now.toISOString();
        const sourceId = validEntityId(command.sourceSessionId);
        return this.inTransaction(transaction, async activeTransaction => {
            const previous = await this.runtime.repository.readSession(sourceId, activeTransaction);
            if (!previous) throw new PreviousSessionUnavailableError(command.sourceSessionId);
            const draft = sessionToPrescriptionDraft(previous.activities);
            const plannedLinks: SessionPlannedLinkInput[] = [];
            if (draft !== null) {
                const published = await planning.publisher.publish({ draft }, metadata, activeTransaction);
                plannedLinks.push(
                    await this.freezeReferenceLink(
                        published,
                        published.id,
                        profile.id,
                        null,
                        at,
                        now,
                        metadata,
                        activeTransaction,
                    ),
                );
            }
            const timeZone = command.timeZone ?? previous.timeZone ?? profile.timeZone;
            return this.createStartedSession(
                {
                    id: command.id ?? this.generateId(),
                    profileId: profile.id,
                    localDate: command.localDate ?? localDateInZone(now, timeZone),
                    timeZone,
                    title: command.title ?? previous.title ?? null,
                    notes: command.notes ?? null,
                    tags: command.tags ?? [],
                    readiness: command.readiness,
                    ...(plannedLinks.length > 0 ? { mappings: { plannedLinks } } : {}),
                },
                now,
                metadata,
                activeTransaction,
                "Started training session from previous workout",
            );
        });
    }

    /** Append one activity to a session's ordered activity list (design 18.2). */
    addActivity(
        id: string,
        expectedVersion: number | undefined,
        command: AddSessionActivityCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        return this.mutateTree(
            id,
            expectedVersion,
            metadata,
            transaction,
            "Added session activity",
            state => ({ activities: [...stateToCommandActivities(state.activities), command.activity] }),
        );
    }

    /** Reorder a session's activities to match the supplied complete ordered list of activity IDs. */
    reorderActivities(
        id: string,
        expectedVersion: number | undefined,
        command: ReorderSessionActivitiesCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        return this.mutateTree(id, expectedVersion, metadata, transaction, "Reordered session activities", state => {
            const byId = new Map(stateToCommandActivities(state.activities).map(activity => [activity.id, activity]));
            if (command.activityIds.length !== byId.size || command.activityIds.some(activityId => !byId.has(activityId)))
                throw new ApplicationValidationError("The reorder list must contain every activity exactly once", {
                    activityIds: ["The reorder list must contain every activity exactly once"],
                });
            const activities = command.activityIds.map((activityId, index) => ({
                ...byId.get(activityId)!,
                position: index,
            }));
            return { activities };
        });
    }

    /** Substitute an occurrence's exercise and record a `substituted` occurrence mapping (PRD AC-4). */
    substituteOccurrence(
        id: string,
        expectedVersion: number | undefined,
        command: SubstituteOccurrenceCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        return this.mutateTree(id, expectedVersion, metadata, transaction, "Substituted exercise", state => {
            const activities = stateToCommandActivities(state.activities);
            const activity = activities.find(candidate => candidate.id === command.activityId);
            const occurrence = activity?.strength?.occurrences?.find(item => item.id === command.occurrenceId);
            if (!activity || !occurrence)
                throw new ApplicationValidationError("The occurrence to substitute was not found in this session", {
                    occurrenceId: ["The occurrence to substitute was not found in this session"],
                });
            const nextOccurrences = activity.strength!.occurrences!.map(item =>
                item.id === command.occurrenceId ? { ...item, exerciseId: command.newExerciseId } : item,
            );
            const nextActivities = activities.map(candidate =>
                candidate.id === command.activityId
                    ? { ...candidate, strength: { ...candidate.strength!, occurrences: nextOccurrences } }
                    : candidate,
            );
            // A `substituted` mapping needs the prescribed exercise it replaces. Use the explicit id or the
            // one an existing occurrence mapping already carries; a free swap with no plan records no mapping.
            const existing = state.occurrenceMappings.find(mapping => mapping.occurrenceId === command.occurrenceId);
            const prescribedExerciseId = command.prescribedExerciseId ?? existing?.prescribedExerciseId ?? null;
            const mappings =
                prescribedExerciseId !== null
                    ? replaceOccurrenceMapping(state, command.occurrenceId, {
                          id: this.generateId(),
                          occurrenceId: command.occurrenceId,
                          prescribedExerciseId,
                          relation: "substituted",
                          reason: command.reason ?? null,
                      })
                    : undefined;
            return { activities: nextActivities, mappings };
        });
    }

    /** Record (create or replace) one performed set inside an occurrence, with an optional mapping. */
    recordPerformedSet(
        id: string,
        expectedVersion: number | undefined,
        command: RecordPerformedSetCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        return this.mutateTree(id, expectedVersion, metadata, transaction, "Recorded performed set", state => {
            const activities = stateToCommandActivities(state.activities);
            const activity = activities.find(candidate => candidate.id === command.activityId);
            const occurrence = activity?.strength?.occurrences?.find(item => item.id === command.occurrenceId);
            if (!activity || !occurrence)
                throw new ApplicationValidationError("The occurrence for this set was not found in this session", {
                    occurrenceId: ["The occurrence for this set was not found in this session"],
                });
            const performedSets = upsertById(occurrence.performedSets ?? [], command.set);
            const nextActivities = activities.map(candidate =>
                candidate.id === command.activityId
                    ? {
                          ...candidate,
                          strength: {
                              ...candidate.strength!,
                              occurrences: candidate.strength!.occurrences!.map(item =>
                                  item.id === command.occurrenceId ? { ...item, performedSets } : item,
                              ),
                          },
                      }
                    : candidate,
            );
            const mappings =
                command.mapping != null
                    ? replaceSetMapping(state, command.set.id, {
                          id: command.mapping.id ?? this.generateId(),
                          performedSetId: command.set.id,
                          prescribedSetId: command.mapping.prescribedSetId ?? null,
                          relation: command.mapping.relation,
                          portion: command.mapping.portion ?? null,
                          reason: command.mapping.reason ?? null,
                          notes: command.mapping.notes ?? null,
                      })
                    : undefined;
            return { activities: nextActivities, mappings };
        });
    }

    /** Patch an existing performed set (found by ID across occurrences), optionally updating its mapping. */
    updatePerformedSet(
        id: string,
        expectedVersion: number | undefined,
        setId: string,
        command: UpdatePerformedSetCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const { mapping, ...patch } = command;
        return this.mutateTree(id, expectedVersion, metadata, transaction, "Updated performed set", state => {
            let found = false;
            const activities = stateToCommandActivities(state.activities).map(activity => {
                if (activity.strength == null) return activity;
                const occurrences = activity.strength.occurrences?.map(occurrence => ({
                    ...occurrence,
                    performedSets: (occurrence.performedSets ?? []).map(set => {
                        if (set.id !== setId) return set;
                        found = true;
                        return { ...set, ...patch };
                    }),
                }));
                return { ...activity, strength: { ...activity.strength, occurrences } };
            });
            if (!found)
                throw new ApplicationValidationError("The performed set to update was not found in this session", {
                    setId: ["The performed set to update was not found in this session"],
                });
            const mappings =
                mapping != null
                    ? replaceSetMapping(state, setId, {
                          id: mapping.id ?? this.generateId(),
                          performedSetId: setId,
                          prescribedSetId: mapping.prescribedSetId ?? null,
                          relation: mapping.relation,
                          portion: mapping.portion ?? null,
                          reason: mapping.reason ?? null,
                          notes: mapping.notes ?? null,
                      })
                    : undefined;
            return { activities, mappings };
        });
    }

    /**
     * Load the complete active-session view in a bounded query: the session tree plus every frozen
     * prescription it maps against (source planned/template + resolved execution), so the live UI can
     * render planned-versus-actual without extra round trips (design 18.3; PRD UX-3).
     */
    async readActiveView(id: string, transaction?: Transaction): Promise<ActiveTrainingSessionView | null> {
        const sessionId = validEntityId(id);
        const resource = await this.runtime.repository.readSession(sessionId, transaction);
        if (!resource) return null;
        const plans = await this.loadReferencePlans(resource, transaction);
        return { ...resource, plans };
    }

    /**
     * Preview a completion without mutating: surface advisory issues (empty activities, skipped/partial
     * sets, uncovered prescribed sets) and the planned-session outcome each linked plan would receive
     * (design 11.6). The UI shows this before the user leaves the active flow (PRD UX-3).
     */
    async previewCompletion(id: string, transaction?: Transaction): Promise<CompletionPreview> {
        const sessionId = validEntityId(id);
        const resource = await this.runtime.repository.readSession(sessionId, transaction);
        if (!resource) throw new TrainingSessionNotFoundError(id);
        const plans = await this.loadReferencePlans(resource, transaction);
        return { issues: completionIssues(resource, plans), plannedOutcomes: this.projectedOutcomes(resource, plans) };
    }

    /**
     * Replace the planned/actual mapping tree of a session (design 11.4). The actual side is validated by
     * the aggregate; the prescribed side is validated here against the session's linked immutable
     * prescriptions so a mapping can never reference a prescribed row from another session's plan.
     */
    async recordMappings(
        id: string,
        expectedVersion: number | undefined,
        command: RecordSessionMappingsCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const planning = this.requirePlanning();
        const sessionId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                TRAINING_SESSION_ENTITY_TYPE,
                sessionId,
                activeTransaction,
            );
            if (!stored) throw new TrainingSessionNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            await this.assertPrescribedOwnership(stored.state.plannedLinks, command, planning, activeTransaction);
            const result = await this.runtime.mutations.mutate({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: sessionId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = TrainingSession.rehydrate(state).update({ mappings: command }, now);
                    return {
                        state: next.state,
                        events: [this.event("updated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Recorded session mappings"),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    restore(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingSessionResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "restored", metadata, transaction, session => session.restore(now));
    }

    private async mutate(
        id: string,
        expectedVersion: number | undefined,
        action: TrainingSessionAction,
        metadata: TrainingSessionMutationMetadata,
        transaction: Transaction | undefined,
        apply: (session: TrainingSession) => TrainingSession,
        recompute?: RecomputeMode,
    ): Promise<TrainingSessionResource> {
        const sessionId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                TRAINING_SESSION_ENTITY_TYPE,
                sessionId,
                activeTransaction,
            );
            if (!stored) throw new TrainingSessionNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const result = await this.runtime.mutations.mutate({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: sessionId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = apply(TrainingSession.rehydrate(state));
                    return {
                        state: next.state,
                        events: [this.event(action, next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, `${capitalize(action)} training session`),
                transaction: activeTransaction,
            });
            if (recompute !== undefined)
                await this.recomputeLinkedPlans(result.state, recompute, metadata, activeTransaction);
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    /** Create a fresh session already moved to `in_progress`, persisting one revision. */
    private createStartedSession(
        input: CreateTrainingSessionInput,
        now: Date,
        metadata: TrainingSessionMutationMetadata,
        transaction: Transaction | undefined,
        summary: string,
    ): Promise<TrainingSessionResource> {
        return this.inTransaction(transaction, async activeTransaction => {
            const session = TrainingSession.create(input, now).start(now);
            await this.runtime.mutations.create({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: entityId(session.state.id),
                state: session.state,
                metadata: revisionMetadata(metadata, summary),
                events: [this.event("started", session.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(session.state.id, activeTransaction);
        });
    }

    /**
     * Freeze a prescription reference for a starting session: resolve percentage targets into an
     * immutable resolved-execution prescription when needed, and return the link binding the frozen
     * source + resolved IDs to an optional planned session.
     */
    private async freezeReferenceLink(
        sourceTree: SessionPrescriptionState,
        sourcePrescriptionId: string,
        profileId: string,
        plannedSessionId: string | null,
        at: string,
        now: Date,
        metadata: TrainingSessionMutationMetadata,
        transaction: Transaction,
    ): Promise<SessionPlannedLinkInput> {
        const planning = this.requirePlanning();
        const context = await this.buildResolutionContext(sourceTree, profileId, at);
        const resolution = resolveExecutionPrescription(sourceTree, context, this.minter(), now);
        let resolvedPrescriptionId = sourcePrescriptionId;
        if (resolution.prescription !== null) {
            const persisted = await planning.publisher.publishPreparedState(
                resolution.prescription.state,
                metadata,
                transaction,
            );
            resolvedPrescriptionId = persisted.id;
        }
        return { plannedSessionId, sourcePrescriptionId, resolvedPrescriptionId };
    }

    /**
     * Shared granular-mutation flow: load under the expected version, let a pure transform produce the
     * next activity tree and/or mapping tree, re-resolve occurrence snapshots, validate any prescribed
     * mapping references, then save through the aggregate's whole-tree update so the root version advances.
     */
    private mutateTree(
        id: string,
        expectedVersion: number | undefined,
        metadata: TrainingSessionMutationMetadata,
        transaction: Transaction | undefined,
        summary: string,
        transform: (state: TrainingSessionState) => {
            activities?: readonly SessionActivityCommandInput[];
            mappings?: SessionMappingsInput;
        },
    ): Promise<TrainingSessionResource> {
        const sessionId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                TRAINING_SESSION_ENTITY_TYPE,
                sessionId,
                activeTransaction,
            );
            if (!stored) throw new TrainingSessionNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const change = transform(stored.state);
            const activities =
                change.activities !== undefined
                    ? await this.enrichActivities(change.activities, existingSnapshots(stored.state))
                    : undefined;
            if (change.mappings !== undefined && mappingsHavePrescribedRefs(change.mappings))
                await this.assertPrescribedOwnership(
                    stored.state.plannedLinks,
                    change.mappings,
                    this.requirePlanning(),
                    activeTransaction,
                );
            const input: UpdateTrainingSessionInput = {
                ...(activities !== undefined ? { activities } : {}),
                ...(change.mappings !== undefined ? { mappings: change.mappings } : {}),
            };
            const result = await this.runtime.mutations.mutate({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: sessionId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = TrainingSession.rehydrate(state).update(input, now);
                    return {
                        state: next.state,
                        events: [this.event("updated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, summary),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    /** Load every frozen prescription this session references, batched, for the active/preview views. */
    private async loadReferencePlans(
        resource: TrainingSessionResource,
        transaction?: Transaction,
    ): Promise<readonly ActiveSessionPlan[]> {
        if (!this.runtime.planning || resource.plannedLinks.length === 0) return [];
        const ids = [...new Set(resource.plannedLinks.map(link => link.resolvedPrescriptionId))];
        const trees = await this.runtime.planning.prescriptions.loadTrees(ids, transaction);
        const byId = new Map(trees.map(tree => [tree.id, tree]));
        const plans: ActiveSessionPlan[] = [];
        for (const link of resource.plannedLinks) {
            const prescription = byId.get(link.resolvedPrescriptionId);
            if (prescription)
                plans.push({
                    referencePrescriptionId: link.resolvedPrescriptionId,
                    plannedSessionId: link.plannedSessionId,
                    prescription,
                });
        }
        return plans;
    }

    /** Project the outcome each linked planned session would receive if the session completed now. */
    private projectedOutcomes(
        resource: TrainingSessionResource,
        plans: readonly ActiveSessionPlan[],
    ): readonly CompletionPreviewOutcome[] {
        const byResolved = new Map(plans.map(plan => [plan.referencePrescriptionId, plan.prescription]));
        const outcomes: CompletionPreviewOutcome[] = [];
        for (const link of resource.plannedLinks) {
            if (link.plannedSessionId === null) continue;
            const prescription = byResolved.get(link.resolvedPrescriptionId);
            const prescribedSetIds = prescribedSetIdsOf(prescription);
            const coverage = computeCoverage(resource, prescribedSetIds);
            outcomes.push({
                plannedSessionId: link.plannedSessionId,
                currentStatus: null,
                projectedStatus: outcomeFromCoverage(prescribedSetIds.size, coverage),
                prescribedSetCount: prescribedSetIds.size,
                coveredSetCount: coverage.coveredSetIds.size,
            });
        }
        return outcomes;
    }

    /** Freeze a sync resolution context by prefetching every max + increment the tree could need. */
    private async buildResolutionContext(
        planned: SessionPrescriptionState,
        profileId: string,
        at: string,
    ): Promise<TargetResolutionContext> {
        const planning = this.requirePlanning();
        const maxes = new Map<string, { trainingMaxId: string; valueKg: string; effectiveFrom: string } | null>();
        const increments = new Map<
            string,
            { id: string; scope: string; incrementKg: string; minimumKg: string | null } | null
        >();
        for (const activity of planned.activities)
            for (const exercise of activity.strength?.exercises ?? []) {
                const bases = new Set<MaxBasis>();
                for (const set of exercise.sets) {
                    if (set.targets.percent1rm !== null) bases.add("estimated_1rm");
                    if (set.targets.percentTrainingMax !== null) bases.add("training_max");
                }
                if (bases.size === 0) continue;
                if (!increments.has(exercise.exerciseId)) {
                    const increment = await planning.increments.resolveForExercise(exercise.exerciseId);
                    increments.set(
                        exercise.exerciseId,
                        increment
                            ? {
                                  id: increment.id,
                                  scope: increment.scope,
                                  incrementKg: increment.incrementKg,
                                  minimumKg: increment.minimumKg,
                              }
                            : null,
                    );
                }
                for (const basis of bases) {
                    const key = `${exercise.exerciseId}::${basis}`;
                    if (maxes.has(key)) continue;
                    const resolved = await planning.targetContext.resolveTrainingMax({
                        profileId,
                        exerciseId: exercise.exerciseId,
                        maxType: basis,
                        customLabel: null,
                        at,
                    });
                    maxes.set(
                        key,
                        resolved
                            ? {
                                  trainingMaxId: resolved.trainingMaxId,
                                  valueKg: resolved.valueKg,
                                  effectiveFrom: resolved.effectiveFrom,
                              }
                            : null,
                    );
                }
            }
        return {
            resolveMax: ({ exerciseId, basis }) => {
                const max = maxes.get(`${exerciseId}::${basis}`);
                return max
                    ? {
                          trainingMaxId: max.trainingMaxId,
                          maxType: basis,
                          valueKg: max.valueKg,
                          effectiveFrom: max.effectiveFrom,
                      }
                    : null;
            },
            roundLoad: ({ exerciseId, loadKg }) => {
                const increment = increments.get(exerciseId);
                if (!increment) return { valueKg: loadKg, incrementId: null, incrementScope: null };
                return {
                    valueKg: roundLoadToIncrement(loadKg, increment),
                    incrementId: increment.id,
                    incrementScope: increment.scope,
                };
            },
        };
    }

    /** Validate every prescribed-side reference against the session's linked immutable prescriptions. */
    private async assertPrescribedOwnership(
        links: readonly SessionPlannedLink[],
        command: SessionMappingsInput,
        planning: TrainingSessionPlanningPorts<Transaction>,
        transaction: Transaction,
    ): Promise<void> {
        const prescriptionIds = new Set<string>();
        for (const link of links) {
            prescriptionIds.add(link.sourcePrescriptionId);
            prescriptionIds.add(link.resolvedPrescriptionId);
        }
        const trees = await planning.prescriptions.loadTrees([...prescriptionIds], transaction);
        const activityIds = new Set<string>();
        const exerciseIds = new Set<string>();
        const setIds = new Set<string>();
        const runStepIds = new Set<string>();
        for (const tree of trees)
            for (const activity of tree.activities) {
                activityIds.add(activity.id);
                for (const exercise of activity.strength?.exercises ?? []) {
                    exerciseIds.add(exercise.id);
                    for (const set of exercise.sets) setIds.add(set.id);
                }
                for (const step of activity.running?.steps ?? []) runStepIds.add(step.id);
            }
        const check = (id: string | null | undefined, owned: ReadonlySet<string>, path: string): void => {
            if (id != null && !owned.has(id)) throw new SessionMappingOwnershipError(path, id);
        };
        for (const mapping of command.activityMappings ?? [])
            check(mapping.prescribedActivityId, activityIds, "activity");
        for (const mapping of command.occurrenceMappings ?? [])
            check(mapping.prescribedExerciseId, exerciseIds, "exercise");
        for (const mapping of command.setMappings ?? []) check(mapping.prescribedSetId, setIds, "set");
        for (const mapping of command.runStepMappings ?? []) check(mapping.prescribedRunStepId, runStepIds, "runStep");
    }

    /** Recompute each linked planned session independently from this session's mappings (design 11.6). */
    private async recomputeLinkedPlans(
        state: TrainingSessionState,
        mode: RecomputeMode,
        metadata: TrainingSessionMutationMetadata,
        transaction: Transaction,
    ): Promise<void> {
        const planning = this.runtime.planning;
        if (!planning || state.plannedLinks.length === 0) return;
        for (const link of state.plannedLinks) {
            // Template/previous references carry no planned session to recompute.
            if (link.plannedSessionId === null) continue;
            const plannedSessionId = link.plannedSessionId;
            const outcome =
                mode === "archive" ? "planned" : await this.deriveOutcome(state, link, mode, planning, transaction);
            await planning.plannedCommands.recomputeOutcomeWithinTransaction(
                plannedSessionId,
                outcome,
                metadata,
                transaction,
            );
        }
    }

    private async deriveOutcome(
        state: TrainingSessionState,
        link: SessionPlannedLink,
        mode: RecomputeMode,
        planning: TrainingSessionPlanningPorts<Transaction>,
        transaction: Transaction,
    ): Promise<PlannedActualOutcome> {
        const resolved = await planning.prescriptions.loadTree(link.resolvedPrescriptionId, transaction);
        const prescribedSetIds = prescribedSetIdsOf(resolved ?? undefined);
        const coverage = computeCoverage(state, prescribedSetIds);
        if (mode === "reopen") return coverage.anyCovered ? "partially_completed" : "planned";
        return outcomeFromCoverage(prescribedSetIds.size, coverage);
    }

    private requirePlanning(): TrainingSessionPlanningPorts<Transaction> {
        if (!this.runtime.planning) throw new PlanningNotConfiguredError();
        return this.runtime.planning;
    }

    private minter(): IdMinter {
        return { rowId: () => this.generateId(), logicalKey: () => this.generateId() };
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<TrainingSessionResource> {
        const resource = await this.runtime.repository.readSession(entityId(id), transaction);
        if (!resource) throw new TrainingSessionNotFoundError(id);
        return resource;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: TrainingSessionAction,
        state: TrainingSessionState,
        aggregateRevision: number,
        metadata: TrainingSessionMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.session.${action}`,
            version: 1,
            occurredAt,
            aggregateType: TRAINING_SESSION_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                trainingSessionId: state.id,
                profileId: state.profileId,
                status: state.status,
                archived: state.archivedAt !== null,
            },
        });
    }
}

const trainingSessionRevisionResourceMapper: SnapshotResourceMapper<TrainingSessionState, TrainingSessionResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class TrainingSessionRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<TrainingSessionResource> {
    readonly entityType = TRAINING_SESSION_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<TrainingSessionState, TrainingSessionResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<TrainingSessionState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Training session event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            trainingSessionSerializer,
            trainingSessionRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<TrainingSessionResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: TrainingSessionResource }> {
        const now = this.clock.now();
        const result = await this.mutations.restore({
            entityType: this.entityType,
            entityId: input.entityId,
            restoreVersion: input.restoreVersion,
            expectedVersion: input.expectedVersion,
            metadata: input.metadata,
            events: [
                new PlatformDomainEvent({
                    id: this.generateId(),
                    name: "training.session.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: { trainingSessionId: input.entityId, restoredVersion: input.restoreVersion },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: trainingSessionRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: trainingSessionSerializer.currentSchemaVersion,
                source: "restore",
                actorId: input.metadata.actorId ?? null,
                reason: input.metadata.reason ?? null,
                summary: input.metadata.summary,
                correlationId: input.metadata.correlationId,
                createdAt: now,
            }),
        };
    }
}

/** Project the persisted activity tree back into snapshot-free command inputs for a granular edit. */
function stateToCommandActivities(activities: TrainingSessionState["activities"]): SessionActivityCommandInput[] {
    return activities.map(activity => ({
        id: activity.id,
        type: activity.type,
        position: activity.position,
        startedAt: activity.startedAt,
        endedAt: activity.endedAt,
        durationSeconds: activity.durationSeconds,
        rpe: activity.rpe,
        feeling: activity.feeling,
        notes: activity.notes,
        tags: activity.tags,
        strength: activity.strength
            ? {
                  occurrences: activity.strength.occurrences.map(occurrence => ({
                      id: occurrence.id,
                      exerciseId: occurrence.exerciseId,
                      position: occurrence.position,
                      purpose: occurrence.purpose,
                      technique: occurrence.technique,
                      discomfort: occurrence.discomfort,
                      pump: occurrence.pump,
                      notes: occurrence.notes,
                      performedSets: occurrence.performedSets,
                  })),
                  setGroups: activity.strength.setGroups,
              }
            : null,
    }));
}

/** Insert or replace an item (matched by `id`) in a list, preserving order. */
function upsertById<T extends { readonly id: string }>(items: readonly T[], next: T): T[] {
    const index = items.findIndex(item => item.id === next.id);
    if (index === -1) return [...items, next];
    return items.map((item, position) => (position === index ? next : item));
}

/** Build the full mapping input from current state, replacing any occurrence mapping for one occurrence. */
function replaceOccurrenceMapping(
    state: TrainingSessionState,
    occurrenceId: string,
    mapping: OccurrenceMappingInput,
): SessionMappingsInput {
    return {
        activityMappings: [...state.activityMappings],
        occurrenceMappings: upsertMapping(
            state.occurrenceMappings.filter(existing => existing.occurrenceId !== occurrenceId),
            mapping,
        ),
        setMappings: [...state.setMappings],
        runStepMappings: [...state.runStepMappings],
    };
}

/** Build the full mapping input from current state, replacing any set mapping for one performed set. */
function replaceSetMapping(
    state: TrainingSessionState,
    performedSetId: string,
    mapping: SetMappingInput,
): SessionMappingsInput {
    return {
        activityMappings: [...state.activityMappings],
        occurrenceMappings: [...state.occurrenceMappings],
        setMappings: upsertMapping(
            state.setMappings.filter(existing => existing.performedSetId !== performedSetId),
            mapping,
        ),
        runStepMappings: [...state.runStepMappings],
    };
}

function upsertMapping<T>(existing: readonly T[], next: T): T[] {
    return [...existing, next];
}

/** True when any level mapping carries a prescribed-side reference that must be validated for ownership. */
function mappingsHavePrescribedRefs(mappings: SessionMappingsInput): boolean {
    return (
        (mappings.activityMappings ?? []).some(mapping => mapping.prescribedActivityId != null) ||
        (mappings.occurrenceMappings ?? []).some(mapping => mapping.prescribedExerciseId != null) ||
        (mappings.setMappings ?? []).some(mapping => mapping.prescribedSetId != null) ||
        (mappings.runStepMappings ?? []).some(mapping => mapping.prescribedRunStepId != null)
    );
}

/** Collect every prescribed strength set ID in a frozen prescription tree. */
function prescribedSetIdsOf(prescription?: SessionPrescriptionState): Set<string> {
    const ids = new Set<string>();
    for (const activity of prescription?.activities ?? [])
        for (const exercise of activity.strength?.exercises ?? []) for (const set of exercise.sets) ids.add(set.id);
    return ids;
}

interface SetCoverage {
    readonly coveredSetIds: ReadonlySet<string>;
    readonly anyCovered: boolean;
}

/** Determine which prescribed sets a session's set mappings cover (partial counts as touched, not full). */
function computeCoverage(state: TrainingSessionState, prescribedSetIds: ReadonlySet<string>): SetCoverage {
    const coveredSetIds = new Set<string>();
    let anyCovered = false;
    for (const mapping of state.setMappings) {
        if (mapping.prescribedSetId === null) {
            anyCovered = true;
            continue;
        }
        if (!prescribedSetIds.has(mapping.prescribedSetId)) continue;
        anyCovered = true;
        if (mapping.relation !== "partial") coveredSetIds.add(mapping.prescribedSetId);
    }
    return { coveredSetIds, anyCovered };
}

function outcomeFromCoverage(prescribedCount: number, coverage: SetCoverage): PlannedActualOutcome {
    if (prescribedCount > 0 && coverage.coveredSetIds.size === prescribedCount) return "completed";
    return coverage.anyCovered ? "partially_completed" : "planned";
}

/** Advisory completion issues: empty activities, unfinished sets, and uncovered prescribed sets. */
function completionIssues(
    resource: TrainingSessionResource,
    plans: readonly ActiveSessionPlan[],
): CompletionPreviewIssue[] {
    const issues: CompletionPreviewIssue[] = [];
    for (const activity of resource.activities) {
        const occurrences = activity.strength?.occurrences ?? [];
        const totalSets = occurrences.reduce((sum, occurrence) => sum + occurrence.performedSets.length, 0);
        if (activity.type === "strength" && totalSets === 0)
            issues.push({
                code: "empty_activity",
                severity: "warning",
                message: "This activity has no logged sets.",
                activityId: activity.id,
                occurrenceId: null,
            });
        for (const occurrence of occurrences)
            for (const set of occurrence.performedSets)
                if (set.status === "skipped" || set.status === "partial")
                    issues.push({
                        code: `set_${set.status}`,
                        severity: "warning",
                        message:
                            set.status === "skipped"
                                ? "A set was skipped."
                                : "A set was recorded as partially completed.",
                        activityId: activity.id,
                        occurrenceId: occurrence.id,
                    });
    }
    const coveredPrescribedSetIds = new Set(
        resource.setMappings
            .filter(mapping => mapping.prescribedSetId !== null && mapping.relation !== "partial")
            .map(mapping => mapping.prescribedSetId as string),
    );
    for (const plan of plans)
        for (const setId of prescribedSetIdsOf(plan.prescription))
            if (!coveredPrescribedSetIds.has(setId))
                issues.push({
                    code: "prescribed_set_uncovered",
                    severity: "warning",
                    message: "A prescribed set has no matching performed set.",
                    activityId: null,
                    occurrenceId: null,
                });
    return issues;
}

/** Index the immutable snapshots of the occurrences currently persisted so edits can preserve them. */
function existingSnapshots(
    state: TrainingSessionState,
): ReadonlyMap<string, { readonly exerciseId: string; readonly snapshot: ExerciseSnapshotV1 }> {
    const map = new Map<string, { exerciseId: string; snapshot: ExerciseSnapshotV1 }>();
    for (const activity of state.activities)
        if (activity.strength !== null)
            for (const occurrence of activity.strength.occurrences)
                map.set(occurrence.id, { exerciseId: occurrence.exerciseId, snapshot: occurrence.snapshot });
    return map;
}

/** Format the local calendar date for an instant in the given IANA zone (design 11.6, TS-2). */
function localDateInZone(instant: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(instant);
    // en-CA formats as YYYY-MM-DD.
    return parts;
}

function revisionMetadata(metadata: TrainingSessionMutationMetadata, summary: string): RevisionMetadata {
    return {
        source: metadata.source ?? "user",
        actorId: metadata.actorId ?? null,
        reason: metadata.reason ?? null,
        summary,
        correlationId: metadata.correlationId,
    };
}

function capitalize(value: string): string {
    return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function validEntityId(value: string): EntityId {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Training session ID must be a UUID", {
            trainingSessionId: ["Training session ID must be a UUID"],
        });
    }
}
