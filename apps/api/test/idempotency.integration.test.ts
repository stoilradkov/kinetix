import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, idempotencyRecords } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { IdempotentCommandExecutor, hashRequest, type UnitOfWork } from "#src/platform/application/index";
import { DrizzleIdempotencyRepository } from "#src/platform/infrastructure/drizzle-idempotency-repository";

const testDatabaseUrl = process.env.IDEMPOTENCY_TEST_DATABASE_URL ?? process.env.REVISION_TEST_DATABASE_URL;

describe.runIf(testDatabaseUrl)("Drizzle idempotency persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleIdempotencyRepository(connection as unknown as DatabaseService);
    const operations: string[] = [];

    beforeAll(async () => {
        await connection.db.select({ id: idempotencyRecords.id }).from(idempotencyRecords).limit(1);
    });

    afterEach(async () => {
        for (const operation of operations.splice(0))
            await connection.db.delete(idempotencyRecords).where(eq(idempotencyRecords.operation, operation));
    });

    afterAll(async () => {
        await connection.client.end({ timeout: 5 });
    });

    it("replays completed responses and replaces expired records", async () => {
        const operation = `integration.${randomUUID()}`;
        operations.push(operation);
        const requestHash = hashRequest({ name: "Base" });
        const now = new Date("2026-07-26T12:00:00.000Z");
        const initial = {
            operation,
            key: "key-1",
            requestHash,
            correlationId: "request-1",
            now,
            expiresAt: new Date("2026-07-26T13:00:00.000Z"),
        };

        await connection.db.transaction(async transaction => {
            await expect(repository.acquire(initial, transaction)).resolves.toEqual({ kind: "acquired" });
            await repository.complete(
                {
                    operation,
                    key: "key-1",
                    requestHash,
                    response: {
                        status: 201,
                        body: { id: "program-1" },
                        responseHash: hashRequest({ status: 201, body: { id: "program-1" } }),
                    },
                    completedAt: now,
                },
                transaction,
            );
        });

        await connection.db.transaction(async transaction => {
            await expect(repository.acquire(initial, transaction)).resolves.toMatchObject({
                kind: "replay",
                response: { status: 201, body: { id: "program-1" } },
            });
        });

        await connection.db.transaction(async transaction => {
            await expect(
                repository.acquire(
                    {
                        ...initial,
                        requestHash: hashRequest({ name: "Replacement" }),
                        now: new Date("2026-07-26T14:00:00.000Z"),
                        expiresAt: new Date("2026-07-26T15:00:00.000Z"),
                    },
                    transaction,
                ),
            ).resolves.toEqual({ kind: "acquired" });
        });
    });

    it("allows only one concurrent reservation for an operation and key", async () => {
        const operation = `integration.${randomUUID()}`;
        operations.push(operation);
        const input = {
            operation,
            key: "key-1",
            requestHash: hashRequest({ name: "Concurrent" }),
            correlationId: "request-1",
            now: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
        };
        const results = await Promise.all([
            connection.db.transaction(transaction => repository.acquire(input, transaction)),
            connection.db.transaction(transaction => repository.acquire(input, transaction)),
        ]);

        expect(results.map(result => result.kind).sort()).toEqual(["acquired", "in_progress"]);
    });

    it("executes one command and safely replays it to a concurrent caller", async () => {
        const operation = `integration.${randomUUID()}`;
        operations.push(operation);
        const unitOfWork: UnitOfWork<unknown> = {
            execute: work => connection.db.transaction(transaction => work(transaction)),
        };
        const executor = new IdempotentCommandExecutor(unitOfWork, repository);
        let executions = 0;
        const execute = () =>
            executor.execute(
                {
                    operation,
                    key: "key-1",
                    request: { name: "Concurrent command" },
                    context: { correlationId: randomUUID(), source: "agent" },
                },
                async () => {
                    executions += 1;
                    return { status: 201, body: { id: "program-1", version: 1 } };
                },
            );

        const results = await Promise.all([execute(), execute()]);

        expect(executions).toBe(1);
        expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
        expect(results[0]?.body).toEqual(results[1]?.body);
    });
});
