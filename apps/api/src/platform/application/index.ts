export type { KinetixModuleDefinition } from "#src/platform/application/module-definition";
export { UNIT_OF_WORK, type UnitOfWork } from "#src/platform/application/unit-of-work";
export {
    MigratingSnapshotSerializer,
    RevisionMutationService,
    StaleAggregateVersionError,
    type CurrentStateStore,
    type EntityRevision,
    type RevisionMetadata,
    type RevisionPage,
    type RevisionSnapshot,
    type SnapshotMigration,
    type RevisionStore,
    type SnapshotSerializer,
    type TransactionalEventPublisher,
} from "#src/platform/application/revisions";
