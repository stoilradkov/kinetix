import type { CommandContext } from "#src/platform/application/command-context";
import type { Clock, DomainEvent } from "#src/platform/domain/index";

export const OUTBOX_WRITER = Symbol("OUTBOX_WRITER");
export const OUTBOX_LEASE_STORE = Symbol("OUTBOX_LEASE_STORE");
export const JOB_QUEUE = Symbol("JOB_QUEUE");
export const JOB_STATUS_READER = Symbol("JOB_STATUS_READER");
export const JOB_LEASE_STORE = Symbol("JOB_LEASE_STORE");
export const HANDLER_RECEIPTS = Symbol("HANDLER_RECEIPTS");
export const SCHEDULER_LOCK = Symbol("SCHEDULER_LOCK");

export type JobState = "queued" | "running" | "succeeded" | "failed";
export type OutboxEventState = "pending" | "processing" | "published" | "failed";
export type WorkItemKind = "job" | "event";

export interface WorkLease {
    readonly owner: string;
    readonly expiresAt: Date;
    readonly heartbeatAt: Date;
}

export interface WorkError {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly failedAt: Date;
}

export interface JobProgress {
    readonly completed: number;
    readonly total?: number;
    readonly message?: string;
}

export interface EnqueueJob {
    readonly type: string;
    readonly version: number;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly priority?: number;
    readonly maxAttempts?: number;
    readonly runAt?: Date;
    readonly idempotencyKey?: string | null;
    readonly correlationId: string;
    readonly causationId?: string | null;
}

export interface QueuedJob {
    readonly id: string;
    readonly type: string;
    readonly version: number;
    readonly state: JobState;
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly nextAttemptAt: Date;
    readonly idempotencyKey: string | null;
    readonly correlationId: string;
    readonly causationId: string | null;
    readonly createdAt: Date;
}

export interface JobStatus extends QueuedJob {
    readonly progress: JobProgress | null;
    readonly error: WorkError | null;
    readonly startedAt: Date | null;
    readonly completedAt: Date | null;
    readonly updatedAt: Date;
}

export interface ClaimedJob extends JobStatus {
    readonly payload: Readonly<Record<string, unknown>>;
    readonly payloadFingerprint: string;
    readonly state: "running";
    readonly lease: WorkLease;
}

export interface ClaimedOutboxEvent {
    readonly id: string;
    readonly name: string;
    readonly version: number;
    readonly stableName: string;
    readonly aggregateType: string | null;
    readonly aggregateId: string | null;
    readonly aggregateRevision: number | null;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly payloadFingerprint: string;
    readonly state: "processing";
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly correlationId: string;
    readonly causationId: string | null;
    readonly occurredAt: Date;
    readonly lease: WorkLease;
}

export interface OutboxWriter<Transaction = unknown> {
    publish(events: readonly DomainEvent[], transaction: Transaction, context?: CommandContext): Promise<void>;
}

export interface JobQueue<Transaction = unknown> {
    enqueue(input: EnqueueJob, transaction: Transaction): Promise<QueuedJob>;
}

export interface JobStatusReader {
    find(id: string): Promise<JobStatus | null>;
}

export interface ClaimWorkInput {
    readonly workerId: string;
    readonly now: Date;
    readonly leaseDurationMs: number;
    readonly limit: number;
}

export interface WorkFailureInput {
    readonly id: string;
    readonly workerId: string;
    readonly failedAt: Date;
    readonly error: WorkError;
    readonly retryAt: Date | null;
}

export interface JobLeaseStore<Transaction = unknown> {
    claimDue(input: ClaimWorkInput): Promise<ClaimedJob[]>;
    heartbeat(id: string, workerId: string, now: Date, leaseDurationMs: number): Promise<boolean>;
    reportProgress(id: string, workerId: string, progress: JobProgress, now: Date): Promise<boolean>;
    complete(id: string, workerId: string, completedAt: Date, transaction?: Transaction): Promise<boolean>;
    fail(input: WorkFailureInput): Promise<boolean>;
}

export interface OutboxLeaseStore<Transaction = unknown> {
    claimDue(input: ClaimWorkInput): Promise<ClaimedOutboxEvent[]>;
    heartbeat(id: string, workerId: string, now: Date, leaseDurationMs: number): Promise<boolean>;
    complete(id: string, workerId: string, completedAt: Date, transaction?: Transaction): Promise<boolean>;
    fail(input: WorkFailureInput): Promise<boolean>;
}

export interface HandlerReceiptStore<Transaction = unknown> {
    has(kind: WorkItemKind, itemId: string, handler: string, transaction: Transaction): Promise<boolean>;
    record(
        kind: WorkItemKind,
        itemId: string,
        handler: string,
        handledAt: Date,
        transaction: Transaction,
    ): Promise<void>;
}

export interface JobHandlerContext<Transaction = unknown> {
    readonly transaction: Transaction;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly causationId: string | null;
    heartbeat(): Promise<boolean>;
    reportProgress(progress: JobProgress): Promise<boolean>;
}

export interface JobHandler<Transaction = unknown> {
    readonly name: string;
    readonly jobType: string;
    readonly jobVersion: number;
    handle(job: ClaimedJob, context: JobHandlerContext<Transaction>): Promise<void>;
}

export interface OutboxHandlerContext<Transaction = unknown> {
    readonly transaction: Transaction;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly causationId: string | null;
    heartbeat(): Promise<boolean>;
}

export interface OutboxHandler<Transaction = unknown> {
    readonly name: string;
    readonly eventName: string;
    readonly eventVersion: number;
    handle(event: ClaimedOutboxEvent, context: OutboxHandlerContext<Transaction>): Promise<void>;
}

export interface AdvisorySchedulerLock<Transaction = unknown> {
    withLock(name: string, work: (transaction: Transaction) => Promise<void>): Promise<boolean>;
}

export class HandlerRegistry<Handler extends { readonly name: string }> {
    private readonly handlers = new Map<string, Handler>();

    register(key: string, handler: Handler): void {
        const normalizedKey = requiredIdentifier(key, "Handler key", 240);
        const name = requiredIdentifier(handler.name, "Handler name", 180);
        const registryKey = `${normalizedKey}:${name}`;
        if (this.handlers.has(registryKey))
            throw new Error(`Handler ${name} is already registered for ${normalizedKey}`);
        this.handlers.set(registryKey, handler);
    }

    for(key: string): Handler[] {
        const prefix = `${key}:`;
        return [...this.handlers.entries()]
            .filter(([registryKey]) => registryKey.startsWith(prefix))
            .map(([, handler]) => handler);
    }
}

export class JobHandlerRegistry<Transaction = unknown> {
    private readonly registry = new HandlerRegistry<JobHandler<Transaction>>();

    register(handler: JobHandler<Transaction>): void {
        this.registry.register(workName(handler.jobType, handler.jobVersion), handler);
    }

    get(type: string, version: number): JobHandler<Transaction> | null {
        const handlers = this.registry.for(workName(type, version));
        if (handlers.length > 1) throw new Error(`Multiple job handlers are registered for ${workName(type, version)}`);
        return handlers[0] ?? null;
    }
}

export class OutboxHandlerRegistry<Transaction = unknown> {
    private readonly registry = new HandlerRegistry<OutboxHandler<Transaction>>();

    register(handler: OutboxHandler<Transaction>): void {
        this.registry.register(workName(handler.eventName, handler.eventVersion), handler);
    }

    get(name: string, version: number): OutboxHandler<Transaction>[] {
        return this.registry.for(workName(name, version));
    }
}

export class EnqueueJobFromEventHandler<Transaction = unknown> implements OutboxHandler<Transaction> {
    constructor(
        readonly name: string,
        readonly eventName: string,
        readonly eventVersion: number,
        private readonly queue: JobQueue<Transaction>,
        private readonly toJob: (event: ClaimedOutboxEvent) => Omit<EnqueueJob, "correlationId" | "causationId">,
    ) {}

    async handle(event: ClaimedOutboxEvent, context: OutboxHandlerContext<Transaction>): Promise<void> {
        const job = this.toJob(event);
        await this.queue.enqueue(
            {
                ...job,
                idempotencyKey: job.idempotencyKey ?? event.id,
                correlationId: event.correlationId,
                causationId: event.id,
            },
            context.transaction,
        );
    }
}

export class NonRetryableWorkError extends Error {
    readonly retryable = false;

    constructor(
        message: string,
        readonly code = "WORK_REJECTED",
    ) {
        super(message);
        this.name = "NonRetryableWorkError";
    }
}

export class RetryableWorkError extends Error {
    readonly retryable = true;

    constructor(
        message: string,
        readonly code = "TRANSIENT_FAILURE",
    ) {
        super(message);
        this.name = "RetryableWorkError";
    }
}

export interface RetryPolicyOptions {
    readonly baseDelayMs?: number;
    readonly maximumDelayMs?: number;
}

export class RetryPolicy {
    readonly baseDelayMs: number;
    readonly maximumDelayMs: number;

    constructor(options: RetryPolicyOptions = {}) {
        this.baseDelayMs = positiveInteger(options.baseDelayMs ?? 1_000, "Retry base delay");
        this.maximumDelayMs = positiveInteger(options.maximumDelayMs ?? 15 * 60_000, "Retry maximum delay");
        if (this.maximumDelayMs < this.baseDelayMs)
            throw new Error("Retry maximum delay cannot be less than the base delay");
    }

    delayMs(attempt: number): number {
        const exponent = Math.max(0, positiveInteger(attempt, "Attempt") - 1);
        return Math.min(this.maximumDelayMs, this.baseDelayMs * 2 ** Math.min(exponent, 52));
    }

    retryAt(attempt: number, attemptedAt: Date): Date {
        return new Date(attemptedAt.getTime() + this.delayMs(attempt));
    }
}

export function leaseExpiresAt(now: Date, leaseDurationMs: number): Date {
    return new Date(now.getTime() + positiveInteger(leaseDurationMs, "Lease duration"));
}

export function isLeaseExpired(lease: Pick<WorkLease, "expiresAt">, now: Date): boolean {
    return lease.expiresAt.getTime() <= now.getTime();
}

export function workName(name: string, version: number): string {
    return `${requiredIdentifier(name, "Work name", 180)}.v${positiveInteger(version, "Work version")}`;
}

export class ScheduledJob {
    constructor(
        private readonly lock: AdvisorySchedulerLock,
        private readonly queue: JobQueue,
        private readonly clock: Clock = { now: () => new Date() },
    ) {}

    run(name: string, create: (now: Date) => EnqueueJob | null): Promise<boolean> {
        const normalizedName = requiredIdentifier(name, "Schedule name", 180);
        return this.lock.withLock(normalizedName, async transaction => {
            const job = create(this.clock.now());
            if (job) await this.queue.enqueue(job, transaction);
        });
    }
}

function requiredIdentifier(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${name} cannot be empty`);
    if (normalized.length > maximumLength) throw new Error(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return value;
}
