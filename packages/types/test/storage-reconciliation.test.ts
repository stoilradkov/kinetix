import { describe, expect, it } from "vitest";

import {
    reconciliationConflictCodeSchema,
    storageOperationSchema,
    storagePlanEntrySchema,
    storageReconciliationPlanSchema,
} from "#src/index";

const ENTITY_ID = "0198a4db-d8da-7000-8000-0000000000f2";

function entry(overrides: Record<string, unknown> = {}) {
    return {
        path: ["programs", 0],
        entityType: "program",
        externalId: "prog-1",
        operation: "create",
        currentEntityId: null,
        currentVersion: null,
        conflictCode: null,
        ...overrides,
    };
}

describe("storageOperationSchema", () => {
    it("enumerates the four operations", () => {
        expect(storageOperationSchema.options).toEqual(["create", "update", "skip-identical", "conflict"]);
    });
});

describe("reconciliationConflictCodeSchema", () => {
    it("enumerates the stable conflict codes", () => {
        expect(reconciliationConflictCodeSchema.options).toEqual([
            "EXTERNAL_ID_EXISTS",
            "EXPECTED_VERSION_REQUIRED",
            "VERSION_MISMATCH",
        ]);
    });
});

describe("storagePlanEntrySchema", () => {
    it("accepts a create with no current binding", () => {
        expect(storagePlanEntrySchema.parse(entry()).operation).toBe("create");
    });

    it("accepts an update carrying the current id and version", () => {
        const parsed = storagePlanEntrySchema.parse(
            entry({ operation: "update", currentEntityId: ENTITY_ID, currentVersion: 4 }),
        );
        expect(parsed).toMatchObject({ operation: "update", currentEntityId: ENTITY_ID, currentVersion: 4 });
    });

    it("accepts a conflict carrying a machine-readable code", () => {
        const parsed = storagePlanEntrySchema.parse(
            entry({
                operation: "conflict",
                currentEntityId: ENTITY_ID,
                currentVersion: 9,
                conflictCode: "VERSION_MISMATCH",
            }),
        );
        expect(parsed.conflictCode).toBe("VERSION_MISMATCH");
    });

    it("rejects unknown fields", () => {
        expect(storagePlanEntrySchema.safeParse(entry({ extra: true })).success).toBe(false);
    });
});

describe("storageReconciliationPlanSchema", () => {
    it("accepts a complete ordered plan with counts and conflicts", () => {
        const conflict = entry({
            externalId: "prog-2",
            operation: "conflict",
            currentEntityId: ENTITY_ID,
            currentVersion: 2,
            conflictCode: "EXTERNAL_ID_EXISTS",
        });
        const parsed = storageReconciliationPlanSchema.parse({
            namespace: "coach-app",
            mode: "create",
            entries: [entry(), conflict],
            counts: { create: 1, update: 0, "skip-identical": 0, conflict: 1 },
            conflicts: [conflict],
            hasConflicts: true,
        });
        expect(parsed.entries).toHaveLength(2);
        expect(parsed.counts.conflict).toBe(1);
        expect(parsed.hasConflicts).toBe(true);
    });
});
