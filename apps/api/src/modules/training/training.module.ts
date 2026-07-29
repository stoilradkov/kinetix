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
    TRAINING_MAX_COMMANDS,
    TRAINING_MAX_QUERIES,
    TRAINING_MAX_REPOSITORY,
    TRAINING_TARGET_CONTEXT_READER,
    TrainingMaxCommands,
    TrainingMaxQueries,
    RepositoryTrainingTargetContextReader,
    type TrainingMaxCatalogReader,
    type TrainingMaxRepository,
    ZONE_DEFINITION_COMMANDS,
    ZONE_DEFINITION_QUERIES,
    ZONE_DEFINITION_REPOSITORY,
    ZONE_CONTEXT_READER,
    ZoneDefinitionCommands,
    ZoneDefinitionQueries,
    RepositoryZoneContextReader,
    type ZoneDefinitionRepository,
    EQUIPMENT_INCREMENT_COMMANDS,
    EQUIPMENT_INCREMENT_MUTATION_SERVICE,
    EQUIPMENT_INCREMENT_QUERIES,
    EQUIPMENT_INCREMENT_REPOSITORY,
    EQUIPMENT_INCREMENT_REVISION_HANDLER,
    EquipmentIncrementCommands,
    EquipmentIncrementQueries,
    EquipmentIncrementRevisionHandler,
    equipmentIncrementSerializer,
    type EquipmentIncrementCatalogReader,
    type EquipmentIncrementRepository,
    GEAR_ITEM_COMMANDS,
    GEAR_ITEM_MUTATION_SERVICE,
    GEAR_ITEM_REPOSITORY,
    GEAR_ITEM_REVISION_HANDLER,
    GearItemCommands,
    GearItemRevisionHandler,
    gearItemSerializer,
    type GearItemRepository,
    SESSION_PRESCRIPTION_REPOSITORY,
    PRESCRIPTION_PUBLISHER,
    PRESCRIPTION_CLONER,
    PrescriptionPublisher,
    PrescriptionCloner,
    type SessionPrescriptionRepository,
    WORKOUT_TEMPLATE_REPOSITORY,
    WORKOUT_TEMPLATE_MUTATION_SERVICE,
    WORKOUT_TEMPLATE_COMMANDS,
    WORKOUT_TEMPLATE_REVISION_HANDLER,
    WORKOUT_TEMPLATE_PLANNING_READER,
    WorkoutTemplateCommands,
    WorkoutTemplateRevisionHandler,
    RepositoryWorkoutTemplatePlanningReader,
    workoutTemplateSerializer,
    type WorkoutTemplateRepository,
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
    EquipmentIncrementState,
    GearItemState,
    TrainingGoalState,
    TrainingInjuryState,
    TrainingProfileState,
    WorkoutTemplateState,
} from "#src/modules/training/domain/index";
import { PROFILE_READER, ProfileModule, type ProfileReader } from "#src/modules/profile/index";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { DrizzleTrainingProfileRepository } from "#src/modules/training/infrastructure/drizzle-training-profile-repository";
import { TrainingProfileRevisionRegistrar } from "#src/modules/training/infrastructure/training-profile-revision-registrar";
import { DrizzleTrainingGoalRepository } from "#src/modules/training/infrastructure/drizzle-training-goal-repository";
import { TrainingGoalRevisionRegistrar } from "#src/modules/training/infrastructure/training-goal-revision-registrar";
import { DrizzleTrainingInjuryRepository } from "#src/modules/training/infrastructure/drizzle-training-injury-repository";
import { TrainingInjuryRevisionRegistrar } from "#src/modules/training/infrastructure/training-injury-revision-registrar";
import { DrizzleTrainingMaxRepository } from "#src/modules/training/infrastructure/drizzle-training-max-repository";
import { DrizzleZoneDefinitionRepository } from "#src/modules/training/infrastructure/drizzle-zone-definition-repository";
import { DrizzleEquipmentIncrementRepository } from "#src/modules/training/infrastructure/drizzle-equipment-increment-repository";
import { EquipmentIncrementRevisionRegistrar } from "#src/modules/training/infrastructure/equipment-increment-revision-registrar";
import { DrizzleGearItemRepository } from "#src/modules/training/infrastructure/drizzle-gear-item-repository";
import { GearItemRevisionRegistrar } from "#src/modules/training/infrastructure/gear-item-revision-registrar";
import { DrizzleSessionPrescriptionRepository } from "#src/modules/training/infrastructure/drizzle-session-prescription-repository";
import { DrizzleWorkoutTemplateRepository } from "#src/modules/training/infrastructure/drizzle-workout-template-repository";
import { WorkoutTemplateRevisionRegistrar } from "#src/modules/training/infrastructure/workout-template-revision-registrar";
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
    TrainingMaxController,
    ZoneDefinitionController,
    EquipmentIncrementController,
    GearItemController,
    WorkoutTemplateController,
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
        TrainingMaxController,
        ZoneDefinitionController,
        EquipmentIncrementController,
        GearItemController,
        WorkoutTemplateController,
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
        DrizzleTrainingMaxRepository,
        { provide: TRAINING_MAX_REPOSITORY, useExisting: DrizzleTrainingMaxRepository },
        {
            provide: TRAINING_MAX_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: TrainingMaxRepository,
                catalog: TrainingMaxCatalogReader,
                outbox: OutboxWriter,
                profileReader: ProfileReader,
            ) =>
                new TrainingMaxCommands({
                    unitOfWork,
                    repository,
                    catalog,
                    outbox,
                    profileReader,
                    generateId: randomUUID,
                }),
            inject: [UNIT_OF_WORK, TRAINING_MAX_REPOSITORY, TRAINING_CATALOG_READER, OUTBOX_WRITER, PROFILE_READER],
        },
        {
            provide: TRAINING_MAX_QUERIES,
            useFactory: (repository: TrainingMaxRepository, profileReader: ProfileReader) =>
                new TrainingMaxQueries(repository, profileReader),
            inject: [TRAINING_MAX_REPOSITORY, PROFILE_READER],
        },
        {
            provide: TRAINING_TARGET_CONTEXT_READER,
            useFactory: (repository: TrainingMaxRepository) => new RepositoryTrainingTargetContextReader(repository),
            inject: [TRAINING_MAX_REPOSITORY],
        },
        DrizzleZoneDefinitionRepository,
        { provide: ZONE_DEFINITION_REPOSITORY, useExisting: DrizzleZoneDefinitionRepository },
        {
            provide: ZONE_DEFINITION_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: ZoneDefinitionRepository,
                outbox: OutboxWriter,
                profileReader: ProfileReader,
            ) => new ZoneDefinitionCommands({ unitOfWork, repository, outbox, profileReader, generateId: randomUUID }),
            inject: [UNIT_OF_WORK, ZONE_DEFINITION_REPOSITORY, OUTBOX_WRITER, PROFILE_READER],
        },
        {
            provide: ZONE_DEFINITION_QUERIES,
            useFactory: (repository: ZoneDefinitionRepository, profileReader: ProfileReader) =>
                new ZoneDefinitionQueries(repository, profileReader),
            inject: [ZONE_DEFINITION_REPOSITORY, PROFILE_READER],
        },
        {
            provide: ZONE_CONTEXT_READER,
            useFactory: (repository: ZoneDefinitionRepository) => new RepositoryZoneContextReader(repository),
            inject: [ZONE_DEFINITION_REPOSITORY],
        },
        DrizzleEquipmentIncrementRepository,
        { provide: EQUIPMENT_INCREMENT_REPOSITORY, useExisting: DrizzleEquipmentIncrementRepository },
        {
            provide: EQUIPMENT_INCREMENT_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: EquipmentIncrementRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, equipmentIncrementSerializer, events),
            inject: [UNIT_OF_WORK, EQUIPMENT_INCREMENT_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: EQUIPMENT_INCREMENT_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: EquipmentIncrementRepository,
                mutations: RevisionMutationService<EquipmentIncrementState, DomainEvent>,
                profileReader: ProfileReader,
                catalog: EquipmentIncrementCatalogReader,
            ) =>
                new EquipmentIncrementCommands({
                    unitOfWork,
                    repository,
                    mutations,
                    profileReader,
                    catalog,
                    generateId: randomUUID,
                }),
            inject: [
                UNIT_OF_WORK,
                EQUIPMENT_INCREMENT_REPOSITORY,
                EQUIPMENT_INCREMENT_MUTATION_SERVICE,
                PROFILE_READER,
                TRAINING_CATALOG_READER,
            ],
        },
        {
            provide: EQUIPMENT_INCREMENT_QUERIES,
            useFactory: (
                repository: EquipmentIncrementRepository,
                profileReader: ProfileReader,
                catalog: EquipmentIncrementCatalogReader,
            ) => new EquipmentIncrementQueries(repository, profileReader, catalog),
            inject: [EQUIPMENT_INCREMENT_REPOSITORY, PROFILE_READER, TRAINING_CATALOG_READER],
        },
        {
            provide: EQUIPMENT_INCREMENT_REVISION_HANDLER,
            useFactory: (
                mutations: RevisionMutationService<EquipmentIncrementState, DomainEvent>,
                revisions: RevisionStore,
            ) => new EquipmentIncrementRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [EQUIPMENT_INCREMENT_MUTATION_SERVICE, REVISION_STORE],
        },
        EquipmentIncrementRevisionRegistrar,
        DrizzleGearItemRepository,
        { provide: GEAR_ITEM_REPOSITORY, useExisting: DrizzleGearItemRepository },
        {
            provide: GEAR_ITEM_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: GearItemRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, gearItemSerializer, events),
            inject: [UNIT_OF_WORK, GEAR_ITEM_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: GEAR_ITEM_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: GearItemRepository,
                mutations: RevisionMutationService<GearItemState, DomainEvent>,
                profileReader: ProfileReader,
            ) => new GearItemCommands({ unitOfWork, repository, mutations, profileReader, generateId: randomUUID }),
            inject: [UNIT_OF_WORK, GEAR_ITEM_REPOSITORY, GEAR_ITEM_MUTATION_SERVICE, PROFILE_READER],
        },
        {
            provide: GEAR_ITEM_REVISION_HANDLER,
            useFactory: (mutations: RevisionMutationService<GearItemState, DomainEvent>, revisions: RevisionStore) =>
                new GearItemRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [GEAR_ITEM_MUTATION_SERVICE, REVISION_STORE],
        },
        GearItemRevisionRegistrar,
        DrizzleSessionPrescriptionRepository,
        { provide: SESSION_PRESCRIPTION_REPOSITORY, useExisting: DrizzleSessionPrescriptionRepository },
        {
            provide: PRESCRIPTION_PUBLISHER,
            useFactory: (unitOfWork: UnitOfWork, repository: SessionPrescriptionRepository, outbox: OutboxWriter) =>
                new PrescriptionPublisher({ unitOfWork, repository, outbox, generateId: randomUUID }),
            inject: [UNIT_OF_WORK, SESSION_PRESCRIPTION_REPOSITORY, OUTBOX_WRITER],
        },
        {
            provide: PRESCRIPTION_CLONER,
            useFactory: (unitOfWork: UnitOfWork, repository: SessionPrescriptionRepository, outbox: OutboxWriter) =>
                new PrescriptionCloner({ unitOfWork, repository, outbox, generateId: randomUUID }),
            inject: [UNIT_OF_WORK, SESSION_PRESCRIPTION_REPOSITORY, OUTBOX_WRITER],
        },
        DrizzleWorkoutTemplateRepository,
        { provide: WORKOUT_TEMPLATE_REPOSITORY, useExisting: DrizzleWorkoutTemplateRepository },
        {
            provide: WORKOUT_TEMPLATE_MUTATION_SERVICE,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: WorkoutTemplateRepository,
                revisions: RevisionStore,
                events: OutboxWriter,
            ) => new RevisionMutationService(unitOfWork, repository, revisions, workoutTemplateSerializer, events),
            inject: [UNIT_OF_WORK, WORKOUT_TEMPLATE_REPOSITORY, REVISION_STORE, OUTBOX_WRITER],
        },
        {
            provide: WORKOUT_TEMPLATE_COMMANDS,
            useFactory: (
                unitOfWork: UnitOfWork,
                repository: WorkoutTemplateRepository,
                mutations: RevisionMutationService<WorkoutTemplateState, DomainEvent>,
                publisher: PrescriptionPublisher,
                prescriptions: SessionPrescriptionRepository,
                profileReader: ProfileReader,
            ) =>
                new WorkoutTemplateCommands({
                    unitOfWork,
                    repository,
                    mutations,
                    publisher,
                    prescriptions,
                    profileReader,
                    generateId: randomUUID,
                }),
            inject: [
                UNIT_OF_WORK,
                WORKOUT_TEMPLATE_REPOSITORY,
                WORKOUT_TEMPLATE_MUTATION_SERVICE,
                PRESCRIPTION_PUBLISHER,
                SESSION_PRESCRIPTION_REPOSITORY,
                PROFILE_READER,
            ],
        },
        {
            provide: WORKOUT_TEMPLATE_REVISION_HANDLER,
            useFactory: (
                mutations: RevisionMutationService<WorkoutTemplateState, DomainEvent>,
                revisions: RevisionStore,
            ) => new WorkoutTemplateRevisionHandler(mutations, revisions, { now: () => new Date() }, randomUUID),
            inject: [WORKOUT_TEMPLATE_MUTATION_SERVICE, REVISION_STORE],
        },
        {
            provide: WORKOUT_TEMPLATE_PLANNING_READER,
            useFactory: (
                repository: WorkoutTemplateRepository,
                prescriptions: SessionPrescriptionRepository,
                cloner: PrescriptionCloner,
            ) => new RepositoryWorkoutTemplatePlanningReader(repository, prescriptions, cloner),
            inject: [WORKOUT_TEMPLATE_REPOSITORY, SESSION_PRESCRIPTION_REPOSITORY, PRESCRIPTION_CLONER],
        },
        WorkoutTemplateRevisionRegistrar,
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
    exports: [
        TRAINING_MODULE_DEFINITION,
        TRAINING_CATALOG_QUERIES,
        TRAINING_EXERCISE_CATALOG,
        TRAINING_TARGET_CONTEXT_READER,
        ZONE_CONTEXT_READER,
        WORKOUT_TEMPLATE_PLANNING_READER,
    ],
})
export class TrainingModule {}
