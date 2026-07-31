import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import { PROGRAM_REVISION_HANDLER, type ProgramRevisionHandler } from "#src/modules/training/application/index";
import { RevisionResourceRegistry } from "#src/platform/application/index";

@Injectable()
export class ProgramRevisionRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: RevisionResourceRegistry,
        @Inject(PROGRAM_REVISION_HANDLER)
        private readonly handler: ProgramRevisionHandler,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.handler);
    }
}
