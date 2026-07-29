import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import { GEAR_ITEM_REVISION_HANDLER, type GearItemRevisionHandler } from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class GearItemRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(GEAR_ITEM_REVISION_HANDLER)
        private readonly handler: GearItemRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
