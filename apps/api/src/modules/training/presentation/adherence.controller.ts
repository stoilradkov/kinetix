import { randomUUID } from "node:crypto";

import { Controller, Get, Headers, HttpException, Inject, Optional, Param, Post, Query } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    adherenceFormulaResponseSchema,
    adherenceQueryResponseSchema,
    adherenceQuerySchema,
    sessionAdherenceResponseSchema,
    type AdherenceQueryResponse,
    type AdherenceFormulaResponse,
    type SessionAdherenceResponse,
} from "@kinetix/types";

import {
    ADHERENCE_QUERY_SERVICE,
    CALCULATE_ADHERENCE,
    adherenceFormulaMetadata,
    type AdherenceQueryService,
    type AdherenceResultDetail,
    type CalculateAdherence,
    type SessionAdherenceDetailView,
} from "#src/modules/training/application/index";
import {
    ApplicationValidationError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type CommandContext,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";

/**
 * Adherence read surface (issue #38, AD2; design §16.7, §18.2–18.3). Adherence is a derived projection
 * recomputed by the durable worker off session/mapping/plan events; these read endpoints expose the
 * current results — overall percentage, weighted components, evidence inputs, exclusions, formula version,
 * and a live stale/pending/failed label — for one session, or cursor-filtered across sessions/programs/
 * blocks/date ranges. The scores themselves are never recomputed here: all formula logic lives in the AD1
 * domain calculators. `POST …/recalculate` forces a synchronous recompute for deterministic verification.
 */
@ApiTags("training adherence")
@Controller({ path: "training", version: "1" })
export class AdherenceController {
    constructor(
        @Inject(CALCULATE_ADHERENCE)
        private readonly calculate: CalculateAdherence,
        @Inject(ADHERENCE_QUERY_SERVICE)
        private readonly queries: AdherenceQueryService,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get("adherence")
    @ApiOperation({ summary: "Query adherence results across sessions, programs, blocks, and date ranges" })
    @ApiQuery({ name: "limit", required: false })
    @ApiQuery({ name: "cursor", required: false })
    @ApiQuery({ name: "trainingSessionId", required: false, format: "uuid" })
    @ApiQuery({ name: "plannedSessionId", required: false, format: "uuid" })
    @ApiQuery({ name: "programId", required: false, format: "uuid" })
    @ApiQuery({ name: "blockId", required: false, format: "uuid" })
    @ApiQuery({ name: "scope", required: false, enum: ["strength", "running", "mixed"] })
    @ApiQuery({ name: "from", required: false, description: "Inclusive YYYY-MM-DD lower bound on session local date" })
    @ApiQuery({ name: "to", required: false, description: "Inclusive YYYY-MM-DD upper bound on session local date" })
    async query(@Query() rawQuery: Record<string, unknown> = {}): Promise<AdherenceQueryResponse> {
        const criteria = parseContract(adherenceQuerySchema, rawQuery, "Adherence query validation failed");
        const page = await this.queries.queryResults(criteria);
        return adherenceQueryResponseSchema.parse({
            items: page.items.map(toResultResponse),
            nextCursor: page.nextCursor,
        });
    }

    @Get("sessions/:sessionId/adherence")
    @ApiOperation({ summary: "Read the current adherence results for a session (one per planned prescription)" })
    @ApiParam({ name: "sessionId", format: "uuid" })
    async read(@Param("sessionId") sessionId: string): Promise<SessionAdherenceResponse> {
        const id = uuid(sessionId, "sessionId");
        const view = await this.queries.readForSession(id);
        return sessionAdherenceResponseSchema.parse(toResponse(view));
    }

    @Get("adherence/formula")
    @ApiOperation({ summary: "Read the stable, versioned adherence formula-display metadata" })
    formula(): AdherenceFormulaResponse {
        return adherenceFormulaResponseSchema.parse(adherenceFormulaMetadata());
    }

    @Post("sessions/:sessionId/adherence/recalculate")
    @ApiOperation({ summary: "Force a synchronous adherence recompute for a session (diagnostic)" })
    @ApiParam({ name: "sessionId", format: "uuid" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async recalculate(
        @Param("sessionId") sessionId: string,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Headers("x-correlation-id") correlationId: string | undefined,
        @Headers("x-kinetix-source") source: string | undefined,
    ): Promise<SessionAdherenceResponse> {
        const id = uuid(sessionId, "sessionId");
        const metadata = commandMetadata(correlationId, source);
        // Recompute in the transaction, then re-read the enriched (status-annotated) view for the response.
        const perform = async (transaction?: unknown) => {
            await this.calculate.recalculateForSession({ sessionId: id }, metadata, transaction);
            return toResponse(await this.queries.readForSession(id, transaction));
        };

        if (idempotencyKey === undefined) return sessionAdherenceResponseSchema.parse(await perform());
        if (!this.idempotency) throw new Error("Idempotency support is not configured");
        const result = await this.idempotency.execute(
            {
                operation: "training.adherence.recalculate",
                key: idempotencyKey,
                request: { sessionId: id },
                context: metadata,
            },
            async transaction => ({ status: 200, body: await perform(transaction) }),
        );
        return sessionAdherenceResponseSchema.parse(result.body);
    }
}

function toResponse(view: SessionAdherenceDetailView): unknown {
    return {
        trainingSessionId: view.trainingSessionId,
        results: view.results.map(toResultResponse),
    };
}

function toResultResponse(result: AdherenceResultDetail): unknown {
    return {
        id: result.id,
        trainingSessionId: result.trainingSessionId,
        trainingSessionVersion: result.trainingSessionVersion,
        plannedSessionId: result.plannedSessionId,
        sourcePrescriptionId: result.sourcePrescriptionId,
        resolvedPrescriptionId: result.resolvedPrescriptionId,
        formula: result.formula,
        scope: result.scope,
        overall: result.overall,
        sourceFingerprint: result.sourceFingerprint,
        components: result.components.map(component => ({ ...component, inputs: { ...component.inputs } })),
        exclusions: [...result.exclusions],
        calculatedAt: result.calculatedAt.toISOString(),
        status: result.status,
        plannedSessionTitle: result.plannedSessionTitle,
    };
}

function commandMetadata(rawCorrelationId: string | undefined, rawSource: string | undefined): CommandContext {
    return {
        correlationId: rawCorrelationId?.trim() || randomUUID(),
        actorId: null,
        source: normalizeSource(rawSource),
    };
}

const COMMAND_SOURCES = ["user", "agent", "import", "sync", "system"] as const;

function normalizeSource(rawSource: string | undefined): (typeof COMMAND_SOURCES)[number] {
    const normalized = rawSource?.trim().toLowerCase();
    return COMMAND_SOURCES.find(source => source === normalized) ?? "user";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string, field: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized))
        throw new ApplicationValidationError(`${field} must be a UUID`, { [field]: [`${field} must be a UUID`] });
    return normalized;
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
