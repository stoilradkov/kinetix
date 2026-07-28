import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    TRAINING_GOAL_REVISION_HANDLER,
    type TrainingGoalRevisionHandler,
} from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class TrainingGoalRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(TRAINING_GOAL_REVISION_HANDLER)
        private readonly handler: TrainingGoalRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
