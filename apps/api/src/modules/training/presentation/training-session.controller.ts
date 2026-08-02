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
    completeTrainingSessionRequestSchema,
    createTrainingSessionRequestSchema,
    startTrainingSessionRequestSchema,
    trainingSessionListResponseSchema,
    trainingSessionResponseSchema,
    updateTrainingSessionRequestSchema,
    type TrainingSessionListResponse,
    type TrainingSessionResponse,
} from "@kinetix/types";

import {
    TRAINING_SESSION_COMMANDS,
    TRAINING_SESSION_REPOSITORY,
    TrainingSessionNotFoundError,
    type TrainingSessionCommands,
    type TrainingSessionMutationMetadata,
    type TrainingSessionRepository,
    type TrainingSessionResource,
} from "#src/modules/training/application/index";
import {
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

@ApiTags("training sessions")
@Controller({ path: "training/sessions", version: "1" })
export class TrainingSessionController {
    constructor(
        @Inject(TRAINING_SESSION_COMMANDS)
        private readonly commands: TrainingSessionCommands,
        @Inject(TRAINING_SESSION_REPOSITORY)
        private readonly repository: TrainingSessionRepository,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List training sessions, optionally including archived ones" })
    @ApiQuery({ name: "includeArchived", required: false })
    async list(@Query("includeArchived") includeArchived: string | undefined): Promise<TrainingSessionListResponse> {
        const items = await this.repository.listSessions({ includeArchived: includeArchived === "true" });
        return trainingSessionListResponseSchema.parse({ items });
    }

    @Post()
    @ApiOperation({ summary: "Create a training session for the active profile (planned or unplanned)" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            createTrainingSessionRequestSchema,
            rawBody ?? {},
            "Training session validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.session.create",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.create(request, metadata, transaction),
        });
    }

    @Get(":id")
    @ApiOperation({ summary: "Get one training session with its activities and pain records" })
    @ApiParam({ name: "id", format: "uuid" })
    async get(
        @Param("id") id: string,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingSessionResponse> {
        const session = await this.repository.readSession(sessionId(id));
        if (!session) throw new TrainingSessionNotFoundError(id);
        response.setHeader("ETag", formatRevisionEtag(session.version));
        return trainingSessionResponseSchema.parse(toResponse(session));
    }

    @Patch(":id")
    @ApiOperation({ summary: "Update a training session's metadata, readiness, timing, activities, or pain records" })
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
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            updateTrainingSessionRequestSchema,
            rawBody ?? {},
            "Training session update validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.session.update",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.update(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/start")
    @ApiOperation({ summary: "Start a draft session, stamping the server start instant" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    start(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingSessionResponse> {
        parseContract(startTrainingSessionRequestSchema, rawBody ?? {}, "Training session start validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.session.start",
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.start(id, expectedVersion, metadata, transaction),
        });
    }

    @Post(":id/complete")
    @ApiOperation({ summary: "Complete an in-progress session, stamping the end instant and post ratings" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    complete(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            completeTrainingSessionRequestSchema,
            rawBody ?? {},
            "Training session completion validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.session.complete",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.complete(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/reopen")
    @ApiOperation({ summary: "Reopen a completed session for corrections" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    reopen(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingSessionResponse> {
        return this.transition("reopen", id, ifMatch, rawCorrelationId, idempotencyKey, response, (v, m, t) =>
            this.commands.reopen(id, v, m, t),
        );
    }

    @Post(":id/archive")
    @ApiOperation({ summary: "Archive a training session (soft delete)" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    archive(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingSessionResponse> {
        return this.transition("archive", id, ifMatch, rawCorrelationId, idempotencyKey, response, (v, m, t) =>
            this.commands.archive(id, v, m, t),
        );
    }

    @Post(":id/restore")
    @ApiOperation({ summary: "Restore an archived training session" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    restore(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingSessionResponse> {
        return this.transition("restore", id, ifMatch, rawCorrelationId, idempotencyKey, response, (v, m, t) =>
            this.commands.restore(id, v, m, t),
        );
    }

    private transition(
        action: string,
        id: string,
        ifMatch: string | undefined,
        rawCorrelationId: string | undefined,
        idempotencyKey: string | undefined,
        response: HeaderResponse,
        command: (
            expectedVersion: number,
            metadata: TrainingSessionMutationMetadata,
            transaction?: unknown,
        ) => Promise<TrainingSessionResource>,
    ): Promise<TrainingSessionResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: `training.session.${action}`,
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => command(expectedVersion, metadata, transaction),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: TrainingSessionMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => Promise<TrainingSessionResource>;
    }): Promise<TrainingSessionResponse> {
        const perform = async (transaction?: unknown) =>
            trainingSessionResponseSchema.parse(toResponse(await input.command(transaction)));
        let body: TrainingSessionResponse;
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

function toResponse(resource: TrainingSessionResource): unknown {
    return resource;
}

function sessionId(value: string) {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Training session ID must be a UUID", {
            trainingSessionId: ["Training session ID must be a UUID"],
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

function mutationMetadata(rawCorrelationId: string | undefined): TrainingSessionMutationMetadata {
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
