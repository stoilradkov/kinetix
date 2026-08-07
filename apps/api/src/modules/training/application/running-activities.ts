import { entityId, type EntityId } from "#src/platform/domain/index";
import { ApplicationNotFoundError, ApplicationValidationError, type UnitOfWork } from "#src/platform/application/index";
import type {
    ActivityMappingState,
    PainRecordInput,
    PostWorkoutRatings,
    PreWorkoutReadiness,
    RunningActivityInput,
    RunningActivityState,
    RunStepMappingState,
    SessionActivityState,
    SessionPlannedLink,
    TrainingSessionStatus,
} from "#src/modules/training/domain/index";
import type {
    CreateTrainingSessionCommand,
    RecordSessionMappingsCommand,
    TrainingSessionCommands,
    TrainingSessionMutationMetadata,
    TrainingSessionRepository,
    TrainingSessionResource,
} from "#src/modules/training/application/training-sessions";

export const RUNNING_ACTIVITY_SERVICE = Symbol("RUNNING_ACTIVITY_SERVICE");
export const RUNNING_ACTIVITY_QUERIES = Symbol("RUNNING_ACTIVITY_QUERIES");

/**
 * Run-centric application facade (design §18–19; PRD R3). It gives clients (`kin run`, the web
 * `/training/runs` page) an ergonomic surface for manual and mixed run/strength workouts while
 * delegating every write to {@link TrainingSessionCommands}: a run is always one running activity inside
 * the versioned TrainingSession root, so there is no parallel running persistence path. Bounded list
 * reads go through the {@link RunningActivityQueries} query port (§18.3 query separation).
 */

/** Full run-centric detail read: the enclosing session's metadata plus one run activity and its mappings. */
export interface RunView {
    readonly sessionId: string;
    readonly version: number;
    readonly activityId: string;
    readonly localDate: string;
    readonly timeZone: string;
    readonly status: TrainingSessionStatus;
    readonly title: string | null;
    readonly archivedAt: string | null;
    readonly durationSeconds: number | null;
    readonly rpe: number | null;
    readonly feeling: string | null;
    readonly notes: string | null;
    readonly tags: readonly string[];
    readonly running: RunningActivityState;
    /** The `matched`/`substituted`/… mapping of this run activity to a prescribed activity, if any. */
    readonly activityMapping: ActivityMappingState | null;
    /** Mappings of this run's performed steps to prescribed run steps (one-to-many/many-to-one). */
    readonly runStepMappings: readonly RunStepMappingState[];
    readonly plannedLinks: readonly SessionPlannedLink[];
}

/** Bounded run-list projection (design §18.3): scalar metadata + canonical distance/moving time. */
export interface RunListItem {
    readonly sessionId: string;
    readonly activityId: string;
    readonly version: number;
    readonly localDate: string;
    readonly status: TrainingSessionStatus;
    readonly title: string | null;
    readonly archivedAt: string | null;
    readonly distanceMetres: string | null;
    readonly movingTimeMs: string | null;
    readonly runTags: readonly string[];
}

export interface RunListFilter {
    readonly includeArchived?: boolean;
}

/** Query port over the bounded run-list projection; the write repository never becomes a read path. */
export interface RunningActivityQueries<Transaction = unknown> {
    listRuns(filter?: RunListFilter, transaction?: Transaction): Promise<readonly RunListItem[]>;
}

/** Create and complete a manual run (a session with one running activity) in one call (design §19). */
export interface AddRunCommand {
    readonly localDate?: string;
    readonly timeZone?: string;
    readonly title?: string | null;
    readonly readiness?: Partial<PreWorkoutReadiness>;
    readonly postWorkout?: Partial<PostWorkoutRatings>;
    readonly activityId?: string;
    readonly durationSeconds?: number | null;
    readonly rpe?: number | null;
    readonly feeling?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly running: RunningActivityInput;
    readonly painRecords?: readonly PainRecordInput[];
    readonly mappings?: RecordSessionMappingsCommand;
}

/** Replace a run's summary/structured detail (and optionally its plan mappings) for one activity. */
export interface UpdateRunCommand {
    readonly running: RunningActivityInput;
    readonly mappings?: RecordSessionMappingsCommand;
}

/** Raised when a session has no running activity (or not the requested one) to show or update. */
export class RunActivityNotFoundError extends ApplicationNotFoundError {
    constructor(
        readonly trainingSessionId: string,
        readonly runActivityId?: string,
    ) {
        super(
            runActivityId
                ? `Running activity ${runActivityId} was not found in session ${trainingSessionId}`
                : `No running activity was found in session ${trainingSessionId}`,
            { trainingSessionId, activityId: runActivityId ?? null },
        );
        this.name = "RunActivityNotFoundError";
    }
}

interface RunningActivityServiceRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly sessions: TrainingSessionCommands<Transaction>;
    readonly repository: Pick<TrainingSessionRepository<Transaction>, "readSession">;
    readonly queries: RunningActivityQueries<Transaction>;
    readonly generateId?: () => string;
}

export class RunningActivityService<Transaction = unknown> {
    private readonly generateId: () => string;

    constructor(private readonly runtime: RunningActivityServiceRuntime<Transaction>) {
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Run activity ID generation is not configured");
            });
    }

    /**
     * Log a manual run: create a session carrying one running activity, start it, optionally record its
     * plan mappings, then complete it — all in one transaction (three revisions: created/started/
     * completed). Reuses the TrainingSession lifecycle so a run and a strength workout are recorded and
     * invalidated identically.
     */
    async addRun(
        command: AddRunCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<RunView> {
        const activityId = command.activityId ?? this.generateId();
        const create: CreateTrainingSessionCommand = {
            localDate: command.localDate,
            timeZone: command.timeZone,
            title: command.title ?? null,
            tags: command.tags,
            readiness: command.readiness,
            postWorkout: command.postWorkout,
            activities: [
                {
                    id: activityId,
                    type: "running",
                    position: 0,
                    durationSeconds: command.durationSeconds,
                    rpe: command.rpe,
                    feeling: command.feeling,
                    notes: command.notes,
                    tags: command.tags,
                    strength: null,
                    running: command.running,
                },
            ],
            painRecords: command.painRecords,
        };
        return this.inTransaction(transaction, async tx => {
            const created = await this.runtime.sessions.create(create, metadata, tx);
            let current = await this.runtime.sessions.start(created.id, created.version, metadata, tx);
            if (command.mappings)
                current = await this.runtime.sessions.recordMappings(
                    created.id,
                    current.version,
                    command.mappings,
                    metadata,
                    tx,
                );
            const completed = await this.runtime.sessions.complete(created.id, current.version, {}, metadata, tx);
            return this.viewOf(completed, activityId);
        });
    }

    /**
     * Replace one run activity's summary/structured detail via the whole-payload running command, then
     * (optionally) replace its plan mappings, in one transaction so the version chains cleanly. Editing a
     * completed run reopens it, applies the edit, and re-completes it (design 11.6 step 5–6), so a logged
     * run stays correctable while its adherence/analytics are re-derived exactly like a strength session.
     */
    async updateRun(
        sessionId: string,
        activityId: string,
        expectedVersion: number | undefined,
        command: UpdateRunCommand,
        metadata: TrainingSessionMutationMetadata,
        transaction?: Transaction,
    ): Promise<RunView> {
        return this.inTransaction(transaction, async tx => {
            const before = await this.runtime.repository.readSession(validId(sessionId), tx);
            const target = before?.activities.find(candidate => candidate.id === activityId);
            if (!before || !target || target.type !== "running")
                throw new RunActivityNotFoundError(sessionId, activityId);
            const wasCompleted = before.status === "completed";
            let version = expectedVersion;
            if (wasCompleted) {
                const reopened = await this.runtime.sessions.reopen(sessionId, version, metadata, tx);
                version = reopened.version;
            }
            let current = await this.runtime.sessions.setRunning(
                sessionId,
                version,
                { activityId, running: command.running },
                metadata,
                tx,
            );
            if (command.mappings)
                current = await this.runtime.sessions.recordMappings(
                    sessionId,
                    current.version,
                    command.mappings,
                    metadata,
                    tx,
                );
            if (wasCompleted)
                current = await this.runtime.sessions.complete(sessionId, current.version, {}, metadata, tx);
            return this.viewOf(current, activityId);
        });
    }

    /** Bounded run-centric read of one running activity in a session (its plan mappings included). */
    async showRun(sessionId: string, activityId?: string, transaction?: Transaction): Promise<RunView | null> {
        const resource = await this.runtime.repository.readSession(validId(sessionId), transaction);
        if (!resource) return null;
        const activity = pickRunning(resource, activityId);
        if (!activity) return null;
        return buildView(resource, activity);
    }

    /** Bounded run list across sessions (design §18.3 query separation). */
    listRuns(filter?: RunListFilter, transaction?: Transaction): Promise<readonly RunListItem[]> {
        return this.runtime.queries.listRuns(filter, transaction);
    }

    private viewOf(resource: TrainingSessionResource, activityId: string): RunView {
        const activity = resource.activities.find(candidate => candidate.id === activityId);
        if (!activity || activity.type !== "running" || activity.running === null)
            throw new RunActivityNotFoundError(resource.id, activityId);
        return buildView(resource, activity);
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }
}

/** Choose the running activity to view: the requested one, else the session's first running activity. */
function pickRunning(resource: TrainingSessionResource, activityId?: string): SessionActivityState | undefined {
    if (activityId != null)
        return resource.activities.find(
            candidate => candidate.id === activityId && candidate.type === "running" && candidate.running !== null,
        );
    return resource.activities.find(candidate => candidate.type === "running" && candidate.running !== null);
}

/** Build the run view: session metadata + this activity's running detail and the mappings that touch it. */
function buildView(resource: TrainingSessionResource, activity: SessionActivityState): RunView {
    const running = activity.running!;
    const stepIds = new Set(running.steps.map(step => step.id));
    return {
        sessionId: resource.id,
        version: resource.version,
        activityId: activity.id,
        localDate: resource.localDate,
        timeZone: resource.timeZone,
        status: resource.status,
        title: resource.title,
        archivedAt: resource.archivedAt,
        durationSeconds: activity.durationSeconds,
        rpe: activity.rpe,
        feeling: activity.feeling,
        notes: activity.notes,
        tags: activity.tags,
        running,
        activityMapping: resource.activityMappings.find(mapping => mapping.actualActivityId === activity.id) ?? null,
        runStepMappings: resource.runStepMappings.filter(mapping => stepIds.has(mapping.performedRunStepId)),
        plannedLinks: resource.plannedLinks,
    };
}

function validId(value: string): EntityId {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Training session ID must be a UUID", {
            trainingSessionId: ["Training session ID must be a UUID"],
        });
    }
}
