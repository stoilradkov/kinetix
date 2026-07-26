import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import type { JobWorker, OutboxDispatcher } from "#src/platform/application/index";

export class DurableWorkerHost implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(DurableWorkerHost.name);
    private timer: NodeJS.Timeout | null = null;
    private stopping = false;

    constructor(
        private readonly jobs: JobWorker,
        private readonly outbox: OutboxDispatcher,
        private readonly config: ConfigService,
    ) {}

    onApplicationBootstrap(): void {
        if (!this.config.getOrThrow<boolean>("WORKERS_ENABLED")) {
            this.logger.log("PostgreSQL durable workers are disabled");
            return;
        }
        this.logger.log("Starting PostgreSQL job and outbox workers");
        this.schedule(0);
    }

    onApplicationShutdown(): void {
        this.stopping = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    private schedule(delayMs: number): void {
        this.timer = setTimeout(() => {
            void this.tick();
        }, delayMs);
    }

    private async tick(): Promise<void> {
        if (this.stopping) return;
        try {
            const [jobs, events] = await Promise.all([this.jobs.runOnce(), this.outbox.runOnce()]);
            if (jobs + events > 0) this.logger.debug(`Processed jobs=${jobs} outboxEvents=${events}`);
        } catch (error) {
            this.logger.error("Durable worker polling failed", error instanceof Error ? error.stack : String(error));
        } finally {
            if (!this.stopping) this.schedule(this.config.getOrThrow<number>("WORKER_POLL_INTERVAL_MS"));
        }
    }
}
