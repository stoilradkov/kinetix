import { Global, Module } from "@nestjs/common";

import { DatabaseService } from "#src/database/database.service";
import { UNIT_OF_WORK } from "#src/platform/application/index";
import { DatabaseUnitOfWork } from "#src/platform/infrastructure/database-unit-of-work";

@Global()
@Module({
    providers: [DatabaseService, DatabaseUnitOfWork, { provide: UNIT_OF_WORK, useExisting: DatabaseUnitOfWork }],
    exports: [DatabaseService, UNIT_OF_WORK],
})
export class DatabaseModule {}
