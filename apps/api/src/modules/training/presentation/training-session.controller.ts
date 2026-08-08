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
    Put,
    Query,
    Res,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    activeTrainingSessionResponseSchema,
    addSessionActivityRequestSchema,
    completeTrainingSessionRequestSchema,
    completionPreviewResponseSchema,
    createTrainingSessionRequestSchema,
    recordPerformedSetRequestSchema,
    recordSessionMappingsRequestSchema,
    reorderSessionActivitiesRequestSchema,
    runningActivitySummaryResponseSchema,
    setRunningActivityRequestSchema,
    startEmptyTrainingSessionRequestSchema,
    startPlannedTrainingSessionRequestSchema,
    startPreviousTrainingSessionRequestSchema,
    startTemplateTrainingSessionRequestSchema,
    startTrainingSessionRequestSchema,
    substituteOccurrenceRequestSchema,
    trainingSessionListQuerySchema,
    trainingSessionListResponseSchema,
    trainingSessionResponseSchema,
    updatePerformedSetRequestSchema,
    updateTrainingSessionRequestSchema,
    type ActiveTrainingSessionResponse,
    type CompletionPreviewResponse,
    type RunningActivitySummaryResponse,
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
import { deriveAveragePace, type SessionActivityState } from "#src/modules/training/domain/index";
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
    @ApiOperation({ summary: "List training sessions newest-first, with keyset pagination and filters" })
    @ApiQuery({ name: "limit", required: false })
    @ApiQuery({ name: "cursor", required: false })
    @ApiQuery({ name: "status", required: false })
    @ApiQuery({ name: "from", required: false })
    @ApiQuery({ name: "to", required: false })
    @ApiQuery({ name: "search", required: false })
    @ApiQuery({ name: "includeArchived", required: false })
    async list(@Query() rawQuery: Record<string, unknown> = {}): Promise<TrainingSessionListResponse> {
        const query = parseContract(trainingSessionListQuerySchema, rawQuery, "Session list query validation failed");
        const { items, nextCursor } = await this.repository.listSessions(query);
        return trainingSessionListResponseSchema.parse({ items, nextCursor });
    }

    @Post()
    @ApiOperation({ summary: "Create a training session for the active profile (planned or unplanned)" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            createTrainingSessionRequestSchema,
            rawBody ?? {},
            "Training session validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
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

    @Post("start-planned")
    @ApiOperation({ summary: "Start an in-progress session from a planned session, freezing its resolved targets" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    startPlanned(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            startPlannedTrainingSessionRequestSchema,
            rawBody ?? {},
            "Start-from-planned validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.start-planned",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.startPlanned(request, metadata, transaction),
        });
    }

    @Post("start-empty")
    @ApiOperation({ summary: "Start an empty in-progress session for the active profile" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    startEmpty(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            startEmptyTrainingSessionRequestSchema,
            rawBody ?? {},
            "Start-empty validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.start-empty",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.startEmpty(request, metadata, transaction),
        });
    }

    @Post("start-template")
    @ApiOperation({ summary: "Start an in-progress session from a workout template, freezing its resolved targets" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    startTemplate(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            startTemplateTrainingSessionRequestSchema,
            rawBody ?? {},
            "Start-from-template validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.start-template",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.startFromTemplate(request, metadata, transaction),
        });
    }

    @Post("start-previous")
    @ApiOperation({ summary: "Start an in-progress session by repeating a previous workout" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    startPrevious(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            startPreviousTrainingSessionRequestSchema,
            rawBody ?? {},
            "Start-from-previous validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.start-previous",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.startFromPrevious(request, metadata, transaction),
        });
    }

    @Get(":id/active")
    @ApiOperation({ summary: "Get the complete active-session view (session tree plus its frozen plan)" })
    @ApiParam({ name: "id", format: "uuid" })
    async active(
        @Param("id") id: string,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ActiveTrainingSessionResponse> {
        const view = await this.commands.readActiveView(id);
        if (!view) throw new TrainingSessionNotFoundError(id);
        response.setHeader("ETag", formatRevisionEtag(view.version));
        return activeTrainingSessionResponseSchema.parse(withDerivedPace(view));
    }

    @Get(":id/completion-preview")
    @ApiOperation({ summary: "Preview a completion: validation issues plus projected planned-session outcomes" })
    @ApiParam({ name: "id", format: "uuid" })
    async completionPreview(@Param("id") id: string): Promise<CompletionPreviewResponse> {
        const preview = await this.commands.previewCompletion(id);
        return completionPreviewResponseSchema.parse(preview);
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
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            updateTrainingSessionRequestSchema,
            rawBody ?? {},
            "Training session update validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
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

    @Post(":id/mappings")
    @ApiOperation({ summary: "Record planned/actual mappings for a session (substitutions, splits, combines)" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    recordMappings(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            recordSessionMappingsRequestSchema,
            rawBody ?? {},
            "Session mapping validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.mappings",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.recordMappings(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/activities")
    @ApiOperation({ summary: "Append one activity to a session (live entry)" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    addActivity(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(addSessionActivityRequestSchema, rawBody ?? {}, "Add-activity validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.add-activity",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.addActivity(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/activities/reorder")
    @ApiOperation({ summary: "Reorder a session's activities by the complete ordered ID list" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    reorderActivities(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            reorderSessionActivitiesRequestSchema,
            rawBody ?? {},
            "Reorder validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.reorder-activities",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction =>
                this.commands.reorderActivities(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/occurrences/substitute")
    @ApiOperation({ summary: "Substitute an occurrence's exercise, recording a substituted mapping" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    substituteOccurrence(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            substituteOccurrenceRequestSchema,
            rawBody ?? {},
            "Substitution validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.substitute-occurrence",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction =>
                this.commands.substituteOccurrence(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/strength/sets")
    @ApiOperation({ summary: "Record one performed set inside an occurrence, with an optional mapping" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    recordSet(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(recordPerformedSetRequestSchema, rawBody ?? {}, "Record-set validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.record-set",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction =>
                this.commands.recordPerformedSet(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Patch(":id/strength/sets/:setId")
    @ApiOperation({ summary: "Patch an existing performed set, optionally updating its mapping" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiParam({ name: "setId", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    updateSet(
        @Param("id") id: string,
        @Param("setId") setId: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(updatePerformedSetRequestSchema, rawBody ?? {}, "Update-set validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.update-set",
            idempotencyKey,
            request: { id, setId, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction =>
                this.commands.updatePerformedSet(id, expectedVersion, setId, request, metadata, transaction),
        });
    }

    @Get(":id/running/:activityId")
    @ApiOperation({ summary: "Get the manual running summary of one activity, with its derived pace" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiParam({ name: "activityId", format: "uuid" })
    async runningSummary(
        @Param("id") id: string,
        @Param("activityId") activityId: string,
    ): Promise<RunningActivitySummaryResponse> {
        const summary = await this.commands.readRunningSummary(id, activityId);
        if (!summary) throw new TrainingSessionNotFoundError(id);
        return runningActivitySummaryResponseSchema.parse(toRunningSummaryResponse(summary));
    }

    @Put(":id/running")
    @ApiOperation({ summary: "Upsert the manual running summary of a running activity (live entry)" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    setRunning(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(setRunningActivityRequestSchema, rawBody ?? {}, "Set-running validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.session.set-running",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.setRunning(id, expectedVersion, request, metadata, transaction),
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
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        parseContract(startTrainingSessionRequestSchema, rawBody ?? {}, "Training session start validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
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
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        const request = parseContract(
            completeTrainingSessionRequestSchema,
            rawBody ?? {},
            "Training session completion validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
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
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        return this.transition(
            "reopen",
            id,
            ifMatch,
            rawCorrelationId,
            rawSource,
            rawReason,
            idempotencyKey,
            response,
            (v, m, t) => this.commands.reopen(id, v, m, t),
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
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        return this.transition(
            "archive",
            id,
            ifMatch,
            rawCorrelationId,
            rawSource,
            rawReason,
            idempotencyKey,
            response,
            (v, m, t) => this.commands.archive(id, v, m, t),
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
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<TrainingSessionResponse> {
        return this.transition(
            "restore",
            id,
            ifMatch,
            rawCorrelationId,
            rawSource,
            rawReason,
            idempotencyKey,
            response,
            (v, m, t) => this.commands.restore(id, v, m, t),
        );
    }

    private transition(
        action: string,
        id: string,
        ifMatch: string | undefined,
        rawCorrelationId: string | undefined,
        rawSource: string | undefined,
        rawReason: string | undefined,
        idempotencyKey: string | undefined,
        response: HeaderResponse,
        command: (
            expectedVersion: number,
            metadata: TrainingSessionMutationMetadata,
            transaction?: unknown,
        ) => Promise<TrainingSessionResource>,
    ): Promise<TrainingSessionResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
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
    return withDerivedPace(resource);
}

/**
 * Attach the derived average pace to every running activity as a query-only projection. Pace is never
 * stored on the aggregate (design 11.3); it is computed here from canonical distance/moving time so the
 * wire response carries it alongside the recorded metrics with its provenance and exclusions.
 */
function withDerivedPace<T extends { readonly activities: readonly SessionActivityState[] }>(resource: T): T {
    return {
        ...resource,
        activities: resource.activities.map(activity =>
            activity.running === null
                ? activity
                : { ...activity, running: { ...activity.running, derivedPace: deriveAveragePace(activity.running) } },
        ),
    };
}

function toRunningSummaryResponse(summary: {
    readonly activityId: string;
    readonly running: NonNullable<SessionActivityState["running"]>;
}): unknown {
    return {
        activityId: summary.activityId,
        running: { ...summary.running, derivedPace: deriveAveragePace(summary.running) },
    };
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

/**
 * Build the command context for a session mutation. Provenance travels in headers so the same
 * value threads through the aggregate revision (design §12) and its outbox event: `x-kinetix-source`
 * attributes the change (web/CLI default to `user`, automation sets `agent`), and `x-kinetix-reason`
 * captures a free-text note such as a manual correction. Unknown sources fall back to `user` rather
 * than trusting an arbitrary client string.
 */
function mutationMetadata(
    rawCorrelationId: string | undefined,
    rawSource?: string,
    rawReason?: string,
): TrainingSessionMutationMetadata {
    const reason = rawReason?.trim();
    return {
        correlationId: rawCorrelationId?.trim() || randomUUID(),
        actorId: null,
        source: mutationSource(rawSource),
        ...(reason ? { reason } : {}),
    };
}

const MUTATION_SOURCES = ["user", "agent", "import", "sync", "system"] as const;
type MutationSource = (typeof MUTATION_SOURCES)[number];

function mutationSource(rawSource: string | undefined): MutationSource {
    const normalized = rawSource?.trim().toLowerCase();
    return MUTATION_SOURCES.find(source => source === normalized) ?? "user";
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
