import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    ADHERENCE_INPUT_READER,
    ADHERENCE_PLAN_EVENT_NAMES,
    ADHERENCE_SESSION_EVENT_NAMES,
    AdherenceRecalculationJobHandler,
    CALCULATE_ADHERENCE,
    PlannedSessionAdherenceOutboxHandler,
    SessionAdherenceOutboxHandler,
    type AdherenceInputReader,
    type CalculateAdherence,
} from "#src/modules/training/application/index";
import { JOB_QUEUE, JobHandlerRegistry, OutboxHandlerRegistry, type JobQueue } from "#src/platform/application/index";

/**
 * Registers the adherence recompute job handler with the platform job registry (issue #37, AD1). This is
 * the first job consumer in the codebase; the durable worker looks handlers up by `jobType.vN`.
 */
@Injectable()
export class AdherenceJobRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: JobHandlerRegistry,
        @Inject(CALCULATE_ADHERENCE) private readonly calculate: CalculateAdherence,
    ) {}

    onModuleInit(): void {
        this.registry.register(new AdherenceRecalculationJobHandler(this.calculate));
    }
}

/**
 * Registers the adherence outbox handlers (issue #37, AD1; design §16.3). Session/mapping facts enqueue
 * a recompute when their invalidation metadata marks adherence stale; planned-session changes fan out a
 * recompute to every actual session mapped to the plan. One handler is registered per event name.
 */
@Injectable()
export class AdherenceOutboxRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: OutboxHandlerRegistry,
        @Inject(JOB_QUEUE) private readonly queue: JobQueue,
        @Inject(ADHERENCE_INPUT_READER) private readonly reader: AdherenceInputReader,
    ) {}

    onModuleInit(): void {
        for (const eventName of ADHERENCE_SESSION_EVENT_NAMES) {
            this.registry.register(new SessionAdherenceOutboxHandler(eventName, this.queue));
        }
        for (const eventName of ADHERENCE_PLAN_EVENT_NAMES) {
            this.registry.register(new PlannedSessionAdherenceOutboxHandler(eventName, this.queue, this.reader));
        }
    }
}
