import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Headers, HttpException, Inject, Optional, Patch, Post, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
    coreProfileResponseSchema,
    createProfileRequestSchema,
    updateProfileRequestSchema,
    type CoreProfileResponse,
} from "@kinetix/types";

import {
    CORE_PROFILE_COMMANDS,
    CORE_PROFILE_REPOSITORY,
    type CoreProfileCommands,
    type CoreProfileMutationMetadata,
    type CoreProfileRepository,
    type CoreProfileResource,
} from "#src/modules/profile/application/index";
import {
    ApplicationNotFoundError,
    ExpectedVersionRequiredError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    ApplicationValidationError,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";
import { formatRevisionEtag, parseRevisionEtag } from "#src/platform/presentation/revision-etag";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("profile")
@Controller({ path: "profile", version: "1" })
export class CoreProfileController {
    constructor(
        @Inject(CORE_PROFILE_COMMANDS)
        private readonly commands: CoreProfileCommands,
        @Inject(CORE_PROFILE_REPOSITORY)
        private readonly repository: CoreProfileRepository,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "Get the active core profile" })
    async get(@Res({ passthrough: true }) response: HeaderResponse): Promise<CoreProfileResponse> {
        const resource = await this.repository.readActive();
        if (!resource) throw new ApplicationNotFoundError("No active core profile exists");
        response.setHeader("ETag", formatRevisionEtag(resource.version));
        return coreProfileResponseSchema.parse(resource);
    }

    @Post()
    @ApiOperation({ summary: "Create the single active core profile" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<CoreProfileResponse> {
        const request = parseContract(createProfileRequestSchema, rawBody, "Core profile creation validation failed");
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "profile.core.create",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.create(request, metadata, transaction),
        });
    }

    @Patch()
    @ApiOperation({ summary: "Update the active core profile" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    update(
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<CoreProfileResponse> {
        const request = parseContract(updateProfileRequestSchema, rawBody, "Core profile update validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "profile.core.update",
            idempotencyKey,
            request: { expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.update(expectedVersion, request, metadata, transaction),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: CoreProfileMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => Promise<CoreProfileResource>;
    }): Promise<CoreProfileResponse> {
        const perform = async (transaction?: unknown) =>
            coreProfileResponseSchema.parse(await input.command(transaction));
        let body: CoreProfileResponse;
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

function mutationMetadata(rawCorrelationId: string | undefined, reason?: string | null): CoreProfileMutationMetadata {
    return {
        correlationId: rawCorrelationId?.trim() || randomUUID(),
        actorId: null,
        source: "user",
        ...(reason !== undefined ? { reason } : {}),
    };
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
