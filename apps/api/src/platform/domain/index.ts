export type { Clock } from "#src/platform/domain/clock";
export {
    DomainError,
    DomainNotFoundError,
    DomainValidationError,
    type DomainErrorCode,
    type ErrorContext,
    type FieldErrors,
} from "#src/platform/domain/errors";
export { entityId, type EntityId } from "#src/platform/domain/id";
export {
    AggregateVersion,
    revisionReason,
    revisionSource,
    revisionSources,
    type RevisionSource,
} from "#src/platform/domain/revision";
