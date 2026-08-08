import { z } from "zod";

import { importEntityTypeSchema } from "#src/import-batch";

/**
 * Machine-readable storage reconciliation outcomes for a normalized import (issue #57, HI3; design
 * §12.3, §14.2–14.3). Reconciliation is the single shared policy that decides how an already-normalized
 * payload will affect current Kinetix state; these contracts are how that decision is surfaced to a
 * caller — the same ordered plan a dry-run reports and a commit executes.
 *
 * Each entry addresses one import-addressable entity by its payload location (`path`) and its
 * `(entityType, externalId)` identity, and states the resolved operation. For an entity that already
 * exists it also carries the current Kinetix ID and version; a `conflict` additionally carries a stable
 * machine-readable `conflictCode` so a caller can act deterministically without re-deriving the reason.
 * No field carries or interprets source spreadsheet data — reconciliation never merges, infers, or
 * deduplicates.
 */

const externalIdSchema = z.string().trim().min(1).max(200);
const nonNegativeInt = z.number().int().nonnegative();

/**
 * How a normalized entity affects current state (design §12.3):
 *  - `create` — the external ID is new; the entity is created.
 *  - `update` — the external ID is bound, content changed, and the asserted version matches current.
 *  - `skip-identical` — the external ID is bound to byte-identical canonical content; a no-op.
 *  - `conflict` — the change cannot be applied deterministically (see {@link reconciliationConflictCodeSchema}).
 */
export const storageOperationSchema = z.enum(["create", "update", "skip-identical", "conflict"]);

/**
 * Why a reconciliation resolved to a `conflict`:
 *  - `EXTERNAL_ID_EXISTS` — `create` mode addressed an external ID already bound to differing content.
 *  - `EXPECTED_VERSION_REQUIRED` — an `upsert` would change content but no expected version was asserted.
 *  - `VERSION_MISMATCH` — the asserted expected version does not match the current aggregate version
 *    (the target was modified by a user or a prior import since the caller last observed it).
 */
export const reconciliationConflictCodeSchema = z.enum([
    "EXTERNAL_ID_EXISTS",
    "EXPECTED_VERSION_REQUIRED",
    "VERSION_MISMATCH",
]);

/** The mode a reconciliation runs under, mirroring the import envelope's `mode`. */
export const reconciliationModeSchema = z.enum(["create", "upsert"]);

/**
 * One classified entity in the storage plan. `currentEntityId` / `currentVersion` are present only when
 * an existing entity was resolved (`null` for a `create`); `conflictCode` is present only for a
 * `conflict`. `path` locates the entity in the submitted payload so a caller can anchor the outcome.
 */
export const storagePlanEntrySchema = z
    .object({
        path: z.array(z.union([z.string(), z.number()])),
        entityType: importEntityTypeSchema,
        externalId: externalIdSchema,
        operation: storageOperationSchema,
        currentEntityId: z.string().uuid().nullable(),
        currentVersion: nonNegativeInt.nullable(),
        conflictCode: reconciliationConflictCodeSchema.nullable(),
    })
    .strict();

/** Per-operation totals for a quick summary without walking the plan. */
export const storagePlanCountsSchema = z
    .object({
        create: nonNegativeInt,
        update: nonNegativeInt,
        "skip-identical": nonNegativeInt,
        conflict: nonNegativeInt,
    })
    .strict();

/**
 * The complete ordered storage plan for a normalized import (design §14.2–14.3). `entries` are in
 * payload order and are reused unchanged by dry-run and commit; `conflicts` is the subset a caller can
 * reject on, and `hasConflicts` is the fast gate.
 */
export const storageReconciliationPlanSchema = z
    .object({
        namespace: z.string().trim().min(1).max(120),
        mode: reconciliationModeSchema,
        entries: z.array(storagePlanEntrySchema),
        counts: storagePlanCountsSchema,
        conflicts: z.array(storagePlanEntrySchema),
        hasConflicts: z.boolean(),
    })
    .strict();

export type StorageOperation = z.infer<typeof storageOperationSchema>;
export type ReconciliationConflictCode = z.infer<typeof reconciliationConflictCodeSchema>;
export type ReconciliationMode = z.infer<typeof reconciliationModeSchema>;
export type StoragePlanEntry = z.infer<typeof storagePlanEntrySchema>;
export type StoragePlanCounts = z.infer<typeof storagePlanCountsSchema>;
export type StorageReconciliationPlan = z.infer<typeof storageReconciliationPlanSchema>;
