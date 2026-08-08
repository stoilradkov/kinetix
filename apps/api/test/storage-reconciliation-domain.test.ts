import { describe, expect, it } from "vitest";

import {
    canonicalContentFingerprint,
    reconcileStorageOutcome,
    reconciliationConflictCodes,
    storageOperations,
    toStoragePlanEntry,
    type ExistingEntityState,
    type StorageReconciliationInput,
} from "#src/modules/training/domain/index";

const ENTITY_ID = "0198a4db-d8da-7000-8000-0000000000a1";
const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);

function existing(overrides: Partial<ExistingEntityState> = {}): ExistingEntityState {
    return { entityId: ENTITY_ID, version: 3, fingerprint: FP_A, ...overrides };
}

function input(overrides: Partial<StorageReconciliationInput> = {}): StorageReconciliationInput {
    return { mode: "upsert", incomingFingerprint: FP_A, expectedVersion: 3, existing: existing(), ...overrides };
}

// ---------------------------------------------------------------------------------------------
// Content fingerprint (pure primitive)
// ---------------------------------------------------------------------------------------------

describe("canonicalContentFingerprint", () => {
    it("is independent of object key order", () => {
        expect(canonicalContentFingerprint({ a: 1, b: 2 })).toBe(canonicalContentFingerprint({ b: 2, a: 1 }));
    });

    it("is sensitive to array order (a reordered set list is different content)", () => {
        expect(canonicalContentFingerprint([1, 2, 3])).not.toBe(canonicalContentFingerprint([3, 2, 1]));
    });

    it("drops omitted (undefined) fields but retains explicit null", () => {
        expect(canonicalContentFingerprint({ a: 1, b: undefined })).toBe(canonicalContentFingerprint({ a: 1 }));
        expect(canonicalContentFingerprint({ a: 1, b: null })).not.toBe(canonicalContentFingerprint({ a: 1 }));
    });

    it("distinguishes a known zero from a cleared/absent value", () => {
        expect(canonicalContentFingerprint({ load: 0 })).not.toBe(canonicalContentFingerprint({ load: null }));
        expect(canonicalContentFingerprint({ load: 0 })).not.toBe(canonicalContentFingerprint({}));
    });

    it("distinguishes different scalar contents and nested structures", () => {
        expect(canonicalContentFingerprint({ reps: 5 })).not.toBe(canonicalContentFingerprint({ reps: 6 }));
        expect(canonicalContentFingerprint({ a: { b: 1 } })).not.toBe(canonicalContentFingerprint({ a: { b: 2 } }));
    });

    it("rejects a non-finite number rather than silently colliding", () => {
        expect(() => canonicalContentFingerprint({ x: Number.NaN })).toThrow();
    });
});

// ---------------------------------------------------------------------------------------------
// Reconciliation decision table (the graded core)
// ---------------------------------------------------------------------------------------------

describe("reconcileStorageOutcome", () => {
    it("classifies a new external ID as create", () => {
        expect(reconcileStorageOutcome(input({ existing: null }))).toEqual({ operation: "create" });
    });

    it("classifies same external ID with same canonical content as skip-identical (upsert)", () => {
        expect(reconcileStorageOutcome(input({ mode: "upsert", incomingFingerprint: FP_A }))).toEqual({
            operation: "skip-identical",
            entityId: ENTITY_ID,
        });
    });

    it("classifies same external ID with same canonical content as skip-identical (create replay)", () => {
        expect(
            reconcileStorageOutcome(input({ mode: "create", incomingFingerprint: FP_A, expectedVersion: null })),
        ).toEqual({ operation: "skip-identical", entityId: ENTITY_ID });
    });

    it("classifies an upsert with changed content and matching expected version as update", () => {
        expect(
            reconcileStorageOutcome(input({ mode: "upsert", incomingFingerprint: FP_B, expectedVersion: 3 })),
        ).toEqual({ operation: "update", entityId: ENTITY_ID, fromVersion: 3 });
    });

    it("classifies changed content without an expected version as a conflict", () => {
        expect(
            reconcileStorageOutcome(input({ mode: "upsert", incomingFingerprint: FP_B, expectedVersion: null })),
        ).toEqual({
            operation: "conflict",
            conflictCode: "EXPECTED_VERSION_REQUIRED",
            entityId: ENTITY_ID,
            currentVersion: 3,
        });
    });

    it("classifies a stale expected version (user-modified target) as a version-mismatch conflict", () => {
        expect(
            reconcileStorageOutcome(input({ mode: "upsert", incomingFingerprint: FP_B, expectedVersion: 2 })),
        ).toEqual({
            operation: "conflict",
            conflictCode: "VERSION_MISMATCH",
            entityId: ENTITY_ID,
            currentVersion: 3,
        });
    });

    it("classifies create mode over an existing entity with changed content as a conflict", () => {
        expect(
            reconcileStorageOutcome(input({ mode: "create", incomingFingerprint: FP_B, expectedVersion: null })),
        ).toEqual({
            operation: "conflict",
            conflictCode: "EXTERNAL_ID_EXISTS",
            entityId: ENTITY_ID,
            currentVersion: 3,
        });
    });

    it("treats an unknown prior fingerprint as content-differs (never identical)", () => {
        expect(
            reconcileStorageOutcome(
                input({
                    mode: "upsert",
                    incomingFingerprint: FP_A,
                    expectedVersion: 3,
                    existing: existing({ fingerprint: null }),
                }),
            ),
        ).toEqual({ operation: "update", entityId: ENTITY_ID, fromVersion: 3 });
    });

    it("does not version-gate a child entity whose version is null", () => {
        expect(
            reconcileStorageOutcome(
                input({
                    mode: "upsert",
                    incomingFingerprint: FP_B,
                    expectedVersion: 7,
                    existing: existing({ version: null }),
                }),
            ),
        ).toEqual({ operation: "update", entityId: ENTITY_ID, fromVersion: null });
    });

    it("never merges two distinct external IDs with identical content", () => {
        // The reconciliation only ever sees the bound state for the external ID it is given; a second,
        // distinct external ID with the same content resolves to `create`, so no merge can occur.
        expect(reconcileStorageOutcome(input({ incomingFingerprint: FP_A, existing: null }))).toEqual({
            operation: "create",
        });
    });

    it("exposes stable operation and conflict-code vocabularies", () => {
        expect(storageOperations).toEqual(["create", "update", "skip-identical", "conflict"]);
        expect(reconciliationConflictCodes).toEqual([
            "EXTERNAL_ID_EXISTS",
            "EXPECTED_VERSION_REQUIRED",
            "VERSION_MISMATCH",
        ]);
    });
});

// ---------------------------------------------------------------------------------------------
// Plan entry projection
// ---------------------------------------------------------------------------------------------

describe("toStoragePlanEntry", () => {
    const request = { path: ["programs", 0], entityType: "program" as const, externalId: "prog-1" };

    it("projects a create with no current binding", () => {
        expect(toStoragePlanEntry(request, { operation: "create" })).toEqual({
            path: ["programs", 0],
            entityType: "program",
            externalId: "prog-1",
            operation: "create",
            currentEntityId: null,
            currentVersion: null,
            conflictCode: null,
        });
    });

    it("projects an update with its from-version", () => {
        expect(toStoragePlanEntry(request, { operation: "update", entityId: ENTITY_ID, fromVersion: 4 })).toMatchObject(
            {
                operation: "update",
                currentEntityId: ENTITY_ID,
                currentVersion: 4,
                conflictCode: null,
            },
        );
    });

    it("projects a conflict with its code and current version", () => {
        expect(
            toStoragePlanEntry(request, {
                operation: "conflict",
                conflictCode: "VERSION_MISMATCH",
                entityId: ENTITY_ID,
                currentVersion: 9,
            }),
        ).toMatchObject({ operation: "conflict", conflictCode: "VERSION_MISMATCH", currentVersion: 9 });
    });
});
