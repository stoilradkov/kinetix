import { DomainValidationError } from "#src/platform/domain/index";

import { HISTORICAL_IMPORT_LIMITS } from "#src/modules/training/domain/historical-import";

/**
 * Pure import-batch identity and lifecycle (issue #56, HI2; design §14.4–14.5). A historical import is
 * a *write source*, not a parallel domain model: this module adds durable ownership and stable payload
 * identity for a submitted archive without touching Training aggregates or their revisions/history.
 *
 * Two ideas live here, both framework-, clock-, and database-free:
 *
 *  1. **Immutable payload identity.** A batch is keyed by `(namespace, payloadId)` and pinned to a
 *     canonical `checksum`. Re-registering the same `(namespace, payloadId, checksum)` resolves to the
 *     same batch (deterministic retry); reusing a `payloadId` with a different `checksum` is a conflict
 *     — the payload changed under a claimed identity. `reconcileImportBatchIdentity` decides which.
 *  2. **A minimal lifecycle.** `pending → committed` once authoritative entities are written and a
 *     result checksum recorded, or `pending → failed`. State is the only mutable thing; identity is
 *     fixed at `open`.
 *
 * `namespace`, `payloadId`, `checksum`, `generatedBy`, and `description` are opaque, caller-supplied
 * values. `description` is bounded free text Kinetix stores and never parses — no source workbook or
 * parsing policy is a domain concept here.
 */

export const importBatchStates = ["pending", "committed", "failed"] as const;
export type ImportBatchState = (typeof importBatchStates)[number];

/**
 * The import-addressable aggregate kinds (design §14.4), mirroring the historical-import contract and
 * the persistence registry's `entity_type`. Both the plan side (program/block/planned session tree) and
 * the performance side (completed session/activity/occurrence/group/set/run detail/pain) are
 * addressable, so identity storage works for either aggregate.
 */
export const importEntityTypes = [
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
] as const;
export type ImportEntityType = (typeof importEntityTypes)[number];

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Immutable identity a caller claims for one submitted archive. */
export interface ImportBatchIdentity {
    readonly namespace: string;
    readonly payloadId: string;
    readonly schemaVersion: number;
    readonly checksum: string;
}

/** The full persisted state of an import batch — its identity plus mutable lifecycle. */
export interface ImportBatchSnapshot {
    readonly id: string;
    readonly profileId: string;
    readonly namespace: string;
    readonly payloadId: string;
    readonly schemaVersion: number;
    readonly checksum: string;
    readonly generatedBy: string | null;
    readonly description: string | null;
    readonly state: ImportBatchState;
    readonly resultChecksum: string | null;
    readonly createdAt: string;
    readonly committedAt: string | null;
}

export interface OpenImportBatchInput {
    readonly id: string;
    readonly profileId: string;
    readonly namespace: string;
    readonly payloadId: string;
    readonly schemaVersion: number;
    readonly checksum: string;
    readonly generatedBy?: string | null;
    readonly description?: string | null;
}

/**
 * An import batch aggregate. Identity fields are validated and fixed at {@link ImportBatch.open}; only
 * the lifecycle state (and its result checksum / committed timestamp) ever changes afterward.
 */
export class ImportBatch {
    private constructor(private current: ImportBatchSnapshot) {}

    /** Open a fresh, `pending` batch claiming an identity. Pure — the caller supplies id, profile, clock. */
    static open(input: OpenImportBatchInput, now: Date): ImportBatch {
        const createdAt = isoTimestamp(now, "Import batch creation time");
        return new ImportBatch({
            id: requiredUuid(input.id, "Import batch ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            namespace: requiredText(input.namespace, "Source namespace", 120),
            payloadId: requiredText(input.payloadId, "Payload ID", 200),
            schemaVersion: requireSchemaVersion(input.schemaVersion),
            checksum: requireChecksum(input.checksum, "Payload checksum"),
            generatedBy: optionalText(input.generatedBy, "Generated-by", 200),
            description: optionalText(input.description, "Description", 2_000),
            state: "pending",
            resultChecksum: null,
            createdAt,
            committedAt: null,
        });
    }

    /** Rehydrate an aggregate from persisted state without re-running create-time invariants. */
    static restore(snapshot: ImportBatchSnapshot): ImportBatch {
        return new ImportBatch(snapshot);
    }

    get state(): ImportBatchSnapshot {
        return this.current;
    }

    get identity(): ImportBatchIdentity {
        return {
            namespace: this.current.namespace,
            payloadId: this.current.payloadId,
            schemaVersion: this.current.schemaVersion,
            checksum: this.current.checksum,
        };
    }

    /**
     * Mark the batch committed, recording the checksum of the committed result. Only a `pending` batch
     * may commit; committing a `committed` or `failed` batch is an illegal transition.
     */
    markCommitted(resultChecksum: string, now: Date): this {
        if (this.current.state !== "pending") throw this.illegalTransition("committed");
        this.current = {
            ...this.current,
            state: "committed",
            resultChecksum: requireChecksum(resultChecksum, "Result checksum"),
            committedAt: isoTimestamp(now, "Import batch commit time"),
        };
        return this;
    }

    /** Mark a `pending` batch failed so a later retry can re-open a fresh identity if needed. */
    markFailed(now: Date): this {
        if (this.current.state !== "pending") throw this.illegalTransition("failed");
        this.current = { ...this.current, state: "failed", committedAt: isoTimestamp(now, "Import batch fail time") };
        return this;
    }

    private illegalTransition(target: ImportBatchState): DomainValidationError {
        return new DomainValidationError(`An import batch in state '${this.current.state}' cannot become '${target}'`, {
            state: [`Cannot transition from '${this.current.state}' to '${target}'`],
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Identity reconciliation
// ---------------------------------------------------------------------------------------------

export type ImportBatchIdentityReconciliation =
    | { readonly outcome: "match" }
    | { readonly outcome: "checksum-conflict"; readonly existingChecksum: string; readonly incomingChecksum: string };

/**
 * Reconcile an incoming identity against an already-persisted batch found by `(namespace, payloadId)`.
 * A byte-identical retry (same canonical `checksum`) is a `match` and resolves to the existing batch;
 * any other canonical content under the same `payloadId` is a `checksum-conflict`. A differing schema
 * version is also a conflict, since the checksum is computed over the canonical payload.
 */
export function reconcileImportBatchIdentity(
    existing: Pick<ImportBatchSnapshot, "checksum" | "schemaVersion">,
    incoming: Pick<ImportBatchIdentity, "checksum" | "schemaVersion">,
): ImportBatchIdentityReconciliation {
    if (existing.checksum === incoming.checksum && existing.schemaVersion === incoming.schemaVersion)
        return { outcome: "match" };
    return { outcome: "checksum-conflict", existingChecksum: existing.checksum, incomingChecksum: incoming.checksum };
}

// ---------------------------------------------------------------------------------------------
// Bounded payload size
// ---------------------------------------------------------------------------------------------

export interface ImportBatchPayloadSize {
    readonly programs: number;
    readonly completedSessions: number;
}

/** Signals that the declared payload exceeds a bounded per-archive limit (design §14.4). */
export class ImportPayloadTooLargeError extends DomainValidationError {
    constructor(fieldErrors: Record<string, string[]>) {
        super("The declared import payload exceeds bounded limits", fieldErrors);
        this.name = "ImportPayloadTooLargeError";
    }
}

/**
 * Reject an over-large archive by its declared counts before any persistence work, reusing the
 * historical-import per-archive limits. Throws {@link ImportPayloadTooLargeError} with the exceeded
 * dimension(s) so the boundary surfaces a stable `PAYLOAD_TOO_LARGE`.
 */
export function assertPayloadSizeWithinLimits(size: ImportBatchPayloadSize): void {
    const fieldErrors: Record<string, string[]> = {};
    if (size.programs > HISTORICAL_IMPORT_LIMITS.maxPrograms)
        fieldErrors["payloadSize.programs"] = [
            `Too many programs: ${size.programs} exceeds ${HISTORICAL_IMPORT_LIMITS.maxPrograms}`,
        ];
    if (size.completedSessions > HISTORICAL_IMPORT_LIMITS.maxCompletedSessions)
        fieldErrors["payloadSize.completedSessions"] = [
            `Too many completed sessions: ${size.completedSessions} exceeds ${HISTORICAL_IMPORT_LIMITS.maxCompletedSessions}`,
        ];
    if (Object.keys(fieldErrors).length > 0) throw new ImportPayloadTooLargeError(fieldErrors);
}

// ---------------------------------------------------------------------------------------------
// Field validation helpers (mirrors the other pure aggregates)
// ---------------------------------------------------------------------------------------------

function requiredUuid(value: string, label: string): string {
    if (!UUID_PATTERN.test(value))
        throw new DomainValidationError(`${label} must be a UUID`, { id: [`${label} is invalid`] });
    return value;
}

function requiredText(value: string, label: string, max: number): string {
    const trimmed = (value ?? "").trim();
    if (trimmed.length === 0 || trimmed.length > max)
        throw new DomainValidationError(`${label} must be 1–${max} characters`, {
            [label]: [`${label} must be 1–${max} characters`],
        });
    return trimmed;
}

function optionalText(value: string | null | undefined, label: string, max: number): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > max)
        throw new DomainValidationError(`${label} must be at most ${max} characters`, {
            [label]: [`${label} must be at most ${max} characters`],
        });
    return trimmed;
}

function requireChecksum(value: string, label: string): string {
    if (!CHECKSUM_PATTERN.test(value))
        throw new DomainValidationError(`${label} must be a lowercase hex SHA-256 digest`, {
            checksum: [`${label} is not a hex SHA-256 digest`],
        });
    return value;
}

function requireSchemaVersion(value: number): number {
    if (value !== 1)
        throw new DomainValidationError("Only schema version 1 is supported", {
            schemaVersion: ["Unsupported schema version"],
        });
    return value;
}

function isoTimestamp(now: Date, label: string): string {
    const time = now.getTime();
    if (Number.isNaN(time))
        throw new DomainValidationError(`${label} must be a valid date`, { now: [`${label} is invalid`] });
    return now.toISOString();
}
