import type { MetricContextReader } from "#src/modules/training/application/index";
import type { MetricTarget } from "#src/modules/training/domain/index";

/**
 * The single {@link MetricContextReader} the generic A1 rebuild framework resolves facts through, composed
 * from the per-family readers (issue #46, A4). The generic rebuild passes the calculator key it is
 * recomputing, but a `session`/`profile-*` scope alone cannot tell a strength metric from a running metric
 * (both share those scope types). So this composite routes purely by calculator-key prefix — `running.*`
 * calculators resolve through the running reader, everything else through the strength reader — and each
 * concrete reader still returns `null` for a scope it does not own. It holds no persistence of its own; it
 * only delegates, so the fingerprints it yields are exactly those of the reader it routed to.
 */
export class CompositeMetricContextReader implements MetricContextReader {
    constructor(
        private readonly strength: MetricContextReader,
        private readonly running: MetricContextReader,
    ) {}

    load(
        calculatorKey: string,
        target: MetricTarget,
        transaction?: unknown,
    ): Promise<{ facts: unknown; config: Readonly<Record<string, unknown>> } | null> {
        const reader = calculatorKey.startsWith("running.") ? this.running : this.strength;
        return reader.load(calculatorKey, target, transaction);
    }
}
