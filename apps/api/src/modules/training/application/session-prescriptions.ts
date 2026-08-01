import { DomainEvent as PlatformDomainEvent, type Clock, type DomainEvent } from "#src/platform/domain/index";

import {
    ApplicationNotFoundError,
    type CommandContext,
    type OutboxWriter,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    SessionPrescription,
    collectLogicalKeys,
    type CloneForOwnerOptions,
    type IdMinter,
    type PrescriptionKind,
    type PublishPrescriptionDraft,
    type SessionPrescriptionState,
} from "#src/modules/training/domain/index";

export const SESSION_PRESCRIPTION_REPOSITORY = Symbol("SESSION_PRESCRIPTION_REPOSITORY");
export const PRESCRIPTION_PUBLISHER = Symbol("PRESCRIPTION_PUBLISHER");
export const PRESCRIPTION_CLONER = Symbol("PRESCRIPTION_CLONER");
export const SESSION_PRESCRIPTION_ENTITY_TYPE = "training.session-prescription";

export type SessionPrescriptionResource = SessionPrescriptionState;

/**
 * Capability-shaped port over complete immutable prescription trees. There is no generic
 * base repository; published trees are only ever inserted whole and loaded whole, and
 * infrastructure rows never escape this boundary (ADR 0003).
 */
export interface SessionPrescriptionRepository<Transaction = unknown> {
    insertTree(state: SessionPrescriptionState, transaction: Transaction): Promise<void>;
    loadTree(id: string, transaction?: Transaction): Promise<SessionPrescriptionState | null>;
    loadTrees(ids: readonly string[], transaction?: Transaction): Promise<readonly SessionPrescriptionState[]>;
}

export class PrescriptionNotFoundError extends ApplicationNotFoundError {
    constructor(readonly prescriptionId: string) {
        super(`Prescription ${prescriptionId} was not found`, { prescriptionId });
        this.name = "PrescriptionNotFoundError";
    }
}

export interface PublishPrescriptionCommand {
    readonly draft: PublishPrescriptionDraft;
}

export interface ClonePrescriptionCommand {
    readonly sourcePrescriptionId: string;
    readonly targetKind: PrescriptionKind;
    /** Defaults: resolved_execution keeps logical keys; every other clone mints fresh ones. */
    readonly preserveLogicalKeys?: boolean;
}

interface PrescriptionRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: SessionPrescriptionRepository<Transaction>;
    readonly outbox: OutboxWriter<Transaction>;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

abstract class PrescriptionService<Transaction> {
    protected readonly clock: Clock;
    private readonly generateId: () => string;

    protected constructor(protected readonly runtime: PrescriptionRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Prescription ID generation is not configured");
            });
    }

    protected minter(): IdMinter {
        return { rowId: () => this.generateId(), logicalKey: () => this.generateId() };
    }

    protected newEventId(): string {
        return this.generateId();
    }

    protected inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }
}

/** Validates a draft and publishes it as a new immutable prescription tree. */
export class PrescriptionPublisher<Transaction = unknown> extends PrescriptionService<Transaction> {
    constructor(runtime: PrescriptionRuntime<Transaction>) {
        super(runtime);
    }

    async publish(
        command: PublishPrescriptionCommand,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<SessionPrescriptionResource> {
        const now = this.clock.now();
        const published = SessionPrescription.publishDraft(command.draft, this.minter(), now);
        const state = published.state;
        return this.inTransaction(transaction, async activeTransaction => {
            await this.runtime.repository.insertTree(state, activeTransaction);
            await this.runtime.outbox.publish([this.publishedEvent(state, now, metadata)], activeTransaction, metadata);
            return state;
        });
    }

    /**
     * Persist an already-published prescription tree exactly as previewed — used by bulk commit,
     * which inserts the tree approved in the dry-run rather than re-deriving it (design 14.3). The
     * state is rehydrated to re-run every tree invariant before insert (no re-minting of ids, so the
     * committed tree matches the preview byte-for-byte), and the same published event is emitted so
     * downstream consumers see a single publish. Runs inside the caller's transaction.
     */
    async publishPreparedState(
        state: SessionPrescriptionState,
        metadata: CommandContext,
        transaction: Transaction,
    ): Promise<SessionPrescriptionResource> {
        const now = this.clock.now();
        const validated = SessionPrescription.rehydrate(state).state;
        await this.runtime.repository.insertTree(validated, transaction);
        await this.runtime.outbox.publish([this.publishedEvent(validated, now, metadata)], transaction, metadata);
        return validated;
    }

    private publishedEvent(state: SessionPrescriptionState, occurredAt: Date, metadata: CommandContext): DomainEvent {
        return new PlatformDomainEvent({
            id: this.newEventId(),
            name: "training.session-prescription.published",
            version: 1,
            occurredAt,
            aggregateType: SESSION_PRESCRIPTION_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision: 1,
            correlationId: metadata.correlationId,
            payload: {
                prescriptionId: state.id,
                kind: state.kind,
                sourcePrescriptionId: state.sourcePrescriptionId,
                sourceKind: state.sourceKind,
                activityCount: state.activities.length,
                elementCount: collectLogicalKeys(state).size,
            },
        });
    }
}

/** Clones an existing published tree into a new immutable tree for a different owner/kind. */
export class PrescriptionCloner<Transaction = unknown> extends PrescriptionService<Transaction> {
    constructor(runtime: PrescriptionRuntime<Transaction>) {
        super(runtime);
    }

    async clone(
        command: ClonePrescriptionCommand,
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<SessionPrescriptionResource> {
        const now = this.clock.now();
        const options: CloneForOwnerOptions = {
            targetKind: command.targetKind,
            preserveLogicalKeys: command.preserveLogicalKeys ?? command.targetKind === "resolved_execution",
        };
        return this.inTransaction(transaction, async activeTransaction => {
            const source = await this.runtime.repository.loadTree(command.sourcePrescriptionId, activeTransaction);
            if (!source) throw new PrescriptionNotFoundError(command.sourcePrescriptionId);
            const cloned = SessionPrescription.rehydrate(source).cloneForOwner(options, this.minter(), now).state;
            await this.runtime.repository.insertTree(cloned, activeTransaction);
            await this.runtime.outbox.publish([this.clonedEvent(cloned, now, metadata)], activeTransaction, metadata);
            return cloned;
        });
    }

    private clonedEvent(state: SessionPrescriptionState, occurredAt: Date, metadata: CommandContext): DomainEvent {
        return new PlatformDomainEvent({
            id: this.newEventId(),
            name: "training.session-prescription.cloned",
            version: 1,
            occurredAt,
            aggregateType: SESSION_PRESCRIPTION_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision: 1,
            correlationId: metadata.correlationId,
            payload: {
                prescriptionId: state.id,
                kind: state.kind,
                sourcePrescriptionId: state.sourcePrescriptionId,
                sourceKind: state.sourceKind,
            },
        });
    }
}
