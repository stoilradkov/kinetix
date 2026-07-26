import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { idempotencyRecords, type Database, type IdempotencyRecordRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    IdempotencyAcquisition,
    IdempotencyRepository,
    StoredIdempotentResponse,
} from "#src/platform/application/index";

@Injectable()
export class DrizzleIdempotencyRepository implements IdempotencyRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async acquire(
        input: {
            operation: string;
            key: string;
            requestHash: string;
            correlationId: string;
            now: Date;
            expiresAt: Date;
        },
        transaction: unknown,
    ): Promise<IdempotencyAcquisition> {
        const executor = this.executor(transaction);
        const inserted = await executor
            .insert(idempotencyRecords)
            .values({
                operation: input.operation,
                key: input.key,
                requestHash: input.requestHash,
                correlationId: input.correlationId,
                expiresAt: input.expiresAt,
                createdAt: input.now,
                updatedAt: input.now,
            })
            .onConflictDoNothing({
                target: [idempotencyRecords.operation, idempotencyRecords.key],
            })
            .returning({ id: idempotencyRecords.id });
        if (inserted.length > 0) return { kind: "acquired" };

        const existing = await this.lockedRecord(executor, input.operation, input.key);
        if (!existing) return this.acquire(input, transaction);

        if (existing.expiresAt.getTime() <= input.now.getTime()) {
            await executor.delete(idempotencyRecords).where(eq(idempotencyRecords.id, existing.id));
            await executor.insert(idempotencyRecords).values({
                operation: input.operation,
                key: input.key,
                requestHash: input.requestHash,
                correlationId: input.correlationId,
                expiresAt: input.expiresAt,
                createdAt: input.now,
                updatedAt: input.now,
            });
            return { kind: "acquired" };
        }

        if (existing.requestHash !== input.requestHash) return { kind: "conflict" };
        if (existing.status === "in_progress") return { kind: "in_progress" };
        return { kind: "replay", response: storedResponse(existing) };
    }

    async complete(
        input: {
            operation: string;
            key: string;
            requestHash: string;
            response: StoredIdempotentResponse;
            completedAt: Date;
        },
        transaction: unknown,
    ): Promise<void> {
        const updated = await this.executor(transaction)
            .update(idempotencyRecords)
            .set({
                status: "completed",
                responseStatus: input.response.status,
                responseSnapshot:
                    input.response.body === undefined
                        ? { hasBody: false }
                        : { hasBody: true, body: input.response.body },
                responseHash: input.response.responseHash,
                completedAt: input.completedAt,
                updatedAt: input.completedAt,
            })
            .where(
                and(
                    eq(idempotencyRecords.operation, input.operation),
                    eq(idempotencyRecords.key, input.key),
                    eq(idempotencyRecords.requestHash, input.requestHash),
                    eq(idempotencyRecords.status, "in_progress"),
                ),
            )
            .returning({ id: idempotencyRecords.id });
        if (updated.length !== 1) throw new Error("The idempotency record could not be completed");
    }

    async release(input: { operation: string; key: string; requestHash: string }, transaction: unknown): Promise<void> {
        await this.executor(transaction)
            .delete(idempotencyRecords)
            .where(
                and(
                    eq(idempotencyRecords.operation, input.operation),
                    eq(idempotencyRecords.key, input.key),
                    eq(idempotencyRecords.requestHash, input.requestHash),
                    eq(idempotencyRecords.status, "in_progress"),
                ),
            );
    }

    private async lockedRecord(executor: Database, operation: string, key: string) {
        const rows = await executor
            .select()
            .from(idempotencyRecords)
            .where(and(eq(idempotencyRecords.operation, operation), eq(idempotencyRecords.key, key)))
            .limit(1)
            .for("update");
        return rows[0];
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function storedResponse(row: IdempotencyRecordRow): StoredIdempotentResponse {
    if (
        row.status !== "completed" ||
        row.responseStatus === null ||
        row.responseHash === null ||
        !isResponseSnapshot(row.responseSnapshot)
    )
        throw new Error("Completed idempotency record has no valid response snapshot");
    return {
        status: row.responseStatus,
        body: row.responseSnapshot.hasBody ? row.responseSnapshot.body : undefined,
        responseHash: row.responseHash,
    };
}

function isResponseSnapshot(value: unknown): value is { hasBody: false } | { hasBody: true; body: unknown } {
    if (typeof value !== "object" || value === null || !("hasBody" in value)) return false;
    if (value.hasBody === false) return true;
    return value.hasBody === true && Object.prototype.hasOwnProperty.call(value, "body");
}
