import type { CommandContext } from "#src/platform/application/command-context";
import {
    type ClaimedOutboxEvent,
    type JobHandler,
    type JobHandlerContext,
    type JobQueue,
    type OutboxHandler,
    type OutboxHandlerContext,
    workName,
} from "#src/platform/application/durable-work";
import { ApplicationNotFoundError } from "#src/platform/application/errors";
import { hashRequest } from "#src/platform/application/request-hash";
import type { UnitOfWork } from "#src/platform/application/unit-of-work";
import type { Clock } from "#src/platform/domain/index";

import {
    ADHERENCE_FORMULA,
    RUNNING_COMPONENT_WEIGHTS_V1,
    STRENGTH_COMPONENT_WEIGHTS_V1,
    calculateSessionAdherenceV1,
    type AdherenceCalculation,
    type AdherenceComponentKey,
    type AdherenceComponentResult,
    type AdherenceExclusionReason,
    type AdherenceScope,
    type SessionActivityState,
    type SessionAdherenceInput,
    type SessionMappingsState,
    type SessionPlannedLink,
    type SessionPrescriptionState,
} from "#src/modules/training/domain/index";

// -------------------------------------------------------------------------------------------------
// DI tokens
// -------------------------------------------------------------------------------------------------

export const ADHERENCE_RESULT_REPOSITORY = Symbol("ADHERENCE_RESULT_REPOSITORY");
export const ADHERENCE_INPUT_READER = Symbol("ADHERENCE_INPUT_READER");
export const CALCULATE_ADHERENCE = Symbol("CALCULATE_ADHERENCE");
export const ADHERENCE_RESULT_ENTITY_TYPE = "training.adherence-result";

/** Durable job type recalculated when a session's facts, mappings, or plan change (design §16.3, §17). */
export const ADHERENCE_RECALCULATE_JOB = "adherence.recalculate";
export const ADHERENCE_RECALCULATE_JOB_VERSION = 1;

// -------------------------------------------------------------------------------------------------
// Application-facing views (mirror the wire contract; the application never imports @kinetix/types)
// -------------------------------------------------------------------------------------------------

export interface AdherenceComponentView {
    readonly key: AdherenceComponentKey;
    readonly scope: AdherenceScope;
    readonly score: number | null;
    readonly weight: number;
    readonly included: boolean;
    readonly exclusion: AdherenceExclusionReason | null;
    readonly inputs: Readonly<Record<string, unknown>>;
}

export interface AdherenceResultView {
    readonly id: string;
    readonly trainingSessionId: string;
    readonly trainingSessionVersion: number;
    readonly plannedSessionId: string | null;
    readonly sourcePrescriptionId: string;
    readonly resolvedPrescriptionId: string;
    readonly formula: string;
    readonly scope: AdherenceScope;
    readonly overall: number | null;
    readonly sourceFingerprint: string;
    readonly components: readonly AdherenceComponentView[];
    readonly exclusions: readonly AdherenceExclusionReason[];
    readonly calculatedAt: Date;
}

export interface SessionAdherenceView {
    readonly trainingSessionId: string;
    readonly results: readonly AdherenceResultView[];
}

export interface AdherenceFormulaComponentMetadata {
    readonly key: AdherenceComponentKey;
    readonly scope: AdherenceScope;
    readonly weight: number;
    readonly label: string;
}

export interface AdherenceFormulaMetadata {
    readonly schemaVersion: 1;
    readonly formula: typeof ADHERENCE_FORMULA;
    readonly scoring: string;
    readonly strengthComponents: readonly AdherenceFormulaComponentMetadata[];
    readonly runningComponents: readonly AdherenceFormulaComponentMetadata[];
}

// -------------------------------------------------------------------------------------------------
// Capability ports
// -------------------------------------------------------------------------------------------------

/** Everything one adherence calculation needs, loaded from a bounded session/prescription tree read. */
export interface AdherenceSessionInputs {
    readonly sessionId: string;
    readonly profileId: string;
    readonly version: number;
    readonly plannedLinks: readonly SessionPlannedLink[];
    readonly activities: readonly SessionActivityState[];
    readonly mappings: SessionMappingsState;
    /** Resolved-execution prescription trees keyed by id — one per distinct planned link. */
    readonly resolvedPrescriptions: ReadonlyMap<string, SessionPrescriptionState>;
}

/**
 * Read-only, mapping-aware port over the completed session, its mappings, and the resolved prescription
 * trees it fulfils. Infrastructure loads these in bounded round-trips; rows never escape the boundary.
 */
export interface AdherenceInputReader<Transaction = unknown> {
    loadInputs(sessionId: string, transaction?: Transaction): Promise<AdherenceSessionInputs | null>;
    /** The actual sessions linked to a planned session — the adherence scopes a plan change invalidates. */
    findSessionIdsForPlan(plannedSessionId: string, transaction?: Transaction): Promise<readonly string[]>;
}

/** One persisted component row (projection). */
export interface AdherenceComponentRecord extends AdherenceComponentView {
    readonly position: number;
}

/** One persisted result row plus its components (projection); `calculatedAt` is stamped by the service. */
export interface AdherenceResultRecord {
    readonly id: string;
    readonly profileId: string;
    readonly trainingSessionId: string;
    readonly trainingSessionVersion: number;
    readonly plannedSessionId: string | null;
    readonly sourcePrescriptionId: string;
    readonly resolvedPrescriptionId: string;
    readonly formula: string;
    readonly scope: AdherenceScope;
    readonly overall: number | null;
    readonly sourceFingerprint: string;
    readonly exclusions: readonly AdherenceExclusionReason[];
    readonly calculatedAt: Date;
    readonly components: readonly AdherenceComponentRecord[];
}

/**
 * Idempotent projection port for adherence results. `replaceForSession` supersedes the current results
 * for a session and writes the new current set in one transaction; `currentFingerprints` lets the
 * service skip a rewrite when nothing changed (design §16.3 fingerprint uniqueness).
 */
export interface AdherenceResultRepository<Transaction = unknown> {
    readForSession(sessionId: string, transaction?: Transaction): Promise<readonly AdherenceResultView[]>;
    currentFingerprints(sessionId: string, transaction?: Transaction): Promise<ReadonlyMap<string, string>>;
    replaceForSession(
        sessionId: string,
        results: readonly AdherenceResultRecord[],
        transaction: Transaction,
    ): Promise<readonly AdherenceResultView[]>;
}

// -------------------------------------------------------------------------------------------------
// Calculator registry (design §16.1: rules are code-registered and versioned)
// -------------------------------------------------------------------------------------------------

export interface AdherenceCalculator {
    readonly name: string;
    readonly version: number;
    calculate(input: SessionAdherenceInput): AdherenceCalculation;
}

/** `name.vN`-keyed registry of pure adherence calculators; the overall v1 policy is registered by default. */
export class AdherenceCalculatorRegistry {
    private readonly calculators = new Map<string, AdherenceCalculator>();

    constructor() {
        this.register({ name: "adherence.overall", version: 1, calculate: calculateSessionAdherenceV1 });
    }

    register(calculator: AdherenceCalculator): void {
        const key = workName(calculator.name, calculator.version);
        if (this.calculators.has(key)) throw new Error(`Adherence calculator ${key} is already registered`);
        this.calculators.set(key, calculator);
    }

    /** Resolve a calculator by its `name.vN` formula string (e.g. `adherence.overall.v1`). */
    get(formula: string): AdherenceCalculator {
        const calculator = this.calculators.get(formula);
        if (calculator === undefined) throw new Error(`No adherence calculator is registered for ${formula}`);
        return calculator;
    }
}

// -------------------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------------------

export class AdherenceInputsUnavailableError extends ApplicationNotFoundError {
    constructor(readonly trainingSessionId: string) {
        super(`Training session ${trainingSessionId} was not found for adherence calculation`, { trainingSessionId });
        this.name = "AdherenceInputsUnavailableError";
    }
}

// -------------------------------------------------------------------------------------------------
// CalculateAdherence orchestration
// -------------------------------------------------------------------------------------------------

export interface CalculateAdherenceCommand {
    readonly sessionId: string;
    /** Formula override (`name.vN`); defaults to the current `adherence.overall.v1`. */
    readonly formula?: string;
}

interface CalculateAdherenceRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly reader: AdherenceInputReader<Transaction>;
    readonly repository: AdherenceResultRepository<Transaction>;
    readonly registry: AdherenceCalculatorRegistry;
    readonly generateId: () => string;
    readonly clock?: Clock;
}

/**
 * Loads the exact planned/resolved/actual revisions for a session and calculates one independent
 * adherence result per linked planned prescription (design §16.7; PRD AD-2). Results persist through the
 * projection port idempotently: a fingerprint that matches the current result short-circuits the
 * rewrite so replaying the same facts is a no-op.
 */
export class CalculateAdherence<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: CalculateAdherenceRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
    }

    async recalculateForSession(
        command: CalculateAdherenceCommand,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<SessionAdherenceView> {
        return this.inTransaction(transaction, async activeTransaction => {
            const inputs = await this.runtime.reader.loadInputs(command.sessionId, activeTransaction);
            if (inputs === null) throw new AdherenceInputsUnavailableError(command.sessionId);

            const formula = command.formula ?? ADHERENCE_FORMULA;
            const calculator = this.runtime.registry.get(formula);
            const resolvedFormula = workName(calculator.name, calculator.version);
            const now = this.clock.now();

            const records: AdherenceResultRecord[] = [];
            for (const link of inputs.plannedLinks) {
                const resolved = inputs.resolvedPrescriptions.get(link.resolvedPrescriptionId);
                if (resolved === undefined) continue; // resolved tree unavailable — cannot score this link
                const mappings = filterMappingsForTree(inputs.mappings, resolved);
                const calculation = calculator.calculate({ resolved, actualActivities: inputs.activities, mappings });
                const fingerprint = hashRequest({
                    version: inputs.version,
                    formula: resolvedFormula,
                    plannedSessionId: link.plannedSessionId,
                    sourcePrescriptionId: link.sourcePrescriptionId,
                    resolvedPrescriptionId: link.resolvedPrescriptionId,
                });
                records.push(
                    toRecord(inputs, link, calculation, resolvedFormula, fingerprint, now, this.runtime.generateId),
                );
            }

            const current = await this.runtime.repository.currentFingerprints(command.sessionId, activeTransaction);
            if (fingerprintsUnchanged(records, current)) {
                const existing = await this.runtime.repository.readForSession(command.sessionId, activeTransaction);
                return { trainingSessionId: command.sessionId, results: existing };
            }

            const results = await this.runtime.repository.replaceForSession(
                command.sessionId,
                records,
                activeTransaction,
            );
            return { trainingSessionId: command.sessionId, results };
        });
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }
}

// -------------------------------------------------------------------------------------------------
// Formula-display metadata (stable, versioned, no persistence access)
// -------------------------------------------------------------------------------------------------

const COMPONENT_LABELS: Record<AdherenceComponentKey, string> = {
    session_completion: "Session completion",
    activity_completion: "Activity completion",
    exercise_completion: "Exercise completion / substitution",
    set_completion: "Set completion",
    reps: "Repetitions",
    load: "Load",
    volume: "External-load volume",
    duration: "Duration",
    distance: "Distance",
    pace: "Pace / power",
    step_completion: "Step completion",
    intensity: "RPE / RIR intensity",
};

export function adherenceFormulaMetadata(): AdherenceFormulaMetadata {
    return {
        schemaVersion: 1,
        formula: ADHERENCE_FORMULA,
        scoring:
            "Each component scores 0–100: an actual value inside the target range scores 100, otherwise it " +
            "scores a linear penalty against the nearest violated boundary in canonical units. Missing or " +
            "non-comparable components are excluded and the remaining weights renormalised; cancelled work is " +
            "excluded from the denominator; added work is reported as divergence and never lowers completion. " +
            "Mixed sessions weight activities by planned expected duration when every activity provides it, " +
            "otherwise equally.",
        strengthComponents: formulaComponents(STRENGTH_COMPONENT_WEIGHTS_V1, "strength"),
        runningComponents: formulaComponents(RUNNING_COMPONENT_WEIGHTS_V1, "running"),
    };
}

function formulaComponents(
    weights: Readonly<Record<string, number>>,
    scope: AdherenceScope,
): AdherenceFormulaComponentMetadata[] {
    return Object.entries(weights).map(([key, weight]) => ({
        key: key as AdherenceComponentKey,
        scope: key === "session_completion" ? "session" : scope,
        weight,
        label: COMPONENT_LABELS[key as AdherenceComponentKey],
    }));
}

// -------------------------------------------------------------------------------------------------
// Durable work: job handler + outbox handlers
// -------------------------------------------------------------------------------------------------

/** Runs {@link CalculateAdherence} for one session inside the worker's transaction (idempotent). */
export class AdherenceRecalculationJobHandler<Transaction = unknown> implements JobHandler<Transaction> {
    readonly name = "adherence.recalculation-job";
    readonly jobType = ADHERENCE_RECALCULATE_JOB;
    readonly jobVersion = ADHERENCE_RECALCULATE_JOB_VERSION;

    constructor(private readonly calculate: CalculateAdherence<Transaction>) {}

    async handle(
        job: { readonly payload: Readonly<Record<string, unknown>>; readonly correlationId: string },
        context: JobHandlerContext<Transaction>,
    ): Promise<void> {
        const sessionId = requireString(job.payload.trainingSessionId, "trainingSessionId");
        await this.calculate.recalculateForSession(
            { sessionId },
            { correlationId: job.correlationId, source: "system" },
            context.transaction,
        );
    }
}

/** Enqueue payload shared by every adherence trigger; the session id keys idempotent coalescing. */
function recalculateJob(sessionId: string, event: ClaimedOutboxEvent) {
    return {
        type: ADHERENCE_RECALCULATE_JOB,
        version: ADHERENCE_RECALCULATE_JOB_VERSION,
        payload: { trainingSessionId: sessionId },
        idempotencyKey: `${ADHERENCE_RECALCULATE_JOB}:${sessionId}`,
        correlationId: event.correlationId,
        causationId: event.id,
    };
}

/**
 * Subscribes to a training-session or mapping fact and queues an adherence recompute when the event's
 * invalidation metadata marks adherence stale (design §16.3). One instance is registered per event name.
 */
export class SessionAdherenceOutboxHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    readonly name = "adherence.session-invalidation";
    readonly eventVersion = 1;

    constructor(
        readonly eventName: string,
        private readonly queue: JobQueue<Transaction>,
    ) {}

    async handle(event: ClaimedOutboxEvent, context: OutboxHandlerContext<Transaction>): Promise<void> {
        if (!adherenceInvalidated(event.payload)) return;
        const sessionId = optionalString(event.payload.trainingSessionId) ?? event.aggregateId;
        if (sessionId === null) return;
        await this.queue.enqueue(recalculateJob(sessionId, event), context.transaction);
    }
}

/** Subscribes to a planned-session change and fans out a recompute for every actual session it links. */
export class PlannedSessionAdherenceOutboxHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    readonly name = "adherence.plan-invalidation";
    readonly eventVersion = 1;

    constructor(
        readonly eventName: string,
        private readonly queue: JobQueue<Transaction>,
        private readonly reader: Pick<AdherenceInputReader<Transaction>, "findSessionIdsForPlan">,
    ) {}

    async handle(event: ClaimedOutboxEvent, context: OutboxHandlerContext<Transaction>): Promise<void> {
        const plannedSessionId = optionalString(event.payload.plannedSessionId) ?? event.aggregateId;
        if (plannedSessionId === null) return;
        const sessionIds = await this.reader.findSessionIdsForPlan(plannedSessionId, context.transaction);
        for (const sessionId of sessionIds)
            await this.queue.enqueue(recalculateJob(sessionId, event), context.transaction);
    }
}

/** Session/mapping events whose adherence recompute is driven by their `invalidation.adherence` flag. */
export const ADHERENCE_SESSION_EVENT_NAMES = [
    "training.session.completed",
    "training.session.revised",
    "training.session.reopened",
    "training.session.archived",
    "training.session.restored",
    "training.mapping.changed",
] as const;

/** Planned-session events that move adherence coverage for the actual sessions linked to a plan. */
export const ADHERENCE_PLAN_EVENT_NAMES = [
    "training.planned-session.updated",
    "training.planned-session.recomputed",
] as const;

// -------------------------------------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------------------------------------

function toRecord(
    inputs: AdherenceSessionInputs,
    link: SessionPlannedLink,
    calculation: AdherenceCalculation,
    formula: string,
    fingerprint: string,
    now: Date,
    generateId: () => string,
): AdherenceResultRecord {
    return {
        id: generateId(),
        profileId: inputs.profileId,
        trainingSessionId: inputs.sessionId,
        trainingSessionVersion: inputs.version,
        plannedSessionId: link.plannedSessionId,
        sourcePrescriptionId: link.sourcePrescriptionId,
        resolvedPrescriptionId: link.resolvedPrescriptionId,
        formula,
        scope: calculation.scope,
        overall: calculation.overall,
        sourceFingerprint: fingerprint,
        exclusions: calculation.exclusions,
        calculatedAt: now,
        components: calculation.components.map((component, position) => ({ ...toView(component), position })),
    };
}

function toView(component: AdherenceComponentResult): AdherenceComponentView {
    return {
        key: component.key,
        scope: component.scope,
        score: component.score,
        weight: component.weight,
        included: component.included,
        exclusion: component.exclusion,
        inputs: component.inputs,
    };
}

/** Restrict session-wide mappings to the rows belonging to one resolved prescription tree (plus added work). */
function filterMappingsForTree(
    mappings: SessionMappingsState,
    resolved: SessionPrescriptionState,
): SessionMappingsState {
    const ids = treeRowIds(resolved);
    return {
        plannedLinks: [],
        activityMappings: mappings.activityMappings.filter(
            mapping => mapping.prescribedActivityId === null || ids.activities.has(mapping.prescribedActivityId),
        ),
        occurrenceMappings: mappings.occurrenceMappings.filter(
            mapping => mapping.prescribedExerciseId === null || ids.exercises.has(mapping.prescribedExerciseId),
        ),
        setMappings: mappings.setMappings.filter(
            mapping => mapping.prescribedSetId === null || ids.sets.has(mapping.prescribedSetId),
        ),
        runStepMappings: mappings.runStepMappings.filter(
            mapping => mapping.prescribedRunStepId === null || ids.runSteps.has(mapping.prescribedRunStepId),
        ),
    };
}

function treeRowIds(resolved: SessionPrescriptionState): {
    readonly activities: Set<string>;
    readonly exercises: Set<string>;
    readonly sets: Set<string>;
    readonly runSteps: Set<string>;
} {
    const activities = new Set<string>();
    const exercises = new Set<string>();
    const sets = new Set<string>();
    const runSteps = new Set<string>();
    for (const activity of resolved.activities) {
        activities.add(activity.id);
        for (const exercise of activity.strength?.exercises ?? []) {
            exercises.add(exercise.id);
            for (const set of exercise.sets) sets.add(set.id);
        }
        for (const step of activity.running?.steps ?? []) runSteps.add(step.id);
    }
    return { activities, exercises, sets, runSteps };
}

function fingerprintsUnchanged(
    records: readonly AdherenceResultRecord[],
    current: ReadonlyMap<string, string>,
): boolean {
    if (records.length !== current.size) return false;
    return records.every(record => current.get(record.resolvedPrescriptionId) === record.sourceFingerprint);
}

function adherenceInvalidated(payload: Readonly<Record<string, unknown>>): boolean {
    const invalidation = payload.invalidation;
    return (
        typeof invalidation === "object" &&
        invalidation !== null &&
        (invalidation as Record<string, unknown>).adherence === true
    );
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`Adherence job payload is missing ${field}`);
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}
