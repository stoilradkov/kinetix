import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    EVALUATE_PROGRESSION,
    PROGRESSION_SESSION_EVENT_NAMES,
    ProgressionEvaluationJobHandler,
    SessionProgressionOutboxHandler,
    type EvaluateProgression,
} from "#src/modules/training/application/index";
import { JOB_QUEUE, JobHandlerRegistry, OutboxHandlerRegistry, type JobQueue } from "#src/platform/application/index";

/**
 * Registers the progression evaluation job handler with the platform job registry (issue #40, G2).
 * The durable worker looks handlers up by `jobType.vN`.
 */
@Injectable()
export class ProgressionEvaluationJobRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: JobHandlerRegistry,
        @Inject(EVALUATE_PROGRESSION) private readonly evaluate: EvaluateProgression,
    ) {}

    onModuleInit(): void {
        this.registry.register(new ProgressionEvaluationJobHandler(this.evaluate));
    }
}

/**
 * Registers the progression outbox handlers (issue #40, G2; design §15.3, §17.3). Session facts enqueue
 * an evaluation when their invalidation metadata marks progression stale; one handler is registered per
 * event name so the worker dispatches by `eventName.vN`.
 */
@Injectable()
export class ProgressionEvaluationOutboxRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: OutboxHandlerRegistry,
        @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    ) {}

    onModuleInit(): void {
        for (const eventName of PROGRESSION_SESSION_EVENT_NAMES) {
            this.registry.register(new SessionProgressionOutboxHandler(eventName, this.queue));
        }
    }
}
