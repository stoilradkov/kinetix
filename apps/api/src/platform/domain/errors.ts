export type DomainErrorCode = "VALIDATION_FAILED" | "NOT_FOUND";

export type ErrorContext = Readonly<Record<string, unknown>>;
export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export abstract class DomainError extends Error {
    protected constructor(
        readonly code: DomainErrorCode,
        message: string,
        readonly fieldErrors?: FieldErrors,
        readonly context?: ErrorContext,
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class DomainValidationError extends DomainError {
    constructor(message: string, fieldErrors?: FieldErrors, context?: ErrorContext) {
        super("VALIDATION_FAILED", message, fieldErrors, context);
    }
}

export class DomainNotFoundError extends DomainError {
    constructor(message: string, context?: ErrorContext) {
        super("NOT_FOUND", message, undefined, context);
    }
}
