import { Module } from "@nestjs/common";

import { trainingModuleDefinition } from "#src/modules/training/application/index";

export const TRAINING_MODULE_DEFINITION = Symbol("TRAINING_MODULE_DEFINITION");

@Module({
    providers: [
        {
            provide: TRAINING_MODULE_DEFINITION,
            useValue: trainingModuleDefinition,
        },
    ],
    exports: [TRAINING_MODULE_DEFINITION],
})
export class TrainingModule {}
