import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    MetricCalculatorRegistry,
    PROJECT_RUNNING_METRICS,
    RUNNING_METRIC_SESSION_EVENT_NAMES,
    RunningMetricsOutboxHandler,
    RunningMetricsProjectionJobHandler,
    type ProjectRunningMetrics,
} from "#src/modules/training/application/index";
import { RUNNING_CALCULATORS } from "#src/modules/training/domain/index";
import { JOB_QUEUE, JobHandlerRegistry, OutboxHandlerRegistry, type JobQueue } from "#src/platform/application/index";

/**
 * Registers the A4 running calculators on the shared metric-calculator registry (issue #46; design §16.1).
 * Both the discovery projection and the generic A1 rebuild resolve calculators from here by `key.vN`.
 */
@Injectable()
export class RunningCalculatorRegistrar implements OnModuleInit {
    constructor(@Inject(MetricCalculatorRegistry) private readonly registry: MetricCalculatorRegistry) {}

    onModuleInit(): void {
        for (const calculator of RUNNING_CALCULATORS) this.registry.register(calculator);
    }
}

/** Registers the running projection job handler with the platform job registry (design §16.3, §17). */
@Injectable()
export class RunningMetricsJobRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: JobHandlerRegistry,
        @Inject(PROJECT_RUNNING_METRICS) private readonly project: ProjectRunningMetrics,
    ) {}

    onModuleInit(): void {
        this.registry.register(new RunningMetricsProjectionJobHandler(this.project));
    }
}

/**
 * Registers one outbox handler per session-lifecycle event (issue #46, A4; design §16.3). Each enqueues a
 * session-keyed running projection job, coalescing a burst of edits into a single recompute.
 */
@Injectable()
export class RunningMetricsOutboxRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: OutboxHandlerRegistry,
        @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    ) {}

    onModuleInit(): void {
        for (const eventName of RUNNING_METRIC_SESSION_EVENT_NAMES) {
            this.registry.register(new RunningMetricsOutboxHandler(eventName, this.queue));
        }
    }
}
