import { Inject, Injectable } from "@nestjs/common";

import { HEALTH_CONTEXT_READER, type HealthContextReader } from "#src/modules/health-data/index";
import type { ProgressionHealthReader } from "#src/modules/training/application/index";

/**
 * Reads sleep context for a session through the public {@link HealthContextReader} port — never the
 * Health Data tables (ADR 0005, design §16.3). Sleep points are stored in minutes; this adapter returns
 * the most recent point over the day up to and including the session date, converted to hours, or `null`
 * when nothing was recorded so the safety policies treat sleep as a missing input.
 */
@Injectable()
export class DrizzleProgressionHealthReader implements ProgressionHealthReader {
    constructor(@Inject(HEALTH_CONTEXT_READER) private readonly health: HealthContextReader) {}

    async readSleepHours(_profileId: string, localDate: string): Promise<number | null> {
        const day = new Date(`${localDate}T00:00:00.000Z`);
        if (Number.isNaN(day.getTime())) return null;
        const from = new Date(day.getTime() - 24 * 3_600_000).toISOString();
        const to = new Date(day.getTime() + 24 * 3_600_000 - 1).toISOString();
        const window = await this.health.readWindow({ type: "sleep", from, to });
        if (!window.available || window.points.length === 0) return null;
        const latest = window.points.reduce((newest, point) =>
            point.effectiveAt > newest.effectiveAt ? point : newest,
        );
        return latest.value === null ? null : latest.value / 60;
    }
}
