import type { Clock } from "#src/platform/domain/index";

import { commandContext, type CommandContext } from "#src/platform/application/command-context";
import {
    ApplicationValidationError,
    IdempotencyConflictError,
    IdempotencyInProgressError,
} from "#src/platform/application/errors";
import { hashRequest } from "#src/platform/application/request-hash";
import type { UnitOfWork } from "#src/platform/application/unit-of-work";

export const IDEMPOTENCY_REPOSITORY = Symbol("IDEMPOTENCY_REPOSITORY");
export const IDEMPOTENT_COMMAND_EXECUTOR = Symbol("IDEMPOTENT_COMMAND_EXECUTOR");

export type IdempotencyRecordStatus = "in_progress" | "completed";

export interface IdempotentResponse<Body = unknown> {
    readonly status: number;
    readonly body: Body;
}

export interface StoredIdempotentResponse extends IdempotentResponse {
    readonly responseHash: string;
}

export type IdempotencyAcquisition =
    | { readonly kind: "acquired" }
    | { readonly kind: "in_progress" }
    | { readonly kind: "conflict" }
    | { readonly kind: "replay"; readonly response: StoredIdempotentResponse };

export interface IdempotencyRepository<Transaction = unknown> {
    acquire(
        input: {
            operation: string;
            key: string;
            requestHash: string;
            correlationId: string;
            now: Date;
            expiresAt: Date;
        },
        transaction: Transaction,
    ): Promise<IdempotencyAcquisition>;
    complete(
        input: {
            operation: string;
            key: string;
            requestHash: string;
            response: StoredIdempotentResponse;
            completedAt: Date;
        },
        transaction: Transaction,
    ): Promise<void>;
    release(input: { operation: string; key: string; requestHash: string }, transaction: Transaction): Promise<void>;
}

export interface IdempotentCommandResult<Body> extends IdempotentResponse<Body> {
    readonly replayed: boolean;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

export class IdempotentCommandExecutor<Transaction = unknown> {
    constructor(
        private readonly unitOfWork: UnitOfWork<Transaction>,
        private readonly records: IdempotencyRepository<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly ttlMs = DEFAULT_TTL_MS,
    ) {
        if (!Number.isSafeInteger(ttlMs) || ttlMs < 1)
            throw new ApplicationValidationError("Idempotency TTL must be a positive integer");
    }

    execute<Body>(
        input: {
            operation: string;
            key: string;
            request: unknown;
            context: CommandContext;
        },
        command: (transaction: Transaction, context: CommandContext) => Promise<IdempotentResponse<Body>>,
    ): Promise<IdempotentCommandResult<Body>> {
        const operation = normalizedIdentifier(input.operation, "Idempotency operation", 120);
        const key = normalizedIdentifier(input.key, "Idempotency key", 255);
        const requestHash = hashRequest(input.request);
        const context = commandContext(input.context);
        const now = this.clock.now();
        const expiresAt = new Date(now.getTime() + this.ttlMs);

        return this.unitOfWork.execute(async transaction => {
            const acquisition = await this.records.acquire(
                {
                    operation,
                    key,
                    requestHash,
                    correlationId: context.correlationId,
                    now,
                    expiresAt,
                },
                transaction,
            );
            if (acquisition.kind === "conflict") throw new IdempotencyConflictError(operation, key);
            if (acquisition.kind === "in_progress") throw new IdempotencyInProgressError(operation, key);
            if (acquisition.kind === "replay") {
                const actualResponseHash = hashRequest({
                    status: acquisition.response.status,
                    body: acquisition.response.body,
                });
                if (actualResponseHash !== acquisition.response.responseHash)
                    throw new Error("Stored idempotency response hash does not match its snapshot");
                return {
                    status: acquisition.response.status,
                    body: acquisition.response.body as Body,
                    replayed: true,
                };
            }

            try {
                const response = validateResponse(await command(transaction, context));
                await this.records.complete(
                    {
                        operation,
                        key,
                        requestHash,
                        response: {
                            ...response,
                            responseHash: hashRequest({ status: response.status, body: response.body }),
                        },
                        completedAt: this.clock.now(),
                    },
                    transaction,
                );
                return { ...response, replayed: false };
            } catch (error) {
                await this.records.release({ operation, key, requestHash }, transaction);
                throw error;
            }
        }, context);
    }
}

function normalizedIdentifier(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new ApplicationValidationError(`${name} cannot be empty`);
    if (normalized.length > maximumLength)
        throw new ApplicationValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function validateResponse<Body>(response: IdempotentResponse<Body>): IdempotentResponse<Body> {
    if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599)
        throw new ApplicationValidationError("Idempotent response status must be a valid HTTP status");
    return response;
}
