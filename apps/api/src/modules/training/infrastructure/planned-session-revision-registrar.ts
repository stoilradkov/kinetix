import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    PLANNED_SESSION_REVISION_HANDLER,
    type PlannedSessionRevisionHandler,
} from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class PlannedSessionRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(PLANNED_SESSION_REVISION_HANDLER)
        private readonly handler: PlannedSessionRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
