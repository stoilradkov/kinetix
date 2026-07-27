import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import { CORE_PROFILE_REVISION_HANDLER, type CoreProfileRevisionHandler } from "#src/modules/profile/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class CoreProfileRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(CORE_PROFILE_REVISION_HANDLER)
        private readonly handler: CoreProfileRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
