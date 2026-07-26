import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Headers, HttpCode, Inject, Optional, Param, Post, Query, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import {
    exerciseMergeHistoryResponseSchema,
    exerciseMergePreviewRequestSchema,
    exerciseMergePreviewResponseSchema,
    exerciseMergeResourceSchema,
    mergeExerciseRequestSchema,
    revertExerciseMergeRequestSchema,
    type ExerciseMergeHistoryResponse,
    type ExerciseMergePreviewResponse,
    type ExerciseMergeResource,
} from "@kinetix/types";

import {
    EXERCISE_MERGE_SERVICE,
    type ExerciseMergeRecord,
    type ExerciseMergeService,
    type ExerciseMutationMetadata,
} from "#src/modules/training/application/index";
import {
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";
import { parseRevisionEtag, formatRevisionEtag } from "#src/platform/presentation/revision-etag";

import { contractValidationException } from "#src/modules/training/presentation/training-catalog.controller";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("training exercise merges")
@Controller({ path: "training/catalog/exercise-merges", version: "1" })
export class ExerciseMergeController {
    constructor(
        @Inject(EXERCISE_MERGE_SERVICE)
        private readonly service: ExerciseMergeService,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Post("preview")
    @HttpCode(200)
    @ApiOperation({ summary: "Preview current references, aliases, and analytics impact before merging" })
    async preview(@Body() rawBody: unknown): Promise<ExerciseMergePreviewResponse> {
        const request = parseContract(
            exerciseMergePreviewRequestSchema,
            rawBody,
            "Exercise merge preview validation failed",
        );
        return exerciseMergePreviewResponseSchema.parse({
            schemaVersion: 1,
            ...(await this.service.preview(request)),
        });
    }

    @Post()
    @ApiOperation({ summary: "Merge a duplicate exercise into a canonical definition" })
    @ApiHeader({ name: "Idempotency-Key", required: true })
    async merge(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseMergeResource> {
        const request = parseContract(mergeExerciseRequestSchema, rawBody, "Exercise merge validation failed");
        const metadata = mutationMetadata(rawCorrelationId, request.reason);
        return this.executeMutation({
            operation: "training.exercise.merge",
            idempotencyKey: requiredIdempotencyKey(rawIdempotencyKey),
            request,
            metadata,
            status: 201,
            response,
            command: transaction => this.service.merge(request, metadata, transaction),
        });
    }

    @Get("history/:exerciseId")
    @ApiOperation({ summary: "List applied and reverted merges affecting an exercise" })
    @ApiParam({ name: "exerciseId", format: "uuid" })
    async history(
        @Param("exerciseId") exerciseId: string,
        @Query("limit") rawLimit?: string,
        @Query("cursor") rawCursor?: string,
    ): Promise<ExerciseMergeHistoryResponse> {
        const limit = rawLimit === undefined ? 20 : positiveInteger(rawLimit, "limit");
        const cursor = rawCursor === undefined ? undefined : nonNegativeInteger(rawCursor, "cursor");
        const history = await this.service.history(exerciseId, limit, cursor);
        return exerciseMergeHistoryResponseSchema.parse({
            schemaVersion: 1,
            items: history.items.map(mapMerge),
            nextCursor: history.nextCursor,
        });
    }

    @Get(":id")
    @ApiOperation({ summary: "Get merge evidence and current revert state" })
    @ApiParam({ name: "id", format: "uuid" })
    async get(
        @Param("id") id: string,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseMergeResource> {
        const resource = mapMerge(await this.service.get(id));
        response.setHeader("ETag", formatRevisionEtag(resource.version));
        return resource;
    }

    @Post(":id/revert")
    @HttpCode(200)
    @ApiOperation({ summary: "Revert an active exercise merge and restore its redirected references" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: true })
    async revert(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseMergeResource> {
        const request = parseContract(
            revertExerciseMergeRequestSchema,
            rawBody,
            "Exercise merge revert validation failed",
        );
        const expectedMergeVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, request.reason);
        return this.executeMutation({
            operation: "training.exercise.merge.revert",
            idempotencyKey: requiredIdempotencyKey(rawIdempotencyKey),
            request: { id, expectedMergeVersion, ...request },
            metadata,
            status: 200,
            response,
            command: transaction =>
                this.service.revert(
                    id,
                    {
                        expectedMergeVersion,
                        expectedCanonicalVersion: request.expectedCanonicalVersion,
                        expectedMergedVersion: request.expectedMergedVersion,
                        reason: request.reason,
                    },
                    metadata,
                    transaction,
                ),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey: string;
        readonly request: unknown;
        readonly metadata: ExerciseMutationMetadata;
        readonly status: number;
        readonly response: HeaderResponse;
        readonly command: (transaction: unknown) => Promise<ExerciseMergeRecord>;
    }): Promise<ExerciseMergeResource> {
        if (!this.idempotency) throw new Error("Idempotency support is not configured");
        const result = await this.idempotency.execute(
            {
                operation: input.operation,
                key: input.idempotencyKey,
                request: input.request,
                context: input.metadata,
            },
            async transaction => ({
                status: input.status,
                body: mapMerge(await input.command(transaction)),
            }),
        );
        input.response.setHeader("Idempotency-Replayed", String(result.replayed));
        input.response.setHeader("ETag", formatRevisionEtag(result.body.version));
        return exerciseMergeResourceSchema.parse(result.body);
    }
}

function mapMerge(record: ExerciseMergeRecord): ExerciseMergeResource {
    return exerciseMergeResourceSchema.parse({
        schemaVersion: 1,
        ...record,
        redirectedAliases: [...record.redirectedAliases],
        externalIds: [...record.externalIds],
        referenceImpact: [...record.referenceImpact],
        affectedExerciseIds: [...record.affectedExerciseIds],
        affectedFamilyExerciseIds: [...record.affectedFamilyExerciseIds],
    });
}

function parseContract<Output>(
    schema: {
        safeParse(value: unknown):
            | { success: true; data: Output }
            | {
                  success: false;
                  error: {
                      issues: readonly {
                          path: readonly PropertyKey[];
                          message: string;
                      }[];
                  };
              };
    },
    value: unknown,
    message: string,
): Output {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw contractValidationException(message, parsed.error.issues);
    return parsed.data;
}

function mutationMetadata(rawCorrelationId: string | undefined, reason?: string | null): ExerciseMutationMetadata {
    return {
        correlationId: rawCorrelationId?.trim() || randomUUID(),
        actorId: null,
        source: "user",
        ...(reason !== undefined ? { reason } : {}),
    };
}

function requiredIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key) throw new ApplicationValidationError("Idempotency-Key is required for exercise merge commands");
    if (key.length > 255) throw new ApplicationValidationError("Idempotency-Key cannot exceed 255 characters");
    return key;
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

function positiveInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new ApplicationValidationError(`Exercise merge history ${name} must be positive`);
    return parsed;
}

function nonNegativeInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
        throw new ApplicationValidationError(`Exercise merge history ${name} must be non-negative`);
    return parsed;
}
