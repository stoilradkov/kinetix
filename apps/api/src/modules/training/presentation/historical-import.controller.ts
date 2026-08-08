import { randomUUID } from "node:crypto";

import { Body, Controller, Headers, HttpException, Inject, Optional, Post, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
    historicalImportDryRunResponseSchema,
    historicalImportEnvelopeSchema,
    type HistoricalImportDryRunResponse,
} from "@kinetix/types";

import {
    HISTORICAL_IMPORT_DRY_RUN,
    type HistoricalImportDryRun,
    type HistoricalImportEnvelopeInput,
} from "#src/modules/training/application/index";
import {
    IDEMPOTENT_COMMAND_EXECUTOR,
    type CommandContext,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

/**
 * Historical-import dry-run endpoint (design §14.2; issue #58, HI4). Validates and previews an
 * already-normalized archive — many programs and completed sessions together — with no authoritative
 * catalog/program/session side effects; only the expiring preview artifact is stored. The body carries
 * the exact canonical tree and the deterministic storage plan a later commit will execute, plus any
 * validation errors and required catalog mappings. Path-anchored validation failures surface as 422.
 */
@ApiTags("training import")
@Controller({ path: "training/imports", version: "1" })
export class HistoricalImportController {
    constructor(
        @Inject(HISTORICAL_IMPORT_DRY_RUN)
        private readonly dryRun: HistoricalImportDryRun,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Post("dry-runs")
    @ApiOperation({ summary: "Validate and preview an already-normalized historical import without side effects" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<HistoricalImportDryRunResponse> {
        const request = parseContract(
            historicalImportEnvelopeSchema,
            rawBody,
            "Historical import validation failed",
        ) as unknown as HistoricalImportEnvelopeInput;
        const metadata: CommandContext = {
            correlationId: rawCorrelationId?.trim() || randomUUID(),
            actorId: null,
            source: "agent",
        };
        const perform = async (transaction?: unknown) =>
            historicalImportDryRunResponseSchema.parse(await this.dryRun.execute(request, metadata, transaction));

        let body: HistoricalImportDryRunResponse;
        if (idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                { operation: "training.imports.dry-run", key: idempotencyKey, request, context: metadata },
                async transaction => ({ status: 201, body: await perform(transaction) }),
            );
            body = result.body;
            response.setHeader("Idempotency-Replayed", String(result.replayed));
        } else {
            body = await perform();
        }
        response.setHeader("X-Dry-Run-Id", body.dryRunId);
        response.setHeader("X-Dry-Run-Expires-At", body.expiresAt);
        return body;
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
    if (parsed.success) return parsed.data;
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
        const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$";
        (fieldErrors[path] ??= []).push(issue.message);
    }
    throw new HttpException({ code: "VALIDATION_FAILED", message, fieldErrors }, 422);
}
