import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Headers, HttpException, Inject, Optional, Post, Query, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    recordZoneDefinitionRequestSchema,
    zoneDefinitionListResponseSchema,
    zoneDefinitionResponseSchema,
    type ZoneDefinitionListResponse,
    type ZoneDefinitionResponse,
} from "@kinetix/types";

import {
    ZONE_DEFINITION_COMMANDS,
    ZONE_DEFINITION_QUERIES,
    type ZoneDefinitionCommands,
    type ZoneDefinitionMutationMetadata,
    type ZoneDefinitionQueries,
} from "#src/modules/training/application/index";
import { zoneFamilies, type ZoneFamily } from "#src/modules/training/domain/index";
import {
    ApplicationValidationError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("training zones")
@Controller({ path: "training/zones", version: "1" })
export class ZoneDefinitionController {
    constructor(
        @Inject(ZONE_DEFINITION_COMMANDS)
        private readonly commands: ZoneDefinitionCommands,
        @Inject(ZONE_DEFINITION_QUERIES)
        private readonly queries: ZoneDefinitionQueries,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List the current zone definitions across families" })
    async list(): Promise<ZoneDefinitionListResponse> {
        return zoneDefinitionListResponseSchema.parse({ items: await this.queries.listCurrent() });
    }

    @Get("history")
    @ApiOperation({ summary: "List the effective-interval history for one zone family" })
    @ApiQuery({ name: "family", required: true })
    async history(@Query("family") family: string | undefined): Promise<ZoneDefinitionListResponse> {
        return zoneDefinitionListResponseSchema.parse({ items: await this.queries.history(parseFamily(family)) });
    }

    @Get("effective")
    @ApiOperation({ summary: "Resolve the zone definition in force at an instant" })
    @ApiQuery({ name: "family", required: true })
    @ApiQuery({ name: "at", required: false, description: "ISO 8601 instant; defaults to now" })
    async effective(
        @Query("family") family: string | undefined,
        @Query("at") at: string | undefined,
    ): Promise<ZoneDefinitionResponse> {
        const resolved = await this.queries.asOf(parseFamily(family), instant(at));
        if (!resolved)
            throw new HttpException(
                { code: "NOT_FOUND", message: "No zone definition is effective at that instant" },
                404,
            );
        return zoneDefinitionResponseSchema.parse(resolved);
    }

    @Post()
    @ApiOperation({ summary: "Record a new zone definition, closing the current one for its family" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async record(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ZoneDefinitionResponse> {
        const request = parseContract(recordZoneDefinitionRequestSchema, rawBody, "Zone definition validation failed");
        const metadata = mutationMetadata(rawCorrelationId);
        const input = {
            family: request.family,
            method: request.method,
            ...(request.config !== undefined ? { config: request.config } : {}),
            ranges: request.ranges.map(range => ({
                position: range.position,
                name: range.name,
                lowerBound: range.lowerBound,
                upperBound: range.upperBound ?? null,
                ...(range.lowerInclusive !== undefined ? { lowerInclusive: range.lowerInclusive } : {}),
                ...(range.upperInclusive !== undefined ? { upperInclusive: range.upperInclusive } : {}),
            })),
            ...(request.source !== undefined ? { source: request.source } : {}),
            note: request.note ?? null,
            ...(request.effectiveFrom !== undefined ? { effectiveFrom: request.effectiveFrom } : {}),
        };
        const perform = async (transaction?: unknown) =>
            zoneDefinitionResponseSchema.parse(await this.commands.record(input, metadata, transaction));
        if (idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                { operation: "training.zone-definition.record", key: idempotencyKey, request, context: metadata },
                async transaction => ({ status: 201, body: await perform(transaction) }),
            );
            response.setHeader("Idempotency-Replayed", String(result.replayed));
            return result.body;
        }
        return perform();
    }
}

function parseFamily(value: string | undefined): ZoneFamily {
    if (value && (zoneFamilies as readonly string[]).includes(value)) return value as ZoneFamily;
    throw new ApplicationValidationError(`Unknown zone family '${value ?? ""}'`, {
        family: [`family must be one of: ${zoneFamilies.join(", ")}`],
    });
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

function mutationMetadata(rawCorrelationId: string | undefined): ZoneDefinitionMutationMetadata {
    return { correlationId: rawCorrelationId?.trim() || randomUUID(), actorId: null, source: "user" };
}
