import type { CommandContext } from "#src/platform/application/command-context";
import {
    type ClaimedJob,
    type ClaimedOutboxEvent,
    type JobHandler,
    type JobHandlerContext,
    type JobQueue,
    type OutboxHandler,
    type OutboxHandlerContext,
} from "#src/platform/application/durable-work";
import { ApplicationNotFoundError } from "#src/platform/application/errors";
import { hashRequest } from "#src/platform/application/request-hash";
import type { UnitOfWork } from "#src/platform/application/unit-of-work";
import type { Clock } from "#src/platform/domain/index";

import {
    buildEvaluationFingerprintSeed,
    canonicalMetricKey,
    evaluateProgressionRule,
    type ActionV1,
    type ConditionEvaluation,
    type MetricFact,
    type MetricLookup,
    type PerformedSetState,
    type ProgressionActionType,
    type ProgressionMetricKey,
    type ProgressionEvaluationStatus,
    type ProposedProgressionAction,
    type RuleScope,
    type RuleTarget,
    type RuleTrigger,
    type TrainingSessionState,
} from "#src/modules/training/domain/index";
import type { ProgressionRuleResource } from "#src/modules/training/application/progression-rules";

// -------------------------------------------------------------------------------------------------
// DI tokens
// -------------------------------------------------------------------------------------------------

export const PROGRESSION_EVALUATION_REPOSITORY = Symbol("PROGRESSION_EVALUATION_REPOSITORY");
export const PROGRESSION_CONTEXT_READER = Symbol("PROGRESSION_CONTEXT_READER");
export const APPLICABLE_PROGRESSION_RULE_READER = Symbol("APPLICABLE_PROGRESSION_RULE_READER");
export const EVALUATE_PROGRESSION = Symbol("EVALUATE_PROGRESSION");
export const PROGRESSION_EVALUATION_ENTITY_TYPE = "training.progression-evaluation";

/** Durable job that evaluates applicable rules for one completed session (design §15.3, §17). */
export const PROGRESSION_EVALUATE_JOB = "progression.evaluate";
export const PROGRESSION_EVALUATE_JOB_VERSION = 1;

// -------------------------------------------------------------------------------------------------
// Application-facing views (mirror the wire contract; the application never imports @kinetix/types)
// -------------------------------------------------------------------------------------------------

export interface ProgressionEvaluationActionView {
    readonly position: number;
    readonly actionType: ProgressionActionType;
    readonly action: ActionV1;
    readonly status: "proposed";
}

export interface ProgressionEvaluationView {
    readonly id: string;
    readonly profileId: string;
    readonly ruleId: string;
    readonly ruleVersion: number;
    readonly ruleName: string;
    readonly trainingSessionId: string;
    readonly trainingSessionVersion: number;
    readonly trigger: RuleTrigger;
    readonly scopeType: RuleScope["type"];
    readonly scopeId: string;
    readonly target: RuleTarget;
    readonly matched: boolean;
    readonly status: ProgressionEvaluationStatus;
    readonly explanation: ConditionEvaluation;
    readonly missingMetrics: readonly string[];
    readonly contextRevisions: Readonly<Record<string, number>>;
    readonly contextFacts: Readonly<Record<string, MetricFact>>;
    readonly contextFingerprint: string;
    readonly actions: readonly ProgressionEvaluationActionView[];
    readonly evaluatedAt: Date;
}

// -------------------------------------------------------------------------------------------------
// Capability ports
// -------------------------------------------------------------------------------------------------

/** The logical scopes a completed session belongs to, resolved once for rule-scope matching. */
export interface SessionScopeChain {
    readonly programIds: readonly string[];
    readonly blockIds: readonly string[];
    readonly templateIds: readonly string[];
    readonly exerciseLogicalKeys: readonly string[];
    readonly setLogicalKeys: readonly string[];
}

/** Cheap subject facts plus the resolved scope chain; the full session state feeds fact derivation. */
export interface ProgressionEvaluationSubject {
    readonly sessionId: string;
    readonly profileId: string;
    readonly sessionVersion: number;
    readonly completed: boolean;
    readonly scope: SessionScopeChain;
}

/**
 * Read-only port over a completed session's identity, scope chain, and full state. Infrastructure
 * loads these in bounded round-trips; the application derives an immutable metric snapshot from the
 * returned state so the pure evaluator never touches a database (design §15.3).
 */
export interface ProgressionContextReader<Transaction = unknown> {
    loadSubject(
        sessionId: string,
        transaction?: Transaction,
    ): Promise<{ readonly subject: ProgressionEvaluationSubject; readonly session: TrainingSessionState } | null>;
}

/** Efficient applicable-rule queries by trigger (enabled + active) and by id (design §21). */
export interface ApplicableProgressionRuleReader<Transaction = unknown> {
    findEnabledByTrigger(trigger: RuleTrigger, transaction?: Transaction): Promise<readonly ProgressionRuleResource[]>;
    findById(ruleId: string, transaction?: Transaction): Promise<ProgressionRuleResource | null>;
}

/** One persisted evaluation plus its proposed actions; `evaluatedAt` is stamped by the service. */
export interface ProgressionEvaluationRecord {
    readonly id: string;
    readonly profileId: string;
    readonly ruleId: string;
    readonly ruleVersion: number;
    readonly ruleName: string;
    readonly trainingSessionId: string;
    readonly trainingSessionVersion: number;
    readonly trigger: RuleTrigger;
    readonly scopeType: RuleScope["type"];
    readonly scopeId: string;
    readonly target: RuleTarget;
    readonly matched: boolean;
    readonly status: ProgressionEvaluationStatus;
    readonly explanation: ConditionEvaluation;
    readonly missingMetrics: readonly string[];
    readonly contextRevisions: Readonly<Record<string, number>>;
    readonly contextFacts: Readonly<Record<string, MetricFact>>;
    readonly contextFingerprint: string;
    readonly evaluatedAt: Date;
    readonly actions: readonly ProgressionEvaluationActionView[];
}

/**
 * Idempotent, append-only projection port for evaluations. A fingerprint that already exists is a
 * replay and must not be inserted again (design §15.3 replay safety); listing/reading feed the
 * approval and status surfaces.
 */
export interface ProgressionEvaluationRepository<Transaction = unknown> {
    existsByFingerprint(fingerprint: string, transaction?: Transaction): Promise<boolean>;
    insert(record: ProgressionEvaluationRecord, transaction: Transaction): Promise<ProgressionEvaluationView>;
    readById(id: string, transaction?: Transaction): Promise<ProgressionEvaluationView | null>;
    listForSession(sessionId: string, transaction?: Transaction): Promise<readonly ProgressionEvaluationView[]>;
    listForProfile(
        filter: ProgressionEvaluationListFilter,
        transaction?: Transaction,
    ): Promise<readonly ProgressionEvaluationView[]>;
}

export interface ProgressionEvaluationListFilter {
    readonly profileId?: string;
    readonly status?: ProgressionEvaluationStatus;
    readonly ruleId?: string;
    readonly limit?: number;
}

// -------------------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------------------

export class ProgressionSubjectUnavailableError extends ApplicationNotFoundError {
    constructor(readonly trainingSessionId: string) {
        super(`Training session ${trainingSessionId} was not found for progression evaluation`, {
            trainingSessionId,
        });
        this.name = "ProgressionSubjectUnavailableError";
    }
}

// -------------------------------------------------------------------------------------------------
// Pure metric derivation (immutable context from a supplied session state, no I/O)
// -------------------------------------------------------------------------------------------------

/**
 * Derive the session-scoped metric snapshot G2 supports directly from a completed session's state
 * (design §15.1). Every fact stamps the session version it was read from; metrics the MVP cannot
 * derive deterministically (analytics, streaks, windows, non-session scopes) are simply absent, and
 * the evaluator treats their absence as a recorded "missing" — never a fabricated zero.
 */
export function deriveSessionMetricFacts(
    session: TrainingSessionState,
    sessionVersion: number,
): { readonly facts: MetricLookup; readonly revisions: Readonly<Record<string, number>> } {
    const facts = new Map<string, MetricFact>();
    const set = (key: ProgressionMetricKey, value: number | boolean | null) => {
        if (value !== null)
            facts.set(canonicalMetricKey({ key, scope: "session" }), { value, sourceRevision: sessionVersion });
    };

    const performedSets = collectPerformedSets(session);
    const working = performedSets.filter(entry => entry.setType !== "warm_up");

    if (working.length > 0) {
        const completed = working.filter(entry => entry.status === "completed").length;
        set("sets_completed", completed);
        set(
            "completed_all_sets",
            working.every(entry => entry.status === "completed"),
        );
    }

    set("rpe", meanOf([...working.map(entry => entry.measurements.rpe), ...session.activities.map(a => a.rpe)]));
    set("rir", meanOf(working.map(entry => entry.measurements.rir)));
    set("readiness", meanOf(Object.values(session.readiness)));
    set("reported_pain", session.painRecords.length > 0 ? Math.max(...session.painRecords.map(p => p.severity)) : 0);

    return { facts, revisions: { session: sessionVersion } };
}

function collectPerformedSets(session: TrainingSessionState): readonly PerformedSetState[] {
    const sets: PerformedSetState[] = [];
    for (const activity of session.activities)
        for (const occurrence of activity.strength?.occurrences ?? []) sets.push(...occurrence.performedSets);
    return sets;
}

function meanOf(values: readonly (number | null)[]): number | null {
    const present = values.filter((value): value is number => typeof value === "number");
    if (present.length === 0) return null;
    return present.reduce((total, value) => total + value, 0) / present.length;
}

// -------------------------------------------------------------------------------------------------
// Scope matching (pure)
// -------------------------------------------------------------------------------------------------

/** Whether a rule's scope target covers the session's resolved scope chain. */
export function ruleMatchesScope(scope: RuleScope, chain: SessionScopeChain): boolean {
    switch (scope.type) {
        case "program":
            return chain.programIds.includes(scope.id);
        case "block":
            return chain.blockIds.includes(scope.id);
        case "template":
            return chain.templateIds.includes(scope.id);
        case "exercise":
            return chain.exerciseLogicalKeys.includes(scope.id);
        case "set":
            return chain.setLogicalKeys.includes(scope.id);
        default:
            return false;
    }
}

// -------------------------------------------------------------------------------------------------
// EvaluateProgression orchestration
// -------------------------------------------------------------------------------------------------

export interface EvaluateProgressionCommand {
    readonly sessionId: string;
    readonly trigger: RuleTrigger;
    /** Restrict evaluation to a single rule (manual re-run of one rule). */
    readonly ruleId?: string;
}

interface EvaluateProgressionRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly contextReader: ProgressionContextReader<Transaction>;
    readonly ruleReader: ApplicableProgressionRuleReader<Transaction>;
    readonly repository: ProgressionEvaluationRepository<Transaction>;
    readonly generateId: () => string;
    readonly clock?: Clock;
}

/**
 * Resolves applicable enabled rules for a completed session's trigger and scope, builds one immutable
 * context, runs the pure evaluator per rule, and persists a single evaluation per fingerprint. Replays
 * short-circuit on the existing fingerprint so the same rule version against the same context revisions
 * never duplicates (design §15.3). A non-completed or missing session yields no evaluations.
 */
export class EvaluateProgression<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: EvaluateProgressionRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
    }

    async evaluateSession(
        command: EvaluateProgressionCommand,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<readonly ProgressionEvaluationView[]> {
        return this.inTransaction(transaction, async activeTransaction => {
            const loaded = await this.runtime.contextReader.loadSubject(command.sessionId, activeTransaction);
            if (loaded === null) throw new ProgressionSubjectUnavailableError(command.sessionId);
            const { subject, session } = loaded;
            if (!subject.completed) return [];

            const rules = await this.resolveApplicableRules(command, subject, activeTransaction);
            const { facts, revisions } = deriveSessionMetricFacts(session, subject.sessionVersion);
            const now = this.clock.now();

            for (const rule of rules) {
                const fingerprint = this.fingerprint(rule, command.trigger, subject, revisions);
                if (await this.runtime.repository.existsByFingerprint(fingerprint, activeTransaction)) continue;
                const outcome = evaluateProgressionRule({ condition: rule.condition, actions: rule.actions, facts });
                await this.runtime.repository.insert(
                    this.toRecord(rule, command.trigger, subject, revisions, facts, fingerprint, outcome, now),
                    activeTransaction,
                );
            }

            return this.runtime.repository.listForSession(command.sessionId, activeTransaction);
        });
    }

    private async resolveApplicableRules(
        command: EvaluateProgressionCommand,
        subject: ProgressionEvaluationSubject,
        transaction: Transaction,
    ): Promise<readonly ProgressionRuleResource[]> {
        const candidates =
            command.ruleId !== undefined
                ? await this.singleRule(command.ruleId, transaction)
                : await this.runtime.ruleReader.findEnabledByTrigger(command.trigger, transaction);
        return candidates.filter(
            rule =>
                rule.status === "active" &&
                rule.enabled &&
                rule.triggers.includes(command.trigger) &&
                ruleMatchesScope(rule.scope, subject.scope),
        );
    }

    private async singleRule(ruleId: string, transaction: Transaction): Promise<readonly ProgressionRuleResource[]> {
        const rule = await this.runtime.ruleReader.findById(ruleId, transaction);
        return rule ? [rule] : [];
    }

    private fingerprint(
        rule: ProgressionRuleResource,
        trigger: RuleTrigger,
        subject: ProgressionEvaluationSubject,
        contextRevisions: Readonly<Record<string, number>>,
    ): string {
        return hashRequest(
            buildEvaluationFingerprintSeed({
                ruleId: rule.id,
                ruleVersion: rule.version,
                conditionSchemaVersion: rule.conditionSchemaVersion,
                actionSchemaVersion: rule.actionSchemaVersion,
                trigger,
                targetMode: rule.target.mode,
                targetSelector: rule.target.selector,
                scopeType: rule.scope.type,
                scopeId: rule.scope.id,
                subjectId: subject.sessionId,
                contextRevisions,
            }),
        );
    }

    private toRecord(
        rule: ProgressionRuleResource,
        trigger: RuleTrigger,
        subject: ProgressionEvaluationSubject,
        contextRevisions: Readonly<Record<string, number>>,
        facts: MetricLookup,
        fingerprint: string,
        outcome: ReturnType<typeof evaluateProgressionRule>,
        now: Date,
    ): ProgressionEvaluationRecord {
        return {
            id: this.runtime.generateId(),
            profileId: subject.profileId,
            ruleId: rule.id,
            ruleVersion: rule.version,
            ruleName: rule.name,
            trainingSessionId: subject.sessionId,
            trainingSessionVersion: subject.sessionVersion,
            trigger,
            scopeType: rule.scope.type,
            scopeId: rule.scope.id,
            target: rule.target,
            matched: outcome.matched,
            status: outcome.status,
            explanation: outcome.explanation,
            missingMetrics: outcome.missingMetrics,
            contextRevisions,
            contextFacts: Object.fromEntries(facts),
            contextFingerprint: fingerprint,
            evaluatedAt: now,
            actions: outcome.proposedActions.map(toActionView),
        };
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }
}

function toActionView(proposed: ProposedProgressionAction): ProgressionEvaluationActionView {
    return {
        position: proposed.position,
        actionType: proposed.action.type,
        action: proposed.action,
        status: "proposed",
    };
}

// -------------------------------------------------------------------------------------------------
// Durable work: job handler + outbox handler
// -------------------------------------------------------------------------------------------------

/** Evaluates applicable rules for one session inside the worker's transaction (idempotent by fingerprint). */
export class ProgressionEvaluationJobHandler<Transaction = unknown> implements JobHandler<Transaction> {
    readonly name = "progression.evaluation-job";
    readonly jobType = PROGRESSION_EVALUATE_JOB;
    readonly jobVersion = PROGRESSION_EVALUATE_JOB_VERSION;

    constructor(private readonly evaluate: EvaluateProgression<Transaction>) {}

    async handle(job: ClaimedJob, context: JobHandlerContext<Transaction>): Promise<void> {
        const sessionId = requireString(job.payload.trainingSessionId, "trainingSessionId");
        const trigger = (optionalString(job.payload.trigger) ?? "session_completed") as RuleTrigger;
        await this.evaluate.evaluateSession(
            { sessionId, trigger },
            { correlationId: job.correlationId, source: "system" },
            context.transaction,
        );
    }
}

/** Enqueue payload keyed by session so replayed session events coalesce onto one evaluation job. */
function evaluateJob(sessionId: string, event: ClaimedOutboxEvent) {
    return {
        type: PROGRESSION_EVALUATE_JOB,
        version: PROGRESSION_EVALUATE_JOB_VERSION,
        payload: { trainingSessionId: sessionId, trigger: "session_completed" as const },
        idempotencyKey: `${PROGRESSION_EVALUATE_JOB}:${sessionId}`,
        correlationId: event.correlationId,
        causationId: event.id,
    };
}

/**
 * Subscribes to a session fact and queues a progression evaluation when the event's invalidation
 * metadata marks progression stale (design §15.3, §17.3). One instance is registered per event name.
 */
export class SessionProgressionOutboxHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    readonly name = "progression.session-invalidation";
    readonly eventVersion = 1;

    constructor(
        readonly eventName: string,
        private readonly queue: JobQueue<Transaction>,
    ) {}

    async handle(event: ClaimedOutboxEvent, context: OutboxHandlerContext<Transaction>): Promise<void> {
        if (!progressionInvalidated(event.payload)) return;
        const sessionId = optionalString(event.payload.trainingSessionId) ?? event.aggregateId;
        if (sessionId === null) return;
        await this.queue.enqueue(evaluateJob(sessionId, event), context.transaction);
    }
}

/** Session events whose progression evaluation is driven by their `invalidation.progression` flag. */
export const PROGRESSION_SESSION_EVENT_NAMES = [
    "training.session.completed",
    "training.session.revised",
    "training.session.reopened",
    "training.session.archived",
    "training.session.restored",
] as const;

// -------------------------------------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------------------------------------

function progressionInvalidated(payload: Readonly<Record<string, unknown>>): boolean {
    const invalidation = payload.invalidation;
    return (
        typeof invalidation === "object" &&
        invalidation !== null &&
        (invalidation as Record<string, unknown>).progression === true
    );
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`Progression job payload is missing ${field}`);
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}
