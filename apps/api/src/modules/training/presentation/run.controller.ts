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
    Post,
    Put,
    Query,
    Res,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    addRunRequestSchema,
    runListResponseSchema,
    runViewResponseSchema,
    type RunListItemResponse,
    type RunListResponse,
    type RunViewResponse,
    updateRunRequestSchema,
} from "@kinetix/types";

import {
    RUNNING_ACTIVITY_SERVICE,
    RunActivityNotFoundError,
    type RunListItem,
    type RunView,
    type RunningActivityService,
    type TrainingSessionMutationMetadata,
} from "#src/modules/training/application/index";
import {
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";
import { deriveAveragePace } from "#src/modules/training/domain/index";
import { formatRevisionEtag, parseRevisionEtag } from "#src/platform/presentation/revision-etag";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

/**
 * Run-centric HTTP surface (design §18–19; PRD R3): an ergonomic adapter over the TrainingSession
 * root for manual and mixed run/strength workouts. `POST` logs a run (create + complete) and `PUT`
 * corrects one; both delegate to {@link RunningActivityService}, so a run and a strength session share
 * the exact same aggregate, versioning, idempotency, and history. `GET` reads use the bounded run
 * projections (§18.3). Average pace is attached on read and never stored.
 */
@ApiTags("training runs")
@Controller({ path: "training/runs", version: "1" })
export class RunController {
    constructor(
        @Inject(RUNNING_ACTIVITY_SERVICE)
        private readonly runs: RunningActivityService,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List runs across sessions (bounded projection with derived pace)" })
    @ApiQuery({ name: "includeArchived", required: false })
    async list(@Query("includeArchived") includeArchived: string | undefined): Promise<RunListResponse> {
        const items = await this.runs.listRuns({ includeArchived: includeArchived === "true" });
        return runListResponseSchema.parse({ items: items.map(toRunListItemResponse) });
    }

    @Post()
    @ApiOperation({ summary: "Log a manual run: create a session with one running activity and complete it" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    add(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<RunViewResponse> {
        const request = parseContract(addRunRequestSchema, rawBody ?? {}, "Add-run validation failed");
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.run.add",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.runs.addRun(request, metadata, transaction),
        });
    }

    @Get(":sessionId")
    @ApiOperation({ summary: "Show a run: the session's (primary) running activity with its plan mappings" })
    @ApiParam({ name: "sessionId", format: "uuid" })
    async show(@Param("sessionId") sessionId: string): Promise<RunViewResponse> {
        const view = await this.runs.showRun(sessionId);
        if (!view) throw new RunActivityNotFoundError(sessionId);
        return runViewResponseSchema.parse(toRunViewResponse(view));
    }

    @Get(":sessionId/:activityId")
    @ApiOperation({ summary: "Show a specific run activity inside a (mixed) session with its plan mappings" })
    @ApiParam({ name: "sessionId", format: "uuid" })
    @ApiParam({ name: "activityId", format: "uuid" })
    async showActivity(
        @Param("sessionId") sessionId: string,
        @Param("activityId") activityId: string,
    ): Promise<RunViewResponse> {
        const view = await this.runs.showRun(sessionId, activityId);
        if (!view) throw new RunActivityNotFoundError(sessionId, activityId);
        return runViewResponseSchema.parse(toRunViewResponse(view));
    }

    @Put(":sessionId/:activityId")
    @ApiOperation({ summary: "Correct a run's summary/detail and plan mappings (reopens/re-completes a logged run)" })
    @ApiParam({ name: "sessionId", format: "uuid" })
    @ApiParam({ name: "activityId", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    update(
        @Param("sessionId") sessionId: string,
        @Param("activityId") activityId: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("x-kinetix-source") rawSource?: string,
        @Headers("x-kinetix-reason") rawReason?: string,
    ): Promise<RunViewResponse> {
        const request = parseContract(updateRunRequestSchema, rawBody ?? {}, "Update-run validation failed");
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId, rawSource, rawReason);
        return this.executeMutation({
            operation: "training.run.update",
            idempotencyKey,
            request: { sessionId, activityId, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction =>
                this.runs.updateRun(sessionId, activityId, expectedVersion, request, metadata, transaction),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: TrainingSessionMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => Promise<RunView>;
    }): Promise<RunViewResponse> {
        const perform = async (transaction?: unknown) =>
            runViewResponseSchema.parse(toRunViewResponse(await input.command(transaction)));
        let body: RunViewResponse;
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

/** Attach the query-only derived average pace to the run view's running detail (design 11.3). */
function toRunViewResponse(view: RunView): unknown {
    return { ...view, running: { ...view.running, derivedPace: deriveAveragePace(view.running) } };
}

/** Derive average pace (seconds per kilometre) for a bounded list item from its canonical fields. */
function toRunListItemResponse(item: RunListItem): RunListItemResponse {
    const distanceMetres = item.distanceMetres === null ? null : Number(item.distanceMetres);
    const movingMs = item.movingTimeMs === null ? null : Number(item.movingTimeMs);
    const derivedPaceSecondsPerKm =
        distanceMetres !== null && movingMs !== null && distanceMetres > 0 && movingMs > 0
            ? Math.round((movingMs / distanceMetres) * 1_000) / 1_000
            : null;
    return {
        sessionId: item.sessionId,
        activityId: item.activityId,
        version: item.version,
        localDate: item.localDate,
        status: item.status,
        title: item.title,
        archivedAt: item.archivedAt,
        distanceMetres: item.distanceMetres,
        movingTimeMs: item.movingTimeMs,
        derivedPaceSecondsPerKm,
        runTags: [...item.runTags],
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
