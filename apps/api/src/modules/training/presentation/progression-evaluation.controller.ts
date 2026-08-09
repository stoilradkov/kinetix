import { randomUUID } from "node:crypto";

import {
    Body,
    Controller,
    Get,
    Headers,
    HttpException,
    Inject,
    Optional,
    Param,
    Post,
    Query,
    Res,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    approveProgressionEvaluationRequestSchema,
    evaluateProgressionRequestSchema,
    progressionEvaluationListQuerySchema,
    progressionEvaluationListResponseSchema,
    progressionEvaluationResponseSchema,
    rejectProgressionEvaluationRequestSchema,
    type ProgressionEvaluationListResponse,
    type ProgressionEvaluationResponse,
} from "@kinetix/types";

import {
    EVALUATE_PROGRESSION,
    PROGRESSION_APPROVAL_SERVICE,
    PROGRESSION_EVALUATION_REPOSITORY,
    ProgressionSubjectUnavailableError,
    type EvaluateProgression,
    type ProgressionApprovalService,
    type ProgressionEvaluationRepository,
    type ProgressionEvaluationView,
} from "#src/modules/training/application/index";
import { PROFILE_READER, type ProfileReader } from "#src/modules/profile/index";
import {
    ApplicationValidationError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type CommandContext,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

/**
 * Progression evaluation read/trigger surface (issue #40, G2; design §15.3). Evaluations are immutable
 * evidence produced by the durable worker off `training.session.*` events; these endpoints expose the
 * matched/unmatched explanation, retained context, and proposed actions for a session or across the
 * profile's approval queue, and let a client manually (or scheduled-) trigger evaluation of a completed
 * session's applicable rules. Rich approval/apply UI remains G4.
 */
@ApiTags("training progression")
@Controller({ path: "training", version: "1" })
export class ProgressionEvaluationController {
    constructor(
        @Inject(EVALUATE_PROGRESSION) private readonly evaluate: EvaluateProgression,
        @Inject(PROGRESSION_EVALUATION_REPOSITORY) private readonly repository: ProgressionEvaluationRepository,
        @Inject(PROGRESSION_APPROVAL_SERVICE) private readonly approval: ProgressionApprovalService,
        @Inject(PROFILE_READER) private readonly profiles: ProfileReader,
        @Optional() @Inject(IDEMPOTENT_COMMAND_EXECUTOR) private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Post("sessions/:sessionId/progression/evaluate")
    @ApiOperation({ summary: "Manually (or scheduled-) evaluate a completed session's applicable rules" })
    @ApiParam({ name: "sessionId", format: "uuid" })
    async evaluateSession(
        @Param("sessionId") sessionId: string,
        @Body() rawBody: unknown = {},
        @Headers("x-correlation-id") correlationId: string | undefined,
        @Headers("x-kinetix-source") source: string | undefined,
    ): Promise<ProgressionEvaluationListResponse> {
        const id = uuid(sessionId, "sessionId");
        const command = parseContract(evaluateProgressionRequestSchema, rawBody, "Evaluate request validation failed");
        try {
            const results = await this.evaluate.evaluateSession(
                { sessionId: id, trigger: command.trigger, ...(command.ruleId ? { ruleId: command.ruleId } : {}) },
                commandMetadata(correlationId, source),
            );
            return progressionEvaluationListResponseSchema.parse({ items: results.map(toResponse) });
        } catch (error) {
            if (error instanceof ProgressionSubjectUnavailableError)
                throw new HttpException({ code: "NOT_FOUND", message: error.message }, 404);
            throw error;
        }
    }

    @Get("sessions/:sessionId/progression/evaluations")
    @ApiOperation({ summary: "List the progression evaluations recorded for a session" })
    @ApiParam({ name: "sessionId", format: "uuid" })
    async listForSession(@Param("sessionId") sessionId: string): Promise<ProgressionEvaluationListResponse> {
        const id = uuid(sessionId, "sessionId");
        const results = await this.repository.listForSession(id);
        return progressionEvaluationListResponseSchema.parse({ items: results.map(toResponse) });
    }

    @Get("progression/evaluations")
    @ApiOperation({ summary: "List progression evaluations across the profile's sessions (approval queue)" })
    @ApiQuery({ name: "status", required: false, enum: ["unmatched", "pending", "blocked", "applied", "rejected"] })
    @ApiQuery({ name: "ruleId", required: false, format: "uuid" })
    @ApiQuery({ name: "limit", required: false })
    async list(@Query() rawQuery: Record<string, unknown> = {}): Promise<ProgressionEvaluationListResponse> {
        const query = parseContract(
            progressionEvaluationListQuerySchema,
            rawQuery,
            "Evaluation query validation failed",
        );
        const profileId = await this.profiles.requireActiveProfileId();
        const results = await this.repository.listForProfile({ profileId, ...query });
        return progressionEvaluationListResponseSchema.parse({ items: results.map(toResponse) });
    }

    @Get("progression/evaluations/:evaluationId")
    @ApiOperation({ summary: "Read one progression evaluation with its full explanation and proposed actions" })
    @ApiParam({ name: "evaluationId", format: "uuid" })
    async detail(@Param("evaluationId") evaluationId: string): Promise<ProgressionEvaluationResponse> {
        const id = uuid(evaluationId, "evaluationId");
        const view = await this.repository.readById(id);
        if (view === null)
            throw new HttpException({ code: "NOT_FOUND", message: `Evaluation ${id} was not found` }, 404);
        return progressionEvaluationResponseSchema.parse(toResponse(view));
    }

    @Post("progression/evaluations/:evaluationId/approve")
    @ApiOperation({ summary: "Approve a proposal, applying its actions to the target owner (all-or-none)" })
    @ApiParam({ name: "evaluationId", format: "uuid" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async approve(
        @Param("evaluationId") evaluationId: string,
        @Body() rawBody: unknown = {},
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Headers("x-correlation-id") correlationId: string | undefined,
        @Headers("x-kinetix-source") source: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgressionEvaluationResponse> {
        const id = uuid(evaluationId, "evaluationId");
        const command = parseContract(
            approveProgressionEvaluationRequestSchema,
            rawBody,
            "Approve request validation failed",
        );
        const metadata = commandMetadata(correlationId, source);
        return this.executeDecision({
            operation: "training.progression-evaluation.approve",
            idempotencyKey,
            request: { evaluationId: id, ...command },
            metadata,
            response,
            run: transaction =>
                this.approval.approve({ evaluationId: id, reason: command.reason ?? null }, metadata, transaction),
        });
    }

    @Post("progression/evaluations/:evaluationId/reject")
    @ApiOperation({ summary: "Reject/acknowledge a proposal without applying it" })
    @ApiParam({ name: "evaluationId", format: "uuid" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async reject(
        @Param("evaluationId") evaluationId: string,
        @Body() rawBody: unknown = {},
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Headers("x-correlation-id") correlationId: string | undefined,
        @Headers("x-kinetix-source") source: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgressionEvaluationResponse> {
        const id = uuid(evaluationId, "evaluationId");
        const command = parseContract(
            rejectProgressionEvaluationRequestSchema,
            rawBody,
            "Reject request validation failed",
        );
        const metadata = commandMetadata(correlationId, source);
        return this.executeDecision({
            operation: "training.progression-evaluation.reject",
            idempotencyKey,
            request: { evaluationId: id, ...command },
            metadata,
            response,
            run: transaction =>
                this.approval.reject({ evaluationId: id, reason: command.reason ?? null }, metadata, transaction),
        });
    }

    /**
     * Run an approve/reject through the idempotent executor when a key is supplied (so a retried decision
     * replays the stored response instead of re-applying), otherwise directly in the service's own unit of
     * work. The evaluation projection has no aggregate version, so concurrency is guarded by the row lock
     * and the deterministic status transition rather than an ETag.
     */
    private async executeDecision(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: CommandContext;
        readonly response: HeaderResponse;
        readonly run: (transaction?: unknown) => Promise<ProgressionEvaluationView>;
    }): Promise<ProgressionEvaluationResponse> {
        const perform = async (transaction?: unknown) =>
            progressionEvaluationResponseSchema.parse(toResponse(await input.run(transaction)));
        if (input.idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                {
                    operation: input.operation,
                    key: input.idempotencyKey,
                    request: input.request,
                    context: input.metadata,
                },
                async transaction => ({ status: 200, body: await perform(transaction) }),
            );
            input.response.setHeader("Idempotency-Replayed", String(result.replayed));
            return result.body;
        }
        return perform();
    }
}

function toResponse(view: ProgressionEvaluationView): unknown {
    return {
        id: view.id,
        ruleId: view.ruleId,
        ruleVersion: view.ruleVersion,
        ruleName: view.ruleName,
        trainingSessionId: view.trainingSessionId,
        trainingSessionVersion: view.trainingSessionVersion,
        trigger: view.trigger,
        scopeType: view.scopeType,
        scopeId: view.scopeId,
        target: view.target,
        matched: view.matched,
        status: view.status,
        explanation: view.explanation,
        missingMetrics: [...view.missingMetrics],
        contextRevisions: { ...view.contextRevisions },
        contextFacts: { ...view.contextFacts },
        contextFingerprint: view.contextFingerprint,
        safety: {
            outcome: view.safety.outcome,
            findings: view.safety.findings.map(finding => ({ ...finding, missingInputs: [...finding.missingInputs] })),
            missingInputs: [...view.safety.missingInputs],
        },
        conflict: {
            conflicting: view.conflict.conflicting,
            ruleIds: [...view.conflict.ruleIds],
            fields: [...view.conflict.fields],
        },
        autoApplyEligible: view.autoApplyEligible,
        autoApplyReason: view.autoApplyReason,
        stale: view.stale,
        decidedAt: view.decidedAt ? view.decidedAt.toISOString() : null,
        decidedBy: view.decidedBy,
        decisionReason: view.decisionReason,
        resultRevisions: view.resultRevisions.map(revision => ({ ...revision })),
        actions: view.actions.map(action => ({ ...action, action: { ...action.action } })),
        evaluatedAt: view.evaluatedAt.toISOString(),
    };
}

function commandMetadata(rawCorrelationId: string | undefined, rawSource: string | undefined): CommandContext {
    return {
        correlationId: rawCorrelationId?.trim() || randomUUID(),
        actorId: null,
        source: normalizeSource(rawSource),
    };
}

const COMMAND_SOURCES = ["user", "agent", "import", "sync", "system"] as const;

function normalizeSource(rawSource: string | undefined): (typeof COMMAND_SOURCES)[number] {
    const normalized = rawSource?.trim().toLowerCase();
    return COMMAND_SOURCES.find(source => source === normalized) ?? "user";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string, field: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized))
        throw new ApplicationValidationError(`${field} must be a UUID`, { [field]: [`${field} must be a UUID`] });
    return normalized;
}

function parseContract<Output>(
    schema: {
        safeParse(
            value: unknown,
        ):
            | { success: true; data: Output }
            | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
    },
    value: unknown,
    message: string,
): Output {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw contractValidationException(message, parsed.error.issues);
    return parsed.data;
}

function contractValidationException(
    message: string,
    issues: readonly { path: readonly PropertyKey[]; message: string }[],
): HttpException {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of issues) {
        const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$";
        (fieldErrors[path] ??= []).push(issue.message);
    }
    return new HttpException({ code: "VALIDATION_FAILED", message, fieldErrors }, 422);
}
