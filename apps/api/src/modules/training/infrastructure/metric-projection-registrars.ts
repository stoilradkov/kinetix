import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import {
    ANALYTICS_INVALIDATION_STORE,
    DERIVED_METRIC_REPOSITORY,
    METRIC_CONTEXT_EVENT_NAMES,
    METRIC_EXERCISE_EVENT_NAMES,
    METRIC_INVALIDATION_READER,
    METRIC_PLAN_EVENT_NAMES,
    METRIC_SESSION_EVENT_NAMES,
    METRIC_ZONE_EVENT_NAMES,
    MetricFullRebuildJobHandler,
    MetricInvalidationOutboxHandler,
    MetricRebuildJobHandler,
    REBUILD_METRICS,
    type AnalyticsInvalidationStore,
    type DerivedMetricRepository,
    type MetricInvalidationReader,
    type RebuildMetrics,
} from "#src/modules/training/application/index";
import type { SourceChange } from "#src/modules/training/domain/index";
import { JOB_QUEUE, JobHandlerRegistry, OutboxHandlerRegistry, type JobQueue } from "#src/platform/application/index";

/**
 * Registers the derived-metric rebuild job handlers (issue #43, A1). Both the targeted (invalidation-drain)
 * and scheduled/manual full-sweep jobs recompute through the same idempotent calculators; the durable
 * worker looks handlers up by `jobType.vN`.
 */
@Injectable()
export class MetricRebuildJobRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: JobHandlerRegistry,
        @Inject(REBUILD_METRICS) private readonly rebuild: RebuildMetrics,
    ) {}

    onModuleInit(): void {
        this.registry.register(new MetricRebuildJobHandler(this.rebuild));
        this.registry.register(new MetricFullRebuildJobHandler(this.rebuild));
    }
}

/** Every invalidation-triggering event paired with the source-change kind it maps to (design §16.3). */
const INVALIDATION_EVENTS: readonly { readonly eventName: string; readonly kind: SourceChange["kind"] }[] = [
    ...METRIC_SESSION_EVENT_NAMES.map(eventName => ({ eventName, kind: "session" as const })),
    ...METRIC_EXERCISE_EVENT_NAMES.map(eventName => ({ eventName, kind: "exercise" as const })),
    ...METRIC_CONTEXT_EVENT_NAMES.map(eventName => ({ eventName, kind: "context" as const })),
    ...METRIC_ZONE_EVENT_NAMES.map(eventName => ({ eventName, kind: "zone" as const })),
    ...METRIC_PLAN_EVENT_NAMES.map(eventName => ({ eventName, kind: "plan" as const })),
];

/**
 * Registers one outbox handler per invalidation-triggering event (issue #43, A1; design §16.3). Each
 * handler translates a committed fact into coalesced invalidation scopes, appends them to the durable
 * queue, marks the affected current projections stale, and enqueues a coalesced rebuild job.
 */
@Injectable()
export class MetricInvalidationOutboxRegistrar implements OnModuleInit {
    constructor(
        private readonly registry: OutboxHandlerRegistry,
        @Inject(JOB_QUEUE) private readonly queue: JobQueue,
        @Inject(ANALYTICS_INVALIDATION_STORE) private readonly store: AnalyticsInvalidationStore,
        @Inject(DERIVED_METRIC_REPOSITORY) private readonly repository: DerivedMetricRepository,
        @Inject(METRIC_INVALIDATION_READER) private readonly reader: MetricInvalidationReader,
    ) {}

    onModuleInit(): void {
        for (const { eventName, kind } of INVALIDATION_EVENTS) {
            this.registry.register(
                new MetricInvalidationOutboxHandler(eventName, kind, {
                    store: this.store,
                    repository: this.repository,
                    queue: this.queue,
                    reader: this.reader,
                }),
            );
        }
    }
}
