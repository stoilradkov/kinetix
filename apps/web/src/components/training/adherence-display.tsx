import type {
    AdherenceComponentKeyValue,
    AdherenceExclusionReasonValue,
    AdherenceFormulaResponse,
    AdherenceResultResponse,
    AdherenceStatusValue,
} from "@kinetix/types";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

type BadgeVariant = "success" | "warning" | "destructive" | "info" | "outline" | "secondary";

const componentLabels: Record<AdherenceComponentKeyValue, string> = {
    session_completion: "Session completion",
    activity_completion: "Activity completion",
    exercise_completion: "Exercise completion",
    set_completion: "Set completion",
    reps: "Repetitions",
    load: "Load",
    volume: "Volume",
    duration: "Duration",
    distance: "Distance",
    pace: "Pace / power",
    step_completion: "Step completion",
    intensity: "RPE / RIR intensity",
};

const exclusionLabels: Record<AdherenceExclusionReasonValue, string> = {
    missing_target: "no target",
    missing_actual: "not recorded",
    non_comparable: "not comparable",
    cancelled: "cancelled",
    no_load_model: "no load model",
    no_mapped_work: "no mapped work",
};

const statusVariant: Record<AdherenceStatusValue, BadgeVariant> = {
    current: "outline",
    stale: "warning",
    pending: "info",
    failed: "destructive",
};

const statusLabel: Record<AdherenceStatusValue, string> = {
    current: "up to date",
    stale: "stale",
    pending: "recalculating",
    failed: "recompute failed",
};

/** Colour a 0–100 score by band — green on target, amber under, red badly missed; muted when excluded. */
function scoreVariant(score: number | null, included: boolean): BadgeVariant {
    if (!included || score === null) return "outline";
    if (score >= 90) return "success";
    if (score >= 70) return "warning";
    return "destructive";
}

/** Added/substituted work reported as divergence across the result's components (never lowers completion). */
function divergence(result: AdherenceResultResponse): { added: number; substituted: number } {
    let added = 0;
    let substituted = 0;
    for (const component of result.components) {
        for (const [key, value] of Object.entries(component.inputs)) {
            if (typeof value !== "number") continue;
            if (key === "substituted") substituted += value;
            else if (key.startsWith("added")) added += value;
        }
    }
    return { added, substituted };
}

/**
 * Read-only adherence display (issue #38, AD2; design §16.7). Renders each stored result — overall
 * percentage, weighted components with their scores/weights, exclusions, added/substituted divergence,
 * per-component evidence, the formula version, and a stale/pending/failed label — without recomputing any
 * score. All numbers use the tabular-mono treatment; score bands map to Kinetic-Calm status tokens.
 */
export function AdherenceDisplay({
    results,
    formula,
}: {
    readonly results: readonly AdherenceResultResponse[];
    readonly formula?: AdherenceFormulaResponse | null;
}): React.JSX.Element {
    return (
        <div className="grid gap-4">
            {results.map(result => (
                <AdherenceResultCard formula={formula} key={result.id} result={result} />
            ))}
        </div>
    );
}

function AdherenceResultCard({
    result,
    formula,
}: {
    readonly result: AdherenceResultResponse;
    readonly formula?: AdherenceFormulaResponse | null;
}): React.JSX.Element {
    const overall = result.overall;
    const diverge = divergence(result);
    return (
        <div className="border-border grid gap-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-2xl font-semibold tabular-nums">
                        {overall === null ? "—" : `${overall}%`}
                    </span>
                    <Badge variant={statusVariant[result.status]}>{statusLabel[result.status]}</Badge>
                    <Badge variant="secondary">{result.scope}</Badge>
                </div>
                <span className="text-muted-foreground font-mono text-xs">{result.formula}</span>
            </div>

            <Progress value={overall ?? 0} />

            {result.plannedSessionTitle !== null ? (
                <p className="text-muted-foreground text-sm">
                    vs planned <span className="text-foreground">{result.plannedSessionTitle}</span>
                </p>
            ) : null}

            {diverge.added > 0 || diverge.substituted > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                    {diverge.substituted > 0 ? <Badge variant="info">{diverge.substituted} substituted</Badge> : null}
                    {diverge.added > 0 ? <Badge variant="info">{diverge.added} added</Badge> : null}
                    <span className="text-muted-foreground text-xs">reported as divergence, not penalised</span>
                </div>
            ) : null}

            <dl className="grid gap-1.5">
                {result.components.map(component => (
                    <div className="flex items-center justify-between gap-2 text-sm" key={component.key}>
                        <dt className="text-muted-foreground flex items-center gap-1.5">
                            {componentLabels[component.key]}
                            {component.weight > 0 ? (
                                <span className="text-muted-foreground/70 font-mono text-xs tabular-nums">
                                    ×{component.weight}
                                </span>
                            ) : (
                                <span className="text-muted-foreground/70 text-xs">info</span>
                            )}
                        </dt>
                        <dd>
                            {component.included && component.score !== null ? (
                                <Badge variant={scoreVariant(component.score, component.included)}>
                                    {component.score}
                                </Badge>
                            ) : (
                                <Badge variant="outline">
                                    {component.exclusion === null ? "excluded" : exclusionLabels[component.exclusion]}
                                </Badge>
                            )}
                        </dd>
                    </div>
                ))}
            </dl>

            {result.exclusions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Excluded from the score:</span>
                    {result.exclusions.map(reason => (
                        <Badge key={reason} variant="outline">
                            {exclusionLabels[reason]}
                        </Badge>
                    ))}
                </div>
            ) : null}

            <Accordion collapsible type="single">
                <AccordionItem value="evidence">
                    <AccordionTrigger className="text-sm">Evidence & formula</AccordionTrigger>
                    <AccordionContent>
                        <div className="grid gap-3">
                            {result.components.map(component => (
                                <div className="grid gap-1" key={component.key}>
                                    <p className="text-xs font-medium">{componentLabels[component.key]}</p>
                                    <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                                        {Object.entries(component.inputs).map(([key, value]) => (
                                            <div className="flex justify-between gap-2" key={key}>
                                                <dt>{key}</dt>
                                                <dd className="font-mono tabular-nums">{formatEvidence(value)}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                            ))}
                            {formula ? (
                                <p className="text-muted-foreground text-xs">
                                    <span className="text-foreground font-mono">{formula.formula}</span> ·{" "}
                                    {formula.scoring}
                                </p>
                            ) : null}
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );
}

function formatEvidence(value: unknown): string {
    if (value === null) return "—";
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
}
