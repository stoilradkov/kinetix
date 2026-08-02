import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    TRAINING_SESSION_REVISION_HANDLER,
    type TrainingSessionRevisionHandler,
} from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class TrainingSessionRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(TRAINING_SESSION_REVISION_HANDLER)
        private readonly handler: TrainingSessionRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
