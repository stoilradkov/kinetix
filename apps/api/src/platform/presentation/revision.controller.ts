import { randomUUID } from "node:crypto";

import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpException,
    NotFoundException,
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
    constructor(private readonly resources: RevisionResourceRegistry) {}

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
        if (!parsedQuery.success) throw new BadRequestException(parsedQuery.error.flatten());

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
    async restore(
        @Param("entityType") entityType: string,
        @Param("entityId") rawEntityId: string,
        @Param("version") rawRestoreVersion: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Body() rawBody: unknown,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<RestoreRevisionResponse> {
        const request = restoreRevisionRequestSchema.safeParse(rawBody ?? {});
        if (!request.success) throw new BadRequestException(request.error.flatten());

        const aggregateId = parseEntityId(rawEntityId);
        const restoreVersion = parsePositiveVersion(rawRestoreVersion, "Restore version");
        const expectedVersion = parseIfMatch(ifMatch);
        const correlationId = rawCorrelationId?.trim() || randomUUID();

        try {
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
            });
            const etag = formatRevisionEtag(restored.version);
            response.setHeader("ETag", etag);
            return restoreRevisionResponseSchema.parse({
                version: restored.version,
                etag,
                resource: restored.resource,
            });
        } catch (error) {
            throw mapRevisionError(error);
        }
    }
}

function parseEntityId(value: string): EntityId {
    try {
        return entityId(value);
    } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Invalid entity ID");
    }
}

function parsePositiveVersion(value: string, name: string): number {
    const version = Number(value);
    try {
        return AggregateVersion.from(version).value;
    } catch {
        throw new BadRequestException(`${name} must be a positive integer`);
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
        throw new BadRequestException(error instanceof Error ? error.message : "Invalid If-Match");
    }
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
    return error;
}
