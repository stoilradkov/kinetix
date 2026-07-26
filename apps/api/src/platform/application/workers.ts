import {
    type ClaimWorkInput,
    type ClaimedJob,
    type ClaimedOutboxEvent,
    type HandlerReceiptStore,
    type JobHandlerRegistry,
    type JobLeaseStore,
    NonRetryableWorkError,
    type OutboxHandler,
    type OutboxHandlerRegistry,
    type OutboxLeaseStore,
    type RetryPolicy,
    RetryableWorkError,
    type WorkError,
} from "#src/platform/application/durable-work";
import { ApplicationError } from "#src/platform/application/errors";
import type { UnitOfWork } from "#src/platform/application/unit-of-work";
import { type Clock, DomainError } from "#src/platform/domain/index";

export interface WorkerOptions {
    readonly workerId: string;
    readonly leaseDurationMs?: number;
    readonly batchSize?: number;
}

export interface FailureClassification {
    readonly retryable: boolean;
    readonly code: string;
    readonly publicMessage: string;
}

export function classifyWorkFailure(error: unknown): FailureClassification {
    if (error instanceof NonRetryableWorkError)
        return { retryable: false, code: safeCode(error.code), publicMessage: safeMessage(error.message) };
    if (error instanceof DomainError)
        return { retryable: false, code: safeCode(error.code), publicMessage: safeMessage(error.message) };
    if (error instanceof ApplicationError)
        return { retryable: false, code: safeCode(error.code), publicMessage: safeMessage(error.message) };
    if (error instanceof RetryableWorkError)
        return {
            retryable: true,
            code: safeCode(error.code),
            publicMessage: "Temporary processing failure",
        };
    return { retryable: true, code: "TRANSIENT_FAILURE", publicMessage: "Temporary processing failure" };
}

export class JobWorker<Transaction = unknown> {
    private readonly workerId: string;
    private readonly leaseDurationMs: number;
    private readonly batchSize: number;

    constructor(
        private readonly store: JobLeaseStore<Transaction>,
        private readonly handlers: JobHandlerRegistry<Transaction>,
        private readonly receipts: HandlerReceiptStore<Transaction>,
        private readonly unitOfWork: UnitOfWork<Transaction>,
        private readonly retryPolicy: RetryPolicy,
        options: WorkerOptions,
        private readonly clock: Clock = { now: () => new Date() },
    ) {
        this.workerId = required(options.workerId, "Worker ID");
        this.leaseDurationMs = positiveInteger(options.leaseDurationMs ?? 30_000, "Lease duration");
        this.batchSize = positiveInteger(options.batchSize ?? 10, "Worker batch size");
    }

    async runOnce(): Promise<number> {
        const claimed = await this.store.claimDue(this.claimInput());
        await Promise.all(claimed.map(job => this.execute(job)));
        return claimed.length;
    }

    private async execute(job: ClaimedJob): Promise<void> {
        const handler = this.handlers.get(job.type, job.version);
        if (!handler) {
            await this.fail(job, new NonRetryableWorkError(`No handler is registered for ${job.type}.v${job.version}`));
            return;
        }

        const stopHeartbeat = this.startHeartbeat(job.id);
        try {
            await this.unitOfWork.execute(async transaction => {
                if (!(await this.receipts.has("job", job.id, handler.name, transaction))) {
                    await handler.handle(job, {
                        transaction,
                        idempotencyKey: job.idempotencyKey ?? job.id,
                        correlationId: job.correlationId,
                        causationId: job.causationId,
                        heartbeat: () =>
                            this.store.heartbeat(job.id, this.workerId, this.clock.now(), this.leaseDurationMs),
                        reportProgress: progress =>
                            this.store.reportProgress(job.id, this.workerId, progress, this.clock.now()),
                    });
                    await this.receipts.record("job", job.id, handler.name, this.clock.now(), transaction);
                }
                const completed = await this.store.complete(job.id, this.workerId, this.clock.now(), transaction);
                if (!completed) throw new RetryableWorkError("Job lease was lost before completion", "LEASE_LOST");
            });
        } catch (error) {
            await this.fail(job, error);
        } finally {
            stopHeartbeat();
        }
    }

    private async fail(job: ClaimedJob, error: unknown): Promise<void> {
        const failedAt = this.clock.now();
        const classification = classifyWorkFailure(error);
        const retryAt =
            classification.retryable && job.attempts < job.maxAttempts
                ? this.retryPolicy.retryAt(job.attempts, failedAt)
                : null;
        await this.store.fail({
            id: job.id,
            workerId: this.workerId,
            failedAt,
            error: workError(classification, failedAt, retryAt !== null),
            retryAt,
        });
    }

    private claimInput(): ClaimWorkInput {
        return {
            workerId: this.workerId,
            now: this.clock.now(),
            leaseDurationMs: this.leaseDurationMs,
            limit: this.batchSize,
        };
    }

    private startHeartbeat(id: string): () => void {
        const interval = setInterval(
            () => {
                void this.store
                    .heartbeat(id, this.workerId, this.clock.now(), this.leaseDurationMs)
                    .catch(() => undefined);
            },
            Math.max(250, Math.floor(this.leaseDurationMs / 3)),
        );
        interval.unref();
        return () => clearInterval(interval);
    }
}

export class OutboxDispatcher<Transaction = unknown> {
    private readonly workerId: string;
    private readonly leaseDurationMs: number;
    private readonly batchSize: number;

    constructor(
        private readonly store: OutboxLeaseStore<Transaction>,
        private readonly handlers: OutboxHandlerRegistry<Transaction>,
        private readonly receipts: HandlerReceiptStore<Transaction>,
        private readonly unitOfWork: UnitOfWork<Transaction>,
        private readonly retryPolicy: RetryPolicy,
        options: WorkerOptions,
        private readonly clock: Clock = { now: () => new Date() },
    ) {
        this.workerId = required(options.workerId, "Worker ID");
        this.leaseDurationMs = positiveInteger(options.leaseDurationMs ?? 30_000, "Lease duration");
        this.batchSize = positiveInteger(options.batchSize ?? 10, "Worker batch size");
    }

    async runOnce(): Promise<number> {
        const claimed = await this.store.claimDue({
            workerId: this.workerId,
            now: this.clock.now(),
            leaseDurationMs: this.leaseDurationMs,
            limit: this.batchSize,
        });
        await Promise.all(claimed.map(event => this.dispatch(event)));
        return claimed.length;
    }

    private async dispatch(event: ClaimedOutboxEvent): Promise<void> {
        try {
            for (const handler of this.handlers.get(event.name, event.version)) {
                await this.dispatchToHandler(event, handler);
            }
            const completed = await this.store.complete(event.id, this.workerId, this.clock.now());
            if (!completed) throw new RetryableWorkError("Event lease was lost before completion", "LEASE_LOST");
        } catch (error) {
            const failedAt = this.clock.now();
            const classification = classifyWorkFailure(error);
            const retryAt =
                classification.retryable && event.attempts < event.maxAttempts
                    ? this.retryPolicy.retryAt(event.attempts, failedAt)
                    : null;
            await this.store.fail({
                id: event.id,
                workerId: this.workerId,
                failedAt,
                error: workError(classification, failedAt, retryAt !== null),
                retryAt,
            });
        }
    }

    private async dispatchToHandler(event: ClaimedOutboxEvent, handler: OutboxHandler<Transaction>): Promise<void> {
        await this.store.heartbeat(event.id, this.workerId, this.clock.now(), this.leaseDurationMs);
        await this.unitOfWork.execute(async transaction => {
            if (await this.receipts.has("event", event.id, handler.name, transaction)) return;
            await handler.handle(event, {
                transaction,
                idempotencyKey: event.id,
                correlationId: event.correlationId,
                causationId: event.causationId,
                heartbeat: () => this.store.heartbeat(event.id, this.workerId, this.clock.now(), this.leaseDurationMs),
            });
            await this.receipts.record("event", event.id, handler.name, this.clock.now(), transaction);
        });
    }
}

function workError(classification: FailureClassification, failedAt: Date, retryable: boolean): WorkError {
    return {
        code: classification.code,
        message: classification.publicMessage,
        retryable,
        failedAt,
    };
}

function safeCode(value: string): string {
    const normalized = value
        .trim()
        .toUpperCase()
        .replaceAll(/[^A-Z0-9_]/g, "_");
    return normalized.slice(0, 80) || "WORK_FAILED";
}

function safeMessage(value: string): string {
    const normalized = value.trim();
    return (normalized || "Work failed").slice(0, 500);
}

function required(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${name} cannot be empty`);
    if (normalized.length > 180) throw new Error(`${name} cannot exceed 180 characters`);
    return normalized;
}

function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return value;
}
