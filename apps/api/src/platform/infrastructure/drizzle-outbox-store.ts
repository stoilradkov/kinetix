import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";

import { outboxEvents, type Database, type OutboxEventRow, type StoredWorkError } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    leaseExpiresAt,
    type ClaimedOutboxEvent,
    type ClaimWorkInput,
    type OutboxLeaseStore,
    type OutboxWriter,
    type WorkError,
    type WorkFailureInput,
    workName,
} from "#src/platform/application/index";
import { hashRequest } from "#src/platform/application/request-hash";

@Injectable()
export class DrizzleOutboxStore implements OutboxWriter, OutboxLeaseStore {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async publish(events: Parameters<OutboxWriter["publish"]>[0], transaction: unknown): Promise<void> {
        if (events.length === 0) return;
        const now = new Date();
        await this.executor(transaction)
            .insert(outboxEvents)
            .values(
                events.map(event => ({
                    id: event.id,
                    eventName: event.name,
                    eventVersion: event.version,
                    aggregateType: event.aggregateType,
                    aggregateId: event.aggregateId,
                    aggregateRevision: event.aggregateRevision,
                    payload: { ...event.payload },
                    payloadFingerprint: hashRequest(event.payload),
                    correlationId: event.correlationId,
                    causationId: event.causationId,
                    occurredAt: event.occurredAt,
                    nextAttemptAt: now,
                    createdAt: now,
                    updatedAt: now,
                })),
            );
    }

    async claimDue(input: ClaimWorkInput): Promise<ClaimedOutboxEvent[]> {
        validateClaim(input);
        return this.database.db.transaction(async transaction => {
            await transaction
                .update(outboxEvents)
                .set({
                    status: "failed",
                    error: storedError({
                        code: "LEASE_EXPIRED",
                        message: "Event lease expired after the final attempt",
                        retryable: false,
                        failedAt: input.now,
                    }),
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    heartbeatAt: null,
                    updatedAt: input.now,
                })
                .where(
                    and(
                        eq(outboxEvents.status, "processing"),
                        lte(outboxEvents.leaseExpiresAt, input.now),
                        sql`${outboxEvents.attempts} >= ${outboxEvents.maxAttempts}`,
                    ),
                );

            const due = await transaction
                .select({ id: outboxEvents.id })
                .from(outboxEvents)
                .where(
                    and(
                        sql`${outboxEvents.attempts} < ${outboxEvents.maxAttempts}`,
                        or(
                            and(eq(outboxEvents.status, "pending"), lte(outboxEvents.nextAttemptAt, input.now)),
                            and(eq(outboxEvents.status, "processing"), lte(outboxEvents.leaseExpiresAt, input.now)),
                        ),
                    ),
                )
                .orderBy(asc(outboxEvents.nextAttemptAt), asc(outboxEvents.createdAt))
                .limit(input.limit)
                .for("update", { skipLocked: true });
            if (due.length === 0) return [];

            const rows = await transaction
                .update(outboxEvents)
                .set({
                    status: "processing",
                    attempts: sql`${outboxEvents.attempts} + 1`,
                    leaseOwner: input.workerId,
                    leaseExpiresAt: leaseExpiresAt(input.now, input.leaseDurationMs),
                    heartbeatAt: input.now,
                    updatedAt: input.now,
                })
                .where(
                    inArray(
                        outboxEvents.id,
                        due.map(item => item.id),
                    ),
                )
                .returning();
            return rows.map(claimedEvent);
        });
    }

    async heartbeat(id: string, workerId: string, now: Date, leaseDurationMs: number): Promise<boolean> {
        const rows = await this.database.db
            .update(outboxEvents)
            .set({
                heartbeatAt: now,
                leaseExpiresAt: leaseExpiresAt(now, leaseDurationMs),
                updatedAt: now,
            })
            .where(
                and(
                    eq(outboxEvents.id, id),
                    eq(outboxEvents.status, "processing"),
                    eq(outboxEvents.leaseOwner, workerId),
                    gt(outboxEvents.leaseExpiresAt, now),
                ),
            )
            .returning({ id: outboxEvents.id });
        return rows.length === 1;
    }

    async complete(id: string, workerId: string, completedAt: Date, transaction?: unknown): Promise<boolean> {
        const rows = await this.executor(transaction)
            .update(outboxEvents)
            .set({
                status: "published",
                error: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
                publishedAt: completedAt,
                updatedAt: completedAt,
            })
            .where(
                and(
                    eq(outboxEvents.id, id),
                    eq(outboxEvents.status, "processing"),
                    eq(outboxEvents.leaseOwner, workerId),
                    gt(outboxEvents.leaseExpiresAt, completedAt),
                ),
            )
            .returning({ id: outboxEvents.id });
        return rows.length === 1;
    }

    async fail(input: WorkFailureInput): Promise<boolean> {
        const rows = await this.database.db
            .update(outboxEvents)
            .set(
                input.retryAt
                    ? {
                          status: "pending",
                          nextAttemptAt: input.retryAt,
                          error: storedError(input.error),
                          leaseOwner: null,
                          leaseExpiresAt: null,
                          heartbeatAt: null,
                          updatedAt: input.failedAt,
                      }
                    : {
                          status: "failed",
                          error: storedError(input.error),
                          leaseOwner: null,
                          leaseExpiresAt: null,
                          heartbeatAt: null,
                          updatedAt: input.failedAt,
                      },
            )
            .where(
                and(
                    eq(outboxEvents.id, input.id),
                    eq(outboxEvents.status, "processing"),
                    eq(outboxEvents.leaseOwner, input.workerId),
                ),
            )
            .returning({ id: outboxEvents.id });
        return rows.length === 1;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function claimedEvent(row: OutboxEventRow): ClaimedOutboxEvent {
    if (
        row.status !== "processing" ||
        row.leaseOwner === null ||
        row.leaseExpiresAt === null ||
        row.heartbeatAt === null
    )
        throw new Error("Claimed outbox event has invalid lease state");
    return {
        id: row.id,
        name: row.eventName,
        version: row.eventVersion,
        stableName: workName(row.eventName, row.eventVersion),
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        aggregateRevision: row.aggregateRevision,
        payload: row.payload,
        payloadFingerprint: row.payloadFingerprint,
        state: "processing",
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        correlationId: row.correlationId,
        causationId: row.causationId,
        occurredAt: row.occurredAt,
        lease: {
            owner: row.leaseOwner,
            expiresAt: row.leaseExpiresAt,
            heartbeatAt: row.heartbeatAt,
        },
    };
}

function storedError(error: WorkError): StoredWorkError {
    return {
        code: required(error.code, "Work error code", 80),
        message: required(error.message, "Work error message", 500),
        retryable: error.retryable,
        failedAt: error.failedAt.toISOString(),
    };
}

function validateClaim(input: ClaimWorkInput): void {
    required(input.workerId, "Worker ID", 180);
    if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime()))
        throw new Error("Claim time must be a valid date");
    positiveInteger(input.leaseDurationMs, "Lease duration");
    const limit = positiveInteger(input.limit, "Claim limit");
    if (limit > 100) throw new Error("Claim limit cannot exceed 100");
}

function required(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${name} cannot be empty`);
    if (normalized.length > maximumLength) throw new Error(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return value;
}
