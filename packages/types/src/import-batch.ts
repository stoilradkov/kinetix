import { z } from "zod";

/**
 * Import-batch persistence contracts (issue #56, HI2; design §14.4–14.5). Where the historical-import
 * envelope (`historical-import.ts`, #55) defines the *payload* a caller submits, this module defines
 * the durable *identity and ownership* Kinetix persists for that payload: a stable import batch keyed
 * by `(namespace, payloadId)`, its immutable canonical checksum, its lifecycle state, and the
 * deterministic external-ID → Kinetix-ID mappings for every entity a batch commits.
 *
 * These are read/identity contracts only — no field here carries or interprets source spreadsheet
 * data. `namespace`, `payloadId`, `checksum`, and `description` are opaque, caller-supplied values;
 * `description` is bounded free text Kinetix stores and never parses. Deterministic retries rely on
 * `(namespace, payloadId, checksum)`: re-submitting the same triple resolves to the same batch, and
 * reusing a `payloadId` with a different `checksum` is a conflict.
 */

const namespaceSchema = z.string().trim().min(1).max(120);
const payloadIdSchema = z.string().trim().min(1).max(200);
const generatedBySchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().min(1).max(2_000);
const externalIdSchema = z.string().trim().min(1).max(200);
const checksumSchema = z.string().regex(/^[0-9a-f]{64}$/, "Must be a lowercase hex SHA-256 digest");
const nonNegativeInt = z.number().int().nonnegative();

/**
 * Lifecycle states of an import batch (design §14.5). A batch is `pending` the moment its identity is
 * claimed; it becomes `committed` once its authoritative entities are written and a result checksum is
 * recorded, or `failed` if a commit attempt is abandoned. States are append-only for a given batch —
 * an entity is only traceable to a batch after it commits.
 */
export const importBatchStateSchema = z.enum(["pending", "committed", "failed"]);

/**
 * The import-addressable aggregate kinds (design §14.4). Each is a distinct external-ID uniqueness
 * namespace and mirrors the historical-import domain's `HistoricalEntityType`. Both the plan side
 * (program/block/planned session tree) and the performance side (completed session/activity/occurrence
 * /group/set/run detail/pain) are addressable, so identity storage works for either aggregate.
 */
export const importEntityTypeSchema = z.enum([
    "program",
    "program-block",
    "planned-session",
    "planned-activity",
    "planned-exercise",
    "planned-set",
    "training-session",
    "session-activity",
    "occurrence",
    "set-group",
    "performed-set",
    "run-step",
    "run-split",
    "pain-record",
]);

/**
 * Immutable payload identity a caller registers for a batch (design §14.4). `checksum` is the lowercase
 * hex SHA-256 the caller computed over the canonical payload; the boundary re-verifies it so a retried
 * or resumed import is provably the same bytes. `description` is opaque, bounded metadata Kinetix
 * stores and never interprets — no source workbook or parsing policy is persisted here.
 */
export const importBatchSourceSchema = z
    .object({
        namespace: namespaceSchema,
        payloadId: payloadIdSchema,
        schemaVersion: z.literal(1),
        checksum: checksumSchema,
        generatedBy: generatedBySchema.optional(),
        description: descriptionSchema.optional(),
    })
    .strict();

/**
 * Bounded declared size of the payload the batch identifies, so an over-large archive is rejected with
 * a stable `PAYLOAD_TOO_LARGE` error before any persistence work. These are counts only — never source
 * content — and are matched against the historical-import domain limits.
 */
export const importBatchPayloadSizeSchema = z
    .object({
        programs: nonNegativeInt,
        completedSessions: nonNegativeInt,
    })
    .strict();

/** Register (open-or-resolve) an import batch by its identity (design §14.5). */
export const registerImportBatchRequestSchema = z
    .object({
        source: importBatchSourceSchema,
        payloadSize: importBatchPayloadSizeSchema.optional(),
    })
    .strict();

/**
 * Import batch identity + lifecycle (design §14.5). `resolved` is `true` when a register call matched
 * an already-persisted batch (a deterministic retry) rather than opening a new one, so a caller can
 * tell a fresh claim from an idempotent replay.
 */
export const importBatchResponseSchema = z
    .object({
        id: z.string().uuid(),
        namespace: namespaceSchema,
        payloadId: payloadIdSchema,
        schemaVersion: z.literal(1),
        checksum: checksumSchema,
        generatedBy: z.string().nullable(),
        description: z.string().nullable(),
        state: importBatchStateSchema,
        resultChecksum: checksumSchema.nullable(),
        createdAt: z.string(),
        committedAt: z.string().nullable(),
        resolved: z.boolean(),
    })
    .strict();

/** One caller-external-ID → Kinetix-ID mapping owned by a batch (design §14.4). */
export const importBatchMappingSchema = z
    .object({
        entityType: importEntityTypeSchema,
        externalId: externalIdSchema,
        entityId: z.string().uuid(),
    })
    .strict();

/** Deterministic external-ID → Kinetix-ID mappings for a batch, sorted by `(entityType, externalId)`. */
export const importBatchMappingsResponseSchema = z
    .object({
        batchId: z.string().uuid(),
        namespace: namespaceSchema,
        count: nonNegativeInt,
        mappings: z.array(importBatchMappingSchema),
    })
    .strict();

export type ImportBatchState = z.infer<typeof importBatchStateSchema>;
export type ImportEntityType = z.infer<typeof importEntityTypeSchema>;
export type ImportBatchSource = z.infer<typeof importBatchSourceSchema>;
export type ImportBatchPayloadSize = z.infer<typeof importBatchPayloadSizeSchema>;
export type RegisterImportBatchRequest = z.infer<typeof registerImportBatchRequestSchema>;
export type ImportBatchResponse = z.infer<typeof importBatchResponseSchema>;
export type ImportBatchMapping = z.infer<typeof importBatchMappingSchema>;
export type ImportBatchMappingsResponse = z.infer<typeof importBatchMappingsResponseSchema>;
