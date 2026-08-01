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
    "DRY_RUN_CONSUMED",
    "DRY_RUN_TOKEN_INVALID",
    "EXTERNAL_ID_CONFLICT",
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

/** A dry-run's validity window elapsed before it was committed (design 14.3 step 1). */
export class DryRunExpiredError extends ApplicationError {
    constructor(readonly dryRunId: string) {
        super("DRY_RUN_EXPIRED", "This dry-run has expired; re-run the dry-run", undefined, { dryRunId });
    }
}

/** A referenced catalog/aggregate version or the normalized hash changed since the dry-run (14.3 step 2). */
export class DryRunStaleError extends ApplicationError {
    constructor(readonly dryRunId: string) {
        super("DRY_RUN_STALE", "The referenced catalog changed since this dry-run; re-run the dry-run", undefined, {
            dryRunId,
        });
    }
}

/** A previously approved dry-run was already committed and cannot be committed again (design 14.3). */
export class DryRunConsumedError extends ApplicationError {
    constructor(readonly dryRunId: string) {
        super("DRY_RUN_CONSUMED", "This dry-run was already committed", undefined, { dryRunId });
    }
}

/** The approval token does not match the stored dry-run (design 14.3). */
export class DryRunTokenInvalidError extends ApplicationError {
    constructor(readonly dryRunId: string) {
        super("DRY_RUN_TOKEN_INVALID", "The approval token is not valid for this dry-run", undefined, { dryRunId });
    }
}

/** A stable external ID is already registered for another entity in this namespace. */
export class ExternalIdConflictError extends ApplicationError {
    constructor(
        readonly namespace: string,
        readonly entityType: string,
        readonly externalId: string,
    ) {
        super("EXTERNAL_ID_CONFLICT", "An entity with this external ID already exists in this namespace", undefined, {
            namespace,
            entityType,
            externalId,
        });
    }
}
