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
    createProgressionRuleRequestSchema,
    progressionRuleListQuerySchema,
    progressionRuleListResponseSchema,
    progressionRuleResponseSchema,
    updateProgressionRuleRequestSchema,
    type ProgressionRuleListResponse,
    type ProgressionRuleResponse,
} from "@kinetix/types";

import {
    PROGRESSION_RULE_COMMANDS,
    PROGRESSION_RULE_REPOSITORY,
    ProgressionRuleNotFoundError,
    type ProgressionRuleCommands,
    type ProgressionRuleListFilter,
    type ProgressionRuleMutationMetadata,
    type ProgressionRuleRepository,
    type ProgressionRuleResource,
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

@ApiTags("progression rules")
@Controller({ path: "training/rules", version: "1" })
export class ProgressionRuleController {
    constructor(
        @Inject(PROGRESSION_RULE_COMMANDS)
        private readonly commands: ProgressionRuleCommands,
        @Inject(PROGRESSION_RULE_REPOSITORY)
        private readonly repository: ProgressionRuleRepository,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List progression rules, optionally filtered by scope, enabled, and archive state" })
    @ApiQuery({ name: "includeArchived", required: false })
    @ApiQuery({ name: "scopeType", required: false })
    @ApiQuery({ name: "enabled", required: false })
    async list(@Query() rawQuery: Record<string, unknown>): Promise<ProgressionRuleListResponse> {
        const query = parseContract(progressionRuleListQuerySchema, rawQuery, "Progression rule query is invalid");
        const filter: ProgressionRuleListFilter = {
            ...(query.includeArchived !== undefined ? { includeArchived: query.includeArchived } : {}),
            ...(query.scopeType !== undefined ? { scopeType: query.scopeType } : {}),
            ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
        };
        const items = await this.repository.listRules(filter);
        return progressionRuleListResponseSchema.parse({ items });
    }

    @Post()
    @ApiOperation({ summary: "Create a progression rule for the active profile" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgressionRuleResponse> {
        const request = parseContract(
            createProgressionRuleRequestSchema,
            rawBody,
            "Progression rule creation validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.progression-rule.create",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.create(request, metadata, transaction),
        });
    }

    @Get(":id")
    @ApiOperation({ summary: "Get one progression rule" })
    @ApiParam({ name: "id", format: "uuid" })
    async get(
        @Param("id") id: string,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgressionRuleResponse> {
        const resource = await this.repository.readRule(ruleId(id));
        if (!resource) throw new ProgressionRuleNotFoundError(id);
        response.setHeader("ETag", formatRevisionEtag(resource.version));
        return progressionRuleResponseSchema.parse(resource);
    }

    @Patch(":id")
    @ApiOperation({ summary: "Update a progression rule" })
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
    ): Promise<ProgressionRuleResponse> {
        const request = parseContract(
            updateProgressionRuleRequestSchema,
            rawBody,
            "Progression rule update validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.progression-rule.update",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.update(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/archive")
    @ApiOperation({ summary: "Archive a progression rule" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    archive(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgressionRuleResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.progression-rule.archive",
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.archive(id, expectedVersion, metadata, transaction),
        });
    }

    @Post(":id/restore")
    @ApiOperation({ summary: "Restore an archived progression rule" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    restore(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ProgressionRuleResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.progression-rule.restore",
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.restore(id, expectedVersion, metadata, transaction),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: ProgressionRuleMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => Promise<ProgressionRuleResource>;
    }): Promise<ProgressionRuleResponse> {
        const perform = async (transaction?: unknown) =>
            progressionRuleResponseSchema.parse(await input.command(transaction));
        let body: ProgressionRuleResponse;
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

function ruleId(value: string) {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Progression rule ID must be a UUID", {
            ruleId: ["Progression rule ID must be a UUID"],
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

function mutationMetadata(rawCorrelationId: string | undefined): ProgressionRuleMutationMetadata {
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
