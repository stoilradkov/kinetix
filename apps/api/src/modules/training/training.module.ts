import { Module } from "@nestjs/common";

import {
    SEED_TRAINING_CATALOG,
    TRAINING_CATALOG_QUERIES,
    TRAINING_CATALOG_READER,
    TRAINING_CATALOG_SEED_REPOSITORY,
    SeedTrainingCatalog,
    TrainingCatalogQueries,
    trainingModuleDefinition,
    type TrainingCatalogReader,
    type TrainingCatalogSeedRepository,
} from "#src/modules/training/application/index";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { trainingCatalogSeed } from "#src/modules/training/infrastructure/seed/training-catalog";
import { TrainingCatalogSeedRunner } from "#src/modules/training/infrastructure/seed/training-catalog-runner";
import { TrainingCatalogController } from "#src/modules/training/presentation/index";
import { UNIT_OF_WORK, type UnitOfWork } from "#src/platform/application/index";

export const TRAINING_MODULE_DEFINITION = Symbol("TRAINING_MODULE_DEFINITION");

@Module({
    controllers: [TrainingCatalogController],
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
        TrainingCatalogSeedRunner,
    ],
    exports: [TRAINING_MODULE_DEFINITION, TRAINING_CATALOG_QUERIES],
})
export class TrainingModule {}
