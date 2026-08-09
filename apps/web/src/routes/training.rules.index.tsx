import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircle, Plus } from "lucide-react";
import { z } from "zod";

import { ProgressionRuleForm } from "@/components/training/progression-rule-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createProgressionRule, progressionRulesQueryOptions } from "@/lib/api";
import { describeAction } from "@/lib/progression-rule";
import {
    progressionRuleFormDefaults,
    progressionRuleRequest,
    type ProgressionRuleFormValues,
} from "@/lib/progression-rule-form";

const rulesSearchSchema = z.object({
    view: z.enum(["active", "all"]).optional().catch(undefined),
});

export const Route = createFileRoute("/training/rules/")({
    component: RulesPage,
    validateSearch: rulesSearchSchema,
});

function RulesPage(): React.JSX.Element {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const queryClient = useQueryClient();
    const view = search.view ?? "active";
    const [creating, setCreating] = useState(false);

    const rules = useQuery(progressionRulesQueryOptions(view === "all"));

    const invalidate = (): Promise<unknown> =>
        queryClient.invalidateQueries({ queryKey: ["training-progression-rules"] });

    const createMutation = useMutation({
        mutationFn: (values: ProgressionRuleFormValues) => createProgressionRule(progressionRuleRequest(values)),
        onSuccess: () => invalidate().then(() => setCreating(false)),
    });

    return (
        <main className="mx-auto max-w-4xl space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Progression rules</h1>
                    <p className="text-muted-foreground">Bounded, versioned rules that propose plan changes.</p>
                </div>
                <Button onClick={() => setCreating(true)}>
                    <Plus className="mr-1 size-4" /> New rule
                </Button>
            </div>

            <Tabs
                onValueChange={value =>
                    navigate({ search: previous => ({ ...previous, view: value === "active" ? undefined : "all" }) })
                }
                value={view}
            >
                <TabsList>
                    <TabsTrigger value="active">Active</TabsTrigger>
                    <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
            </Tabs>

            {rules.isPending ? (
                <div className="text-muted-foreground flex items-center gap-2 p-8">
                    <LoaderCircle className="size-4 animate-spin" /> Loading rules…
                </div>
            ) : rules.isError ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4">
                    {rules.error.message}
                </div>
            ) : rules.data.items.length === 0 ? (
                <div className="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center">
                    No progression rules yet.
                </div>
            ) : (
                <ul className="divide-border border-border divide-y rounded-lg border">
                    {rules.data.items.map(rule => (
                        <li key={rule.id}>
                            <Link
                                className="hover:bg-muted/50 flex items-center justify-between gap-4 p-4"
                                params={{ id: rule.id }}
                                to="/training/rules/$id"
                            >
                                <div className="min-w-0 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{rule.name}</span>
                                        <Badge variant={rule.status === "archived" ? "outline" : "success"}>
                                            {rule.status}
                                        </Badge>
                                        {!rule.enabled ? <Badge variant="secondary">disabled</Badge> : null}
                                    </div>
                                    <p className="text-muted-foreground truncate text-sm">
                                        {rule.scope.type} · {rule.target.mode} ·{" "}
                                        {rule.actions.map(describeAction).join("; ")}
                                    </p>
                                </div>
                                <Badge variant="outline">v{rule.version}</Badge>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            <Sheet onOpenChange={open => (open ? undefined : setCreating(false))} open={creating}>
                <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
                    <SheetHeader>
                        <SheetTitle>New progression rule</SheetTitle>
                        <SheetDescription>
                            Define a bounded condition and the actions it proposes. Rules propose changes for approval
                            by default.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        <ProgressionRuleForm
                            defaultValues={progressionRuleFormDefaults()}
                            isSubmitting={createMutation.isPending}
                            mode="create"
                            onSubmit={async values => {
                                await createMutation.mutateAsync(values);
                            }}
                            submitError={createMutation.error}
                            submitLabel="Create rule"
                        />
                    </div>
                </SheetContent>
            </Sheet>
        </main>
    );
}
