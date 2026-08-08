import { hashRequest } from "#src/platform/application/index";
import {
    reconcileStorageOutcome,
    toStoragePlanEntry,
    type ExistingEntityState,
    type ImportEntityType,
    type StorageOperation,
    type StoragePlanEntry,
} from "#src/modules/training/domain/index";

/**
 * Deterministic storage reconciliation for an already-normalized import (issue #57, HI3; design §12.3,
 * §14.2–14.3). This is the single, shared policy both the dry-run preview and the commit run to decide
 * how a normalized payload will affect current Kinetix state. It classifies each import-addressable
 * entity as create / update / skip-identical / conflict — never merging, inferring, or deduplicating —
 * and produces a complete ordered {@link StorageReconciliationPlan} that dry-run reports and commit
 * executes unchanged.
 *
 * The service performs only *reads*: two batched lookups (existing external-ID mappings with their
 * recorded content fingerprints, and current aggregate versions) via a capability port. The decision
 * itself is the pure domain {@link reconcileStorageOutcome}; this layer just orchestrates the reads and
 * applies it in payload order. The application never imports `@kinetix/types`; it mirrors the wire shape
 * structurally and the controller maps it.
 */

export const IMPORT_STORAGE_READ_PORT = Symbol("IMPORT_STORAGE_READ_PORT");
export const RECONCILE_IMPORT_STORAGE = Symbol("RECONCILE_IMPORT_STORAGE");

// ---------------------------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------------------------

/**
 * Compute the stable content fingerprint stored and compared for one normalized entity. It is a SHA-256
 * hex digest over the canonical form of the entity's identity-relevant content, so it is compact,
 * fixed-width, and order-independent for object keys while preserving array order and the
 * omitted/null/zero distinction. The value written at commit time and the value recomputed on a later
 * import are produced by this same function, so identical content yields an identical fingerprint and a
 * genuine `skip-identical`.
 */
export function fingerprintImportContent(content: unknown): string {
    return hashRequest(content);
}

// ---------------------------------------------------------------------------------------------
// Read port (batched, side-effect-free)
// ---------------------------------------------------------------------------------------------

/** One `(entityType, externalId)` identity to look up in the namespaced registry. */
export interface ImportEntityRef {
    readonly entityType: ImportEntityType;
    readonly externalId: string;
}

/** A persisted external-ID → Kinetix-ID mapping plus the content fingerprint recorded at import. */
export interface ExternalIdMappingRecord {
    readonly entityType: ImportEntityType;
    readonly externalId: string;
    readonly entityId: string;
    readonly contentFingerprint: string | null;
}

/** One `(entityType, entityId)` to read a current aggregate version for. */
export interface AggregateVersionRef {
    readonly entityType: ImportEntityType;
    readonly entityId: string;
}

export interface AggregateVersionRecord {
    readonly entityType: ImportEntityType;
    readonly entityId: string;
    readonly version: number;
}

/**
 * Batched, read-only persistence port backing reconciliation (design §14.2). Both methods take the full
 * set of references at once so a large archive resolves in a bounded number of round-trips rather than
 * one-per-entity, and neither performs any source-specific lookup, fuzzy search, or heuristic — only
 * exact `(namespace, entityType, externalId)` and `(entityType, entityId)` reads. All reads join the
 * caller's transaction when supplied so a dry-run and its commit observe a consistent snapshot.
 */
export interface ImportStorageReadPort<Transaction = unknown> {
    /** Resolve existing bindings (with recorded fingerprints) for the given external-ID identities. */
    readExternalIdMappings(
        namespace: string,
        refs: readonly ImportEntityRef[],
        transaction?: Transaction,
    ): Promise<readonly ExternalIdMappingRecord[]>;
    /** Read current live aggregate versions for the given entities (only version-tracked roots resolve). */
    readAggregateVersions(
        refs: readonly AggregateVersionRef[],
        transaction?: Transaction,
    ): Promise<readonly AggregateVersionRecord[]>;
}

// ---------------------------------------------------------------------------------------------
// Application-facing request / plan (mirrors of the wire contract)
// ---------------------------------------------------------------------------------------------

/** One already-normalized entity to reconcile, addressed by its payload identity and fingerprint. */
export interface StorageReconciliationRequest {
    readonly path: readonly (string | number)[];
    readonly entityType: ImportEntityType;
    readonly externalId: string;
    readonly incomingFingerprint: string;
    /** The version the caller asserts for an `upsert` that changes content; omitted for `create`. */
    readonly expectedVersion?: number | null;
}

export interface StorageReconciliationContext {
    readonly namespace: string;
    readonly mode: "create" | "upsert";
}

/** The complete ordered storage plan reused unchanged by dry-run and commit. */
export interface StorageReconciliationPlan {
    readonly namespace: string;
    readonly mode: "create" | "upsert";
    readonly entries: readonly StoragePlanEntry[];
    /** Per-operation totals, for a quick summary without walking the plan. */
    readonly counts: Readonly<Record<StorageOperation, number>>;
    /** Just the conflicting entries, in plan order, so a caller can reject fast. */
    readonly conflicts: readonly StoragePlanEntry[];
    readonly hasConflicts: boolean;
}

interface Runtime<Transaction> {
    readonly readPort: ImportStorageReadPort<Transaction>;
}

const key = (entityType: ImportEntityType, value: string): string => JSON.stringify([entityType, value]);

/**
 * Reconcile a batch of already-normalized entities against current Kinetix state and produce the ordered
 * storage plan (design §14.2–14.3). Exactly two batched reads run regardless of payload size: the
 * external-ID mappings for every requested identity, then the current versions for whatever those
 * mappings resolved to. Each request is then classified in payload order by the pure domain policy, so
 * the plan is deterministic and side-effect-free — the same call from a dry-run and from the commit that
 * consumes it yields the identical plan.
 */
export class ReconcileImportStorage<Transaction = unknown> {
    constructor(private readonly runtime: Runtime<Transaction>) {}

    async execute(
        requests: readonly StorageReconciliationRequest[],
        context: StorageReconciliationContext,
        transaction?: Transaction,
    ): Promise<StorageReconciliationPlan> {
        const mappings = await this.resolveMappings(context.namespace, requests, transaction);
        const versions = await this.resolveVersions(mappings, transaction);

        const entries = requests.map(request => {
            const mapping = mappings.get(key(request.entityType, request.externalId)) ?? null;
            const existing: ExistingEntityState | null = mapping
                ? {
                      entityId: mapping.entityId,
                      version: versions.get(key(mapping.entityType, mapping.entityId)) ?? null,
                      fingerprint: mapping.contentFingerprint,
                  }
                : null;
            const decision = reconcileStorageOutcome({
                mode: context.mode,
                incomingFingerprint: request.incomingFingerprint,
                expectedVersion: request.expectedVersion ?? null,
                existing,
            });
            return toStoragePlanEntry(request, decision);
        });

        return this.summarize(context, entries);
    }

    private async resolveMappings(
        namespace: string,
        requests: readonly StorageReconciliationRequest[],
        transaction?: Transaction,
    ): Promise<Map<string, ExternalIdMappingRecord>> {
        const refs = dedupeRefs(
            requests.map(request => ({ entityType: request.entityType, externalId: request.externalId })),
        );
        if (refs.length === 0) return new Map();
        const rows = await this.runtime.readPort.readExternalIdMappings(namespace, refs, transaction);
        return new Map(rows.map(row => [key(row.entityType, row.externalId), row]));
    }

    private async resolveVersions(
        mappings: Map<string, ExternalIdMappingRecord>,
        transaction?: Transaction,
    ): Promise<Map<string, number>> {
        const refs = dedupeVersionRefs(
            [...mappings.values()].map(mapping => ({ entityType: mapping.entityType, entityId: mapping.entityId })),
        );
        if (refs.length === 0) return new Map();
        const rows = await this.runtime.readPort.readAggregateVersions(refs, transaction);
        return new Map(rows.map(row => [key(row.entityType, row.entityId), row.version]));
    }

    private summarize(
        context: StorageReconciliationContext,
        entries: readonly StoragePlanEntry[],
    ): StorageReconciliationPlan {
        const counts: Record<StorageOperation, number> = {
            create: 0,
            update: 0,
            "skip-identical": 0,
            conflict: 0,
        };
        for (const entry of entries) counts[entry.operation] += 1;
        const conflicts = entries.filter(entry => entry.operation === "conflict");
        return {
            namespace: context.namespace,
            mode: context.mode,
            entries,
            counts,
            conflicts,
            hasConflicts: conflicts.length > 0,
        };
    }
}

function dedupeRefs(refs: readonly ImportEntityRef[]): ImportEntityRef[] {
    const seen = new Set<string>();
    const result: ImportEntityRef[] = [];
    for (const ref of refs) {
        const id = key(ref.entityType, ref.externalId);
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(ref);
    }
    return result;
}

function dedupeVersionRefs(refs: readonly AggregateVersionRef[]): AggregateVersionRef[] {
    const seen = new Set<string>();
    const result: AggregateVersionRef[] = [];
    for (const ref of refs) {
        const id = key(ref.entityType, ref.entityId);
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(ref);
    }
    return result;
}
