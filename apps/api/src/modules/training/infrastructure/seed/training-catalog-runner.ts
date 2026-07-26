import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

import { SEED_TRAINING_CATALOG, type SeedTrainingCatalog } from "#src/modules/training/application/index";

@Injectable()
export class TrainingCatalogSeedRunner implements OnApplicationBootstrap {
    private readonly logger = new Logger(TrainingCatalogSeedRunner.name);

    constructor(
        @Inject(SEED_TRAINING_CATALOG)
        private readonly seedCatalog: SeedTrainingCatalog,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const result = await this.seedCatalog.execute();
        this.logger.log(
            `Training catalog ready: created=${result.created} updated=${result.updated} ` +
                `unchanged=${result.unchanged} archived=${result.archived} userConflicts=${result.userConflicts.length}`,
        );
        if (result.userConflicts.length > 0)
            this.logger.warn(`Skipped user-owned catalog collisions: ${result.userConflicts.join(", ")}`);
    }
}
