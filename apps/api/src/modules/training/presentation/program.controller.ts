import { randomUUID } from "node:crypto";

import {
    Body,
    Controller,
    Delete,
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
    activateProgramRequestSchema,
    activateProgramResponseSchema,
    attachProgramSessionRequestSchema,
    changeProgramStartDateRequestSchema,
    changeProgramStartDateResponseSchema,
    createProgramRequestSchema,
    programListResponseSchema,
    programResponseSchema,
    programSessionsResponseSchema,
    updateProgramRequestSchema,
    type ActivateProgramResponse,
    type ChangeProgramStartDateResponse,
    type ProgramListResponse,
    type ProgramResponse,
    type ProgramSessionsResponse,
} from "@kinetix/types";

import {
    PROGRAM_COMMANDS,
    PROGRAM_QUERIES,
    type ActivateProgramResult,
    type ChangeProgramStartDateResult,
    type ProgramCommands,
    type ProgramDetail,
    type ProgramMutationMetadata,
    type ProgramQueries,
} from "#src/modules/training/application/index";
import {
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";
import { formatRevisionEtag, parseRevisionEtag } from "#src/platform/presentation/revision-etag";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("training programs")
@Controller({ path: "training/programs", version: "1" })
export class ProgramController {
    constructor(
        @Inject(PROGRAM_COMMANDS)
        private readonly commands: ProgramCommands,
        @Inject(PROGRAM_QUERIES)
        private readonly queries: ProgramQueries,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List programs, optionally including archived ones" })
    @ApiQuery({ name: "includeArchived", required: false })
    async list(@Query("includeArchived") includeArchived: string | undefined): Promise<ProgramListResponse> {
        const items = await this.queries.list({ includeArchived: includeArchived === "true" });
        return programListResponseSchema.parse({ items });
    }

    @Post()
    @ApiOperation({ summary: "Create a program for the active profile" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgramResponse> {
        const request = parseContract(createProgramRequestSchema, rawBody, "Program validation failed");
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.program.create",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.create(request, metadata, transaction),
        });
    }

    @Get(":id")
    @ApiOperation({ summary: "Get one program with its blocks, goal links, and current warnings" })
    @ApiParam({ name: "id", format: "uuid" })
    async get(@Param("id") id: string, @Res({ passthrough: true }) response: HeaderResponse): Promise<ProgramResponse> {
        const detail = await this.queries.get(id);
        response.setHeader("ETag", formatRevisionEtag(detail.program.version));
        return programResponseSchema.parse(toResponse(detail));
    }

    @Get(":id/sessions")
    @ApiOperation({ summary: "List the planned sessions that belong to a program" })
    @ApiParam({ name: "id", format: "uuid" })
    async sessions(@Param("id") id: string): Promise<ProgramSessionsResponse> {
        const items = await this.queries.sessions(id);
        return programSessionsResponseSchema.parse({ items });
    }

    @Patch(":id")
    @ApiOperation({ summary: "Update a program's metadata, schedule, blocks, or goal links" })
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
    ): Promise<ProgramResponse> {
        const request = parseContract(updateProgramRequestSchema, rawBody, "Program update validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.program.update",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.update(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/activate")
    @ApiOperation({ summary: "Activate a program and generate its planned sessions" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    activate(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ActivateProgramResponse> {
        const request = parseContract(activateProgramRequestSchema, rawBody, "Program activation validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeActivation({
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            command: transaction => this.commands.activate(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/change-start-date")
    @ApiOperation({ summary: "Change a program's start date, sliding only incomplete future sessions" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    changeStartDate(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ChangeProgramStartDateResponse> {
        const request = parseContract(
            changeProgramStartDateRequestSchema,
            rawBody,
            "Program start-date validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeChangeStartDate({
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            command: transaction => this.commands.changeStartDate(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/pause")
    @ApiOperation({ summary: "Pause an active program" })
    pause(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgramResponse> {
        return this.lifecycle("pause", id, ifMatch, rawCorrelationId, idempotencyKey, response, (v, m, t) =>
            this.commands.pause(id, v, m, t),
        );
    }

    @Post(":id/resume")
    @ApiOperation({ summary: "Resume a paused program" })
    resume(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgramResponse> {
        return this.lifecycle("resume", id, ifMatch, rawCorrelationId, idempotencyKey, response, (v, m, t) =>
            this.commands.resume(id, v, m, t),
        );
    }

    @Post(":id/complete")
    @ApiOperation({ summary: "Complete a program" })
    complete(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgramResponse> {
        return this.lifecycle("complete", id, ifMatch, rawCorrelationId, idempotencyKey, response, (v, m, t) =>
            this.commands.complete(id, v, m, t),
        );
    }

    @Post(":id/archive")
    @ApiOperation({ summary: "Archive a program" })
    archive(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgramResponse> {
        return this.lifecycle("archive", id, ifMatch, rawCorrelationId, idempotencyKey, response, (v, m, t) =>
            this.commands.archive(id, v, m, t),
        );
    }

    @Post(":id/restore")
    @ApiOperation({ summary: "Restore an archived program" })
    restore(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgramResponse> {
        return this.lifecycle("restore", id, ifMatch, rawCorrelationId, idempotencyKey, response, (v, m, t) =>
            this.commands.restore(id, v, m, t),
        );
    }

    @Post(":id/sessions")
    @ApiOperation({ summary: "Attach an existing planned session to a program" })
    @ApiParam({ name: "id", format: "uuid" })
    attachSession(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgramResponse> {
        const request = parseContract(attachProgramSessionRequestSchema, rawBody, "Attach session validation failed");
        return this.executeMutation({
            request,
            metadata: mutationMetadata(rawCorrelationId),
            response,
            status: 200,
            command: transaction => this.commands.attachSession(id, request, transaction),
        });
    }

    @Delete(":id/sessions/:plannedSessionId")
    @ApiOperation({ summary: "Detach a planned session from a program" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiParam({ name: "plannedSessionId", format: "uuid" })
    detachSession(
        @Param("id") id: string,
        @Param("plannedSessionId") plannedSessionId: string,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgramResponse> {
        return this.executeMutation({
            request: { id, plannedSessionId },
            metadata: mutationMetadata(rawCorrelationId),
            response,
            status: 200,
            command: transaction => this.commands.detachSession(id, plannedSessionId, transaction),
        });
    }

    private lifecycle(
        operation: string,
        id: string,
        ifMatch: string | undefined,
        rawCorrelationId: string | undefined,
        idempotencyKey: string | undefined,
        response: HeaderResponse,
        command: (
            expectedVersion: number,
            metadata: ProgramMutationMetadata,
            transaction?: unknown,
        ) => Promise<ProgramDetail>,
    ): Promise<ProgramResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: `training.program.${operation}`,
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => command(expectedVersion, metadata, transaction),
        });
    }

    private async executeMutation(input: {
        readonly operation?: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: ProgramMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => Promise<ProgramDetail>;
    }): Promise<ProgramResponse> {
        const perform = async (transaction?: unknown) =>
            programResponseSchema.parse(toResponse(await input.command(transaction)));
        let body: ProgramResponse;
        if (input.idempotencyKey !== undefined && input.operation !== undefined) {
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

    private async executeActivation(input: {
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: ProgramMutationMetadata;
        readonly response: HeaderResponse;
        readonly command: (transaction?: unknown) => Promise<ActivateProgramResult>;
    }): Promise<ActivateProgramResponse> {
        const perform = async (transaction?: unknown) =>
            activateProgramResponseSchema.parse(toActivationResponse(await input.command(transaction)));
        let body: ActivateProgramResponse;
        if (input.idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                {
                    operation: "training.program.activate",
                    key: input.idempotencyKey,
                    request: input.request,
                    context: input.metadata,
                },
                async transaction => ({ status: 200, body: await perform(transaction) }),
            );
            body = result.body;
            input.response.setHeader("Idempotency-Replayed", String(result.replayed));
        } else {
            body = await perform();
        }
        input.response.setHeader("ETag", formatRevisionEtag(body.version));
        return body;
    }

    private async executeChangeStartDate(input: {
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: ProgramMutationMetadata;
        readonly response: HeaderResponse;
        readonly command: (transaction?: unknown) => Promise<ChangeProgramStartDateResult>;
    }): Promise<ChangeProgramStartDateResponse> {
        const perform = async (transaction?: unknown) =>
            changeProgramStartDateResponseSchema.parse(toChangeStartDateResponse(await input.command(transaction)));
        let body: ChangeProgramStartDateResponse;
        if (input.idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                {
                    operation: "training.program.change-start-date",
                    key: input.idempotencyKey,
                    request: input.request,
                    context: input.metadata,
                },
                async transaction => ({ status: 200, body: await perform(transaction) }),
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

function toResponse(detail: ProgramDetail): unknown {
    return { ...detail.program, warnings: detail.warnings };
}

function toChangeStartDateResponse(result: ChangeProgramStartDateResult): unknown {
    return { ...result.program, warnings: result.warnings, movedSessions: result.movedSessions };
}

function toActivationResponse(result: ActivateProgramResult): unknown {
    return {
        ...result.program,
        warnings: result.warnings,
        generatedSessions: result.generatedSessions.map(session => ({
            ...session.session,
            prescription: session.prescription,
        })),
    };
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

function mutationMetadata(rawCorrelationId: string | undefined): ProgramMutationMetadata {
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
