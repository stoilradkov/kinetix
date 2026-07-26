import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";

import {
    jobs as durableJobs,
    type Database,
    type DurableJobRow,
    type StoredJobProgress,
    type StoredWorkError,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    leaseExpiresAt,
    IdempotencyConflictError,
    type ClaimWorkInput,
    type ClaimedJob,
    type EnqueueJob,
    type JobLeaseStore,
    type JobProgress,
    type JobQueue,
    type JobStatus,
    type JobStatusReader,
    type QueuedJob,
    type WorkError,
    type WorkFailureInput,
    workName,
} from "#src/platform/application/index";
import { hashRequest } from "#src/platform/application/request-hash";

@Injectable()
export class DrizzleJobStore implements JobQueue, JobStatusReader, JobLeaseStore {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async enqueue(input: EnqueueJob, transaction: unknown): Promise<QueuedJob> {
        const type = normalizedType(input.type);
        const version = positiveInteger(input.version, "Job version");
        const now = new Date();
        const executor = this.executor(transaction);
        const idempotencyKey = optionalIdentifier(input.idempotencyKey, "Job idempotency key", 255);
        const values = {
            type,
            version,
            payload: input.payload,
            payloadFingerprint: hashRequest(input.payload),
            priority: integerBetween(input.priority ?? 0, "Job priority", -1000, 1000),
            maxAttempts: integerBetween(input.maxAttempts ?? 5, "Job max attempts", 1, 100),
            nextAttemptAt: validDate(input.runAt ?? now, "Job run time"),
            idempotencyKey,
            correlationId: identifier(input.correlationId, "Job correlation ID", 128),
            causationId: optionalIdentifier(input.causationId, "Job causation ID", 128),
            createdAt: now,
            updatedAt: now,
        };
        const inserted = await executor.insert(durableJobs).values(values).onConflictDoNothing().returning();
        const row =
            inserted[0] ??
            (idempotencyKey
                ? (
                      await executor
                          .select()
                          .from(durableJobs)
                          .where(
                              and(
                                  eq(durableJobs.type, type),
                                  eq(durableJobs.version, version),
                                  eq(durableJobs.idempotencyKey, idempotencyKey),
                              ),
                          )
                          .limit(1)
                  )[0]
                : undefined);
        if (!row) throw new Error("The durable job could not be enqueued");
        if (row.payloadFingerprint !== values.payloadFingerprint)
            throw new IdempotencyConflictError(workName(type, version), idempotencyKey ?? "");
        return queuedJob(row);
    }

    async find(id: string): Promise<JobStatus | null> {
        const rows = await this.database.db.select().from(durableJobs).where(eq(durableJobs.id, id)).limit(1);
        return rows[0] ? jobStatus(rows[0]) : null;
    }

    async claimDue(input: ClaimWorkInput): Promise<ClaimedJob[]> {
        validateClaim(input);
        return this.database.db.transaction(async transaction => {
            await transaction
                .update(durableJobs)
                .set({
                    status: "failed",
                    error: storedError({
                        code: "LEASE_EXPIRED",
                        message: "Worker lease expired after the final attempt",
                        retryable: false,
                        failedAt: input.now,
                    }),
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    heartbeatAt: null,
                    completedAt: input.now,
                    updatedAt: input.now,
                })
                .where(
                    and(
                        eq(durableJobs.status, "running"),
                        lte(durableJobs.leaseExpiresAt, input.now),
                        sql`${durableJobs.attempts} >= ${durableJobs.maxAttempts}`,
                    ),
                );

            const due = await transaction
                .select({ id: durableJobs.id })
                .from(durableJobs)
                .where(
                    and(
                        sql`${durableJobs.attempts} < ${durableJobs.maxAttempts}`,
                        or(
                            and(eq(durableJobs.status, "queued"), lte(durableJobs.nextAttemptAt, input.now)),
                            and(eq(durableJobs.status, "running"), lte(durableJobs.leaseExpiresAt, input.now)),
                        ),
                    ),
                )
                .orderBy(desc(durableJobs.priority), asc(durableJobs.nextAttemptAt), asc(durableJobs.createdAt))
                .limit(input.limit)
                .for("update", { skipLocked: true });
            if (due.length === 0) return [];

            const rows = await transaction
                .update(durableJobs)
                .set({
                    status: "running",
                    attempts: sql`${durableJobs.attempts} + 1`,
                    leaseOwner: input.workerId,
                    leaseExpiresAt: leaseExpiresAt(input.now, input.leaseDurationMs),
                    heartbeatAt: input.now,
                    startedAt: sql`coalesce(
                        ${durableJobs.startedAt},
                        ${input.now.toISOString()}::timestamptz
                    )`,
                    updatedAt: input.now,
                })
                .where(
                    inArray(
                        durableJobs.id,
                        due.map(item => item.id),
                    ),
                )
                .returning();
            return rows.map(claimedJob);
        });
    }

    async heartbeat(id: string, workerId: string, now: Date, leaseDurationMs: number): Promise<boolean> {
        const rows = await this.database.db
            .update(durableJobs)
            .set({
                heartbeatAt: now,
                leaseExpiresAt: leaseExpiresAt(now, leaseDurationMs),
                updatedAt: now,
            })
            .where(
                and(
                    eq(durableJobs.id, id),
                    eq(durableJobs.status, "running"),
                    eq(durableJobs.leaseOwner, workerId),
                    gt(durableJobs.leaseExpiresAt, now),
                ),
            )
            .returning({ id: durableJobs.id });
        return rows.length === 1;
    }

    async reportProgress(id: string, workerId: string, progress: JobProgress, now: Date): Promise<boolean> {
        const rows = await this.database.db
            .update(durableJobs)
            .set({ progress: storedProgress(progress), updatedAt: now })
            .where(
                and(
                    eq(durableJobs.id, id),
                    eq(durableJobs.status, "running"),
                    eq(durableJobs.leaseOwner, workerId),
                    gt(durableJobs.leaseExpiresAt, now),
                ),
            )
            .returning({ id: durableJobs.id });
        return rows.length === 1;
    }

    async complete(id: string, workerId: string, completedAt: Date, transaction?: unknown): Promise<boolean> {
        const rows = await this.executor(transaction)
            .update(durableJobs)
            .set({
                status: "succeeded",
                progress: sql`CASE
                    WHEN ${durableJobs.progress} IS NULL THEN '{"completed":1,"total":1}'::jsonb
                    ELSE ${durableJobs.progress}
                END`,
                error: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
                completedAt,
                updatedAt: completedAt,
            })
            .where(
                and(
                    eq(durableJobs.id, id),
                    eq(durableJobs.status, "running"),
                    eq(durableJobs.leaseOwner, workerId),
                    gt(durableJobs.leaseExpiresAt, completedAt),
                ),
            )
            .returning({ id: durableJobs.id });
        return rows.length === 1;
    }

    async fail(input: WorkFailureInput): Promise<boolean> {
        const rows = await this.database.db
            .update(durableJobs)
            .set(
                input.retryAt
                    ? {
                          status: "queued",
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
                          completedAt: input.failedAt,
                          updatedAt: input.failedAt,
                      },
            )
            .where(
                and(
                    eq(durableJobs.id, input.id),
                    eq(durableJobs.status, "running"),
                    eq(durableJobs.leaseOwner, input.workerId),
                ),
            )
            .returning({ id: durableJobs.id });
        return rows.length === 1;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function queuedJob(row: DurableJobRow): QueuedJob {
    return {
        id: row.id,
        type: row.type,
        version: row.version,
        state: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        nextAttemptAt: row.nextAttemptAt,
        idempotencyKey: row.idempotencyKey,
        correlationId: row.correlationId,
        causationId: row.causationId,
        createdAt: row.createdAt,
    };
}

function jobStatus(row: DurableJobRow): JobStatus {
    return {
        ...queuedJob(row),
        progress: row.progress ?? null,
        error: row.error ? workError(row.error) : null,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
    };
}

function claimedJob(row: DurableJobRow): ClaimedJob {
    if (row.status !== "running" || row.leaseOwner === null || row.leaseExpiresAt === null || row.heartbeatAt === null)
        throw new Error("Claimed job has invalid lease state");
    return {
        ...jobStatus(row),
        state: "running",
        payload: row.payload,
        payloadFingerprint: row.payloadFingerprint,
        lease: {
            owner: row.leaseOwner,
            expiresAt: row.leaseExpiresAt,
            heartbeatAt: row.heartbeatAt,
        },
    };
}

function storedProgress(progress: JobProgress): StoredJobProgress {
    const completed = nonNegativeInteger(progress.completed, "Completed progress");
    const total = progress.total === undefined ? undefined : positiveInteger(progress.total, "Total progress");
    if (total !== undefined && completed > total) throw new Error("Completed progress cannot exceed total progress");
    const message = optionalIdentifier(progress.message, "Progress message", 240) ?? undefined;
    return { completed, ...(total === undefined ? {} : { total }), ...(message === undefined ? {} : { message }) };
}

function storedError(error: WorkError): StoredWorkError {
    return {
        code: identifier(error.code, "Work error code", 80),
        message: identifier(error.message, "Work error message", 500),
        retryable: error.retryable,
        failedAt: validDate(error.failedAt, "Failure time").toISOString(),
    };
}

function workError(error: StoredWorkError): WorkError {
    return {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        failedAt: new Date(error.failedAt),
    };
}

function validateClaim(input: ClaimWorkInput): void {
    identifier(input.workerId, "Worker ID", 180);
    validDate(input.now, "Claim time");
    positiveInteger(input.leaseDurationMs, "Lease duration");
    integerBetween(input.limit, "Claim limit", 1, 100);
}

function normalizedType(value: string): string {
    const normalized = identifier(value, "Job type", 180);
    workName(normalized, 1);
    return normalized;
}

function identifier(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${name} cannot be empty`);
    if (normalized.length > maximumLength) throw new Error(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function optionalIdentifier(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value === undefined || value === null) return null;
    return identifier(value, name, maximumLength);
}

function positiveInteger(value: number, name: string): number {
    return integerBetween(value, name, 1, Number.MAX_SAFE_INTEGER);
}

function nonNegativeInteger(value: number, name: string): number {
    return integerBetween(value, name, 0, Number.MAX_SAFE_INTEGER);
}

function integerBetween(value: number, name: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    return value;
}

function validDate(value: Date, name: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${name} must be a valid date`);
    return value;
}
