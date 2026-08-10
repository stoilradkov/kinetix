import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    PROJECT_RUNNING_RECORDS,
    RUNNING_RECORD_SESSION_EVENT_NAMES,
    RunningRecordsOutboxHandler,
    RunningRecordsProjectionJobHandler,
    type ProjectRunningRecords,
} from "#src/modules/training/application/index";
import { JOB_QUEUE, JobHandlerRegistry, OutboxHandlerRegistry, type JobQueue } from "#src/platform/application/index";

/** Registers the running-records projection job handler with the platform job registry (issue #46, A4). */
@Injectable()
export class RunningRecordsJobRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: JobHandlerRegistry,
        @Inject(PROJECT_RUNNING_RECORDS) private readonly project: ProjectRunningRecords,
    ) {}

    onModuleInit(): void {
        this.registry.register(new RunningRecordsProjectionJobHandler(this.project));
    }
}

/**
 * Registers one outbox handler per session-lifecycle event (issue #46, A4; design §16.3, §16.8). Each
 * enqueues a session-keyed running-records projection job, coalescing a burst of edits into one recompute.
 */
@Injectable()
export class RunningRecordsOutboxRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: OutboxHandlerRegistry,
        @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    ) {}

    onModuleInit(): void {
        for (const eventName of RUNNING_RECORD_SESSION_EVENT_NAMES) {
            this.registry.register(new RunningRecordsOutboxHandler(eventName, this.queue));
        }
    }
}
