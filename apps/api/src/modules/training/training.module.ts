import { randomUUID } from "node:crypto";

import { Module } from "@nestjs/common";

import {
    EXERCISE_CATALOG_COMMANDS,
    EXERCISE_MERGE_REPOSITORY,
    EXERCISE_MERGE_SERVICE,
    EXERCISE_MUTATION_SERVICE,
    EXERCISE_REFERENCE_UPDATER,
    EXERCISE_REPOSITORY,
    EXERCISE_REVISION_HANDLER,
    SEED_TRAINING_CATALOG,
    TRAINING_CATALOG_QUERIES,
    TRAINING_CATALOG_READER,
    TRAINING_CATALOG_SEED_REPOSITORY,
    TRAINING_EXERCISE_CATALOG,
    ExerciseCatalogCommands,
    ExerciseMergeService,
    ExerciseRevisionHandler,
    SeedTrainingCatalog,
    TrainingExerciseCatalog,
    TrainingCatalogQueries,
    TRAINING_PROFILE_COMMANDS,
    TRAINING_PROFILE_MUTATION_SERVICE,
    TRAINING_PROFILE_REPOSITORY,
    TRAINING_PROFILE_REVISION_HANDLER,
    TrainingProfileCommands,
    TrainingProfileRevisionHandler,
    exerciseDefinitionSerializer,
    trainingProfileSerializer,
    trainingModuleDefinition,
    type TrainingProfileRepository,
    type ExerciseRepository,
    type ExerciseMergeRepository,
    type ExerciseReferenceUpdater,
    type TrainingCatalogReader,
    type TrainingCatalogSeedRepository,
} from "#src/modules/training/application/index";
import type { ExerciseDefinitionState, TrainingProfileState } from "#src/modules/training/domain/index";
import { PROFILE_READER, ProfileModule, type ProfileReader } from "#src/modules/profile/index";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { DrizzleTrainingProfileRepository } from "#src/modules/training/infrastructure/drizzle-training-profile-repository";
import { TrainingProfileRevisionRegistrar } from "#src/modules/training/infrastructure/training-profile-revision-registrar";
import {
    DrizzleExerciseMergeRepository,
    DrizzleExerciseReferenceUpdater,
} from "#src/modules/training/infrastructure/drizzle-exercise-merge-repository";
import { ExerciseRevisionRegistrar } from "#src/modules/training/infrastructure/exercise-revision-registrar";
import { trainingCatalogSeed } from "#src/modules/training/infrastructure/seed/training-catalog";
import { TrainingCatalogSeedRunner } from "#src/modules/training/infrastructure/seed/training-catalog-runner";
import {
    ExerciseDefinitionController,
    ExerciseMergeController,
    TrainingCatalogController,
    TrainingProfileController,
} from "#src/modules/training/presentation/index";
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

export const TRAINING_MODULE_DEFINITION = Symbol("TRAINING_MODULE_DEFINITION");

@Module({
    imports: [ProfileModule],
    controllers: [
        TrainingCatalogController,
        ExerciseDefinitionController,
        ExerciseMergeController,
        TrainingProfileController,
    ],
    providers: [
        DrizzleTrainingCatalogRepository,
        DrizzleExerciseMergeRepository,
        DrizzleExerciseReferenceUpdater,
        DrizzleTrainingProfileRepository,
        { provide: TRAINING_PROFILE_REPOSITORY, useExisting: DrizzleTrainingProfileRepository },
        {
            provide: TRAINING_PROFILE_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: TrainingProfileRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, trainingProfileSerializer, events),
            inject: [UNIT_OF_WORK, TRAINING_PROFILE_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: TRAINING_PROFILE_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: TrainingProfileRepository,
                mutations: RevisionMutationService<TrainingProfileState, DomainEvent>,
                profileReader: ProfileReader,
            ) =>
                new TrainingProfileCommands({
                    unitOfWork,
                    repository,
                    mutations,
                    profileReader,
                    generateId: randomUUID,
                }),
            inject: [UNIT_OF_WORK, TRAINING_PROFILE_REPOSITORY, TRAINING_PROFILE_MUTATION_SERVICE, PROFILE_READER],
        },
        {
            provide: TRAINING_PROFILE_REVISION_HANDLER,
            useFactory: (
                mutations: RevisionMutationService<TrainingProfileState, DomainEvent>,
                revisions: RevisionStore,
            ) => new TrainingProfileRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [TRAINING_PROFILE_MUTATION_SERVICE, REVISION_STORE],
        },
        TrainingProfileRevisionRegistrar,
        {
            provide: TRAINING_MODULE_DEFINITION,
            useValue: trainingModuleDefinition,
        },
        {
            provide: TRAINING_CATALOG_SEED_REPOSITORY,
            useExisting: DrizzleTrainingCatalogRepository,
        },
        {
            provide: TRAINING_CATALOG_READER,
            useExisting: DrizzleTrainingCatalogRepository,
        },
        {
            provide: EXERCISE_REPOSITORY,
            useExisting: DrizzleTrainingCatalogRepository,
        },
        {
            provide: EXERCISE_MERGE_REPOSITORY,
            useExisting: DrizzleExerciseMergeRepository,
        },
        {
            provide: EXERCISE_REFERENCE_UPDATER,
            useExisting: DrizzleExerciseReferenceUpdater,
        },
        {
            provide: SEED_TRAINING_CATALOG,
            useFactory: (unitOfWork: UnitOfWork, repository: TrainingCatalogSeedRepository) =>
                new SeedTrainingCatalog(unitOfWork, repository, trainingCatalogSeed, { now: () => new Date() }),
            inject: [UNIT_OF_WORK, TRAINING_CATALOG_SEED_REPOSITORY],
        },
        {
            provide: TRAINING_CATALOG_QUERIES,
            useFactory: (reader: TrainingCatalogReader) => new TrainingCatalogQueries(reader),
            inject: [TRAINING_CATALOG_READER],
        },
        {
            provide: EXERCISE_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: ExerciseRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, exerciseDefinitionSerializer, events),
            inject: [UNIT_OF_WORK, EXERCISE_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: EXERCISE_CATALOG_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: ExerciseRepository,
                mutations: RevisionMutationService<ExerciseDefinitionState, DomainEvent>,
            ) =>
                new ExerciseCatalogCommands({
                    unitOfWork,
                    repository,
                    mutations,
                    generateId: randomUUID,
                }),
            inject: [UNIT_OF_WORK, EXERCISE_REPOSITORY, EXERCISE_MUTATION_SERVICE],
        },
        {
            provide: TRAINING_EXERCISE_CATALOG,
            useFactory: (repository: ExerciseRepository, revisions: RevisionStore, merges: ExerciseMergeRepository) =>
                new TrainingExerciseCatalog(repository, revisions, merges),
            inject: [EXERCISE_REPOSITORY, REVISION_STORE, EXERCISE_MERGE_REPOSITORY],
        },
        {
            provide: EXERCISE_MERGE_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                exercises: ExerciseRepository,
                merges: ExerciseMergeRepository,
                references: ExerciseReferenceUpdater,
                mutations: RevisionMutationService<ExerciseDefinitionState, DomainEvent>,
                events: OutboxWriter,
            ) =>
                new ExerciseMergeService({
                    unitOfWork,
                    exercises,
                    merges,
                    references,
                    mutations,
                    events,
                    generateId: randomUUID,
                }),
            inject: [
                UNIT_OF_WORK,
                EXERCISE_REPOSITORY,
                EXERCISE_MERGE_REPOSITORY,
                EXERCISE_REFERENCE_UPDATER,
                EXERCISE_MUTATION_SERVICE,
                OUTBOX_WRITER,
            ],
        },
        {
            provide: EXERCISE_REVISION_HANDLER,
            useFactory: (
                mutations: RevisionMutationService<ExerciseDefinitionState, DomainEvent>,
                revisions: RevisionStore,
            ) => new ExerciseRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [EXERCISE_MUTATION_SERVICE, REVISION_STORE],
        },
        ExerciseRevisionRegistrar,
        TrainingCatalogSeedRunner,
    ],
    exports: [TRAINING_MODULE_DEFINITION, TRAINING_CATALOG_QUERIES, TRAINING_EXERCISE_CATALOG],
})
export class TrainingModule {}
