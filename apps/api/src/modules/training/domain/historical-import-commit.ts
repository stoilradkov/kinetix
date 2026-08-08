import type { ImportEntityType } from "#src/modules/training/domain/import-batch";
import type { StoragePlanEntry } from "#src/modules/training/domain/storage-reconciliation";

/**
 * Pure batch-planning for the historical-import commit (issue #59, HI5; design §14.7). The commit
 * persists an already-approved archive as a sequence of **aggregate-safe batches** — one per program
 * and one per completed session — each applied in its own transaction so a crash never leaves a partial
 * aggregate. This module owns the framework-, clock-, and database-free reasoning about those batches:
 * how the reconciliation plan (#57) groups into batches, which batches a resumed run must still apply
 * versus skip, and how per-entity counts tally. It performs no I/O and mints nothing; the application
 * service drives the actual persistence and checkpoints.
 */

/** The two aggregate kinds a historical import commits: a program tree, or a completed session tree. */
export type CommitBatchKind = "program" | "completed-session";

/**
 * One aggregate-safe unit of commit work. `key` is stable across retries (derived from the batch kind
 * and its payload index, not a minted id), so a resumed run addresses the same batch deterministically.
 * `entityCount` is how many import-addressable entities the batch registers, used only for reporting
 * created/skipped totals — it never drives a decision.
 */
export interface CommitBatch {
    readonly key: string;
    readonly kind: CommitBatchKind;
    readonly index: number;
    readonly path: readonly (string | number)[];
    readonly rootExternalId: string | null;
    readonly entityCount: number;
}

/** Entity-level totals across every import-addressable entity (design §14.7). */
export interface CommitCounts {
    readonly created: number;
    readonly updated: number;
    readonly skipped: number;
    readonly conflicted: number;
}

const PROGRAM_ROOT = "programs";
const SESSION_ROOT = "completedSessions";

/** The stable checkpoint key for a batch — `<kind>#<index>` — deterministic across retries. */
export function commitBatchKey(kind: CommitBatchKind, index: number): string {
    return `${kind}#${index}`;
}

/**
 * Group an ordered storage-reconciliation plan into aggregate-safe commit batches, in payload order
 * (every program first, then every completed session). Each plan entry's `path` begins with its root
 * collection and index (`["programs", i, …]` or `["completedSessions", j, …]`); entries are grouped by
 * that `(root, index)` prefix, so a batch's `entityCount` is exactly the number of import-addressable
 * entities the aggregate owns. The batch's `rootExternalId` is the external id of the depth-2 root entry
 * (a program's own external id may be absent). Entries with an unrecognized root are ignored — the plan
 * is produced by the historical collector, so this only guards against malformed input.
 */
export function planCommitBatches(entries: readonly StoragePlanEntry[]): CommitBatch[] {
    const order: string[] = [];
    const groups = new Map<
        string,
        {
            kind: CommitBatchKind;
            index: number;
            path: readonly (string | number)[];
            rootExternalId: string | null;
            count: number;
        }
    >();

    for (const entry of entries) {
        const root = entry.path[0];
        const index = entry.path[1];
        if ((root !== PROGRAM_ROOT && root !== SESSION_ROOT) || typeof index !== "number") continue;
        const kind: CommitBatchKind = root === PROGRAM_ROOT ? "program" : "completed-session";
        const key = commitBatchKey(kind, index);
        let group = groups.get(key);
        if (!group) {
            group = { kind, index, path: [root, index], rootExternalId: null, count: 0 };
            groups.set(key, group);
            order.push(key);
        }
        group.count += 1;
        // The depth-2 entry is the aggregate root; capture its external id for tracing/registration.
        if (entry.path.length === 2) group.rootExternalId = entry.externalId;
    }

    return order.map(key => {
        const group = groups.get(key)!;
        return {
            key,
            kind: group.kind,
            index: group.index,
            path: group.path,
            rootExternalId: group.rootExternalId,
            entityCount: group.count,
        };
    });
}

/**
 * Split batches into those a resumed run must still apply and those already committed by a prior attempt
 * (design §14.7). `committedKeys` is the durable checkpoint recorded after each batch's transaction
 * commits; a batch whose key is present has already been persisted and registered, so re-applying it
 * would duplicate the aggregate. Order is preserved so the caller commits in deterministic payload order.
 */
export function partitionCommitBatches(
    batches: readonly CommitBatch[],
    committedKeys: ReadonlySet<string>,
): { readonly pending: CommitBatch[]; readonly completed: CommitBatch[] } {
    const pending: CommitBatch[] = [];
    const completed: CommitBatch[] = [];
    for (const batch of batches) (committedKeys.has(batch.key) ? completed : pending).push(batch);
    return { pending, completed };
}

/**
 * Tally entity-level counts for a commit run (design §14.7). `committed` are batches this run applied
 * fresh, `skipped` are batches a resume found already committed, and `conflicted` (present only on a
 * failed run whose failing batch was an external-id collision) are entities that could not be created.
 * `updated` is always `0` at the create-mode MVP. The tally is pure over the batches' `entityCount`s.
 */
export function tallyCommitCounts(input: {
    readonly committed: readonly CommitBatch[];
    readonly skipped: readonly CommitBatch[];
    readonly conflicted?: readonly CommitBatch[];
}): CommitCounts {
    const sum = (batches: readonly CommitBatch[]): number =>
        batches.reduce((total, batch) => total + batch.entityCount, 0);
    return {
        created: sum(input.committed),
        updated: 0,
        skipped: sum(input.skipped),
        conflicted: sum(input.conflicted ?? []),
    };
}

/** The external-id entries a program batch registers, derived from the normalized program tree. */
export interface CommitRegistration {
    readonly entityType: ImportEntityType;
    readonly externalId: string;
    readonly entityId: string;
}
