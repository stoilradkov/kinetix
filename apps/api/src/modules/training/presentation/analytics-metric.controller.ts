import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Headers, Inject, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    derivedMetricResourceSchema,
    findingQueryResponseSchema,
    findingResourceSchema,
    metricCalculatorCatalogResponseSchema,
    metricQueryResponseSchema,
    metricRebuildRequestSchema,
    metricRebuildResponseSchema,
    personalRecordCatalogResponseSchema,
    type DerivedMetricResource,
    type FindingQueryResponse,
    type FindingResource,
    type MetricCalculatorCatalogResponse,
    type MetricQueryResponse,
    type MetricRebuildRequest,
    type MetricRebuildResponse,
    type PersonalRecordCatalogResponse,
} from "@kinetix/types";

import {
    DERIVED_METRIC_REPOSITORY,
    FINDING_REPOSITORY,
    REBUILD_METRICS,
    personalRecordCatalogMetadata,
    runningMetricCatalogMetadata,
    runningRecordCatalogMetadata,
    strengthMetricCatalogMetadata,
    type DerivedMetricRepository,
    type DerivedMetricView,
    type FindingRepository,
    type FindingView,
    type RebuildMetrics,
} from "#src/modules/training/application/index";
import { ApplicationValidationError, type CommandContext } from "#src/platform/application/index";

/**
 * Low-level analytics metric surface (issue #43, A1; design §16.1–16.3). Derived metrics are projections
 * recomputed by the durable worker off session/context/zone/plan invalidations; these endpoints expose the
 * current (and, on request, superseded) projections that later analytics views build on, and a diagnostic
 * rebuild command that forces a synchronous recompute for deterministic verification. All scoring lives in
 * the domain calculators behind the RebuildMetrics use case — the controller never invokes a calculator or
 * exposes the internal invalidation/job payloads.
 */
@ApiTags("training analytics")
@Controller({ path: "training/analytics", version: "1" })
export class AnalyticsMetricController {
    constructor(
        @Inject(DERIVED_METRIC_REPOSITORY)
        private readonly repository: DerivedMetricRepository,
        @Inject(FINDING_REPOSITORY)
        private readonly findings: FindingRepository,
        @Inject(REBUILD_METRICS)
        private readonly rebuild: RebuildMetrics,
    ) {}

    @Get("metrics")
    @ApiOperation({ summary: "Query current (and optionally superseded) derived metric projections" })
    @ApiQuery({ name: "calculatorKey", required: false })
    @ApiQuery({ name: "scopeType", required: false })
    @ApiQuery({ name: "scopeId", required: false })
    @ApiQuery({ name: "includeSuperseded", required: false })
    @ApiQuery({ name: "limit", required: false })
    async metrics(
        @Query("calculatorKey") calculatorKey: string | undefined,
        @Query("scopeType") scopeType: string | undefined,
        @Query("scopeId") scopeId: string | undefined,
        @Query("includeSuperseded") includeSuperseded: string | undefined,
        @Query("limit") limit: string | undefined,
    ): Promise<MetricQueryResponse> {
        const views = await this.repository.query({
            calculatorKey: nonEmpty(calculatorKey),
            scopeType: nonEmpty(scopeType),
            scopeId: nonEmpty(scopeId),
            includeSuperseded: includeSuperseded === "true",
            limit: parseLimit(limit),
        });
        return metricQueryResponseSchema.parse({ items: views.map(toResource) });
    }

    @Get("metrics/catalog")
    @ApiOperation({ summary: "List the registered metric calculators and their stable display metadata" })
    catalog(): MetricCalculatorCatalogResponse {
        return metricCalculatorCatalogResponseSchema.parse({
            schemaVersion: 1,
            calculators: [
                ...strengthMetricCatalogMetadata().calculators,
                ...runningMetricCatalogMetadata().calculators,
            ],
        });
    }

    @Get("records")
    @ApiOperation({ summary: "Query current (and optionally superseded) personal-record findings" })
    @ApiQuery({ name: "findingKey", required: false })
    @ApiQuery({ name: "scopeType", required: false })
    @ApiQuery({ name: "scopeId", required: false })
    @ApiQuery({ name: "includeSuperseded", required: false })
    @ApiQuery({ name: "limit", required: false })
    async records(
        @Query("findingKey") findingKey: string | undefined,
        @Query("scopeType") scopeType: string | undefined,
        @Query("scopeId") scopeId: string | undefined,
        @Query("includeSuperseded") includeSuperseded: string | undefined,
        @Query("limit") limit: string | undefined,
    ): Promise<FindingQueryResponse> {
        const views = await this.findings.query({
            findingKey: nonEmpty(findingKey),
            scopeType: nonEmpty(scopeType),
            scopeId: nonEmpty(scopeId),
            includeSuperseded: includeSuperseded === "true",
            limit: parseLimit(limit),
        });
        return findingQueryResponseSchema.parse({ items: views.map(toFindingResource) });
    }

    @Get("records/catalog")
    @ApiOperation({ summary: "List the personal-record types and their stable display metadata" })
    recordsCatalog(): PersonalRecordCatalogResponse {
        return personalRecordCatalogResponseSchema.parse({
            schemaVersion: 1,
            records: [...personalRecordCatalogMetadata().records, ...runningRecordCatalogMetadata().records],
        });
    }

    @Post("rebuild")
    @ApiOperation({ summary: "Force a synchronous derived-metric rebuild (targeted, scope, or full)" })
    async rebuildMetrics(
        @Body() body: unknown,
        @Headers("x-correlation-id") correlationId: string | undefined,
        @Headers("x-kinetix-source") source: string | undefined,
    ): Promise<MetricRebuildResponse> {
        const request = parse(metricRebuildRequestSchema, body);
        const metadata = commandMetadata(correlationId, source);
        const summary = await this.run(request, metadata);
        return metricRebuildResponseSchema.parse(summary);
    }

    private run(request: MetricRebuildRequest, metadata: CommandContext) {
        switch (request.mode) {
            case "targeted":
                return this.rebuild.fromPendingInvalidations(metadata);
            case "full":
                return this.rebuild.full(metadata);
            case "scope":
                return this.rebuild.fromScope(
                    { dependency: request.dependency, scopeType: request.scopeType, scopeId: request.scopeId },
                    metadata,
                );
        }
    }
}

function toResource(view: DerivedMetricView): DerivedMetricResource {
    return derivedMetricResourceSchema.parse({
        id: view.id,
        profileId: view.profileId,
        calculatorKey: view.calculatorKey,
        calculatorVersion: view.calculatorVersion,
        scope: view.scope,
        period: view.period,
        dimensions: view.dimensions,
        numericValue: view.numericValue,
        textValue: view.textValue,
        unit: view.unit,
        details: view.details,
        sourceFingerprint: view.sourceFingerprint,
        state: view.state,
        stale: view.stale,
        calculatedAt: view.calculatedAt.toISOString(),
        supersededAt: view.supersededAt?.toISOString() ?? null,
    });
}

function toFindingResource(view: FindingView): FindingResource {
    return findingResourceSchema.parse({
        id: view.id,
        profileId: view.profileId,
        findingKey: view.findingKey,
        findingVersion: view.findingVersion,
        scope: view.scope,
        dimensions: view.dimensions,
        numericValue: view.numericValue,
        unit: view.unit,
        status: view.status,
        evidence: view.evidence,
        sourceFingerprint: view.sourceFingerprint,
        state: view.state,
        calculatedAt: view.calculatedAt.toISOString(),
        supersededAt: view.supersededAt?.toISOString() ?? null,
    });
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function parseLimit(value: string | undefined): number {
    if (value === undefined) return 50;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200)
        throw new ApplicationValidationError("limit must be an integer between 1 and 200", {
            limit: ["limit must be an integer between 1 and 200"],
        });
    return parsed;
}

const COMMAND_SOURCES = ["user", "agent", "import", "sync", "system"] as const;

function commandMetadata(rawCorrelationId: string | undefined, rawSource: string | undefined): CommandContext {
    const normalized = rawSource?.trim().toLowerCase();
    return {
        correlationId: rawCorrelationId?.trim() || randomUUID(),
        actorId: null,
        source: COMMAND_SOURCES.find(candidate => candidate === normalized) ?? "user",
    };
}

function parse<Output>(
    schema: {
        safeParse(
            value: unknown,
        ):
            | { success: true; data: Output }
            | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
    },
    value: unknown,
): Output {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
        const key = issue.path.map(String).join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new ApplicationValidationError("Invalid rebuild request", fieldErrors);
}
