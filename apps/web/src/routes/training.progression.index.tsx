import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { progressionEvaluationsQueryOptions } from "@/lib/api";
import { describeAction } from "@/lib/progression-rule";

const QUEUE_VIEWS = ["pending", "blocked", "applied", "rejected"] as const;
type QueueView = (typeof QUEUE_VIEWS)[number];

const searchSchema = z.object({
    status: z.enum(QUEUE_VIEWS).optional().catch(undefined),
});

export const Route = createFileRoute("/training/progression/")({
    component: ApprovalQueuePage,
    validateSearch: searchSchema,
});

function ApprovalQueuePage(): React.JSX.Element {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const view: QueueView = search.status ?? "pending";

    const evaluations = useQuery(progressionEvaluationsQueryOptions(view));

    return (
        <main className="mx-auto max-w-4xl space-y-6 p-6">
            <div>
                <h1 className="text-2xl font-semibold">Progression approvals</h1>
                <p className="text-muted-foreground">
                    Proposed plan changes awaiting your decision. Approving applies the change to a new future revision;
                    history is never rewritten.
                </p>
            </div>

            <Tabs
                onValueChange={value =>
                    navigate({
                        search: previous => ({
                            ...previous,
                            status: value === "pending" ? undefined : (value as QueueView),
                        }),
                    })
                }
                value={view}
            >
                <TabsList>
                    {QUEUE_VIEWS.map(status => (
                        <TabsTrigger key={status} value={status}>
                            {status[0]!.toUpperCase() + status.slice(1)}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            {evaluations.isPending ? (
                <div className="text-muted-foreground flex items-center gap-2 p-8">
                    <LoaderCircle className="size-4 animate-spin" /> Loading proposals…
                </div>
            ) : evaluations.isError ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4">
                    {evaluations.error.message}
                </div>
            ) : evaluations.data.items.length === 0 ? (
                <div className="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center">
                    No {view} proposals.
                </div>
            ) : (
                <ul className="divide-border border-border divide-y rounded-lg border">
                    {evaluations.data.items.map(item => (
                        <li key={item.id}>
                            <Link
                                className="hover:bg-muted/50 flex items-center justify-between gap-4 p-4"
                                params={{ id: item.id }}
                                to="/training/progression/$id"
                            >
                                <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">{item.ruleName}</span>
                                        {item.stale ? <Badge variant="warning">stale</Badge> : null}
                                        {item.conflict.conflicting ? (
                                            <Badge variant="destructive">conflict</Badge>
                                        ) : null}
                                        {item.safety.outcome !== "pass" ? (
                                            <Badge
                                                variant={item.safety.outcome === "block" ? "destructive" : "warning"}
                                            >
                                                safety: {item.safety.outcome}
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <p className="text-muted-foreground truncate text-sm">
                                        {item.scopeType} · {item.target.mode} ·{" "}
                                        {item.actions.map(action => describeAction(action.action)).join("; ")}
                                    </p>
                                </div>
                                <Badge variant="outline">{item.status}</Badge>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
