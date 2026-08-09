import { Injectable } from "@nestjs/common";

import type { MetricContextReader } from "#src/modules/training/application/index";
import type { MetricTarget } from "#src/modules/training/domain/index";

/**
 * The default metric context reader for the A1 framework (issue #43). No production calculators are
 * registered yet, so nothing needs loading; the strength/running/1RM slices (A2–A4) replace this with a
 * composite reader that dispatches to the per-calculator context builders. Returning `null` here means a
 * recompute for an unknown calculator retires any stored projection rather than fabricating facts.
 */
@Injectable()
export class EmptyMetricContextReader implements MetricContextReader {
    load(
        calculatorKey: string,
        target: MetricTarget,
    ): Promise<{ facts: unknown; config: Readonly<Record<string, unknown>> } | null> {
        void calculatorKey;
        void target;
        return Promise.resolve(null);
    }
}
