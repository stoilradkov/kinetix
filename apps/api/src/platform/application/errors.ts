import type { ErrorContext, FieldErrors } from "#src/platform/domain/index";

export const applicationErrorCodes = [
    "VALIDATION_FAILED",
    "NOT_FOUND",
    "PRECONDITION_REQUIRED",
    "VERSION_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "IDEMPOTENCY_IN_PROGRESS",
    "DRY_RUN_EXPIRED",
    "DRY_RUN_STALE",
    "CATALOG_MAPPING_REQUIRED",
    "PROGRESSION_CONFLICT",
    "PROGRESSION_STALE",
    "JOB_FAILED",
] as const;

export type ApplicationErrorCode = (typeof applicationErrorCodes)[number];

export class ApplicationError extends Error {
    constructor(
        readonly code: ApplicationErrorCode,
        message: string,
        readonly fieldErrors?: FieldErrors,
        readonly context?: ErrorContext,
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class ApplicationValidationError extends ApplicationError {
    constructor(message: string, fieldErrors?: FieldErrors, context?: ErrorContext) {
        super("VALIDATION_FAILED", message, fieldErrors, context);
    }
}

export class ApplicationNotFoundError extends ApplicationError {
    constructor(message: string, context?: ErrorContext) {
        super("NOT_FOUND", message, undefined, context);
    }
}

export class ExpectedVersionRequiredError extends ApplicationError {
    constructor() {
        super("PRECONDITION_REQUIRED", "An expected aggregate version is required");
    }
}

export class VersionConflictError extends ApplicationError {
    constructor(
        readonly expectedVersion: number,
        readonly currentVersion: number,
    ) {
        super(
            "VERSION_CONFLICT",
            `Expected aggregate version ${expectedVersion}, but current version is ${currentVersion}`,
            undefined,
            { expectedVersion, currentVersion },
        );
    }
}

export class IdempotencyConflictError extends ApplicationError {
    constructor(
        readonly operation: string,
        readonly key: string,
    ) {
        super("IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different request", undefined, {
            operation,
        });
    }
}

export class IdempotencyInProgressError extends ApplicationError {
    constructor(
        readonly operation: string,
        readonly key: string,
    ) {
        super("IDEMPOTENCY_IN_PROGRESS", "A request with this idempotency key is still in progress", undefined, {
            operation,
        });
    }
}
