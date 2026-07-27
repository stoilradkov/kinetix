import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    TRAINING_PROFILE_REVISION_HANDLER,
    type TrainingProfileRevisionHandler,
} from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class TrainingProfileRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(TRAINING_PROFILE_REVISION_HANDLER)
        private readonly handler: TrainingProfileRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
