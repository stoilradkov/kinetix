import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    PERSONAL_RECORD_SESSION_EVENT_NAMES,
    PROJECT_PERSONAL_RECORDS,
    PersonalRecordsOutboxHandler,
    PersonalRecordsProjectionJobHandler,
    type ProjectPersonalRecords,
} from "#src/modules/training/application/index";
import { JOB_QUEUE, JobHandlerRegistry, OutboxHandlerRegistry, type JobQueue } from "#src/platform/application/index";

/** Registers the personal-records projection job handler with the platform job registry (issue #45, A3). */
@Injectable()
export class PersonalRecordsJobRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: JobHandlerRegistry,
        @Inject(PROJECT_PERSONAL_RECORDS) private readonly project: ProjectPersonalRecords,
    ) {}

    onModuleInit(): void {
        this.registry.register(new PersonalRecordsProjectionJobHandler(this.project));
    }
}

/**
 * Registers one outbox handler per session-lifecycle event (issue #45, A3; design §16.3, §16.8). Each
 * enqueues a session-keyed personal-records projection job, coalescing a burst of edits into one recompute.
 */
@Injectable()
export class PersonalRecordsOutboxRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: OutboxHandlerRegistry,
        @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    ) {}

    onModuleInit(): void {
        for (const eventName of PERSONAL_RECORD_SESSION_EVENT_NAMES) {
            this.registry.register(new PersonalRecordsOutboxHandler(eventName, this.queue));
        }
    }
}
