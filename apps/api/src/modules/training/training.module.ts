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
    TRAINING_GOAL_COMMANDS,
    TRAINING_GOAL_MUTATION_SERVICE,
    TRAINING_GOAL_REPOSITORY,
    TRAINING_GOAL_REVISION_HANDLER,
    TrainingGoalCommands,
    TrainingGoalRevisionHandler,
    TRAINING_INJURY_COMMANDS,
    TRAINING_INJURY_MUTATION_SERVICE,
    TRAINING_INJURY_REPOSITORY,
    TRAINING_INJURY_REVISION_HANDLER,
    TrainingInjuryCommands,
    TrainingInjuryRevisionHandler,
    exerciseDefinitionSerializer,
    trainingProfileSerializer,
    trainingGoalSerializer,
    trainingInjurySerializer,
    trainingModuleDefinition,
    type TrainingProfileRepository,
    type TrainingGoalRepository,
    type TrainingInjuryRepository,
    type InjuryCatalogReader,
    type ExerciseRepository,
    type ExerciseMergeRepository,
    type ExerciseReferenceUpdater,
    type TrainingCatalogReader,
    type TrainingCatalogSeedRepository,
} from "#src/modules/training/application/index";
import type {
    ExerciseDefinitionState,
    TrainingGoalState,
    TrainingInjuryState,
    TrainingProfileState,
} from "#src/modules/training/domain/index";
import { PROFILE_READER, ProfileModule, type ProfileReader } from "#src/modules/profile/index";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { DrizzleTrainingProfileRepository } from "#src/modules/training/infrastructure/drizzle-training-profile-repository";
import { TrainingProfileRevisionRegistrar } from "#src/modules/training/infrastructure/training-profile-revision-registrar";
import { DrizzleTrainingGoalRepository } from "#src/modules/training/infrastructure/drizzle-training-goal-repository";
import { TrainingGoalRevisionRegistrar } from "#src/modules/training/infrastructure/training-goal-revision-registrar";
import { DrizzleTrainingInjuryRepository } from "#src/modules/training/infrastructure/drizzle-training-injury-repository";
import { TrainingInjuryRevisionRegistrar } from "#src/modules/training/infrastructure/training-injury-revision-registrar";
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
    TrainingGoalController,
    TrainingInjuryController,
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
        TrainingGoalController,
        TrainingInjuryController,
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
        DrizzleTrainingGoalRepository,
        { provide: TRAINING_GOAL_REPOSITORY, useExisting: DrizzleTrainingGoalRepository },
        {
            provide: TRAINING_GOAL_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: TrainingGoalRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, trainingGoalSerializer, events),
            inject: [UNIT_OF_WORK, TRAINING_GOAL_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: TRAINING_GOAL_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: TrainingGoalRepository,
                mutations: RevisionMutationService<TrainingGoalState, DomainEvent>,
                profileReader: ProfileReader,
            ) =>
                new TrainingGoalCommands({
                    unitOfWork,
                    repository,
                    mutations,
                    profileReader,
                    generateId: randomUUID,
                }),
            inject: [UNIT_OF_WORK, TRAINING_GOAL_REPOSITORY, TRAINING_GOAL_MUTATION_SERVICE, PROFILE_READER],
        },
        {
            provide: TRAINING_GOAL_REVISION_HANDLER,
            useFactory: (
                mutations: RevisionMutationService<TrainingGoalState, DomainEvent>,
                revisions: RevisionStore,
            ) => new TrainingGoalRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [TRAINING_GOAL_MUTATION_SERVICE, REVISION_STORE],
        },
        TrainingGoalRevisionRegistrar,
        DrizzleTrainingInjuryRepository,
        { provide: TRAINING_INJURY_REPOSITORY, useExisting: DrizzleTrainingInjuryRepository },
        {
            provide: TRAINING_INJURY_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: TrainingInjuryRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, trainingInjurySerializer, events),
            inject: [UNIT_OF_WORK, TRAINING_INJURY_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: TRAINING_INJURY_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: TrainingInjuryRepository,
                mutations: RevisionMutationService<TrainingInjuryState, DomainEvent>,
                profileReader: ProfileReader,
                catalog: InjuryCatalogReader,
            ) =>
                new TrainingInjuryCommands({
                    unitOfWork,
                    repository,
                    mutations,
                    profileReader,
                    catalog,
                    generateId: randomUUID,
                }),
            inject: [
                UNIT_OF_WORK,
                TRAINING_INJURY_REPOSITORY,
                TRAINING_INJURY_MUTATION_SERVICE,
                PROFILE_READER,
                TRAINING_CATALOG_READER,
            ],
        },
        {
            provide: TRAINING_INJURY_REVISION_HANDLER,
            useFactory: (
                mutations: RevisionMutationService<TrainingInjuryState, DomainEvent>,
                revisions: RevisionStore,
            ) => new TrainingInjuryRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [TRAINING_INJURY_MUTATION_SERVICE, REVISION_STORE],
        },
        TrainingInjuryRevisionRegistrar,
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
