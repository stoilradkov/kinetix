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
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import {
    createTrainingGoalRequestSchema,
    trainingGoalListResponseSchema,
    trainingGoalResponseSchema,
    updateTrainingGoalRequestSchema,
    type TrainingGoalListResponse,
    type TrainingGoalResponse,
} from "@kinetix/types";

import {
    TRAINING_GOAL_COMMANDS,
    TRAINING_GOAL_REPOSITORY,
    TrainingGoalNotFoundError,
    type TrainingGoalCommands,
    type TrainingGoalMutationMetadata,
    type TrainingGoalRepository,
    type TrainingGoalResource,
} from "#src/modules/training/application/index";
import { goalStatuses, type GoalStatus } from "#src/modules/training/domain/index";
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

@ApiTags("training goals")
@Controller({ path: "training/goals", version: "1" })
export class TrainingGoalController {
    constructor(
        @Inject(TRAINING_GOAL_COMMANDS)
        private readonly commands: TrainingGoalCommands,
        @Inject(TRAINING_GOAL_REPOSITORY)
        private readonly repository: TrainingGoalRepository,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List training goals, optionally filtered by status" })
    async list(@Query("status") rawStatus: string | undefined): Promise<TrainingGoalListResponse> {
        const items = await this.repository.listGoals(rawStatus ? { status: parseStatus(rawStatus) } : undefined);
        return trainingGoalListResponseSchema.parse({ items });
    }

    @Post()
    @ApiOperation({ summary: "Create a training goal for the active profile" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingGoalResponse> {
        const request = parseContract(
            createTrainingGoalRequestSchema,
            rawBody,
            "Training goal creation validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.goal.create",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.create(request, metadata, transaction),
        });
    }

    @Get(":id")
    @ApiOperation({ summary: "Get one training goal" })
    @ApiParam({ name: "id", format: "uuid" })
    async get(
        @Param("id") id: string,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingGoalResponse> {
        const resource = await this.repository.readGoal(goalId(id));
        if (!resource) throw new TrainingGoalNotFoundError(id);
        response.setHeader("ETag", formatRevisionEtag(resource.version));
        return trainingGoalResponseSchema.parse(resource);
    }

    @Patch(":id")
    @ApiOperation({ summary: "Update a training goal" })
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
    ): Promise<TrainingGoalResponse> {
        const request = parseContract(
            updateTrainingGoalRequestSchema,
            rawBody,
            "Training goal update validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.goal.update",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.update(id, expectedVersion, request, metadata, transaction),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: TrainingGoalMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => Promise<TrainingGoalResource>;
    }): Promise<TrainingGoalResponse> {
        const perform = async (transaction?: unknown) =>
            trainingGoalResponseSchema.parse(await input.command(transaction));
        let body: TrainingGoalResponse;
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

function parseStatus(value: string): GoalStatus {
    if ((goalStatuses as readonly string[]).includes(value)) return value as GoalStatus;
    throw new ApplicationValidationError(`Unknown goal status '${value}'`, {
        status: [`status must be one of: ${goalStatuses.join(", ")}`],
    });
}

function goalId(value: string) {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Training goal ID must be a UUID", {
            goalId: ["Training goal ID must be a UUID"],
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

function mutationMetadata(rawCorrelationId: string | undefined, reason?: string | null): TrainingGoalMutationMetadata {
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
