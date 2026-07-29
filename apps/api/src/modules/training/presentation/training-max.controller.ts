import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Headers, HttpException, Inject, Optional, Post, Query, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    recordTrainingMaxRequestSchema,
    trainingMaxListResponseSchema,
    trainingMaxResponseSchema,
    type TrainingMaxListResponse,
    type TrainingMaxResponse,
} from "@kinetix/types";

import {
    TRAINING_MAX_COMMANDS,
    TRAINING_MAX_QUERIES,
    type TrainingMaxCommands,
    type TrainingMaxMutationMetadata,
    type TrainingMaxQueries,
    type TrainingMaxSeriesRef,
} from "#src/modules/training/application/index";
import { trainingMaxTypes, type TrainingMaxType } from "#src/modules/training/domain/index";
import {
    ApplicationValidationError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("training maxima")
@Controller({ path: "training/maxes", version: "1" })
export class TrainingMaxController {
    constructor(
        @Inject(TRAINING_MAX_COMMANDS)
        private readonly commands: TrainingMaxCommands,
        @Inject(TRAINING_MAX_QUERIES)
        private readonly queries: TrainingMaxQueries,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List the current training maxima, optionally filtered by exercise" })
    @ApiQuery({ name: "exerciseId", required: false, format: "uuid" })
    async list(@Query("exerciseId") exerciseId: string | undefined): Promise<TrainingMaxListResponse> {
        const items = await this.queries.listCurrent(
            exerciseId ? { exerciseId: uuid(exerciseId, "exerciseId") } : undefined,
        );
        return trainingMaxListResponseSchema.parse({ items });
    }

    @Get("history")
    @ApiOperation({ summary: "List the full effective-interval history for one training-max series" })
    @ApiQuery({ name: "exerciseId", required: true, format: "uuid" })
    @ApiQuery({ name: "maxType", required: true })
    @ApiQuery({ name: "customLabel", required: false })
    async history(
        @Query("exerciseId") exerciseId: string | undefined,
        @Query("maxType") maxType: string | undefined,
        @Query("customLabel") customLabel: string | undefined,
    ): Promise<TrainingMaxListResponse> {
        const items = await this.queries.history(series(exerciseId, maxType, customLabel));
        return trainingMaxListResponseSchema.parse({ items });
    }

    @Get("effective")
    @ApiOperation({ summary: "Resolve the training max in force at an instant" })
    @ApiQuery({ name: "exerciseId", required: true, format: "uuid" })
    @ApiQuery({ name: "maxType", required: true })
    @ApiQuery({ name: "customLabel", required: false })
    @ApiQuery({ name: "at", required: false, description: "ISO 8601 instant; defaults to now" })
    async effective(
        @Query("exerciseId") exerciseId: string | undefined,
        @Query("maxType") maxType: string | undefined,
        @Query("customLabel") customLabel: string | undefined,
        @Query("at") at: string | undefined,
    ): Promise<TrainingMaxResponse> {
        const resolved = await this.queries.asOf(series(exerciseId, maxType, customLabel), instant(at));
        if (!resolved)
            throw new HttpException(
                { code: "NOT_FOUND", message: "No training max is effective at that instant" },
                404,
            );
        return trainingMaxResponseSchema.parse(resolved);
    }

    @Post()
    @ApiOperation({ summary: "Record a new training max, closing the current one" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async record(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<TrainingMaxResponse> {
        const request = parseContract(recordTrainingMaxRequestSchema, rawBody, "Training max validation failed");
        const metadata = mutationMetadata(rawCorrelationId);
        const input = {
            exerciseId: request.exerciseId,
            maxType: request.maxType,
            customLabel: request.customLabel ?? null,
            value: request.load.value,
            unit: request.load.unit,
            ...(request.source !== undefined ? { source: request.source } : {}),
            note: request.note ?? null,
            ...(request.effectiveFrom !== undefined ? { effectiveFrom: request.effectiveFrom } : {}),
        };
        const perform = async (transaction?: unknown) =>
            trainingMaxResponseSchema.parse(await this.commands.record(input, metadata, transaction));
        if (idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                { operation: "training.training-max.record", key: idempotencyKey, request, context: metadata },
                async transaction => ({ status: 201, body: await perform(transaction) }),
            );
            response.setHeader("Idempotency-Replayed", String(result.replayed));
            return result.body;
        }
        return perform();
    }
}

function series(
    exerciseId: string | undefined,
    maxType: string | undefined,
    customLabel: string | undefined,
): TrainingMaxSeriesRef {
    return {
        exerciseId: uuid(exerciseId, "exerciseId"),
        maxType: parseType(maxType),
        customLabel: customLabel === undefined || customLabel.trim().length === 0 ? null : customLabel.trim(),
    };
}

function parseType(value: string | undefined): TrainingMaxType {
    if (value && (trainingMaxTypes as readonly string[]).includes(value)) return value as TrainingMaxType;
    throw new ApplicationValidationError(`Unknown training max type '${value ?? ""}'`, {
        maxType: [`maxType must be one of: ${trainingMaxTypes.join(", ")}`],
    });
}

function uuid(value: string | undefined, field: string): string {
    const normalized = (value ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized))
        throw new ApplicationValidationError(`${field} must be a UUID`, { [field]: [`${field} must be a UUID`] });
    return normalized;
}

function instant(value: string | undefined): string {
    if (value === undefined) return new Date().toISOString();
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        throw new ApplicationValidationError("at must be an ISO 8601 instant", {
            at: ["at must be an ISO 8601 instant"],
        });
    return date.toISOString();
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

function mutationMetadata(rawCorrelationId: string | undefined): TrainingMaxMutationMetadata {
    return {
        correlationId: rawCorrelationId?.trim() || randomUUID(),
        actorId: null,
        source: "user",
    };
}
