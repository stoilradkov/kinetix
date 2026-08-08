import type { ImportEntityType } from "#src/modules/training/domain/import-batch";

/**
 * Pure deterministic storage reconciliation for an already-normalized import (issue #57, HI3; design
 * §12.3, §14.2–14.3). Given a canonical payload's external-ID identity, the existing aggregate version,
 * and a normalized content fingerprint, this module decides — with no I/O, clock, or heuristics — how a
 * single import-addressable entity will affect current Kinetix state: {@link StorageOperation.create},
 * {@link StorageOperation.update}, `skip-identical`, or `conflict`.
 *
 * The policy is intentionally narrow. It keys entities *only* by their `(entityType, externalId)`
 * identity, never by similar names, dates, or set contents, so two distinct external IDs are always two
 * distinct entities and Kinetix never infers a merge (#57 out of scope: heuristic deduplication). It
 * preserves the existing optimistic-concurrency contract: a content change is an `update` only when the
 * caller asserts the *current* aggregate version, and a target that moved underneath the caller (a
 * user-modified entity, or a stale expected version) is a `conflict` rather than a silent overwrite.
 *
 * The same decision drives both the dry-run preview and the commit, so a previewed plan and the plan
 * actually executed are byte-for-byte the same (design 14.2/14.3).
 */

// ---------------------------------------------------------------------------------------------
// Content fingerprint (pure, dependency-free)
// ---------------------------------------------------------------------------------------------

/**
 * A stable, order-independent canonical serialization of a normalized entity's identity-relevant
 * content. Object keys are sorted so field order never changes the fingerprint; array order is
 * preserved (a reordered set list is genuinely different content). `undefined` object properties are
 * dropped (an omitted field), while explicit `null` is retained (a cleared field), preserving the
 * omitted / null / zero distinction the import contract guarantees.
 *
 * This is the pure basis of a fingerprint: two entities with equal canonical content produce equal
 * strings, and any content difference produces a different string. Callers that need a compact,
 * fixed-width digest hash this value (the application does, via `hashRequest`); the reconciliation
 * decision below compares fingerprint strings and is agnostic to whether they are canonical forms or
 * hashes, as long as producer and stored form agree.
 */
export function canonicalContentFingerprint(content: unknown): string {
    return canonicalize(content);
}

function canonicalize(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "null";
    const type = typeof value;
    if (type === "string" || type === "boolean") return JSON.stringify(value);
    if (type === "number") {
        if (!Number.isFinite(value)) throw new Error("Cannot fingerprint a non-finite number");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    if (type === "object") {
        const object = value as Record<string, unknown>;
        const entries: string[] = [];
        for (const key of Object.keys(object).sort()) {
            const item = object[key];
            if (item === undefined) continue;
            entries.push(`${JSON.stringify(key)}:${canonicalize(item)}`);
        }
        return `{${entries.join(",")}}`;
    }
    throw new Error(`Cannot fingerprint a value of type ${type}`);
}

// ---------------------------------------------------------------------------------------------
// Decision outcomes
// ---------------------------------------------------------------------------------------------

export const storageOperations = ["create", "update", "skip-identical", "conflict"] as const;
export type StorageOperation = (typeof storageOperations)[number];

/**
 * Why a reconciliation resolved to a `conflict`. Each is a stable, machine-readable code surfaced in the
 * storage plan so a caller can act deterministically without re-deriving the reason:
 *  - `EXTERNAL_ID_EXISTS` — `create` mode addressed an external ID already bound to an entity whose
 *    content differs; create never overwrites an existing entity.
 *  - `EXPECTED_VERSION_REQUIRED` — an `upsert` would change existing content but the caller asserted no
 *    expected version, so the change has no valid update intent.
 *  - `VERSION_MISMATCH` — the asserted expected version does not match the current aggregate version;
 *    the target was modified (by a user or a prior import) since the caller last observed it.
 */
export const reconciliationConflictCodes = [
    "EXTERNAL_ID_EXISTS",
    "EXPECTED_VERSION_REQUIRED",
    "VERSION_MISMATCH",
] as const;
export type ReconciliationConflictCode = (typeof reconciliationConflictCodes)[number];

/** The existing Kinetix state an incoming entity's external ID already resolves to, if any. */
export interface ExistingEntityState {
    /** The authoritative Kinetix ID the external ID is bound to. */
    readonly entityId: string;
    /**
     * The current live aggregate version, for optimistic-concurrency gating. `null` when the entity is
     * not independently version-tracked (a child entity versioned via its root aggregate), in which case
     * version gating is deferred to the root.
     */
    readonly version: number | null;
    /**
     * The normalized content fingerprint recorded when the entity was last imported. `null` when no
     * fingerprint was captured (e.g. an entity created before fingerprints were stored), which is
     * treated as "content unknown" — never as identical.
     */
    readonly fingerprint: string | null;
}

export interface StorageReconciliationInput {
    readonly mode: "create" | "upsert";
    /** The canonical content fingerprint of the incoming, already-normalized entity. */
    readonly incomingFingerprint: string;
    /** The version the caller asserts the current entity is at, for an `upsert` that changes content. */
    readonly expectedVersion?: number | null;
    /** Existing state the external ID resolves to, or `null` when the external ID is new. */
    readonly existing: ExistingEntityState | null;
}

export type StorageReconciliationDecision =
    | { readonly operation: "create" }
    | { readonly operation: "skip-identical"; readonly entityId: string }
    | { readonly operation: "update"; readonly entityId: string; readonly fromVersion: number | null }
    | {
          readonly operation: "conflict";
          readonly conflictCode: ReconciliationConflictCode;
          readonly entityId: string;
          readonly currentVersion: number | null;
      };

/**
 * Classify how one already-normalized entity will affect current Kinetix state (the decision table at
 * the heart of #57). The order of checks is deliberate:
 *
 *  1. **New external ID → `create`.** Nothing is bound; the entity is created. Distinct external IDs are
 *     distinct entities, so this is reached even when another entity has identical content.
 *  2. **Bound + identical content → `skip-identical`.** A byte-identical canonical fingerprint means the
 *     last import already wrote exactly this content; re-writing it is a no-op. This precedes the mode
 *     check so a full replay of the same payload is idempotent in either mode (deterministic retries).
 *  3. **Bound + content differs, `create` mode → `conflict EXTERNAL_ID_EXISTS`.** Create refuses to
 *     touch an existing entity.
 *  4. **Bound + content differs, `upsert`, no expected version → `conflict EXPECTED_VERSION_REQUIRED`.**
 *  5. **Bound + content differs, `upsert`, expected version ≠ current → `conflict VERSION_MISMATCH`.**
 *  6. **Bound + content differs, `upsert`, expected version = current → `update`.**
 *
 * Pure and total: every input maps to exactly one outcome with no I/O.
 */
export function reconcileStorageOutcome(input: StorageReconciliationInput): StorageReconciliationDecision {
    const { existing } = input;
    if (existing === null) return { operation: "create" };

    if (existing.fingerprint !== null && existing.fingerprint === input.incomingFingerprint)
        return { operation: "skip-identical", entityId: existing.entityId };

    if (input.mode === "create")
        return {
            operation: "conflict",
            conflictCode: "EXTERNAL_ID_EXISTS",
            entityId: existing.entityId,
            currentVersion: existing.version,
        };

    const expectedVersion = input.expectedVersion ?? null;
    if (expectedVersion === null)
        return {
            operation: "conflict",
            conflictCode: "EXPECTED_VERSION_REQUIRED",
            entityId: existing.entityId,
            currentVersion: existing.version,
        };

    if (existing.version !== null && expectedVersion !== existing.version)
        return {
            operation: "conflict",
            conflictCode: "VERSION_MISMATCH",
            entityId: existing.entityId,
            currentVersion: existing.version,
        };

    return { operation: "update", entityId: existing.entityId, fromVersion: existing.version };
}

// ---------------------------------------------------------------------------------------------
// Plan entry (shared vocabulary for the application storage plan)
// ---------------------------------------------------------------------------------------------

/**
 * One classified entity in a storage plan: its payload location (`path`), its `(entityType, externalId)`
 * identity, the resolved operation, and — when an existing entity was found — the current Kinetix ID and
 * version plus any conflict code. This is the pure shape the application service assembles into an
 * ordered plan and the presentation layer renders as a machine-readable reconciliation outcome.
 */
export interface StoragePlanEntry {
    readonly path: readonly (string | number)[];
    readonly entityType: ImportEntityType;
    readonly externalId: string;
    readonly operation: StorageOperation;
    readonly currentEntityId: string | null;
    readonly currentVersion: number | null;
    readonly conflictCode: ReconciliationConflictCode | null;
}

/** Build a plan entry from a request's identity and a reconciliation decision. Pure. */
export function toStoragePlanEntry(
    request: {
        readonly path: readonly (string | number)[];
        readonly entityType: ImportEntityType;
        readonly externalId: string;
    },
    decision: StorageReconciliationDecision,
): StoragePlanEntry {
    const base = { path: request.path, entityType: request.entityType, externalId: request.externalId };
    switch (decision.operation) {
        case "create":
            return { ...base, operation: "create", currentEntityId: null, currentVersion: null, conflictCode: null };
        case "skip-identical":
            return {
                ...base,
                operation: "skip-identical",
                currentEntityId: decision.entityId,
                currentVersion: null,
                conflictCode: null,
            };
        case "update":
            return {
                ...base,
                operation: "update",
                currentEntityId: decision.entityId,
                currentVersion: decision.fromVersion,
                conflictCode: null,
            };
        case "conflict":
            return {
                ...base,
                operation: "conflict",
                currentEntityId: decision.entityId,
                currentVersion: decision.currentVersion,
                conflictCode: decision.conflictCode,
            };
    }
}
