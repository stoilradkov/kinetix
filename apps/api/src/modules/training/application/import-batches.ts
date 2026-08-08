import type { Clock } from "#src/platform/domain/index";
import {
    ApplicationNotFoundError,
    ImportPayloadConflictError,
    PayloadTooLargeError,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    ImportBatch,
    ImportPayloadTooLargeError,
    assertPayloadSizeWithinLimits,
    reconcileImportBatchIdentity,
    type ImportBatchPayloadSize,
    type ImportBatchSnapshot,
} from "#src/modules/training/domain/index";
import type { BulkExternalIdMapping, BulkExternalIdRegistry } from "#src/modules/training/application/bulk-program";

export const IMPORT_BATCH_REPOSITORY = Symbol("IMPORT_BATCH_REPOSITORY");
export const REGISTER_IMPORT_BATCH = Symbol("REGISTER_IMPORT_BATCH");
export const IMPORT_BATCH_QUERY_SERVICE = Symbol("IMPORT_BATCH_QUERY_SERVICE");

// ---------------------------------------------------------------------------------------------
// Application-facing input/output (mirrors of the wire contract; the app never imports @kinetix/types)
// ---------------------------------------------------------------------------------------------

export interface RegisterImportBatchInput {
    readonly source: {
        readonly namespace: string;
        readonly payloadId: string;
        readonly schemaVersion: 1;
        readonly checksum: string;
        readonly generatedBy?: string | null;
        readonly description?: string | null;
    };
    readonly payloadSize?: ImportBatchPayloadSize;
}

export interface ImportBatchView {
    readonly id: string;
    readonly namespace: string;
    readonly payloadId: string;
    readonly schemaVersion: 1;
    readonly checksum: string;
    readonly generatedBy: string | null;
    readonly description: string | null;
    readonly state: ImportBatchSnapshot["state"];
    readonly resultChecksum: string | null;
    readonly createdAt: string;
    readonly committedAt: string | null;
    /** True when this call resolved an already-persisted batch (a deterministic retry). */
    readonly resolved: boolean;
}

export interface ImportBatchMappingsView {
    readonly batchId: string;
    readonly namespace: string;
    readonly count: number;
    readonly mappings: readonly BulkExternalIdMapping[];
}

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

/**
 * Persistence port over the import-batch identity store. `lockByIdentity` serializes concurrent
 * registrations of the same `(namespace, payloadId)` (SELECT … FOR UPDATE) so two callers racing on the
 * same identity both resolve to one batch; there is no generic base repository and no raw SQL in the
 * use case (ADR 0003). All writes run inside the caller's UnitOfWork.
 */
export interface ImportBatchRepository<Transaction = unknown> {
    lockByIdentity(
        profileId: string,
        namespace: string,
        payloadId: string,
        transaction: Transaction,
    ): Promise<ImportBatchSnapshot | null>;
    /**
     * Insert the batch, or do nothing if its `(namespace, payloadId)` identity already exists (an
     * `INSERT … ON CONFLICT DO NOTHING`). Returns `true` when a new row was written, `false` when the
     * identity was already claimed — so a first-time registration racing a concurrent one converges on
     * a single batch without aborting the transaction.
     */
    insertIfAbsent(record: ImportBatchSnapshot, transaction: Transaction): Promise<boolean>;
    findById(profileId: string, id: string, transaction?: Transaction): Promise<ImportBatchSnapshot | null>;
}

interface ProfileReaderPort {
    requireActiveProfileId(): Promise<string>;
}

// ---------------------------------------------------------------------------------------------
// Register (open-or-resolve) use case
// ---------------------------------------------------------------------------------------------

interface RegisterRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: ImportBatchRepository<Transaction>;
    readonly profileReader: ProfileReaderPort;
    readonly clock?: Clock;
    readonly generateId: () => string;
}

/**
 * Register (open-or-resolve) an import batch by its immutable identity (design §14.5, HI2). A clean
 * historical archive still needs durable ownership before its entities can commit; this is where a
 * caller claims that identity. The operation is deterministic under retry:
 *
 *  - No batch for `(namespace, payloadId)` → open a fresh `pending` batch and return it (`resolved:
 *    false`).
 *  - An existing batch with the same canonical `checksum` → return it unchanged (`resolved: true`); a
 *    byte-identical retry is a no-op.
 *  - An existing batch with a different `checksum` → {@link ImportPayloadConflictError}: the payload
 *    changed under a claimed identity.
 *
 * The whole open-or-resolve runs in one transaction with a row lock on the identity, so two concurrent
 * registrations of the same payload converge on a single batch rather than racing to insert duplicates.
 * The identity, description, and checksum are opaque, already-normalized values — this use case
 * interprets none of them.
 */
export class RegisterImportBatch<Transaction = unknown> {
    private readonly clock: Clock;

    constructor(private readonly runtime: RegisterRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
    }

    execute(input: RegisterImportBatchInput, transaction?: Transaction): Promise<ImportBatchView> {
        if (transaction === undefined) return this.runtime.unitOfWork.execute(active => this.register(input, active));
        return this.register(input, transaction);
    }

    private async register(input: RegisterImportBatchInput, transaction: Transaction): Promise<ImportBatchView> {
        if (input.payloadSize) this.assertSize(input.payloadSize);
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const { namespace, payloadId, checksum, schemaVersion } = input.source;

        const existing = await this.runtime.repository.lockByIdentity(profileId, namespace, payloadId, transaction);
        if (existing) return this.reconcileOrThrow(existing, { checksum, schemaVersion }, true);

        const batch = ImportBatch.open(
            {
                id: this.runtime.generateId(),
                profileId,
                namespace,
                payloadId,
                schemaVersion,
                checksum,
                generatedBy: input.source.generatedBy ?? null,
                description: input.source.description ?? null,
            },
            this.clock.now(),
        );
        const inserted = await this.runtime.repository.insertIfAbsent(batch.state, transaction);
        if (inserted) return this.toView(batch.state, false);

        // Lost a concurrent first-registration race: the identity now exists. Re-read and reconcile so a
        // byte-identical concurrent submit still resolves to the one winning batch.
        const raced = await this.runtime.repository.lockByIdentity(profileId, namespace, payloadId, transaction);
        if (!raced) throw new ImportPayloadConflictError(namespace, payloadId, "", checksum);
        return this.reconcileOrThrow(raced, { checksum, schemaVersion }, true);
    }

    private reconcileOrThrow(
        existing: ImportBatchSnapshot,
        incoming: { checksum: string; schemaVersion: number },
        resolved: boolean,
    ): ImportBatchView {
        const reconciliation = reconcileImportBatchIdentity(existing, incoming);
        if (reconciliation.outcome === "checksum-conflict")
            throw new ImportPayloadConflictError(
                existing.namespace,
                existing.payloadId,
                reconciliation.existingChecksum,
                reconciliation.incomingChecksum,
            );
        return this.toView(existing, resolved);
    }

    /** Translate the domain's bounded-size rejection into a stable `PAYLOAD_TOO_LARGE` at the boundary. */
    private assertSize(size: ImportBatchPayloadSize): void {
        try {
            assertPayloadSizeWithinLimits(size);
        } catch (error) {
            if (error instanceof ImportPayloadTooLargeError)
                throw new PayloadTooLargeError(error.message, error.fieldErrors);
            throw error;
        }
    }

    private toView(snapshot: ImportBatchSnapshot, resolved: boolean): ImportBatchView {
        return {
            id: snapshot.id,
            namespace: snapshot.namespace,
            payloadId: snapshot.payloadId,
            schemaVersion: 1,
            checksum: snapshot.checksum,
            generatedBy: snapshot.generatedBy,
            description: snapshot.description,
            state: snapshot.state,
            resultChecksum: snapshot.resultChecksum,
            createdAt: snapshot.createdAt,
            committedAt: snapshot.committedAt,
            resolved,
        };
    }
}

// ---------------------------------------------------------------------------------------------
// Read use case
// ---------------------------------------------------------------------------------------------

interface QueryRuntime {
    readonly repository: ImportBatchRepository;
    readonly externalIds: Pick<BulkExternalIdRegistry, "listByBatch">;
    readonly profileReader: ProfileReaderPort;
}

/** Not-found for a read against a missing/foreign import batch. */
export class ImportBatchNotFoundError extends ApplicationNotFoundError {
    constructor(readonly batchId: string) {
        super(`Import batch ${batchId} was not found`, { batchId });
        this.name = "ImportBatchNotFoundError";
    }
}

/**
 * Read side of the import-batch surface (design §14.5): resolve a batch's identity/lifecycle and list
 * the deterministic external-ID → Kinetix-ID mappings it owns, so any committed entity can be traced
 * back to its batch and caller external ID. Both reads are scoped to the active profile.
 */
export class ImportBatchQueryService {
    constructor(private readonly runtime: QueryRuntime) {}

    async findById(id: string): Promise<ImportBatchView> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const snapshot = await this.runtime.repository.findById(profileId, id);
        if (!snapshot) throw new ImportBatchNotFoundError(id);
        return {
            id: snapshot.id,
            namespace: snapshot.namespace,
            payloadId: snapshot.payloadId,
            schemaVersion: 1,
            checksum: snapshot.checksum,
            generatedBy: snapshot.generatedBy,
            description: snapshot.description,
            state: snapshot.state,
            resultChecksum: snapshot.resultChecksum,
            createdAt: snapshot.createdAt,
            committedAt: snapshot.committedAt,
            resolved: true,
        };
    }

    async listMappings(id: string): Promise<ImportBatchMappingsView> {
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const snapshot = await this.runtime.repository.findById(profileId, id);
        if (!snapshot) throw new ImportBatchNotFoundError(id);
        const mappings = await this.runtime.externalIds.listByBatch(id);
        return { batchId: id, namespace: snapshot.namespace, count: mappings.length, mappings };
    }
}
