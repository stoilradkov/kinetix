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
    type MaxBasis,
    type OccurrenceMappingInput,
    type PainRecordInput,
    type PerformedSetInput,
    type PlannedActualOutcome,
    type PostWorkoutRatings,
    type PreWorkoutReadiness,
    type RunStepMappingInput,
    type SessionPlannedLink,
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
import type { TrainingExerciseCatalogPort } from "#src/modules/training/application/exercises";
import type {
    PlannedSessionCommands,
    PlannedSessionRepository,
} from "#src/modules/training/application/planned-sessions";
import type {
    PrescriptionPublisher,
    SessionPrescriptionRepository,
} from "#src/modules/training/application/session-prescriptions";
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
    readonly publisher: Pick<PrescriptionPublisher<Transaction>, "publishPreparedState">;
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

            const context = await this.buildResolutionContext(plannedTree, planned.profileId, at);
            const resolution = resolveExecutionPrescription(plannedTree, context, this.minter(), now);
            let resolvedPrescriptionId = planned.currentPrescriptionId;
            if (resolution.prescription !== null) {
                const persisted = await planning.publisher.publishPreparedState(
                    resolution.prescription.state,
                    metadata,
                    activeTransaction,
                );
                resolvedPrescriptionId = persisted.id;
            }

            const link: SessionPlannedLink = {
                plannedSessionId: planned.id,
                sourcePrescriptionId: planned.currentPrescriptionId,
                resolvedPrescriptionId,
            };
            const timeZone = command.timeZone ?? planned.timeZone ?? profile.timeZone;
            const session = TrainingSession.create(
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
            ).start(now);
            await this.runtime.mutations.create({
                entityType: TRAINING_SESSION_ENTITY_TYPE,
                entityId: entityId(session.state.id),
                state: session.state,
                metadata: revisionMetadata(metadata, "Started training session from plan"),
                events: [this.event("started", session.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(session.state.id, activeTransaction);
        });
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
        command: RecordSessionMappingsCommand,
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
            const outcome =
                mode === "archive" ? "planned" : await this.deriveOutcome(state, link, mode, planning, transaction);
            await planning.plannedCommands.recomputeOutcomeWithinTransaction(
                link.plannedSessionId,
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
        const prescribedSetIds = new Set<string>();
        for (const activity of resolved?.activities ?? [])
            for (const exercise of activity.strength?.exercises ?? [])
                for (const set of exercise.sets) prescribedSetIds.add(set.id);
        const fullyCovered = new Set<string>();
        let anyCovered = false;
        for (const mapping of state.setMappings) {
            if (mapping.prescribedSetId === null) {
                anyCovered = true;
                continue;
            }
            if (!prescribedSetIds.has(mapping.prescribedSetId)) continue;
            anyCovered = true;
            if (mapping.relation !== "partial") fullyCovered.add(mapping.prescribedSetId);
        }
        if (mode === "reopen") return anyCovered ? "partially_completed" : "planned";
        if (prescribedSetIds.size > 0 && fullyCovered.size === prescribedSetIds.size) return "completed";
        return anyCovered ? "partially_completed" : "planned";
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
