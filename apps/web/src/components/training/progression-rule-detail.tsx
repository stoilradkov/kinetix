import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, ChevronLeft, LoaderCircle, MoreHorizontal, Pencil, RotateCcw } from "lucide-react";

import type { ProgressionRuleResponse } from "@kinetix/types";

import { ActionList, ConditionTree } from "@/components/training/progression-rule-condition";
import { ProgressionRuleForm } from "@/components/training/progression-rule-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { changeProgressionRuleStatus, progressionRuleQueryOptions, updateProgressionRule } from "@/lib/api";
import {
    progressionRuleFormValues,
    progressionRuleRequest,
    type ProgressionRuleFormValues,
} from "@/lib/progression-rule-form";

export function ProgressionRuleDetailRoute({ ruleId }: { ruleId: string }): React.JSX.Element {
    const rule = useQuery(progressionRuleQueryOptions(ruleId));
    if (rule.isPending)
        return (
            <div className="text-muted-foreground flex items-center gap-2 p-8">
                <LoaderCircle className="size-4 animate-spin" /> Loading rule…
            </div>
        );
    if (rule.isError)
        return (
            <div className="border-destructive/30 bg-destructive/10 text-destructive m-6 rounded-lg border p-4">
                {rule.error.message}
            </div>
        );
    return <ProgressionRuleDetail rule={rule.data} />;
}

function ProgressionRuleDetail({ rule }: { rule: ProgressionRuleResponse }): React.JSX.Element {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    const invalidate = (): Promise<unknown> =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: ["training-progression-rule", rule.id] }),
            queryClient.invalidateQueries({ queryKey: ["training-progression-rules"] }),
        ]);

    const statusMutation = useMutation({
        mutationFn: (action: "archive" | "restore") => changeProgressionRuleStatus(rule, action),
        onSuccess: () => {
            setActionError(null);
            void invalidate();
        },
        onError: error => setActionError(error instanceof Error ? error.message : "Action failed"),
    });

    const editMutation = useMutation({
        mutationFn: (values: ProgressionRuleFormValues) => updateProgressionRule(rule, progressionRuleRequest(values)),
        onSuccess: () => invalidate().then(() => setEditing(false)),
    });

    return (
        <div className="mx-auto max-w-3xl space-y-6 p-6">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                    <Link
                        className="text-muted-foreground flex items-center gap-1 text-sm hover:underline"
                        to="/training/rules"
                    >
                        <ChevronLeft className="size-4" /> Progression rules
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl font-semibold">{rule.name}</h1>
                        <Badge variant={rule.status === "archived" ? "outline" : "success"}>{rule.status}</Badge>
                        <Badge variant={rule.enabled ? "success" : "secondary"}>
                            {rule.enabled ? "enabled" : "disabled"}
                        </Badge>
                        {rule.autoApply ? (
                            <Badge variant="warning">auto-apply</Badge>
                        ) : (
                            <Badge variant="info">approval</Badge>
                        )}
                        <Badge variant="outline">v{rule.version}</Badge>
                    </div>
                    {rule.description ? <p className="text-muted-foreground">{rule.description}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={() => setEditing(true)} size="sm" variant="outline">
                        <Pencil className="mr-1 size-4" /> Edit
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="outline">
                                <MoreHorizontal className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {rule.status === "archived" ? (
                                <DropdownMenuItem onClick={() => statusMutation.mutate("restore")}>
                                    <RotateCcw className="mr-2 size-4" /> Restore
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem onClick={() => statusMutation.mutate("archive")}>
                                    <Archive className="mr-2 size-4" /> Archive
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {actionError ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
                    {actionError}
                </div>
            ) : null}

            <Section title="Scope & target">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Detail label="Scope" value={`${rule.scope.type} · ${rule.scope.id.slice(0, 8)}`} />
                    <Detail label="Target mode" value={rule.target.mode} />
                    <Detail
                        label="Selector"
                        value={
                            rule.target.selector.kind === "scope"
                                ? "scope element"
                                : `${rule.target.selector.kind} · ${rule.target.selector.logicalKey.slice(0, 8)}`
                        }
                    />
                    <Detail label="Triggers" value={rule.triggers.join(", ")} />
                </dl>
            </Section>

            <Section title="When (condition)">
                <ConditionTree condition={rule.condition} />
            </Section>

            <Section title="Then (actions)">
                <ActionList actions={rule.actions} />
            </Section>

            <Section title="Safety policy">
                <p className="text-muted-foreground text-sm">
                    {rule.safetyPolicy.policyKey ?? "Default safety policy"}
                    {Object.keys(rule.safetyPolicy.config).length > 0
                        ? ` · ${JSON.stringify(rule.safetyPolicy.config)}`
                        : ""}
                </p>
            </Section>

            <Sheet onOpenChange={open => (open ? undefined : setEditing(false))} open={editing}>
                <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
                    <SheetHeader>
                        <SheetTitle>Edit progression rule</SheetTitle>
                        <SheetDescription>Every save creates a new immutable rule revision.</SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        <ProgressionRuleForm
                            defaultValues={progressionRuleFormValues(rule)}
                            isSubmitting={editMutation.isPending}
                            key={`${rule.id}:${rule.version}`}
                            mode="edit"
                            onSubmit={async values => {
                                await editMutation.mutateAsync(values);
                            }}
                            submitError={editMutation.error}
                            submitLabel="Save rule"
                        />
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
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
