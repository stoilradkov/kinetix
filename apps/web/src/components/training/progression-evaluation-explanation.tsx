import type { ProgressionEvaluationExplanation } from "@kinetix/types";

import { Badge } from "@/components/ui/badge";

const OPERATOR_LABELS: Record<string, string> = {
    eq: "=",
    neq: "≠",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    between: "between",
};

function formatValue(value: number | readonly [number, number] | boolean | null): string {
    if (value === null) return "—";
    if (Array.isArray(value)) return `${value[0]} – ${value[1]}`;
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
}

/**
 * Read-only recursive renderer for an evaluation's matched/unmatched explanation tree. Each node is
 * tinted by whether it matched (green) or not (muted), and metric leaves show the observed value, the
 * comparand, and whether the input was missing — the evidence behind the verdict (design §15.3, PRD PG-7).
 */
export function ExplanationTree({ node }: { node: ProgressionEvaluationExplanation }): React.JSX.Element {
    if (node.kind === "metric") {
        return (
            <div className="flex flex-wrap items-center gap-2 py-1 font-mono text-sm tabular-nums">
                <Badge variant={node.matched ? "success" : "secondary"}>{node.matched ? "met" : "unmet"}</Badge>
                <span className="text-foreground">{node.metricKey}</span>
                <span className="text-muted-foreground">{OPERATOR_LABELS[node.operator] ?? node.operator}</span>
                <span className="text-foreground">{formatValue(node.comparand)}</span>
                {node.missing ? (
                    <Badge variant="warning">missing input</Badge>
                ) : (
                    <span className="text-muted-foreground">observed {formatValue(node.observed)}</span>
                )}
            </div>
        );
    }
    if (node.kind === "not") {
        return (
            <div className="border-border ml-2 border-l pl-3">
                <Badge variant={node.matched ? "success" : "secondary"}>NOT</Badge>
                <div className="mt-1">
                    <ExplanationTree node={node.child} />
                </div>
            </div>
        );
    }
    return (
        <div className="border-border ml-2 border-l pl-3">
            <Badge variant={node.matched ? "success" : "secondary"}>{node.kind === "all" ? "ALL OF" : "ANY OF"}</Badge>
            <div className="mt-1 space-y-1">
                {node.children.map((child, index) => (
                    <ExplanationTree key={index} node={child} />
                ))}
            </div>
        </div>
    );
}
