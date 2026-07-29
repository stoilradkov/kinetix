import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    EQUIPMENT_INCREMENT_REVISION_HANDLER,
    type EquipmentIncrementRevisionHandler,
} from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class EquipmentIncrementRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(EQUIPMENT_INCREMENT_REVISION_HANDLER)
        private readonly handler: EquipmentIncrementRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
