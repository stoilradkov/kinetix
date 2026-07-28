import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    HEALTH_RECORD_REVISION_HANDLER,
    type ManualHealthRecordRevisionHandler,
} from "#src/modules/health-data/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class HealthRecordRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(HEALTH_RECORD_REVISION_HANDLER)
        private readonly handler: ManualHealthRecordRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
