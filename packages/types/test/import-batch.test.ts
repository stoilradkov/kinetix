import { describe, expect, it } from "vitest";

import {
    apiErrorCodeSchema,
    importBatchMappingsResponseSchema,
    importBatchResponseSchema,
    registerImportBatchRequestSchema,
} from "#src/index";

const CHECKSUM = "a".repeat(64);
const BATCH_ID = "0198a4db-d8da-7000-8000-0000000000f1";
const ENTITY_ID = "0198a4db-d8da-7000-8000-0000000000f2";

function source(overrides: Record<string, unknown> = {}) {
    return {
        namespace: "coach-app",
        payloadId: "archive-2021",
        schemaVersion: 1,
        checksum: CHECKSUM,
        ...overrides,
    };
}

describe("registerImportBatchRequestSchema", () => {
    it("accepts a minimal identity", () => {
        const parsed = registerImportBatchRequestSchema.parse({ source: source() });
        expect(parsed.source.payloadId).toBe("archive-2021");
    });

    it("accepts an opaque description and payload-size counts", () => {
        const parsed = registerImportBatchRequestSchema.parse({
            source: source({ generatedBy: "coach-cli@2.1", description: "Hevy export, 2021 season" }),
            payloadSize: { programs: 3, completedSessions: 812 },
        });
        expect(parsed.source.description).toBe("Hevy export, 2021 season");
        expect(parsed.payloadSize?.completedSessions).toBe(812);
    });

    it("rejects a non-hex checksum", () => {
        expect(registerImportBatchRequestSchema.safeParse({ source: source({ checksum: "NOTHEX" }) }).success).toBe(
            false,
        );
    });

    it("rejects an unsupported schema version", () => {
        expect(registerImportBatchRequestSchema.safeParse({ source: source({ schemaVersion: 2 }) }).success).toBe(
            false,
        );
    });

    it("rejects unknown source keys so no spreadsheet field can be smuggled in", () => {
        expect(
            registerImportBatchRequestSchema.safeParse({ source: source({ sheetRow: 42, cell: "B7" }) }).success,
        ).toBe(false);
    });

    it("rejects a blank namespace", () => {
        expect(registerImportBatchRequestSchema.safeParse({ source: source({ namespace: "   " }) }).success).toBe(
            false,
        );
    });
});

describe("importBatchResponseSchema", () => {
    it("round-trips a pending batch", () => {
        const parsed = importBatchResponseSchema.parse({
            id: BATCH_ID,
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
        });
        expect(parsed.state).toBe("pending");
        expect(parsed.resolved).toBe(false);
    });

    it("rejects an unknown lifecycle state", () => {
        const base = {
            id: BATCH_ID,
            namespace: "coach-app",
            payloadId: "archive-2021",
            schemaVersion: 1,
            checksum: CHECKSUM,
            generatedBy: null,
            description: null,
            resultChecksum: null,
            createdAt: "2026-08-08T10:00:00.000Z",
            committedAt: null,
            resolved: true,
        };
        expect(importBatchResponseSchema.safeParse({ ...base, state: "archived" }).success).toBe(false);
    });
});

describe("importBatchMappingsResponseSchema", () => {
    it("round-trips mappings across plan and performance entity types", () => {
        const parsed = importBatchMappingsResponseSchema.parse({
            batchId: BATCH_ID,
            namespace: "coach-app",
            count: 2,
            mappings: [
                { entityType: "program", externalId: "prog-1", entityId: ENTITY_ID },
                { entityType: "training-session", externalId: "sess-1", entityId: ENTITY_ID },
            ],
        });
        expect(parsed.mappings).toHaveLength(2);
    });

    it("rejects an unknown entity type", () => {
        expect(
            importBatchMappingsResponseSchema.safeParse({
                batchId: BATCH_ID,
                namespace: "coach-app",
                count: 1,
                mappings: [{ entityType: "spreadsheet-cell", externalId: "x", entityId: ENTITY_ID }],
            }).success,
        ).toBe(false);
    });
});

describe("apiErrorCodeSchema", () => {
    it("includes the HI2 identity and payload-size conflict codes", () => {
        expect(apiErrorCodeSchema.safeParse("IMPORT_PAYLOAD_CONFLICT").success).toBe(true);
        expect(apiErrorCodeSchema.safeParse("PAYLOAD_TOO_LARGE").success).toBe(true);
    });
});
