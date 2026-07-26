import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, jobs as durableJobs, moduleInstances, outboxEvents, workHandlerReceipts } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { DomainEvent } from "#src/platform/domain/index";
import { DrizzleJobStore } from "#src/platform/infrastructure/drizzle-job-store";
import { DrizzleOutboxStore } from "#src/platform/infrastructure/drizzle-outbox-store";
import { PostgresAdvisorySchedulerLock } from "#src/platform/infrastructure/postgres-advisory-scheduler-lock";

const testDatabaseUrl =
    process.env.DURABLE_WORK_TEST_DATABASE_URL ??
    process.env.IDEMPOTENCY_TEST_DATABASE_URL ??
    process.env.REVISION_TEST_DATABASE_URL;

describe.runIf(testDatabaseUrl)("PostgreSQL durable work", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const database = connection as unknown as DatabaseService;
    const jobs = new DrizzleJobStore(database);
    const outbox = new DrizzleOutboxStore(database);
    const schedulerLocks = new PostgresAdvisorySchedulerLock(database);
    const jobIds: string[] = [];
    const eventIds: string[] = [];
    const moduleIds: string[] = [];

    beforeAll(async () => {
        await connection.db.select({ id: durableJobs.id }).from(durableJobs).limit(1);
        await connection.db.select({ id: outboxEvents.id }).from(outboxEvents).limit(1);
    });

    afterEach(async () => {
        const itemIds = [...jobIds, ...eventIds];
        if (itemIds.length > 0)
            await connection.db.delete(workHandlerReceipts).where(inArray(workHandlerReceipts.itemId, itemIds));
        if (jobIds.length > 0) await connection.db.delete(durableJobs).where(inArray(durableJobs.id, jobIds));
        if (eventIds.length > 0) await connection.db.delete(outboxEvents).where(inArray(outboxEvents.id, eventIds));
        if (moduleIds.length > 0)
            await connection.db.delete(moduleInstances).where(inArray(moduleInstances.id, moduleIds));
        jobIds.length = 0;
        eventIds.length = 0;
        moduleIds.length = 0;
    });

    afterAll(async () => {
        await connection.client.end({ timeout: 5 });
    });

    it("commits aggregate state and outbox intent atomically", async () => {
        const moduleId = randomUUID();
        const eventId = randomUUID();
        moduleIds.push(moduleId);
        eventIds.push(eventId);
        const event = domainEvent(eventId, moduleId);

        await expect(
            connection.db.transaction(async transaction => {
                await transaction.insert(moduleInstances).values({
                    id: moduleId,
                    moduleType: "integration-test",
                    name: "Atomic work",
                    slug: `durable-${moduleId}`,
                });
                await outbox.publish([event], transaction);
                throw new Error("rollback");
            }),
        ).rejects.toThrow("rollback");

        await expect(
            connection.db.select().from(moduleInstances).where(eq(moduleInstances.id, moduleId)),
        ).resolves.toHaveLength(0);
        await expect(
            connection.db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)),
        ).resolves.toHaveLength(0);

        await connection.db.transaction(async transaction => {
            await transaction.insert(moduleInstances).values({
                id: moduleId,
                moduleType: "integration-test",
                name: "Atomic work",
                slug: `durable-${moduleId}`,
            });
            await outbox.publish([event], transaction);
        });

        await expect(
            connection.db.select().from(moduleInstances).where(eq(moduleInstances.id, moduleId)),
        ).resolves.toHaveLength(1);
        await expect(
            connection.db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)),
        ).resolves.toMatchObject([{ correlationId: "request-1", causationId: "command-1", status: "pending" }]);
    });

    it("claims each due job once across workers and recovers an expired lease", async () => {
        const firstClaimAt = new Date("2026-07-26T12:00:00.000Z");
        const queued = await connection.db.transaction(transaction =>
            jobs.enqueue(
                {
                    type: "integration.recalculate",
                    version: 1,
                    payload: { scope: "all" },
                    maxAttempts: 3,
                    runAt: firstClaimAt,
                    correlationId: "request-1",
                },
                transaction,
            ),
        );
        jobIds.push(queued.id);

        const concurrent = await Promise.all([
            jobs.claimDue({ workerId: "worker-a", now: firstClaimAt, leaseDurationMs: 30_000, limit: 1 }),
            jobs.claimDue({ workerId: "worker-b", now: firstClaimAt, leaseDurationMs: 30_000, limit: 1 }),
        ]);

        expect(concurrent.flat()).toHaveLength(1);
        const owner = concurrent[0].length === 1 ? "worker-a" : "worker-b";
        const recoveryWorker = owner === "worker-a" ? "worker-b" : "worker-a";
        await expect(jobs.heartbeat(queued.id, owner, new Date("2026-07-26T12:00:10.000Z"), 30_000)).resolves.toBe(
            true,
        );
        await expect(
            jobs.claimDue({
                workerId: recoveryWorker,
                now: new Date("2026-07-26T12:00:39.999Z"),
                leaseDurationMs: 30_000,
                limit: 1,
            }),
        ).resolves.toHaveLength(0);
        const recovered = await jobs.claimDue({
            workerId: recoveryWorker,
            now: new Date("2026-07-26T12:00:40.000Z"),
            leaseDurationMs: 30_000,
            limit: 1,
        });
        expect(recovered).toMatchObject([{ id: queued.id, attempts: 2, lease: { owner: recoveryWorker } }]);
    });

    it("uses transaction-scoped advisory locks for schedulers", async () => {
        let releaseFirst!: () => void;
        let firstEntered!: () => void;
        const entered = new Promise<void>(resolve => {
            firstEntered = resolve;
        });
        const release = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const lockName = `integration-schedule-${randomUUID()}`;
        const first = schedulerLocks.withLock(lockName, async () => {
            firstEntered();
            await release;
        });
        await entered;

        await expect(schedulerLocks.withLock(lockName, async () => undefined)).resolves.toBe(false);
        releaseFirst();
        await expect(first).resolves.toBe(true);
        await expect(schedulerLocks.withLock(lockName, async () => undefined)).resolves.toBe(true);
    });

    function domainEvent(id: string, aggregateId: string): DomainEvent {
        return new DomainEvent({
            id,
            name: "training.session.completed",
            version: 1,
            occurredAt: new Date("2026-07-26T12:00:00.000Z"),
            aggregateType: "training-session",
            aggregateId,
            aggregateRevision: 2,
            correlationId: "request-1",
            causationId: "command-1",
            payload: { sessionId: aggregateId },
        });
    }
});
