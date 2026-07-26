import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
    EnqueueJobFromEventHandler,
    JobHandlerRegistry,
    JobWorker,
    NonRetryableWorkError,
    RetryPolicy,
    classifyWorkFailure,
    isLeaseExpired,
    leaseExpiresAt,
    type ClaimedJob,
    type HandlerReceiptStore,
    type JobLeaseStore,
    type JobQueue,
    type UnitOfWork,
} from "#src/platform/application/index";
import { DomainEvent, DomainValidationError } from "#src/platform/domain/index";

const now = new Date("2026-07-26T12:00:00.000Z");

describe("durable facts and retry policy", () => {
    it("creates immutable, explicitly versioned domain facts", () => {
        const payload = { sessionId: randomUUID(), invalidation: { analytics: true } };
        const event = new DomainEvent({
            id: randomUUID(),
            name: "training.session.completed",
            version: 1,
            occurredAt: now,
            aggregateType: "training-session",
            aggregateId: payload.sessionId,
            aggregateRevision: 4,
            correlationId: "request-1",
            causationId: "command-1",
            payload,
        });

        payload.invalidation.analytics = false;

        expect(event.stableName).toBe("training.session.completed.v1");
        expect(event.payload).toEqual({
            sessionId: event.aggregateId,
            invalidation: { analytics: true },
        });
        expect(Object.isFrozen(event)).toBe(true);
        expect(Object.isFrozen(event.payload)).toBe(true);
        expect(
            () =>
                new DomainEvent({
                    id: event.id,
                    name: "Session Completed",
                    version: event.version,
                    occurredAt: event.occurredAt,
                    correlationId: event.correlationId,
                    payload: {},
                }),
        ).toThrow(DomainValidationError);
    });

    it("calculates bounded exponential backoff and lease expiry deterministically", () => {
        const policy = new RetryPolicy({ baseDelayMs: 1_000, maximumDelayMs: 5_000 });

        expect(policy.delayMs(1)).toBe(1_000);
        expect(policy.delayMs(3)).toBe(4_000);
        expect(policy.delayMs(10)).toBe(5_000);
        expect(policy.retryAt(2, now).toISOString()).toBe("2026-07-26T12:00:02.000Z");
        const expiresAt = leaseExpiresAt(now, 30_000);
        expect(isLeaseExpired({ expiresAt }, new Date("2026-07-26T12:00:29.999Z"))).toBe(false);
        expect(isLeaseExpired({ expiresAt }, new Date("2026-07-26T12:00:30.000Z"))).toBe(true);
    });

    it("makes domain-terminal and transient failure classification explicit", () => {
        expect(classifyWorkFailure(new NonRetryableWorkError("Invalid input", "INVALID_INPUT"))).toEqual({
            retryable: false,
            code: "INVALID_INPUT",
            publicMessage: "Invalid input",
        });
        expect(classifyWorkFailure(new DomainValidationError("Impossible transition"))).toMatchObject({
            retryable: false,
            code: "VALIDATION_FAILED",
        });
        expect(classifyWorkFailure(new Error("password=secret"))).toEqual({
            retryable: true,
            code: "TRANSIENT_FAILURE",
            publicMessage: "Temporary processing failure",
        });
    });
});

describe("job worker", () => {
    it("does not repeat a handler with a committed receipt", async () => {
        const fixture = workerFixture({ alreadyHandled: true });
        fixture.handlers.register({
            name: "recalculate-analytics",
            jobType: "training.analytics.recalculate",
            jobVersion: 1,
            handle: fixture.handle,
        });

        await expect(fixture.worker.runOnce()).resolves.toBe(1);

        expect(fixture.handle).not.toHaveBeenCalled();
        expect(fixture.store.complete).toHaveBeenCalledWith(fixture.job.id, "worker-1", now, expect.anything());
        expect(fixture.store.fail).not.toHaveBeenCalled();
    });

    it("retries unexpected failures but leaves terminal failures terminal", async () => {
        const transient = workerFixture();
        transient.handlers.register({
            name: "transient",
            jobType: transient.job.type,
            jobVersion: 1,
            handle: vi.fn(async () => {
                throw new Error("database unavailable");
            }),
        });
        await transient.worker.runOnce();
        expect(transient.store.fail).toHaveBeenCalledWith(
            expect.objectContaining({
                retryAt: new Date("2026-07-26T12:00:01.000Z"),
                error: expect.objectContaining({ retryable: true, message: "Temporary processing failure" }),
            }),
        );

        const terminal = workerFixture();
        terminal.handlers.register({
            name: "terminal",
            jobType: terminal.job.type,
            jobVersion: 1,
            handle: vi.fn(async () => {
                throw new NonRetryableWorkError("Unsupported source data", "UNSUPPORTED_SOURCE");
            }),
        });
        await terminal.worker.runOnce();
        expect(terminal.store.fail).toHaveBeenCalledWith(
            expect.objectContaining({
                retryAt: null,
                error: expect.objectContaining({
                    retryable: false,
                    code: "UNSUPPORTED_SOURCE",
                    message: "Unsupported source data",
                }),
            }),
        );

        const exhausted = workerFixture({ attempts: 3 });
        exhausted.handlers.register({
            name: "exhausted",
            jobType: exhausted.job.type,
            jobVersion: 1,
            handle: vi.fn(async () => {
                throw new Error("still unavailable");
            }),
        });
        await exhausted.worker.runOnce();
        expect(exhausted.store.fail).toHaveBeenCalledWith(
            expect.objectContaining({
                retryAt: null,
                error: expect.objectContaining({ retryable: false }),
            }),
        );
    });

    it("maps an after-commit event to an idempotently enqueued job", async () => {
        const enqueue = vi.fn(async () => ({ id: randomUUID() }));
        const queue = { enqueue } as unknown as JobQueue<{ transaction: true }>;
        const handler = new EnqueueJobFromEventHandler(
            "enqueue-analytics",
            "training.session.completed",
            1,
            queue,
            event => ({
                type: "training.analytics.recalculate",
                version: 1,
                payload: { sessionId: event.aggregateId },
            }),
        );
        const event = claimedJobEvent();

        await handler.handle(event, {
            transaction: { transaction: true },
            idempotencyKey: event.id,
            correlationId: event.correlationId,
            causationId: event.causationId,
            heartbeat: async () => true,
        });

        expect(enqueue).toHaveBeenCalledWith(
            expect.objectContaining({
                idempotencyKey: event.id,
                correlationId: "request-1",
                causationId: event.id,
            }),
            { transaction: true },
        );
    });
});

function workerFixture(options: { alreadyHandled?: boolean; attempts?: number } = {}) {
    const job = { ...claimedJob(), ...(options.attempts === undefined ? {} : { attempts: options.attempts }) };
    const handle = vi.fn(async () => undefined);
    const store = {
        claimDue: vi.fn(async () => [job]),
        heartbeat: vi.fn(async () => true),
        reportProgress: vi.fn(async () => true),
        complete: vi.fn(async () => true),
        fail: vi.fn(async () => true),
    } satisfies JobLeaseStore<{ transaction: true }>;
    const receipts = {
        has: vi.fn(async () => options.alreadyHandled ?? false),
        record: vi.fn(async () => undefined),
    } satisfies HandlerReceiptStore<{ transaction: true }>;
    const unitOfWork = {
        execute: work => work({ transaction: true }),
    } satisfies UnitOfWork<{ transaction: true }>;
    const handlers = new JobHandlerRegistry<{ transaction: true }>();
    const worker = new JobWorker(
        store,
        handlers,
        receipts,
        unitOfWork,
        new RetryPolicy(),
        { workerId: "worker-1", leaseDurationMs: 30_000 },
        { now: () => now },
    );
    return { job, handle, store, receipts, handlers, worker };
}

function claimedJob(): ClaimedJob {
    return {
        id: randomUUID(),
        type: "training.analytics.recalculate",
        version: 1,
        payload: { scope: "all" },
        payloadFingerprint: "a".repeat(64),
        state: "running",
        attempts: 1,
        maxAttempts: 3,
        nextAttemptAt: now,
        idempotencyKey: null,
        correlationId: "request-1",
        causationId: "event-1",
        progress: null,
        error: null,
        lease: {
            owner: "worker-1",
            expiresAt: new Date("2026-07-26T12:00:30.000Z"),
            heartbeatAt: now,
        },
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
    };
}

function claimedJobEvent() {
    return {
        id: randomUUID(),
        name: "training.session.completed",
        version: 1,
        stableName: "training.session.completed.v1",
        aggregateType: "training-session",
        aggregateId: randomUUID(),
        aggregateRevision: 2,
        payload: {},
        payloadFingerprint: "b".repeat(64),
        state: "processing" as const,
        attempts: 1,
        maxAttempts: 10,
        correlationId: "request-1",
        causationId: null,
        occurredAt: now,
        lease: {
            owner: "worker-1",
            expiresAt: new Date("2026-07-26T12:00:30.000Z"),
            heartbeatAt: now,
        },
    };
}
