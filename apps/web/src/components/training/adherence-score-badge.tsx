import type { AdherenceResultResponse, AdherenceStatusValue } from "@kinetix/types";

import { Badge } from "@/components/ui/badge";

type BadgeVariant = "success" | "warning" | "destructive" | "info" | "outline";

/** Colour a 0–100 score by band — green on target, amber under, red badly missed; muted when unscored. */
function scoreVariant(overall: number | null): BadgeVariant {
    if (overall === null) return "outline";
    if (overall >= 90) return "success";
    if (overall >= 70) return "warning";
    return "destructive";
}

const staleStatus: Partial<Record<AdherenceStatusValue, string>> = {
    stale: "stale",
    pending: "recalculating",
    failed: "recompute failed",
};

/**
 * Compact adherence indicator for dense lists such as the program hub (issue #38, AD2). Shows the overall
 * percentage banded by the Kinetic-Calm status tokens, plus a muted staleness note when the stored result
 * no longer reflects the current session. Renders nothing when a session has no adherence result yet.
 */
export function AdherenceScoreBadge({
    result,
}: {
    readonly result: AdherenceResultResponse | undefined;
}): React.JSX.Element | null {
    if (result === undefined) return null;
    const stale = staleStatus[result.status];
    return (
        <span className="flex items-center gap-1" title={stale ? `Adherence ${stale}` : "Adherence"}>
            <Badge variant={scoreVariant(result.overall)}>{result.overall === null ? "—" : `${result.overall}%`}</Badge>
            {stale !== undefined ? <span className="text-muted-foreground text-xs">{stale}</span> : null}
        </span>
    );
}
