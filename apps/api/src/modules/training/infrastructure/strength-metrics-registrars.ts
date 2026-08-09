import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    MetricCalculatorRegistry,
    PROJECT_STRENGTH_METRICS,
    STRENGTH_METRIC_SESSION_EVENT_NAMES,
    StrengthMetricsOutboxHandler,
    StrengthMetricsProjectionJobHandler,
    type ProjectStrengthMetrics,
} from "#src/modules/training/application/index";
import { STRENGTH_CALCULATORS } from "#src/modules/training/domain/index";
import { JOB_QUEUE, JobHandlerRegistry, OutboxHandlerRegistry, type JobQueue } from "#src/platform/application/index";

/**
 * Registers the A2 strength calculators on the shared metric-calculator registry (issue #44; design
 * §16.1). Until this runs the production registry is empty; both the discovery projection and the generic
 * A1 rebuild resolve calculators from here by `key.vN`.
 */
@Injectable()
export class StrengthCalculatorRegistrar implements OnModuleInit {
    constructor(@Inject(MetricCalculatorRegistry) private readonly registry: MetricCalculatorRegistry) {}

    onModuleInit(): void {
        for (const calculator of STRENGTH_CALCULATORS) this.registry.register(calculator);
    }
}

/** Registers the strength projection job handler with the platform job registry (design §16.3, §17). */
@Injectable()
export class StrengthMetricsJobRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: JobHandlerRegistry,
        @Inject(PROJECT_STRENGTH_METRICS) private readonly project: ProjectStrengthMetrics,
    ) {}

    onModuleInit(): void {
        this.registry.register(new StrengthMetricsProjectionJobHandler(this.project));
    }
}

/**
 * Registers one outbox handler per session-lifecycle event (issue #44, A2; design §16.3). Each enqueues a
 * session-keyed strength projection job, coalescing a burst of edits into a single recompute.
 */
@Injectable()
export class StrengthMetricsOutboxRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: OutboxHandlerRegistry,
        @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    ) {}

    onModuleInit(): void {
        for (const eventName of STRENGTH_METRIC_SESSION_EVENT_NAMES) {
            this.registry.register(new StrengthMetricsOutboxHandler(eventName, this.queue));
        }
    }
}
