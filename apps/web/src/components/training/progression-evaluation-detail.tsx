import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ChevronLeft, LoaderCircle, X } from "lucide-react";

import type { ProgressionEvaluationResponse, ProgressionEvaluationStatusValue } from "@kinetix/types";

import { ExplanationTree } from "@/components/training/progression-evaluation-explanation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    approveProgressionEvaluation,
    progressionEvaluationQueryOptions,
    rejectProgressionEvaluation,
} from "@/lib/api";
import { describeAction } from "@/lib/progression-rule";

const STATUS_VARIANTS: Record<
    ProgressionEvaluationStatusValue,
    "success" | "info" | "warning" | "destructive" | "secondary"
> = {
    applied: "success",
    pending: "info",
    blocked: "destructive",
    rejected: "secondary",
    unmatched: "secondary",
};

export function ProgressionEvaluationDetailRoute({ evaluationId }: { evaluationId: string }): React.JSX.Element {
    const evaluation = useQuery(progressionEvaluationQueryOptions(evaluationId));
    if (evaluation.isPending)
        return (
            <div className="text-muted-foreground flex items-center gap-2 p-8">
                <LoaderCircle className="size-4 animate-spin" /> Loading proposal…
            </div>
        );
    if (evaluation.isError)
        return (
            <div className="border-destructive/30 bg-destructive/10 text-destructive m-6 rounded-lg border p-4">
                {evaluation.error.message}
            </div>
        );
    return <ProgressionEvaluationDetail evaluation={evaluation.data} />;
}

function ProgressionEvaluationDetail({ evaluation }: { evaluation: ProgressionEvaluationResponse }): React.JSX.Element {
    const queryClient = useQueryClient();
    const [actionError, setActionError] = useState<string | null>(null);

    const invalidate = (): Promise<unknown> =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: ["training-progression-evaluation", evaluation.id] }),
            queryClient.invalidateQueries({ queryKey: ["training-progression-evaluations"] }),
        ]);

    const approve = useMutation({
        mutationFn: () => approveProgressionEvaluation(evaluation.id),
        onSuccess: () => {
            setActionError(null);
            void invalidate();
        },
        onError: error => setActionError(error instanceof Error ? error.message : "Approval failed"),
    });
    const reject = useMutation({
        mutationFn: () => rejectProgressionEvaluation(evaluation.id),
        onSuccess: () => {
            setActionError(null);
            void invalidate();
        },
        onError: error => setActionError(error instanceof Error ? error.message : "Rejection failed"),
    });

    const actionable = evaluation.status === "pending" || evaluation.status === "blocked";
    const busy = approve.isPending || reject.isPending;

    return (
        <div className="mx-auto max-w-3xl space-y-6 p-6">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                    <Link
                        className="text-muted-foreground flex items-center gap-1 text-sm hover:underline"
                        to="/training/progression"
                    >
                        <ChevronLeft className="size-4" /> Approval queue
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl font-semibold">{evaluation.ruleName}</h1>
                        <Badge variant={STATUS_VARIANTS[evaluation.status]}>{evaluation.status}</Badge>
                        {evaluation.stale ? <Badge variant="warning">stale</Badge> : null}
                        {evaluation.conflict.conflicting ? <Badge variant="destructive">conflict</Badge> : null}
                        <Badge variant="outline">rule v{evaluation.ruleVersion}</Badge>
                    </div>
                    <p className="text-muted-foreground text-sm">
                        Triggered by {evaluation.trigger} · session v{evaluation.trainingSessionVersion}
                    </p>
                </div>
                {actionable ? (
                    <div className="flex items-center gap-2">
                        <Button disabled={busy} onClick={() => approve.mutate()} size="sm">
                            <Check className="mr-1 size-4" /> Approve
                        </Button>
                        <Button disabled={busy} onClick={() => reject.mutate()} size="sm" variant="outline">
                            <X className="mr-1 size-4" /> Reject
                        </Button>
                    </div>
                ) : null}
            </div>

            {actionError ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
                    {actionError}
                </div>
            ) : null}

            <Section title="Scope & target">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Detail label="Scope" value={`${evaluation.scopeType} · ${evaluation.scopeId.slice(0, 8)}`} />
                    <Detail label="Target mode" value={evaluation.target.mode} />
                    <Detail
                        label="Selector"
                        value={
                            evaluation.target.selector.kind === "scope"
                                ? "scope element"
                                : `${evaluation.target.selector.kind} · ${evaluation.target.selector.logicalKey.slice(0, 8)}`
                        }
                    />
                    <Detail label="Session" value={evaluation.trainingSessionId.slice(0, 8)} />
                </dl>
            </Section>

            <Section title="Why it matched (evidence)">
                <ExplanationTree node={evaluation.explanation} />
                {evaluation.missingMetrics.length > 0 ? (
                    <p className="text-muted-foreground mt-2 text-xs">
                        Missing metrics: {evaluation.missingMetrics.join(", ")}
                    </p>
                ) : null}
            </Section>

            <Section title="Proposed changes">
                <ul className="space-y-1">
                    {evaluation.actions.map(action => (
                        <li key={action.position} className="flex items-center gap-2 text-sm">
                            <Badge variant="info">{action.actionType}</Badge>
                            <span className="text-muted-foreground">{describeAction(action.action)}</span>
                            <Badge variant={action.status === "applied" ? "success" : "outline"}>{action.status}</Badge>
                        </li>
                    ))}
                </ul>
            </Section>

            <Section title="Safety">
                <p className="mb-2 text-sm">
                    Outcome:{" "}
                    <Badge variant={safetyVariant(evaluation.safety.outcome)}>{evaluation.safety.outcome}</Badge>
                </p>
                {evaluation.safety.findings.length > 0 ? (
                    <ul className="space-y-1 text-sm">
                        {evaluation.safety.findings.map((finding, index) => (
                            <li key={index} className="flex flex-wrap items-center gap-2">
                                <Badge variant={safetyVariant(finding.outcome)}>{finding.policyKey}</Badge>
                                <span className="text-muted-foreground">{finding.message}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted-foreground text-sm">No safety policies engaged.</p>
                )}
                {evaluation.conflict.conflicting ? (
                    <p className="text-muted-foreground mt-2 text-sm">
                        Conflicts with rules {evaluation.conflict.ruleIds.map(id => id.slice(0, 8)).join(", ")} on{" "}
                        {evaluation.conflict.fields.join(", ")}
                    </p>
                ) : null}
            </Section>

            {evaluation.decidedAt ? (
                <Section title="Decision">
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                        <Detail label="Status" value={evaluation.status} />
                        <Detail label="By" value={evaluation.decidedBy ?? "—"} />
                        <Detail label="At" value={new Date(evaluation.decidedAt).toLocaleString()} />
                        {evaluation.decisionReason ? <Detail label="Reason" value={evaluation.decisionReason} /> : null}
                    </dl>
                    {evaluation.resultRevisions.length > 0 ? (
                        <ul className="mt-3 space-y-1 text-sm">
                            {evaluation.resultRevisions.map((revision, index) => (
                                <li key={index} className="font-mono text-xs tabular-nums">
                                    {revision.entityType} {revision.entityId.slice(0, 8)} → v{revision.version}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </Section>
            ) : null}
        </div>
    );
}

function safetyVariant(outcome: string): "success" | "warning" | "destructive" {
    if (outcome === "block") return "destructive";
    if (outcome === "requires_approval") return "warning";
    return "success";
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
    return (
        <section className="bg-card border-border space-y-3 rounded-lg border p-4">
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">{title}</h2>
            {children}
        </section>
    );
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
    return (
        <div>
            <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
            <dd className="font-mono tabular-nums">{value}</dd>
        </div>
    );
}
