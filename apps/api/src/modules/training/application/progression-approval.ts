import type { CommandContext } from "#src/platform/application/command-context";
import type { JobQueue, OutboxWriter } from "#src/platform/application/durable-work";
import {
    ApplicationError,
    ApplicationNotFoundError,
    ApplicationValidationError,
} from "#src/platform/application/errors";
import type { UnitOfWork } from "#src/platform/application/unit-of-work";
import { DomainEvent as PlatformDomainEvent, type Clock, type DomainEvent } from "#src/platform/domain/index";

import {
    applyProgressionActions,
    assessSafety,
    isEvaluationStale,
    planApproval,
    planRejection,
    type ProgressionDecisionRefusal,
    type RuleScope,
    type RuleTarget,
    type SafetyContext,
    type SafetyOutcome,
    type SessionPrescriptionState,
    type TrainingSessionState,
} from "#src/modules/training/domain/index";
import {
    deriveSessionSafetyInputs,
    PROGRESSION_EVALUATE_JOB,
    PROGRESSION_EVALUATE_JOB_VERSION,
    PROGRESSION_EVALUATION_ENTITY_TYPE,
    type ApplicableProgressionRuleReader,
    type ProgressionContextReader,
    type ProgressionEvaluationRepository,
    type ProgressionEvaluationSubject,
    type ProgressionEvaluationView,
    type ProgressionHealthReader,
    type ProgressionResultRevisionView,
} from "#src/modules/training/application/progression-evaluation";
import type { ProfileReader } from "#src/modules/profile/index";

// -------------------------------------------------------------------------------------------------
// DI tokens
// -------------------------------------------------------------------------------------------------

export const PROGRESSION_APPROVAL_SERVICE = Symbol("PROGRESSION_APPROVAL_SERVICE");
export const PROGRESSION_APPLICATION_EXECUTOR = Symbol("PROGRESSION_APPLICATION_EXECUTOR");

// -------------------------------------------------------------------------------------------------
// Application executor port — resolves target owners and applies a mutated prescription atomically
// -------------------------------------------------------------------------------------------------

/** A target owner root a proposal applies to, plus the current immutable prescription to transform. */
export interface ResolvedProgressionTarget {
    readonly ownerType: "workout-template";
    readonly ownerId: string;
    readonly ownerVersion: number;
    readonly ownerProfileId: string;
    readonly prescription: SessionPrescriptionState;
}

/**
 * Capability port over the owner roots a progression proposal can change. Infrastructure resolves the
 * concrete target(s) for a scope/target and applies a transformed prescription by republishing it
 * through the owner's own command (advancing that owner's revision + history + version→prescription
 * link), never mutating an immutable prescription row. Applying every target in one transaction gives
 * the all-or-none guarantee across a multi-target `block_future` change.
 */
export interface ProgressionApplicationExecutor<Transaction = unknown> {
    resolveTargets(
        input: { readonly scope: RuleScope; readonly target: RuleTarget; readonly profileId: string },
        transaction: Transaction,
    ): Promise<readonly ResolvedProgressionTarget[]>;
    applyTarget(
        input: { readonly target: ResolvedProgressionTarget; readonly prescription: SessionPrescriptionState },
        metadata: CommandContext,
        transaction: Transaction,
    ): Promise<ProgressionResultRevisionView>;
}

// -------------------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------------------

export class ProgressionEvaluationNotFoundError extends ApplicationNotFoundError {
    constructor(readonly evaluationId: string) {
        super(`Progression evaluation ${evaluationId} was not found`, { evaluationId });
        this.name = "ProgressionEvaluationNotFoundError";
    }
}

/** A second decision on an already-resolved proposal (concurrent approvers, replays) → 409. */
export class ProgressionAlreadyResolvedError extends ApplicationError {
    constructor(readonly evaluationId: string) {
        super("PROGRESSION_CONFLICT", `Progression evaluation ${evaluationId} has already been resolved`, undefined, {
            evaluationId,
        });
        this.name = "ProgressionAlreadyResolvedError";
    }
}

/** The proposal's context moved after evaluation; it was flagged stale and queued for reevaluation → 409. */
export class ProgressionStaleError extends ApplicationError {
    constructor(readonly evaluationId: string) {
        super(
            "PROGRESSION_STALE",
            `Progression evaluation ${evaluationId} is stale because its context changed; it was queued for reevaluation`,
            undefined,
            { evaluationId },
        );
        this.name = "ProgressionStaleError";
    }
}

/** The proposal cannot be applied to a target the MVP supports (or a safety policy blocks it) → 422. */
export class ProgressionNotApplicableError extends ApplicationValidationError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, { evaluation: [message] }, context);
        this.name = "ProgressionNotApplicableError";
    }
}

// -------------------------------------------------------------------------------------------------
// Commands + runtime
// -------------------------------------------------------------------------------------------------

export interface ApproveProgressionCommand {
    readonly evaluationId: string;
    readonly reason?: string | null;
}

export interface RejectProgressionCommand {
    readonly evaluationId: string;
    readonly reason?: string | null;
}

interface ProgressionApprovalRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: ProgressionEvaluationRepository<Transaction>;
    readonly contextReader: ProgressionContextReader<Transaction>;
    readonly ruleReader: ApplicableProgressionRuleReader<Transaction>;
    readonly executor: ProgressionApplicationExecutor<Transaction>;
    readonly queue: JobQueue<Transaction>;
    readonly outbox: OutboxWriter<Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly healthReader?: ProgressionHealthReader;
    readonly clock?: Clock;
    readonly generateId: () => string;
}

/**
 * Approves or rejects a persisted progression proposal (design §15.3 steps 8–9, PRD PG-5, PG-7, PG-8).
 * Approval locks the evaluation row, rechecks the context (staleness → reevaluate instead of applying),
 * reruns the safety policies, and applies every proposed action to the resolved target owner(s) by
 * republishing a cloned prescription — all in one UnitOfWork so two approvers cannot both apply and the
 * change lands atomically or not at all.
 */
export class ProgressionApprovalService<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: ProgressionApprovalRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
    }

    async approve(
        command: ApproveProgressionCommand,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<ProgressionEvaluationView> {
        return this.inTransaction(transaction, async tx => {
            const evaluation = await this.lockOwned(command.evaluationId, tx);

            // Recheck the context: a moved revision marks the proposal stale and reevaluates it.
            const loaded = await this.runtime.contextReader.loadSubject(evaluation.trainingSessionId, tx);
            if (loaded === null) throw new ProgressionNotApplicableError("The target session is no longer available");
            const currentContextRevisions = { session: loaded.subject.sessionVersion };
            if (isEvaluationStale({ recordedContextRevisions: evaluation.contextRevisions, currentContextRevisions })) {
                await this.runtime.repository.markStale(evaluation.id, tx);
                await this.runtime.queue.enqueue(this.reevaluateJob(evaluation.trainingSessionId, metadata), tx);
                throw new ProgressionStaleError(evaluation.id);
            }

            // Rerun safety against the fresh context; a hard block cannot be approved by a human.
            const safetyOutcome = await this.recheckSafety(evaluation, loaded.subject, loaded.session);
            const outcome = planApproval({ status: evaluation.status, safetyOutcome });
            if (!outcome.allowed) throw this.refusal(evaluation.id, outcome.refusal);

            // Apply every proposed action to each resolved target owner, atomically.
            const scope: RuleScope = { type: evaluation.scopeType, id: evaluation.scopeId };
            const targets = await this.runtime.executor.resolveTargets(
                { scope, target: evaluation.target, profileId: evaluation.profileId },
                tx,
            );
            const actions = [...evaluation.actions].sort((a, b) => a.position - b.position).map(entry => entry.action);
            const resultRevisions: ProgressionResultRevisionView[] = [];
            for (const target of targets) {
                const applied = applyProgressionActions({
                    prescription: target.prescription,
                    scope,
                    target: evaluation.target,
                    actions,
                });
                resultRevisions.push(
                    await this.runtime.executor.applyTarget(
                        { target, prescription: applied.prescription },
                        metadata,
                        tx,
                    ),
                );
            }

            const view = await this.runtime.repository.recordDecision(
                {
                    id: evaluation.id,
                    status: "applied",
                    actionStatus: "applied",
                    decidedAt: this.clock.now(),
                    decidedBy: this.actor(metadata),
                    decisionReason: normalizeReason(command.reason),
                    resultRevisions,
                },
                tx,
            );
            await this.publish(view, "applied", metadata, tx);
            return view;
        });
    }

    async reject(
        command: RejectProgressionCommand,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<ProgressionEvaluationView> {
        return this.inTransaction(transaction, async tx => {
            const evaluation = await this.lockOwned(command.evaluationId, tx);
            const outcome = planRejection({ status: evaluation.status });
            if (!outcome.allowed) throw this.refusal(evaluation.id, outcome.refusal);
            const view = await this.runtime.repository.recordDecision(
                {
                    id: evaluation.id,
                    status: "rejected",
                    actionStatus: "rejected",
                    decidedAt: this.clock.now(),
                    decidedBy: this.actor(metadata),
                    decisionReason: normalizeReason(command.reason),
                    resultRevisions: [],
                },
                tx,
            );
            await this.publish(view, "rejected", metadata, tx);
            return view;
        });
    }

    private async lockOwned(evaluationId: string, tx: Transaction): Promise<ProgressionEvaluationView> {
        const evaluation = await this.runtime.repository.loadForUpdate(evaluationId, tx);
        if (evaluation === null) throw new ProgressionEvaluationNotFoundError(evaluationId);
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        if (evaluation.profileId !== profileId) throw new ProgressionEvaluationNotFoundError(evaluationId);
        return evaluation;
    }

    /** Rebuild the safety verdict from the fresh context and rule config; falls back to the stored outcome. */
    private async recheckSafety(
        evaluation: ProgressionEvaluationView,
        subject: ProgressionEvaluationSubject,
        session: TrainingSessionState,
    ): Promise<SafetyOutcome> {
        if (!evaluation.matched) return evaluation.safety.outcome;
        const rule = await this.runtime.ruleReader.findById(evaluation.ruleId);
        if (!rule || rule.status !== "active") return evaluation.safety.outcome;
        const inputs = deriveSessionSafetyInputs(session);
        const sleepHours =
            (await this.runtime.healthReader?.readSleepHours(subject.profileId, session.localDate)) ?? null;
        const context: SafetyContext = {
            targetMode: evaluation.target.mode,
            config: rule.safetyPolicy.config,
            reportedPainSeverity: inputs.reportedPainSeverity,
            painAreas: inputs.painAreas,
            readiness: inputs.readiness,
            sleepHours,
            recoveryIntervalHours: subject.recoveryIntervalHours,
            weeklyVolume: subject.weeklyVolume,
        };
        return assessSafety(
            evaluation.actions.map(entry => entry.action),
            context,
        ).outcome;
    }

    private refusal(evaluationId: string, refusal: ProgressionDecisionRefusal): ApplicationError {
        switch (refusal) {
            case "already_resolved":
                return new ProgressionAlreadyResolvedError(evaluationId);
            case "not_actionable":
                return new ProgressionNotApplicableError("This evaluation is not in an actionable state");
            case "safety_blocked":
                return new ProgressionNotApplicableError("A safety policy blocks this change; it cannot be approved");
        }
    }

    private reevaluateJob(sessionId: string, metadata: CommandContext) {
        return {
            type: PROGRESSION_EVALUATE_JOB,
            version: PROGRESSION_EVALUATE_JOB_VERSION,
            payload: { trainingSessionId: sessionId, trigger: "session_completed" as const },
            idempotencyKey: `${PROGRESSION_EVALUATE_JOB}:${sessionId}`,
            correlationId: metadata.correlationId,
        };
    }

    private publish(
        view: ProgressionEvaluationView,
        action: "applied" | "rejected",
        metadata: CommandContext,
        tx: Transaction,
    ): Promise<void> {
        const event: DomainEvent = new PlatformDomainEvent({
            id: this.runtime.generateId(),
            name: `training.progression-evaluation.${action}`,
            version: 1,
            occurredAt: this.clock.now(),
            aggregateType: PROGRESSION_EVALUATION_ENTITY_TYPE,
            aggregateId: view.id,
            aggregateRevision: 1,
            correlationId: metadata.correlationId,
            payload: {
                progressionEvaluationId: view.id,
                profileId: view.profileId,
                ruleId: view.ruleId,
                trainingSessionId: view.trainingSessionId,
                status: view.status,
                resultRevisions: view.resultRevisions.map(revision => ({ ...revision })),
            },
        });
        return this.runtime.outbox.publish([event], tx, metadata);
    }

    private actor(metadata: CommandContext): string | null {
        return metadata.actorId ?? metadata.source ?? null;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }
}

function normalizeReason(reason: string | null | undefined): string | null {
    if (reason == null) return null;
    const trimmed = reason.trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, 2_000);
}
