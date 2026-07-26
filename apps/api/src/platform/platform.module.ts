import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { DatabaseModule } from "#src/database/database.module";
import {
    IDEMPOTENCY_REPOSITORY,
    IDEMPOTENT_COMMAND_EXECUTOR,
    IdempotentCommandExecutor,
    REVISION_STORE,
    RevisionResourceRegistry,
    UNIT_OF_WORK,
    type IdempotencyRepository,
    type UnitOfWork,
} from "#src/platform/application/index";
import { DrizzleIdempotencyRepository } from "#src/platform/infrastructure/drizzle-idempotency-repository";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";
import { ApiContextInterceptor, ApiExceptionFilter, RevisionController } from "#src/platform/presentation/index";

@Global()
@Module({
    imports: [DatabaseModule],
    controllers: [RevisionController],
    providers: [
        DrizzleRevisionStore,
        DrizzleIdempotencyRepository,
        RevisionResourceRegistry,
        { provide: REVISION_STORE, useExisting: DrizzleRevisionStore },
        { provide: IDEMPOTENCY_REPOSITORY, useExisting: DrizzleIdempotencyRepository },
        {
            provide: IDEMPOTENT_COMMAND_EXECUTOR,
            useFactory: (unitOfWork: UnitOfWork, records: IdempotencyRepository) =>
                new IdempotentCommandExecutor(unitOfWork, records),
            inject: [UNIT_OF_WORK, IDEMPOTENCY_REPOSITORY],
        },
        { provide: APP_INTERCEPTOR, useClass: ApiContextInterceptor },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
    ],
    exports: [REVISION_STORE, RevisionResourceRegistry, IDEMPOTENCY_REPOSITORY, IDEMPOTENT_COMMAND_EXECUTOR],
})
export class PlatformModule {}
