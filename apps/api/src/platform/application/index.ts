export { commandContext, type CommandContext } from "#src/platform/application/command-context";
export {
    ApplicationError,
    ApplicationNotFoundError,
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    IdempotencyConflictError,
    IdempotencyInProgressError,
    VersionConflictError,
    applicationErrorCodes,
    type ApplicationErrorCode,
} from "#src/platform/application/errors";
export { ExpectedVersionGuard, assertExpectedVersion } from "#src/platform/application/expected-version";
export {
    IDEMPOTENCY_REPOSITORY,
    IDEMPOTENT_COMMAND_EXECUTOR,
    IdempotentCommandExecutor,
    type IdempotencyAcquisition,
    type IdempotencyRecordStatus,
    type IdempotencyRepository,
    type IdempotentCommandResult,
    type IdempotentResponse,
    type StoredIdempotentResponse,
} from "#src/platform/application/idempotency";
export type { KinetixModuleDefinition } from "#src/platform/application/module-definition";
export { canonicalizeRequest, hashRequest } from "#src/platform/application/request-hash";
export { UNIT_OF_WORK, type UnitOfWork } from "#src/platform/application/unit-of-work";
export {
    MigratingSnapshotSerializer,
    REVISION_STORE,
    RevisionHistoryService,
    RevisionMutationService,
    RevisionAggregateNotFoundError,
    RevisionNotFoundError,
    RevisionResourceRegistry,
    StaleAggregateVersionError,
    UnsupportedRevisionEntityTypeError,
    type CurrentStateStore,
    type EntityRevision,
    type RevisionHistoryItem,
    type RevisionHistoryPage,
    type RevisionMetadata,
    type RevisionPage,
    type RevisionResourceHandler,
    type RevisionSnapshot,
    type SnapshotMigration,
    type RevisionStore,
    type SnapshotResourceMapper,
    type SnapshotSerializer,
    type TransactionalEventPublisher,
} from "#src/platform/application/revisions";
