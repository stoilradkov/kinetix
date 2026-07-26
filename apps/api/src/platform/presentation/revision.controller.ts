import { randomUUID } from "node:crypto";

import {
    Body,
    ConflictException,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpException,
    Inject,
    NotFoundException,
    Optional,
    Param,
    Post,
    Query,
    Res,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import {
    restoreRevisionRequestSchema,
    restoreRevisionResponseSchema,
    revisionHistoryQuerySchema,
    revisionHistoryResponseSchema,
    type RestoreRevisionResponse,
    type RevisionHistoryResponse,
} from "@kinetix/types";

import {
    ApplicationError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
    RevisionAggregateNotFoundError,
    RevisionNotFoundError,
    RevisionResourceRegistry,
    StaleAggregateVersionError,
    UnsupportedRevisionEntityTypeError,
} from "#src/platform/application/index";
import { AggregateVersion, entityId, type EntityId } from "#src/platform/domain/index";
import { formatRevisionEtag, parseRevisionEtag } from "#src/platform/presentation/revision-etag";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("history")
@Controller({ path: "history", version: "1" })
export class RevisionController {
    constructor(
        private readonly resources: RevisionResourceRegistry,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get(":entityType/:entityId")
    @ApiOperation({ summary: "List immutable aggregate revisions newest first" })
    @ApiParam({ name: "entityType" })
    @ApiParam({ name: "entityId", format: "uuid" })
    async history(
        @Param("entityType") entityType: string,
        @Param("entityId") rawEntityId: string,
        @Query() rawQuery: Record<string, unknown>,
    ): Promise<RevisionHistoryResponse> {
        const parsedQuery = revisionHistoryQuerySchema.safeParse(rawQuery);
        if (!parsedQuery.success)
            throw validationException("History query validation failed", parsedQuery.error.issues);

        try {
            const page = await this.resources.history(entityType, parseEntityId(rawEntityId), parsedQuery.data);
            return revisionHistoryResponseSchema.parse({
                items: page.items.map(item => ({
                    version: item.version,
                    etag: formatRevisionEtag(item.version),
                    schemaVersion: item.schemaVersion,
                    source: item.source,
                    actorId: item.actorId,
                    reason: item.reason,
                    summary: item.summary,
                    correlationId: item.correlationId,
                    createdAt: item.createdAt.toISOString(),
                    resource: item.resource,
                })),
                nextCursor: page.nextCursor,
            });
        } catch (error) {
            throw mapRevisionError(error);
        }
    }

    @Post(":entityType/:entityId/restore/:version")
    @HttpCode(200)
    @ApiOperation({ summary: "Restore an immutable snapshot as a new current revision" })
    @ApiParam({ name: "entityType" })
    @ApiParam({ name: "entityId", format: "uuid" })
    @ApiParam({ name: "version", type: Number })
    @ApiHeader({ name: "If-Match", required: true, description: 'Quoted current aggregate version, e.g. "3"' })
    @ApiHeader({ name: "Idempotency-Key", required: false, description: "Stable key for safely retrying the restore" })
    async restore(
        @Param("entityType") entityType: string,
        @Param("entityId") rawEntityId: string,
        @Param("version") rawRestoreVersion: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Body() rawBody: unknown,
        @Res({ passthrough: true }) response: HeaderResponse,
        @Headers("idempotency-key") idempotencyKey?: string,
    ): Promise<RestoreRevisionResponse> {
        const request = restoreRevisionRequestSchema.safeParse(rawBody ?? {});
        if (!request.success) throw validationException("Restore request validation failed", request.error.issues);

        const aggregateId = parseEntityId(rawEntityId);
        const restoreVersion = parsePositiveVersion(rawRestoreVersion, "Restore version");
        const expectedVersion = parseIfMatch(ifMatch);
        const correlationId = rawCorrelationId?.trim() || randomUUID();

        try {
            const performRestore = async (transaction?: unknown): Promise<RestoreRevisionResponse> => {
                const restored = await this.resources.restore(entityType, {
                    entityId: aggregateId,
                    restoreVersion,
                    expectedVersion,
                    metadata: {
                        actorId: null,
                        reason: request.data.reason,
                        summary: `Restored revision ${restoreVersion}`,
                        correlationId,
                    },
                    ...(transaction !== undefined ? { transaction } : {}),
                });
                return restoreRevisionResponseSchema.parse({
                    version: restored.version,
                    etag: formatRevisionEtag(restored.version),
                    resource: restored.resource,
                });
            };

            let restored: RestoreRevisionResponse;
            if (idempotencyKey !== undefined) {
                if (!this.idempotency) throw new Error("Idempotency support is not configured");
                const result = await this.idempotency.execute(
                    {
                        operation: "revision.restore",
                        key: idempotencyKey,
                        request: {
                            entityType,
                            entityId: aggregateId,
                            restoreVersion,
                            expectedVersion,
                            body: request.data,
                        },
                        context: { correlationId, actorId: null, source: "restore" },
                    },
                    async transaction => ({ status: 200, body: await performRestore(transaction) }),
                );
                restored = result.body;
                response.setHeader("Idempotency-Replayed", String(result.replayed));
            } else {
                restored = await performRestore();
            }
            response.setHeader("ETag", restored.etag);
            return restored;
        } catch (error) {
            throw mapRevisionError(error);
        }
    }
}

function parseEntityId(value: string): EntityId {
    try {
        return entityId(value);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid entity ID";
        throw validationException(message, [{ path: ["entityId"], message }]);
    }
}

function parsePositiveVersion(value: string, name: string): number {
    const version = Number(value);
    try {
        return AggregateVersion.from(version).value;
    } catch {
        const message = `${name} must be a positive integer`;
        throw validationException(message, [{ path: ["version"], message }]);
    }
}

function parseIfMatch(value: string | undefined): number {
    if (!value)
        throw new HttpException(
            {
                statusCode: 428,
                code: "PRECONDITION_REQUIRED",
                message: "If-Match is required",
            },
            428,
        );
    try {
        return parseRevisionEtag(value);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid If-Match";
        throw validationException(message, [{ path: ["ifMatch"], message }]);
    }
}

function validationException(
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

function mapRevisionError(error: unknown): unknown {
    if (
        error instanceof UnsupportedRevisionEntityTypeError ||
        error instanceof RevisionAggregateNotFoundError ||
        error instanceof RevisionNotFoundError
    )
        return new NotFoundException(error.message);
    if (error instanceof StaleAggregateVersionError)
        return new ConflictException({
            statusCode: 409,
            code: "VERSION_CONFLICT",
            message: error.message,
            currentVersion: error.actual,
            etag: formatRevisionEtag(error.actual),
        });
    if (error instanceof ApplicationError)
        return new HttpException(
            {
                statusCode: applicationErrorStatus(error.code),
                code: error.code,
                message: error.message,
                ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
                ...error.context,
            },
            applicationErrorStatus(error.code),
        );
    return error;
}

function applicationErrorStatus(code: ApplicationError["code"]): number {
    switch (code) {
        case "VALIDATION_FAILED":
        case "CATALOG_MAPPING_REQUIRED":
        case "JOB_FAILED":
            return 422;
        case "NOT_FOUND":
            return 404;
        case "PRECONDITION_REQUIRED":
            return 428;
        default:
            return 409;
    }
}
