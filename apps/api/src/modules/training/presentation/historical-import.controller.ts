import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Headers, HttpException, Inject, Optional, Param, Post, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
    historicalImportCommitRequestSchema,
    historicalImportCommitResponseSchema,
    historicalImportDryRunResponseSchema,
    historicalImportEnvelopeSchema,
    historicalImportListResponseSchema,
    historicalImportReportResponseSchema,
    historicalImportRevertResponseSchema,
    type HistoricalImportCommitResponse,
    type HistoricalImportDryRunResponse,
    type HistoricalImportListResponse,
    type HistoricalImportReportResponse,
    type HistoricalImportRevertResponse,
} from "@kinetix/types";

import {
    COMMIT_HISTORICAL_IMPORT,
    HISTORICAL_IMPORT_COMMIT_QUERY_SERVICE,
    HISTORICAL_IMPORT_DRY_RUN,
    REVERT_HISTORICAL_IMPORT,
    type CommitHistoricalImport,
    type HistoricalImportCommitQueryService,
    type HistoricalImportDryRun,
    type HistoricalImportEnvelopeInput,
    type RevertHistoricalImport,
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
        @Inject(COMMIT_HISTORICAL_IMPORT)
        private readonly commit: CommitHistoricalImport,
        @Inject(HISTORICAL_IMPORT_COMMIT_QUERY_SERVICE)
        private readonly commits: HistoricalImportCommitQueryService,
        @Inject(REVERT_HISTORICAL_IMPORT)
        private readonly revert: RevertHistoricalImport,
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

    /**
     * Start (design §14.7) the durable, resumable commit of an approved dry-run. The body carries only
     * the dry-run identity + approval token; no payload can be smuggled in. The commit applies each
     * program and completed session as its own aggregate-safe transaction and consumes the dry-run only
     * once every batch has committed. A batch failure surfaces as `JOB_FAILED` (422) with the failing
     * canonical payload path; the durable run is then resumable via the retry endpoint.
     */
    @Post("commits")
    @ApiOperation({ summary: "Commit an approved historical dry-run into authoritative Training state" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    async createCommit(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<HistoricalImportCommitResponse> {
        const request = parseContract(
            historicalImportCommitRequestSchema,
            rawBody,
            "Historical import commit validation failed",
        );
        const metadata = this.metadata(rawCorrelationId);
        const body = historicalImportCommitResponseSchema.parse(
            await this.commit.execute(
                {
                    dryRunId: request.dryRunId,
                    approvalToken: request.approvalToken,
                    idempotencyKey: idempotencyKey ?? null,
                },
                metadata,
            ),
        );
        response.setHeader("X-Commit-Id", body.commitId);
        return body;
    }

    /** List every historical import (commit run) for the active profile, newest first (design §14.7). */
    @Get("commits")
    @ApiOperation({ summary: "List the active profile's historical imports" })
    async listCommits(): Promise<HistoricalImportListResponse> {
        return historicalImportListResponseSchema.parse(await this.commits.list());
    }

    /** Read the durable status, counts, and (on failure) the path-anchored failure of a commit run. */
    @Get("commits/:id")
    @ApiOperation({ summary: "Read the status and result of a historical import commit run" })
    async readCommit(@Param("id") id: string): Promise<HistoricalImportCommitResponse> {
        return historicalImportCommitResponseSchema.parse(await this.commits.findById(id));
    }

    /**
     * Generate the immutable storage audit for one committed import (design §14.7). It traces the payload
     * checksum through the storage plan to every stored Kinetix entity and its current revision, records
     * the created/updated/skipped/conflicted counts and any batch failure, and shows whether the import
     * was later reverted. It is a read-only projection over immutable durable records — no side effects.
     */
    @Get("commits/:id/report")
    @ApiOperation({ summary: "Generate the immutable storage audit for a committed historical import" })
    async report(@Param("id") id: string): Promise<HistoricalImportReportResponse> {
        return historicalImportReportResponseSchema.parse(await this.commits.report(id));
    }

    /**
     * Revert a committed import by scoped, history-preserving compensation (design §14.7). It archives the
     * import's own program/planned-session/training-session aggregates (restorable, never hard-deleted) and
     * refuses the whole revert with `IMPORT_REVERT_BLOCKED` (409) if any was edited after the import. The
     * run is durable, idempotent, and resumable — re-posting resumes or replays the same run.
     */
    @Post("commits/:id/reverts")
    @ApiOperation({ summary: "Revert a committed historical import through scoped, history-preserving archival" })
    async createRevert(
        @Param("id") id: string,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<HistoricalImportRevertResponse> {
        const body = historicalImportRevertResponseSchema.parse(
            await this.revert.execute(id, this.metadata(rawCorrelationId)),
        );
        response.setHeader("X-Revert-Id", body.revertId);
        return body;
    }

    /** Read the durable revert run for a committed import (`GET …/commits/:id/reverts`); 404 if none exists. */
    @Get("commits/:id/reverts")
    @ApiOperation({ summary: "Read the status and result of a historical import revert run" })
    async readRevert(@Param("id") id: string): Promise<HistoricalImportRevertResponse> {
        return historicalImportRevertResponseSchema.parse(await this.commits.revertStatus(id));
    }

    /** Resume a failed or interrupted commit run from its last committed checkpoint (design §14.7). */
    @Post("commits/:id/retries")
    @ApiOperation({ summary: "Resume a failed or interrupted historical import commit from its checkpoint" })
    async retryCommit(
        @Param("id") id: string,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<HistoricalImportCommitResponse> {
        const body = historicalImportCommitResponseSchema.parse(
            await this.commit.retry(id, this.metadata(rawCorrelationId)),
        );
        response.setHeader("X-Commit-Id", body.commitId);
        return body;
    }

    private metadata(rawCorrelationId: string | undefined): CommandContext {
        return { correlationId: rawCorrelationId?.trim() || randomUUID(), actorId: null, source: "agent" };
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
