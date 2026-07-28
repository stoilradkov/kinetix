import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    TRAINING_INJURY_REVISION_HANDLER,
    type TrainingInjuryRevisionHandler,
} from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class TrainingInjuryRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(TRAINING_INJURY_REVISION_HANDLER)
        private readonly handler: TrainingInjuryRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
