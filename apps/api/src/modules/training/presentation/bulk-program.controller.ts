import { randomUUID } from "node:crypto";

import { Body, Controller, Headers, HttpException, Inject, Optional, Post, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";

import { bulkDryRunResponseSchema, bulkProgramEnvelopeSchema, type BulkDryRunResponse } from "@kinetix/types";

import { DRY_RUN_BULK_PROGRAM, type DryRunBulkProgram } from "#src/modules/training/application/index";
import {
    IDEMPOTENT_COMMAND_EXECUTOR,
    type CommandContext,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

/**
 * Bulk JSON dry-run endpoint (design 14.2; PRD BI-4, AC-2). Validates and previews a complete
 * normalized program with no program/catalog side effects — only the preview artifact is stored.
 * Path-anchored validation errors surface as 422; mapping requirements and warnings ride in the
 * 200/201 body so an agent can inspect exactly what would commit.
 */
@ApiTags("training bulk")
@Controller({ path: "training/bulk/programs", version: "1" })
export class BulkProgramController {
    constructor(
        @Inject(DRY_RUN_BULK_PROGRAM)
        private readonly dryRun: DryRunBulkProgram,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Post("dry-runs")
    @ApiOperation({ summary: "Validate and preview a complete bulk program without side effects" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<BulkDryRunResponse> {
        const request = parseContract(bulkProgramEnvelopeSchema, rawBody, "Bulk program validation failed");
        const metadata: CommandContext = {
            correlationId: rawCorrelationId?.trim() || randomUUID(),
            actorId: null,
            source: "agent",
        };
        const perform = async (transaction?: unknown) =>
            bulkDryRunResponseSchema.parse(await this.dryRun.execute(request, metadata, transaction));

        let body: BulkDryRunResponse;
        if (idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                { operation: "training.bulk.program.dry-run", key: idempotencyKey, request, context: metadata },
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
