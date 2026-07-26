import { Module } from "@nestjs/common";

import { DatabaseModule } from "#src/database/database.module";
import { REVISION_STORE, RevisionResourceRegistry } from "#src/platform/application/index";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";
import { RevisionController } from "#src/platform/presentation/index";

@Module({
    imports: [DatabaseModule],
    controllers: [RevisionController],
    providers: [
        DrizzleRevisionStore,
        RevisionResourceRegistry,
        { provide: REVISION_STORE, useExisting: DrizzleRevisionStore },
    ],
    exports: [REVISION_STORE, RevisionResourceRegistry],
})
export class PlatformModule {}
