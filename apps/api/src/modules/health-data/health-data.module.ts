import { Module } from "@nestjs/common";

import { healthDataModuleDefinition } from "#src/modules/health-data/application/index.js";

export const HEALTH_DATA_MODULE_DEFINITION = Symbol("HEALTH_DATA_MODULE_DEFINITION");

@Module({
    providers: [
        {
            provide: HEALTH_DATA_MODULE_DEFINITION,
            useValue: healthDataModuleDefinition,
        },
    ],
    exports: [HEALTH_DATA_MODULE_DEFINITION],
})
export class HealthDataModule {}
