import { describe, expect, it, vi } from "vitest";

import {
    IdempotencyConflictError,
    IdempotentCommandExecutor,
    type CommandContext,
    type IdempotencyRepository,
    type StoredIdempotentResponse,
    type UnitOfWork,
} from "#src/platform/application/index";

interface Transaction {
    id: string;
}

class MemoryIdempotencyRepository implements IdempotencyRepository<Transaction> {
    record?: {
        operation: string;
        key: string;
        requestHash: string;
        status: "in_progress" | "completed";
        response?: StoredIdempotentResponse;
        expiresAt: Date;
    };

    async acquire(input: { operation: string; key: string; requestHash: string; now: Date; expiresAt: Date }) {
        if (!this.record || this.record.expiresAt <= input.now) {
            this.record = {
                operation: input.operation,
                key: input.key,
                requestHash: input.requestHash,
                status: "in_progress",
                expiresAt: input.expiresAt,
            };
            return { kind: "acquired" as const };
        }
        if (this.record.requestHash !== input.requestHash) return { kind: "conflict" as const };
        if (this.record.status === "in_progress") return { kind: "in_progress" as const };
        return { kind: "replay" as const, response: this.record.response! };
    }

    async complete(input: { response: StoredIdempotentResponse }) {
        if (!this.record) throw new Error("missing record");
        this.record.status = "completed";
        this.record.response = input.response;
    }

    async release() {
        this.record = undefined;
    }
}

const context: CommandContext = { correlationId: "request-1", source: "agent" };
const transaction = { id: "tx" };

function createFixture() {
    const contexts: Array<CommandContext | undefined> = [];
    const unitOfWork: UnitOfWork<Transaction> = {
        execute: async (work, commandContext) => {
            contexts.push(commandContext);
            return work(transaction, commandContext);
        },
    };
    const records = new MemoryIdempotencyRepository();
    const executor = new IdempotentCommandExecutor(
        unitOfWork,
        records,
        { now: () => new Date("2026-07-26T12:00:00.000Z") },
        60_000,
    );
    return { contexts, records, executor };
}

describe("idempotent command execution", () => {
    it("replays the original status and body for the same canonical request", async () => {
        const { contexts, executor, records } = createFixture();
        const command = vi.fn(async () => ({ status: 201, body: { version: 1, created: true } }));

        const first = await executor.execute(
            { operation: "program.create", key: "key-1", request: { b: 2, a: 1 }, context },
            command,
        );
        const replay = await executor.execute(
            { operation: "program.create", key: "key-1", request: { a: 1, b: 2 }, context },
            command,
        );

        expect(first).toEqual({ status: 201, body: { version: 1, created: true }, replayed: false });
        expect(replay).toEqual({ status: 201, body: { version: 1, created: true }, replayed: true });
        expect(command).toHaveBeenCalledTimes(1);
        expect(records.record?.response?.responseHash).toMatch(/^[0-9a-f]{64}$/);
        expect(contexts).toEqual([context, context]);
    });

    it("rejects reuse of a key for a different request hash", async () => {
        const { executor } = createFixture();
        await executor.execute(
            { operation: "program.create", key: "key-1", request: { name: "First" }, context },
            async () => ({ status: 201, body: { id: "1" } }),
        );

        await expect(
            executor.execute(
                { operation: "program.create", key: "key-1", request: { name: "Second" }, context },
                async () => ({ status: 201, body: { id: "2" } }),
            ),
        ).rejects.toBeInstanceOf(IdempotencyConflictError);
    });

    it("releases an in-progress record when the command fails", async () => {
        const { executor, records } = createFixture();
        await expect(
            executor.execute({ operation: "program.create", key: "key-1", request: {}, context }, async () => {
                throw new Error("command failed");
            }),
        ).rejects.toThrow("command failed");
        expect(records.record).toBeUndefined();

        await expect(
            executor.execute(
                { operation: "program.create", key: "key-1", request: {}, context },
                async (_transaction, commandContext) => ({
                    status: 200,
                    body: { correlationId: commandContext.correlationId },
                }),
            ),
        ).resolves.toMatchObject({ body: { correlationId: "request-1" }, replayed: false });
    });
});
