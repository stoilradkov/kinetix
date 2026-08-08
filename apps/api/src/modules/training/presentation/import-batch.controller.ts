import { Body, Controller, Get, HttpException, Inject, Param, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import {
    importBatchMappingsResponseSchema,
    importBatchResponseSchema,
    registerImportBatchRequestSchema,
    type ImportBatchMappingsResponse,
    type ImportBatchResponse,
} from "@kinetix/types";

import {
    IMPORT_BATCH_QUERY_SERVICE,
    REGISTER_IMPORT_BATCH,
    type ImportBatchQueryService,
    type ImportBatchView,
    type RegisterImportBatch,
} from "#src/modules/training/application/index";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

/**
 * Import-batch identity surface (design §14.5; issue #56, HI2). `POST` registers (opens-or-resolves) a
 * batch by its immutable payload identity: a byte-identical retry resolves to the same batch, while
 * reusing a payload ID with different canonical content is a stable `IMPORT_PAYLOAD_CONFLICT` (409) and
 * an over-large declared payload is `PAYLOAD_TOO_LARGE` (413). The `GET` reads expose a batch's identity
 * /lifecycle and its deterministic external-ID → Kinetix-ID mappings, so every imported entity is
 * traceable to its batch and caller external ID. No endpoint here interprets source content.
 */
@ApiTags("training import")
@Controller({ path: "training/imports/batches", version: "1" })
export class ImportBatchController {
    constructor(
        @Inject(REGISTER_IMPORT_BATCH)
        private readonly registerBatch: RegisterImportBatch,
        @Inject(IMPORT_BATCH_QUERY_SERVICE)
        private readonly query: ImportBatchQueryService,
    ) {}

    @Post()
    @ApiOperation({ summary: "Register (open-or-resolve) an import batch by its payload identity" })
    async register(
        @Body() rawBody: unknown,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<ImportBatchResponse> {
        const request = parseContract(
            registerImportBatchRequestSchema,
            rawBody,
            "Import batch registration validation failed",
        );
        const view = await this.registerBatch.execute(request);
        response.setHeader("X-Import-Batch-Id", view.id);
        return importBatchResponseSchema.parse(toResponse(view));
    }

    @Get(":batchId")
    @ApiOperation({ summary: "Read an import batch's identity and lifecycle state" })
    @ApiParam({ name: "batchId", format: "uuid" })
    async show(@Param("batchId") batchId: string): Promise<ImportBatchResponse> {
        return importBatchResponseSchema.parse(toResponse(await this.query.findById(batchId)));
    }

    @Get(":batchId/mappings")
    @ApiOperation({ summary: "List a batch's external-ID → Kinetix-ID mappings" })
    @ApiParam({ name: "batchId", format: "uuid" })
    async mappings(@Param("batchId") batchId: string): Promise<ImportBatchMappingsResponse> {
        const result = await this.query.listMappings(batchId);
        return importBatchMappingsResponseSchema.parse({
            batchId: result.batchId,
            namespace: result.namespace,
            count: result.count,
            mappings: result.mappings.map(mapping => ({ ...mapping })),
        });
    }
}

function toResponse(view: ImportBatchView): ImportBatchResponse {
    return {
        id: view.id,
        namespace: view.namespace,
        payloadId: view.payloadId,
        schemaVersion: 1,
        checksum: view.checksum,
        generatedBy: view.generatedBy,
        description: view.description,
        state: view.state,
        resultChecksum: view.resultChecksum,
        createdAt: view.createdAt,
        committedAt: view.committedAt,
        resolved: view.resolved,
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
    if (parsed.success) return parsed.data;
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
        const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$";
        (fieldErrors[path] ??= []).push(issue.message);
    }
    throw new HttpException({ code: "VALIDATION_FAILED", message, fieldErrors }, 422);
}
