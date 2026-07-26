import { randomUUID } from "node:crypto";

import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    Inject,
    Optional,
    Param,
    Patch,
    Post,
    Put,
    Query,
    Res,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import {
    createExerciseRequestSchema,
    exerciseMutationResponseSchema,
    exerciseSnapshotV1Schema,
    replaceExerciseAliasesRequestSchema,
    replaceExerciseMusclesRequestSchema,
    replaceExerciseRelationshipsRequestSchema,
    replaceExerciseTagsRequestSchema,
    updateExerciseRequestSchema,
    type ExerciseCatalogItemResponse,
    type ExerciseSnapshotV1Response,
} from "@kinetix/types";

import {
    EXERCISE_CATALOG_COMMANDS,
    TRAINING_EXERCISE_CATALOG,
    type ExerciseCatalogCommands,
    type ExerciseMutationMetadata,
    type TrainingExerciseCatalogPort,
} from "#src/modules/training/application/index";
import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";
import { parseRevisionEtag, formatRevisionEtag } from "#src/platform/presentation/revision-etag";

import {
    contractValidationException,
    mapExercise,
} from "#src/modules/training/presentation/training-catalog.controller";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("training exercises")
@Controller({ path: "training/catalog/exercises", version: "1" })
export class ExerciseDefinitionController {
    constructor(
        @Inject(EXERCISE_CATALOG_COMMANDS)
        private readonly commands: ExerciseCatalogCommands,
        @Inject(TRAINING_EXERCISE_CATALOG)
        private readonly catalog: TrainingExerciseCatalogPort,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Post()
    @ApiOperation({ summary: "Create a user-owned exercise definition" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseCatalogItemResponse> {
        const request = parseContract(createExerciseRequestSchema, rawBody, "Exercise creation validation failed");
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.exercise.create",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.create(request, metadata, transaction),
        });
    }

    @Get("resolve")
    @ApiOperation({ summary: "Resolve one active exercise by a case-insensitive alias" })
    async resolve(@Query("alias") alias: string | undefined): Promise<ExerciseCatalogItemResponse> {
        if (!alias?.trim()) throw new ApplicationValidationError("Exercise alias is required");
        const exercise = await this.catalog.resolveAlias(alias);
        if (!exercise) throw new ApplicationNotFoundError(`Exercise alias '${alias}' was not found`);
        return exerciseMutationResponseSchema.parse(mapExercise(exercise));
    }

    @Get(":id/snapshots/current")
    @ApiOperation({ summary: "Create the current versioned exercise snapshot" })
    @ApiParam({ name: "id", format: "uuid" })
    async currentSnapshot(@Param("id") id: string): Promise<ExerciseSnapshotV1Response> {
        return exerciseSnapshotV1Schema.parse(await this.catalog.currentSnapshot(id));
    }

    @Get(":id/snapshots/:version")
    @ApiOperation({ summary: "Create an exercise snapshot from a historical aggregate revision" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiParam({ name: "version", type: Number })
    async historicalSnapshot(
        @Param("id") id: string,
        @Param("version") rawVersion: string,
    ): Promise<ExerciseSnapshotV1Response> {
        const version = Number(rawVersion);
        if (!Number.isSafeInteger(version) || version < 1)
            throw new ApplicationValidationError("Exercise version must be a positive integer");
        return exerciseSnapshotV1Schema.parse(await this.catalog.historicalSnapshot(id, version));
    }

    @Get(":id")
    @ApiOperation({ summary: "Get one current or archived exercise definition" })
    @ApiParam({ name: "id", format: "uuid" })
    async get(@Param("id") id: string): Promise<ExerciseCatalogItemResponse> {
        return exerciseMutationResponseSchema.parse(mapExercise(await this.catalog.getExercise(id)));
    }

    @Patch(":id")
    @ApiOperation({ summary: "Update exercise metadata, forking seeded definitions" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    update(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseCatalogItemResponse> {
        const request = parseContract(updateExerciseRequestSchema, rawBody, "Exercise update validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.exercise.update",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.update(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Put(":id/aliases")
    @ApiOperation({ summary: "Replace exercise aliases" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    replaceAliases(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseCatalogItemResponse> {
        const request = parseContract(replaceExerciseAliasesRequestSchema, rawBody, "Exercise alias validation failed");
        return this.executeVersionedMutation(
            "aliases",
            id,
            expectedVersionFrom(ifMatch),
            request,
            rawCorrelationId,
            idempotencyKey,
            response,
            (metadata, transaction, expectedVersion) =>
                this.commands.replaceAliases(id, expectedVersion, request.aliases, metadata, transaction),
        );
    }

    @Put(":id/muscles")
    @ApiOperation({ summary: "Replace primary and secondary exercise muscle assignments" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    replaceMuscles(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseCatalogItemResponse> {
        const request = parseContract(
            replaceExerciseMusclesRequestSchema,
            rawBody,
            "Exercise muscle validation failed",
        );
        return this.executeVersionedMutation(
            "muscles",
            id,
            expectedVersionFrom(ifMatch),
            request,
            rawCorrelationId,
            idempotencyKey,
            response,
            (metadata, transaction, expectedVersion) =>
                this.commands.replaceMuscles(id, expectedVersion, request.muscles, metadata, transaction),
        );
    }

    @Put(":id/tags")
    @ApiOperation({ summary: "Replace exercise tags" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    replaceTags(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseCatalogItemResponse> {
        const request = parseContract(replaceExerciseTagsRequestSchema, rawBody, "Exercise tag validation failed");
        return this.executeVersionedMutation(
            "tags",
            id,
            expectedVersionFrom(ifMatch),
            request,
            rawCorrelationId,
            idempotencyKey,
            response,
            (metadata, transaction, expectedVersion) =>
                this.commands.replaceTags(id, expectedVersion, request.tagIds, metadata, transaction),
        );
    }

    @Put(":id/relationships")
    @ApiOperation({ summary: "Replace variation, progression, regression, and analytics-family relationships" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    replaceRelationships(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseCatalogItemResponse> {
        const request = parseContract(
            replaceExerciseRelationshipsRequestSchema,
            rawBody,
            "Exercise relationship validation failed",
        );
        return this.executeVersionedMutation(
            "relationships",
            id,
            expectedVersionFrom(ifMatch),
            request,
            rawCorrelationId,
            idempotencyKey,
            response,
            (metadata, transaction, expectedVersion) =>
                this.commands.replaceRelationships(id, expectedVersion, request.relationships, metadata, transaction),
        );
    }

    @Post(":id/archive")
    @HttpCode(200)
    @ApiOperation({ summary: "Archive an exercise, forking a seeded definition when necessary" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    archive(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseCatalogItemResponse> {
        const request = mutationReason(rawBody);
        return this.executeVersionedMutation(
            "archive",
            id,
            expectedVersionFrom(ifMatch),
            request,
            rawCorrelationId,
            idempotencyKey,
            response,
            (metadata, transaction, expectedVersion) =>
                this.commands.archive(id, expectedVersion, metadata, transaction),
        );
    }

    @Post(":id/restore")
    @HttpCode(200)
    @ApiOperation({ summary: "Restore an archived user-owned exercise" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    restore(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ExerciseCatalogItemResponse> {
        const request = mutationReason(rawBody);
        return this.executeVersionedMutation(
            "restore",
            id,
            expectedVersionFrom(ifMatch),
            request,
            rawCorrelationId,
            idempotencyKey,
            response,
            (metadata, transaction, expectedVersion) =>
                this.commands.restore(id, expectedVersion, metadata, transaction),
        );
    }

    private executeVersionedMutation<Request>(
        action: string,
        id: string,
        expectedVersion: number,
        request: Request & { readonly reason?: string | null },
        rawCorrelationId: string | undefined,
        idempotencyKey: string | undefined,
        response: HeaderResponse,
        command: (
            metadata: ExerciseMutationMetadata,
            transaction: unknown,
            expectedVersion: number,
        ) => ReturnType<ExerciseCatalogCommands["update"]>,
    ): Promise<ExerciseCatalogItemResponse> {
        const metadata = mutationMetadata(rawCorrelationId, request.reason);
        return this.executeMutation({
            operation: `training.exercise.${action}`,
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => command(metadata, transaction, expectedVersion),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: ExerciseMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => ReturnType<ExerciseCatalogCommands["update"]>;
    }): Promise<ExerciseCatalogItemResponse> {
        const perform = async (transaction?: unknown) =>
            exerciseMutationResponseSchema.parse(mapExercise(await input.command(transaction)));
        let body: ExerciseCatalogItemResponse;
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

function mutationReason(value: unknown): { readonly reason?: string | null } {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value))
        throw new ApplicationValidationError("Exercise lifecycle request must be an object");
    const keys = Object.keys(value);
    if (keys.some(key => key !== "reason"))
        throw new ApplicationValidationError("Exercise lifecycle request contains unknown fields");
    const reason = (value as { reason?: unknown }).reason;
    if (reason === undefined) return {};
    if (reason === null) return { reason: null };
    if (typeof reason !== "string" || reason.trim().length === 0 || reason.trim().length > 500)
        throw new ApplicationValidationError("Exercise mutation reason must contain 1 to 500 characters");
    return { reason: reason.trim() };
}
