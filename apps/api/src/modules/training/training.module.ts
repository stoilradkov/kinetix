import { randomUUID } from "node:crypto";

import { Module } from "@nestjs/common";

import {
    EXERCISE_CATALOG_COMMANDS,
    EXERCISE_MUTATION_SERVICE,
    EXERCISE_REPOSITORY,
    EXERCISE_REVISION_HANDLER,
    SEED_TRAINING_CATALOG,
    TRAINING_CATALOG_QUERIES,
    TRAINING_CATALOG_READER,
    TRAINING_CATALOG_SEED_REPOSITORY,
    TRAINING_EXERCISE_CATALOG,
    ExerciseCatalogCommands,
    ExerciseRevisionHandler,
    SeedTrainingCatalog,
    TrainingExerciseCatalog,
    TrainingCatalogQueries,
    exerciseDefinitionSerializer,
    trainingModuleDefinition,
    type ExerciseRepository,
    type TrainingCatalogReader,
    type TrainingCatalogSeedRepository,
} from "#src/modules/training/application/index";
import type { ExerciseDefinitionState } from "#src/modules/training/domain/index";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { ExerciseRevisionRegistrar } from "#src/modules/training/infrastructure/exercise-revision-registrar";
import { trainingCatalogSeed } from "#src/modules/training/infrastructure/seed/training-catalog";
import { TrainingCatalogSeedRunner } from "#src/modules/training/infrastructure/seed/training-catalog-runner";
import { ExerciseDefinitionController, TrainingCatalogController } from "#src/modules/training/presentation/index";
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
    controllers: [TrainingCatalogController, ExerciseDefinitionController],
    providers: [
        DrizzleTrainingCatalogRepository,
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
            useFactory: (repository: ExerciseRepository, revisions: RevisionStore) =>
                new TrainingExerciseCatalog(repository, revisions),
            inject: [EXERCISE_REPOSITORY, REVISION_STORE],
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
