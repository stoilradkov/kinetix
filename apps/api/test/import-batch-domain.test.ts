import { describe, expect, it } from "vitest";

import { DomainValidationError } from "#src/platform/domain/index";
import {
    ImportBatch,
    ImportPayloadTooLargeError,
    assertPayloadSizeWithinLimits,
    importBatchStates,
    reconcileImportBatchIdentity,
    type OpenImportBatchInput,
} from "#src/modules/training/domain/index";

const NOW = new Date("2026-08-08T10:00:00.000Z");
const LATER = new Date("2026-08-08T10:05:00.000Z");
const CHECKSUM = "a".repeat(64);
const RESULT_CHECKSUM = "b".repeat(64);
const BATCH_ID = "0198a4db-d8da-7000-8000-0000000000f1";
const PROFILE_ID = "0198a4db-d8da-7000-8000-0000000000f2";

function open(overrides: Partial<OpenImportBatchInput> = {}): ImportBatch {
    return ImportBatch.open(
        {
            id: BATCH_ID,
            profileId: PROFILE_ID,
            namespace: "coach-app",
            payloadId: "archive-2021",
            schemaVersion: 1,
            checksum: CHECKSUM,
            ...overrides,
        },
        NOW,
    );
}

describe("ImportBatch.open", () => {
    it("opens a pending batch with immutable identity and no result", () => {
        const state = open({ generatedBy: " coach-cli ", description: "  Hevy 2021  " }).state;
        expect(state).toMatchObject({
            id: BATCH_ID,
            profileId: PROFILE_ID,
            namespace: "coach-app",
            payloadId: "archive-2021",
            schemaVersion: 1,
            checksum: CHECKSUM,
            generatedBy: "coach-cli",
            description: "Hevy 2021",
            state: "pending",
            resultChecksum: null,
            committedAt: null,
        });
        expect(state.createdAt).toBe(NOW.toISOString());
    });

    it("rejects a non-hex checksum", () => {
        expect(() => open({ checksum: "NOT-HEX" })).toThrow(DomainValidationError);
    });

    it("rejects an unsupported schema version", () => {
        expect(() => open({ schemaVersion: 2 })).toThrow(DomainValidationError);
    });

    it("rejects a blank namespace", () => {
        expect(() => open({ namespace: "   " })).toThrow(DomainValidationError);
    });

    it("covers exactly the three lifecycle states", () => {
        expect([...importBatchStates]).toEqual(["pending", "committed", "failed"]);
    });
});

describe("ImportBatch lifecycle", () => {
    it("commits a pending batch, recording the result checksum and commit time", () => {
        const batch = open();
        const state = batch.markCommitted(RESULT_CHECKSUM, LATER).state;
        expect(state.state).toBe("committed");
        expect(state.resultChecksum).toBe(RESULT_CHECKSUM);
        expect(state.committedAt).toBe(LATER.toISOString());
    });

    it("refuses to commit twice", () => {
        const batch = open().markCommitted(RESULT_CHECKSUM, LATER);
        expect(() => batch.markCommitted(RESULT_CHECKSUM, LATER)).toThrow(DomainValidationError);
    });

    it("refuses to commit a failed batch", () => {
        const batch = open().markFailed(LATER);
        expect(() => batch.markCommitted(RESULT_CHECKSUM, LATER)).toThrow(DomainValidationError);
    });

    it("rejects a non-hex result checksum", () => {
        expect(() => open().markCommitted("nope", LATER)).toThrow(DomainValidationError);
    });
});

describe("reconcileImportBatchIdentity", () => {
    it("matches a byte-identical retry", () => {
        expect(
            reconcileImportBatchIdentity(
                { checksum: CHECKSUM, schemaVersion: 1 },
                { checksum: CHECKSUM, schemaVersion: 1 },
            ),
        ).toEqual({
            outcome: "match",
        });
    });

    it("flags a different checksum under the same payload id as a conflict", () => {
        const result = reconcileImportBatchIdentity(
            { checksum: CHECKSUM, schemaVersion: 1 },
            { checksum: RESULT_CHECKSUM, schemaVersion: 1 },
        );
        expect(result).toMatchObject({
            outcome: "checksum-conflict",
            existingChecksum: CHECKSUM,
            incomingChecksum: RESULT_CHECKSUM,
        });
    });
});

describe("assertPayloadSizeWithinLimits", () => {
    it("accepts a bounded archive", () => {
        expect(() => assertPayloadSizeWithinLimits({ programs: 3, completedSessions: 812 })).not.toThrow();
    });

    it("rejects too many completed sessions with a stable payload-size error", () => {
        try {
            assertPayloadSizeWithinLimits({ programs: 1, completedSessions: 20_001 });
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(ImportPayloadTooLargeError);
            expect((error as ImportPayloadTooLargeError).fieldErrors).toHaveProperty("payloadSize.completedSessions");
        }
    });
});
