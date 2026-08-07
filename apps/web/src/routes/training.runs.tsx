import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle, Plus } from "lucide-react";

import type { RunListItemResponse } from "@kinetix/types";

import { RunForm } from "@/components/training/run-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { addRun, runsQueryOptions, runViewQueryOptions, updateRun } from "@/lib/api";
import { addRunInput, runFormDefaults, runFormValues, updateRunInput, type RunFormValues } from "@/lib/run-form";

export const Route = createFileRoute("/training/runs")({ component: RunsPage });

type EditorState = { readonly mode: "create" } | { readonly mode: "edit"; readonly run: RunListItemResponse };

function RunsPage(): React.JSX.Element {
    const queryClient = useQueryClient();
    const [includeArchived, setIncludeArchived] = useState(false);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const runs = useQuery(runsQueryOptions(includeArchived));

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["training-runs"] }).then(() => setEditor(null));

    return (
        <main className="mx-auto max-w-4xl px-6 py-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Runs</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Log manual runs with intervals, splits, environment, gear, and plan mappings. Every run is a
                        training session, so it shows up alongside your strength work.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        onClick={() => setIncludeArchived(value => !value)}
                        size="sm"
                        variant={includeArchived ? "default" : "outline"}
                    >
                        {includeArchived ? "Showing archived" : "Show archived"}
                    </Button>
                    <Button onClick={() => setEditor({ mode: "create" })} size="sm">
                        <Plus />
                        New run
                    </Button>
                </div>
            </div>

            <div className="mt-8 grid gap-3">
                {runs.isPending ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
                        <LoaderCircle className="animate-spin" /> Loading runs…
                    </div>
                ) : runs.isError ? (
                    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                        {runs.error.message}
                    </div>
                ) : runs.data.items.length === 0 ? (
                    <p className="text-muted-foreground py-10 text-sm">No runs yet. Log one to start tracking.</p>
                ) : (
                    runs.data.items.map(run => (
                        <button
                            className="border-border hover:bg-muted/50 flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors"
                            key={`${run.sessionId}:${run.activityId}`}
                            onClick={() => setEditor({ mode: "edit", run })}
                            type="button"
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="truncate font-medium">{run.title ?? "Untitled run"}</span>
                                    {run.archivedAt !== null ? <Badge variant="outline">archived</Badge> : null}
                                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                        v{run.version}
                                    </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Badge variant="outline">{run.localDate}</Badge>
                                    <Badge variant="secondary" className="font-mono tabular-nums">
                                        {formatDistance(run.distanceMetres)}
                                    </Badge>
                                    <Badge variant="info" className="font-mono tabular-nums">
                                        {formatPace(run.derivedPaceSecondsPerKm)}
                                    </Badge>
                                    {run.runTags.map(tag => (
                                        <Badge key={tag} variant="secondary">
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        </button>
                    ))
                )}
            </div>

            <Sheet onOpenChange={open => (open ? undefined : setEditor(null))} open={editor !== null}>
                <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                    <SheetHeader>
                        <SheetTitle>{editor?.mode === "edit" ? "Edit run" : "New run"}</SheetTitle>
                        <SheetDescription>
                            {editor?.mode === "edit"
                                ? "Correct the run's detail and plan mappings. Saving reopens and re-completes the run."
                                : "Log a run with its summary, intervals, splits, environment, gear, and pain."}
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {editor?.mode === "edit" ? (
                            <EditRun onSaved={invalidate} run={editor.run} />
                        ) : editor?.mode === "create" ? (
                            <CreateRun onSaved={invalidate} />
                        ) : null}
                    </div>
                </SheetContent>
            </Sheet>
        </main>
    );
}

function CreateRun({ onSaved }: { readonly onSaved: () => void }): React.JSX.Element {
    const mutation = useMutation({
        mutationFn: (values: RunFormValues) => addRun(addRunInput(values)),
        onSuccess: onSaved,
    });
    return (
        <RunForm
            defaultValues={runFormDefaults()}
            isSubmitting={mutation.isPending}
            mode="create"
            onSubmit={async values => {
                await mutation.mutateAsync(values);
            }}
            submitError={mutation.error}
            submitLabel="Log run"
        />
    );
}

function EditRun({
    onSaved,
    run,
}: {
    readonly onSaved: () => void;
    readonly run: RunListItemResponse;
}): React.JSX.Element {
    const detail = useQuery(runViewQueryOptions(run.sessionId));
    const mutation = useMutation({
        mutationFn: (values: RunFormValues) =>
            updateRun(
                { sessionId: run.sessionId, activityId: detail.data!.activityId, version: detail.data!.version },
                updateRunInput(values),
            ),
        onSuccess: onSaved,
    });
    if (detail.isPending)
        return (
            <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
                <LoaderCircle className="animate-spin" /> Loading…
            </div>
        );
    if (detail.isError)
        return (
            <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                {detail.error.message}
            </div>
        );
    return (
        <RunForm
            defaultValues={runFormValues(detail.data)}
            isSubmitting={mutation.isPending}
            key={`${run.sessionId}:${detail.data.version}`}
            mode="edit"
            onSubmit={async values => {
                await mutation.mutateAsync(values);
            }}
            submitError={mutation.error}
            submitLabel="Save changes"
        />
    );
}

function formatDistance(distanceMetres: string | null): string {
    if (distanceMetres === null) return "—";
    return `${(Number(distanceMetres) / 1000).toFixed(2)} km`;
}

function formatPace(secondsPerKilometre: number | null): string {
    if (secondsPerKilometre === null) return "pace —";
    const total = Math.round(secondsPerKilometre);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}/km`;
}
