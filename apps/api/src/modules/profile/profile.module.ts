import { randomUUID } from "node:crypto";

import { Module } from "@nestjs/common";

import {
    CORE_PROFILE_COMMANDS,
    CORE_PROFILE_MUTATION_SERVICE,
    CORE_PROFILE_REPOSITORY,
    CORE_PROFILE_REVISION_HANDLER,
    CoreProfileCommands,
    CoreProfileReader,
    CoreProfileRevisionHandler,
    PROFILE_READER,
    coreProfileSerializer,
    profileModuleDefinition,
    type CoreProfileRepository,
} from "#src/modules/profile/application/index";
import type { CoreProfileState } from "#src/modules/profile/domain/index";
import { CoreProfileRevisionRegistrar } from "#src/modules/profile/infrastructure/core-profile-revision-registrar";
import { DrizzleCoreProfileRepository } from "#src/modules/profile/infrastructure/drizzle-core-profile-repository";
import { CoreProfileController } from "#src/modules/profile/presentation/index";
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

export const PROFILE_MODULE_DEFINITION = Symbol("PROFILE_MODULE_DEFINITION");

@Module({
    controllers: [CoreProfileController],
    providers: [
        DrizzleCoreProfileRepository,
        { provide: PROFILE_MODULE_DEFINITION, useValue: profileModuleDefinition },
        { provide: CORE_PROFILE_REPOSITORY, useExisting: DrizzleCoreProfileRepository },
        {
            provide: PROFILE_READER,
            useFactory: (repository: CoreProfileRepository) => new CoreProfileReader(repository),
            inject: [CORE_PROFILE_REPOSITORY],
        },
        {
            provide: CORE_PROFILE_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: CoreProfileRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, coreProfileSerializer, events),
            inject: [UNIT_OF_WORK, CORE_PROFILE_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: CORE_PROFILE_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: CoreProfileRepository,
                mutations: RevisionMutationService<CoreProfileState, DomainEvent>,
            ) => new CoreProfileCommands({ unitOfWork, repository, mutations, generateId: randomUUID }),
            inject: [UNIT_OF_WORK, CORE_PROFILE_REPOSITORY, CORE_PROFILE_MUTATION_SERVICE],
        },
        {
            provide: CORE_PROFILE_REVISION_HANDLER,
            useFactory: (mutations: RevisionMutationService<CoreProfileState, DomainEvent>, revisions: RevisionStore) =>
                new CoreProfileRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [CORE_PROFILE_MUTATION_SERVICE, REVISION_STORE],
        },
        CoreProfileRevisionRegistrar,
    ],
    exports: [PROFILE_MODULE_DEFINITION, PROFILE_READER],
})
export class ProfileModule {}
