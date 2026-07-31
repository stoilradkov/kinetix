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
    Patch,
    Post,
    Query,
    Res,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    completePlannedSessionRequestSchema,
    createPlannedSessionRequestSchema,
    plannedSessionListResponseSchema,
    plannedSessionResponseSchema,
    skipCancelPlannedSessionRequestSchema,
    updatePlannedSessionRequestSchema,
    type PlannedSessionListResponse,
    type PlannedSessionResponse,
} from "@kinetix/types";

import {
    PLANNED_SESSION_COMMANDS,
    PLANNED_SESSION_REPOSITORY,
    PlannedSessionNotFoundError,
    SESSION_PRESCRIPTION_REPOSITORY,
    type PlannedSessionCommands,
    type PlannedSessionDetail,
    type PlannedSessionMutationMetadata,
    type PlannedSessionOutcomeCommand,
    type PlannedSessionRepository,
    type SessionPrescriptionRepository,
} from "#src/modules/training/application/index";
import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";
import { formatRevisionEtag, parseRevisionEtag } from "#src/platform/presentation/revision-etag";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("training planned sessions")
@Controller({ path: "training/planned-sessions", version: "1" })
export class PlannedSessionController {
    constructor(
        @Inject(PLANNED_SESSION_COMMANDS)
        private readonly commands: PlannedSessionCommands,
        @Inject(PLANNED_SESSION_REPOSITORY)
        private readonly repository: PlannedSessionRepository,
        @Inject(SESSION_PRESCRIPTION_REPOSITORY)
        private readonly prescriptions: SessionPrescriptionRepository,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List planned sessions, optionally including archived ones" })
    @ApiQuery({ name: "includeArchived", required: false })
    async list(@Query("includeArchived") includeArchived: string | undefined): Promise<PlannedSessionListResponse> {
        const items = await this.repository.listSessions({ includeArchived: includeArchived === "true" });
        return plannedSessionListResponseSchema.parse({ items });
    }

    @Post()
    @ApiOperation({ summary: "Create a standalone planned session for the active profile" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        const request = parseContract(createPlannedSessionRequestSchema, rawBody, "Planned session validation failed");
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.planned-session.create",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.create(request, metadata, transaction),
        });
    }

    @Get(":id")
    @ApiOperation({ summary: "Get one planned session with its current prescription" })
    @ApiParam({ name: "id", format: "uuid" })
    async get(
        @Param("id") id: string,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        const session = await this.repository.readSession(sessionId(id));
        if (!session) throw new PlannedSessionNotFoundError(id);
        const prescription = await this.prescriptions.loadTree(session.currentPrescriptionId);
        if (!prescription)
            throw new ApplicationNotFoundError(`Prescription ${session.currentPrescriptionId} was not found`, {
                prescriptionId: session.currentPrescriptionId,
            });
        response.setHeader("ETag", formatRevisionEtag(session.version));
        return plannedSessionResponseSchema.parse(toResponse({ session, prescription }));
    }

    @Patch(":id")
    @ApiOperation({ summary: "Update a planned session, republishing its prescription when supplied" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    update(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        const request = parseContract(
            updatePlannedSessionRequestSchema,
            rawBody,
            "Planned session update validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.planned-session.update",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.update(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/complete")
    @ApiOperation({ summary: "Mark a planned session completed or partially completed" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    complete(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        const request = parseContract(
            completePlannedSessionRequestSchema,
            rawBody ?? {},
            "Planned session completion validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.planned-session.complete",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.complete(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/skip")
    @ApiOperation({ summary: "Skip a planned session with an optional structured reason" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    skip(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        return this.outcome("skip", id, rawBody, ifMatch, rawCorrelationId, idempotencyKey, response, (v, cmd, m, t) =>
            this.commands.skip(id, v, cmd, m, t),
        );
    }

    @Post(":id/cancel")
    @ApiOperation({ summary: "Cancel a planned session with an optional structured reason" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    cancel(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        return this.outcome(
            "cancel",
            id,
            rawBody,
            ifMatch,
            rawCorrelationId,
            idempotencyKey,
            response,
            (v, cmd, m, t) => this.commands.cancel(id, v, cmd, m, t),
        );
    }

    @Post(":id/reopen")
    @ApiOperation({ summary: "Return a terminal planned session to the planned state" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    reopen(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.planned-session.reopen",
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.reopen(id, expectedVersion, metadata, transaction),
        });
    }

    @Post(":id/archive")
    @ApiOperation({ summary: "Archive a planned session" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    archive(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.planned-session.archive",
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.archive(id, expectedVersion, metadata, transaction),
        });
    }

    @Post(":id/restore")
    @ApiOperation({ summary: "Restore an archived planned session" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    restore(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<PlannedSessionResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.planned-session.restore",
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.restore(id, expectedVersion, metadata, transaction),
        });
    }

    private outcome(
        operation: string,
        id: string,
        rawBody: unknown,
        ifMatch: string | undefined,
        rawCorrelationId: string | undefined,
        idempotencyKey: string | undefined,
        response: HeaderResponse,
        command: (
            expectedVersion: number,
            outcome: PlannedSessionOutcomeCommand,
            metadata: PlannedSessionMutationMetadata,
            transaction?: unknown,
        ) => Promise<PlannedSessionDetail>,
    ): Promise<PlannedSessionResponse> {
        const request = parseContract(
            skipCancelPlannedSessionRequestSchema,
            rawBody ?? {},
            "Planned session outcome validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: `training.planned-session.${operation}`,
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction =>
                command(
                    expectedVersion,
                    { reason: request.reason ?? null, notes: request.notes ?? null },
                    metadata,
                    transaction,
                ),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: PlannedSessionMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => Promise<PlannedSessionDetail>;
    }): Promise<PlannedSessionResponse> {
        const perform = async (transaction?: unknown) =>
            plannedSessionResponseSchema.parse(toResponse(await input.command(transaction)));
        let body: PlannedSessionResponse;
        if (input.idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                {
                    operation: input.operation,
                    key: input.idempotencyKey,
                    request: input.request,
                    context: input.metadata,
                },
                async transaction => ({ status: input.status, body: await perform(transaction) }),
            );
            body = result.body;
            input.response.setHeader("Idempotency-Replayed", String(result.replayed));
        } else {
            body = await perform();
        }
        input.response.setHeader("ETag", formatRevisionEtag(body.version));
        return body;
    }
}

function toResponse(detail: PlannedSessionDetail): unknown {
    return { ...detail.session, prescription: detail.prescription };
}

function sessionId(value: string) {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Planned session ID must be a UUID", {
            plannedSessionId: ["Planned session ID must be a UUID"],
        });
    }
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

function mutationMetadata(rawCorrelationId: string | undefined): PlannedSessionMutationMetadata {
    return { correlationId: rawCorrelationId?.trim() || randomUUID(), actorId: null, source: "user" };
}

function expectedVersionFrom(ifMatch: string | undefined): number {
    if (!ifMatch) throw new ExpectedVersionRequiredError();
    try {
        return parseRevisionEtag(ifMatch);
    } catch (error) {
        throw new ApplicationValidationError(error instanceof Error ? error.message : "If-Match is invalid", {
            ifMatch: ["If-Match must be a quoted positive version"],
        });
    }
}
