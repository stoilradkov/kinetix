import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { DatabaseModule } from "#src/database/database.module";
import {
    IDEMPOTENCY_REPOSITORY,
    IDEMPOTENT_COMMAND_EXECUTOR,
    IdempotentCommandExecutor,
    HANDLER_RECEIPTS,
    JOB_LEASE_STORE,
    JOB_QUEUE,
    JOB_STATUS_READER,
    JobHandlerRegistry,
    JobWorker,
    OUTBOX_LEASE_STORE,
    OUTBOX_WRITER,
    OutboxDispatcher,
    OutboxHandlerRegistry,
    REVISION_STORE,
    RetryPolicy,
    SCHEDULER_LOCK,
    RevisionResourceRegistry,
    UNIT_OF_WORK,
    type HandlerReceiptStore,
    type IdempotencyRepository,
    type JobLeaseStore,
    type OutboxLeaseStore,
    type UnitOfWork,
} from "#src/platform/application/index";
import { DrizzleHandlerReceiptStore } from "#src/platform/infrastructure/drizzle-handler-receipt-store";
import { DrizzleIdempotencyRepository } from "#src/platform/infrastructure/drizzle-idempotency-repository";
import { DrizzleJobStore } from "#src/platform/infrastructure/drizzle-job-store";
import { DrizzleOutboxStore } from "#src/platform/infrastructure/drizzle-outbox-store";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";
import { DurableWorkerHost } from "#src/platform/infrastructure/durable-worker-host";
import { PostgresAdvisorySchedulerLock } from "#src/platform/infrastructure/postgres-advisory-scheduler-lock";
import {
    ApiContextInterceptor,
    ApiExceptionFilter,
    JobController,
    RevisionController,
} from "#src/platform/presentation/index";

const DURABLE_WORKER_ID = Symbol("DURABLE_WORKER_ID");

@Global()
@Module({
    imports: [DatabaseModule],
    controllers: [JobController, RevisionController],
    providers: [
        DrizzleRevisionStore,
        DrizzleIdempotencyRepository,
        DrizzleJobStore,
        DrizzleOutboxStore,
        DrizzleHandlerReceiptStore,
        PostgresAdvisorySchedulerLock,
        RevisionResourceRegistry,
        JobHandlerRegistry,
        OutboxHandlerRegistry,
        RetryPolicy,
        { provide: REVISION_STORE, useExisting: DrizzleRevisionStore },
        { provide: IDEMPOTENCY_REPOSITORY, useExisting: DrizzleIdempotencyRepository },
        { provide: JOB_QUEUE, useExisting: DrizzleJobStore },
        { provide: JOB_STATUS_READER, useExisting: DrizzleJobStore },
        { provide: JOB_LEASE_STORE, useExisting: DrizzleJobStore },
        { provide: OUTBOX_WRITER, useExisting: DrizzleOutboxStore },
        { provide: OUTBOX_LEASE_STORE, useExisting: DrizzleOutboxStore },
        { provide: HANDLER_RECEIPTS, useExisting: DrizzleHandlerReceiptStore },
        { provide: SCHEDULER_LOCK, useExisting: PostgresAdvisorySchedulerLock },
        {
            provide: DURABLE_WORKER_ID,
            useFactory: (config: ConfigService) =>
                config.get<string>("WORKER_ID") ?? `${hostname()}:${process.pid}:${randomUUID()}`,
            inject: [ConfigService],
        },
        {
            provide: IDEMPOTENT_COMMAND_EXECUTOR,
            useFactory: (unitOfWork: UnitOfWork, records: IdempotencyRepository) =>
                new IdempotentCommandExecutor(unitOfWork, records),
            inject: [UNIT_OF_WORK, IDEMPOTENCY_REPOSITORY],
        },
        {
            provide: JobWorker,
            useFactory: (
                store: JobLeaseStore,
                handlers: JobHandlerRegistry,
                receipts: HandlerReceiptStore,
                unitOfWork: UnitOfWork,
                retryPolicy: RetryPolicy,
                workerId: string,
                config: ConfigService,
            ) =>
                new JobWorker(store, handlers, receipts, unitOfWork, retryPolicy, {
                    workerId,
                    leaseDurationMs: config.getOrThrow<number>("WORKER_LEASE_DURATION_MS"),
                    batchSize: config.getOrThrow<number>("WORKER_BATCH_SIZE"),
                }),
            inject: [
                JOB_LEASE_STORE,
                JobHandlerRegistry,
                HANDLER_RECEIPTS,
                UNIT_OF_WORK,
                RetryPolicy,
                DURABLE_WORKER_ID,
                ConfigService,
            ],
        },
        {
            provide: OutboxDispatcher,
            useFactory: (
                store: OutboxLeaseStore,
                handlers: OutboxHandlerRegistry,
                receipts: HandlerReceiptStore,
                unitOfWork: UnitOfWork,
                retryPolicy: RetryPolicy,
                workerId: string,
                config: ConfigService,
            ) =>
                new OutboxDispatcher(store, handlers, receipts, unitOfWork, retryPolicy, {
                    workerId,
                    leaseDurationMs: config.getOrThrow<number>("WORKER_LEASE_DURATION_MS"),
                    batchSize: config.getOrThrow<number>("WORKER_BATCH_SIZE"),
                }),
            inject: [
                OUTBOX_LEASE_STORE,
                OutboxHandlerRegistry,
                HANDLER_RECEIPTS,
                UNIT_OF_WORK,
                RetryPolicy,
                DURABLE_WORKER_ID,
                ConfigService,
            ],
        },
        {
            provide: DurableWorkerHost,
            useFactory: (jobs: JobWorker, outbox: OutboxDispatcher, config: ConfigService) =>
                new DurableWorkerHost(jobs, outbox, config),
            inject: [JobWorker, OutboxDispatcher, ConfigService],
        },
        { provide: APP_INTERCEPTOR, useClass: ApiContextInterceptor },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
    ],
    exports: [
        REVISION_STORE,
        RevisionResourceRegistry,
        IDEMPOTENCY_REPOSITORY,
        IDEMPOTENT_COMMAND_EXECUTOR,
        JOB_QUEUE,
        JOB_STATUS_READER,
        OUTBOX_WRITER,
        SCHEDULER_LOCK,
        JobHandlerRegistry,
        OutboxHandlerRegistry,
    ],
})
export class PlatformModule {}
