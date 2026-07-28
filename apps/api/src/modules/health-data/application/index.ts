import type { KinetixModuleDefinition } from "#src/platform/application/index";

export const healthDataModuleDefinition = {
    type: "health-data",
    version: 1,
    displayName: "Health Data",
    cardinality: "one",
} as const satisfies KinetixModuleDefinition;

export {
    HEALTH_CONTEXT_READER,
    HEALTH_RECORD_COMMANDS,
    HEALTH_RECORD_ENTITY_TYPE,
    HEALTH_RECORD_MUTATION_SERVICE,
    HEALTH_RECORD_REPOSITORY,
    HEALTH_RECORD_REVISION_HANDLER,
    HealthContextReaderService,
    ManualHealthRecordCommands,
    ManualHealthRecordNotFoundError,
    ManualHealthRecordRevisionHandler,
    manualHealthRecordSerializer,
    type CreateManualHealthRecordCommand,
    type HealthContextPoint,
    type HealthContextQuery,
    type HealthContextReader,
    type HealthContextWindow,
    type HealthRecordListFilter,
    type HealthRecordMutationMetadata,
    type HealthRecordRepository,
    type ManualHealthRecordResource,
} from "#src/modules/health-data/application/manual-health-records";
