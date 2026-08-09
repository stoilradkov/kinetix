import type { ProgressionAction, ProgressionCondition } from "@kinetix/types";

import { Badge } from "@/components/ui/badge";
import { describeAction } from "@/lib/progression-rule";

const OPERATOR_LABELS: Record<string, string> = {
    eq: "=",
    neq: "≠",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    between: "between",
};

function formatValue(value: number | readonly [number, number] | boolean): string {
    if (Array.isArray(value)) return `${value[0]} – ${value[1]}`;
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
}

/** Read-only recursive renderer for a bounded condition AST (all/any/not + metric leaves). */
export function ConditionTree({ condition }: { condition: ProgressionCondition }): React.JSX.Element {
    if (condition.kind === "metric") {
        const window = condition.metric.window
            ? ` over ${condition.metric.window.value} ${condition.metric.window.kind}`
            : "";
        return (
            <div className="flex flex-wrap items-center gap-2 py-1 font-mono text-sm tabular-nums">
                <Badge variant="outline">{condition.metric.scope}</Badge>
                <span className="text-foreground">{condition.metric.key}</span>
                <span className="text-muted-foreground">
                    {OPERATOR_LABELS[condition.operator] ?? condition.operator}
                </span>
                <span className="text-foreground">{formatValue(condition.value)}</span>
                {window ? <span className="text-muted-foreground">{window}</span> : null}
            </div>
        );
    }
    if (condition.kind === "not") {
        return (
            <div className="border-border ml-2 border-l pl-3">
                <Badge variant="secondary">NOT</Badge>
                <div className="mt-1">
                    <ConditionTree condition={condition.condition} />
                </div>
            </div>
        );
    }
    return (
        <div className="border-border ml-2 border-l pl-3">
            <Badge variant="secondary">{condition.kind === "all" ? "ALL OF" : "ANY OF"}</Badge>
            <div className="mt-1 space-y-1">
                {condition.conditions.map((child, index) => (
                    <ConditionTree key={index} condition={child} />
                ))}
            </div>
        </div>
    );
}

/** Read-only list of proposed actions. */
export function ActionList({ actions }: { actions: readonly ProgressionAction[] }): React.JSX.Element {
    return (
        <ul className="space-y-1">
            {actions.map((action, index) => (
                <li key={index} className="flex items-center gap-2 text-sm">
                    <Badge variant="info">{action.type}</Badge>
                    <span className="text-muted-foreground">{describeAction(action)}</span>
                </li>
            ))}
        </ul>
    );
}
