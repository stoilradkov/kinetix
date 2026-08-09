import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    PROGRESSION_RULE_REVISION_HANDLER,
    type ProgressionRuleRevisionHandler,
} from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class ProgressionRuleRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(PROGRESSION_RULE_REVISION_HANDLER)
        private readonly handler: ProgressionRuleRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
