import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { mapException } from "#src/platform/presentation/api-exception.filter";
import { ImportPayloadConflictError, PayloadTooLargeError } from "#src/platform/application/index";
import type {
    ImportBatchQueryService,
    ImportBatchView,
    RegisterImportBatch,
} from "#src/modules/training/application/index";
import { ImportBatchController } from "#src/modules/training/presentation/index";

const batchId = "0198a4db-d8da-7000-8000-0000000000d1";
const CHECKSUM = "a".repeat(64);

function view(overrides: Partial<ImportBatchView> = {}): ImportBatchView {
    return {
        id: batchId,
        namespace: "coach-app",
        payloadId: "archive-2021",
        schemaVersion: 1,
        checksum: CHECKSUM,
        generatedBy: null,
        description: null,
        state: "pending",
        resultChecksum: null,
        createdAt: "2026-08-08T10:00:00.000Z",
        committedAt: null,
        resolved: false,
        ...overrides,
    };
}

function request(overrides: Record<string, unknown> = {}) {
    return {
        source: {
            namespace: "coach-app",
            payloadId: "archive-2021",
            schemaVersion: 1,
            checksum: CHECKSUM,
            ...overrides,
        },
    };
}

function headers() {
    return { setHeader: vi.fn() };
}

function controller(
    execute = vi.fn().mockResolvedValue(view()),
    findById = vi.fn().mockResolvedValue(view({ resolved: true })),
    listMappings = vi.fn().mockResolvedValue({ batchId, namespace: "coach-app", count: 0, mappings: [] }),
) {
    const register = { execute } as unknown as RegisterImportBatch;
    const query = { findById, listMappings } as unknown as ImportBatchQueryService;
    return { controller: new ImportBatchController(register, query), execute, findById, listMappings };
}

describe("ImportBatchController", () => {
    it("registers a batch and sets the batch-id header", async () => {
        const { controller: subject, execute } = controller();
        const response = headers();
        const body = await subject.register(request(), response);

        expect(body.id).toBe(batchId);
        expect(body.state).toBe("pending");
        expect(execute).toHaveBeenCalledTimes(1);
        expect(response.setHeader).toHaveBeenCalledWith("X-Import-Batch-Id", batchId);
    });

    it("rejects a non-hex checksum with a path-scoped 422", async () => {
        const { controller: subject } = controller();
        try {
            await subject.register(request({ checksum: "NOTHEX" }), headers());
            throw new Error("expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(HttpException);
            const payload = (error as HttpException).getResponse() as {
                code: string;
                fieldErrors: Record<string, string[]>;
            };
            expect(payload.code).toBe("VALIDATION_FAILED");
            expect(Object.keys(payload.fieldErrors).some(key => key.includes("checksum"))).toBe(true);
        }
    });

    it("rejects a source that smuggles a spreadsheet field", async () => {
        const { controller: subject } = controller();
        await expect(subject.register(request({ sheetRow: 7 }), headers())).rejects.toBeInstanceOf(HttpException);
    });

    it("reads a batch by id and lists its mappings", async () => {
        const { controller: subject, findById, listMappings } = controller();
        expect((await subject.show(batchId)).resolved).toBe(true);
        expect(findById).toHaveBeenCalledWith(batchId);
        expect((await subject.mappings(batchId)).count).toBe(0);
        expect(listMappings).toHaveBeenCalledWith(batchId);
    });
});

describe("import-batch error mapping (stable conflict responses)", () => {
    it("maps a reused-payload conflict to a 409 IMPORT_PAYLOAD_CONFLICT", () => {
        const mapped = mapException(
            new ImportPayloadConflictError("coach-app", "archive-2021", CHECKSUM, "b".repeat(64)),
        );
        expect(mapped.status).toBe(409);
        expect(mapped.code).toBe("IMPORT_PAYLOAD_CONFLICT");
    });

    it("maps an over-large payload to a 413 PAYLOAD_TOO_LARGE", () => {
        const mapped = mapException(
            new PayloadTooLargeError("too big", { "payloadSize.completedSessions": ["exceeds"] }),
        );
        expect(mapped.status).toBe(413);
        expect(mapped.code).toBe("PAYLOAD_TOO_LARGE");
    });
});
