import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    WORKOUT_TEMPLATE_REVISION_HANDLER,
    type WorkoutTemplateRevisionHandler,
} from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class WorkoutTemplateRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(WORKOUT_TEMPLATE_REVISION_HANDLER)
        private readonly handler: WorkoutTemplateRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
