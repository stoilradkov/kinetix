import { randomUUID } from "node:crypto";

import { Module } from "@nestjs/common";

import {
    HEALTH_CONTEXT_READER,
    HEALTH_RECORD_COMMANDS,
    HEALTH_RECORD_MUTATION_SERVICE,
    HEALTH_RECORD_REPOSITORY,
    HEALTH_RECORD_REVISION_HANDLER,
    HealthContextReaderService,
    ManualHealthRecordCommands,
    ManualHealthRecordRevisionHandler,
    healthDataModuleDefinition,
    manualHealthRecordSerializer,
    type HealthRecordRepository,
} from "#src/modules/health-data/application/index";
import type { ManualHealthRecordState } from "#src/modules/health-data/domain/index";
import { DrizzleHealthRecordRepository } from "#src/modules/health-data/infrastructure/drizzle-health-record-repository";
import { HealthRecordRevisionRegistrar } from "#src/modules/health-data/infrastructure/health-record-revision-registrar";
import { ManualHealthRecordController } from "#src/modules/health-data/presentation/index";
import { PROFILE_READER, ProfileModule, type ProfileReader } from "#src/modules/profile/index";
import {
    OUTBOX_WRITER,
    REVISION_STORE,
    RevisionMutationService,
    UNIT_OF_WORK,
    type OutboxWriter,
    type RevisionStore,
    type UnitOfWork,
} from "#src/platform/application/index";
import type { DomainEvent } from "#src/platform/domain/index";

export const HEALTH_DATA_MODULE_DEFINITION = Symbol("HEALTH_DATA_MODULE_DEFINITION");

@Module({
    imports: [ProfileModule],
    controllers: [ManualHealthRecordController],
    providers: [
        DrizzleHealthRecordRepository,
        { provide: HEALTH_RECORD_REPOSITORY, useExisting: DrizzleHealthRecordRepository },
        {
            provide: HEALTH_RECORD_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: HealthRecordRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, manualHealthRecordSerializer, events),
            inject: [UNIT_OF_WORK, HEALTH_RECORD_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: HEALTH_RECORD_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: HealthRecordRepository,
                mutations: RevisionMutationService<ManualHealthRecordState, DomainEvent>,
                profileReader: ProfileReader,
            ) =>
                new ManualHealthRecordCommands({
                    unitOfWork,
                    repository,
                    mutations,
                    profileReader,
                    generateId: randomUUID,
                }),
            inject: [UNIT_OF_WORK, HEALTH_RECORD_REPOSITORY, HEALTH_RECORD_MUTATION_SERVICE, PROFILE_READER],
        },
        {
            provide: HEALTH_RECORD_REVISION_HANDLER,
            useFactory: (
                mutations: RevisionMutationService<ManualHealthRecordState, DomainEvent>,
                revisions: RevisionStore,
            ) => new ManualHealthRecordRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [HEALTH_RECORD_MUTATION_SERVICE, REVISION_STORE],
        },
        {
            provide: HEALTH_CONTEXT_READER,
            useFactory: (repository: HealthRecordRepository) => new HealthContextReaderService(repository),
            inject: [HEALTH_RECORD_REPOSITORY],
        },
        HealthRecordRevisionRegistrar,
        {
            provide: HEALTH_DATA_MODULE_DEFINITION,
            useValue: healthDataModuleDefinition,
        },
    ],
    exports: [HEALTH_DATA_MODULE_DEFINITION, HEALTH_CONTEXT_READER],
})
export class HealthDataModule {}
