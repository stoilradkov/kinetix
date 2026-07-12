import { Module } from "@nestjs/common";

import { profileModuleDefinition } from "#src/modules/profile/application/index";

export const PROFILE_MODULE_DEFINITION = Symbol("PROFILE_MODULE_DEFINITION");

@Module({
    providers: [{ provide: PROFILE_MODULE_DEFINITION, useValue: profileModuleDefinition }],
    exports: [PROFILE_MODULE_DEFINITION],
})
export class ProfileModule {}
