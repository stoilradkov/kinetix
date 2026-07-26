import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import { EXERCISE_REVISION_HANDLER, type ExerciseRevisionHandler } from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class ExerciseRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(EXERCISE_REVISION_HANDLER)
        private readonly handler: ExerciseRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
