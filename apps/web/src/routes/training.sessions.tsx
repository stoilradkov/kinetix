import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, CheckCircle2, LoaderCircle, Pencil, Play, Plus, RotateCcw, Timer } from "lucide-react";

import type { TrainingSessionStatusValue, TrainingSessionSummary } from "@kinetix/types";

import { SessionForm } from "@/components/training/session-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
    completeTrainingSession,
    createTrainingSession,
    trainingSessionQueryOptions,
    trainingSessionRevisionHistoryQueryOptions,
    trainingSessionsQueryOptions,
    transitionTrainingSession,
    updateTrainingSession,
} from "@/lib/api";
import {
    sessionCreateInput,
    sessionFormDefaults,
    sessionFormValues,
    sessionUpdateInput,
    type SessionFormValues,
} from "@/lib/session-form";

export const Route = createFileRoute("/training/sessions")({ component: SessionsPage });

type EditorState = { readonly mode: "create" } | { readonly mode: "edit"; readonly session: TrainingSessionSummary };

type LifecycleAction = "start" | "complete" | "reopen" | "archive" | "restore";

const statusVariant: Record<TrainingSessionStatusValue, "secondary" | "info" | "success"> = {
    draft: "secondary",
    in_progress: "info",
    completed: "success",
};

const statusLabel: Record<TrainingSessionStatusValue, string> = {
    draft: "Draft",
    in_progress: "In progress",
    completed: "Completed",
};

const actionLabel: Record<LifecycleAction, string> = {
    start: "Start",
    complete: "Complete",
    reopen: "Reopen",
    archive: "Archive",
    restore: "Restore",
};

/** Contextual lifecycle actions per state; archiving is a separate soft-delete flag. */
function actionsFor(session: TrainingSessionSummary): readonly LifecycleAction[] {
    if (session.archivedAt !== null) return ["restore"];
    switch (session.status) {
        case "draft":
            return ["start", "archive"];
        case "in_progress":
            return ["complete", "archive"];
        case "completed":
            return ["reopen", "archive"];
    }
}

function SessionsPage(): React.JSX.Element {
    const queryClient = useQueryClient();
    const [includeArchived, setIncludeArchived] = useState(false);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const sessions = useQuery(trainingSessionsQueryOptions(includeArchived));

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: ["training-sessions"] }).then(() => setEditor(null));

    const lifecycle = useMutation({
        mutationFn: (input: { session: TrainingSessionSummary; action: LifecycleAction }) =>
            input.action === "complete"
                ? completeTrainingSession(input.session)
                : transitionTrainingSession(input.session, input.action),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training-sessions"] }),
    });

    return (
        <main className="mx-auto max-w-4xl px-6 py-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Sessions</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Track live and retrospective workouts. Timers are anchored to server timestamps, so a reload
                        picks up the elapsed time exactly.
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
                        New session
                    </Button>
                </div>
            </div>

            <div className="mt-8 grid gap-3">
                {sessions.isPending ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
                        <LoaderCircle className="animate-spin" /> Loading sessions…
                    </div>
                ) : sessions.isError ? (
                    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                        {sessions.error.message}
                    </div>
                ) : sessions.data.items.length === 0 ? (
                    <p className="text-muted-foreground py-10 text-sm">
                        No sessions yet. Create one to start tracking a workout.
                    </p>
                ) : (
                    sessions.data.items.map(session => (
                        <div
                            className="border-border flex items-center justify-between gap-3 rounded-lg border p-4"
                            key={session.id}
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="truncate font-medium">{session.title ?? "Untitled session"}</span>
                                    <Badge variant={statusVariant[session.status]}>{statusLabel[session.status]}</Badge>
                                    {session.archivedAt !== null ? <Badge variant="outline">archived</Badge> : null}
                                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                        v{session.version}
                                    </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Badge variant="outline">{session.localDate}</Badge>
                                    <Badge variant="outline">
                                        {session.activityCount}{" "}
                                        {session.activityCount === 1 ? "activity" : "activities"}
                                    </Badge>
                                    {session.painRecordCount > 0 ? (
                                        <Badge variant="warning">
                                            {session.painRecordCount} pain{" "}
                                            {session.painRecordCount === 1 ? "record" : "records"}
                                        </Badge>
                                    ) : null}
                                    {session.tags.map(tag => (
                                        <Badge key={tag} variant="secondary">
                                            {tag}
                                        </Badge>
                                    ))}
                                    {session.status === "in_progress" && session.startedAt !== null ? (
                                        <ElapsedTimer startedAt={session.startedAt} />
                                    ) : null}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                {session.archivedAt === null && session.status !== "completed" ? (
                                    <Button
                                        onClick={() => setEditor({ mode: "edit", session })}
                                        size="sm"
                                        variant="outline"
                                    >
                                        <Pencil />
                                        Edit
                                    </Button>
                                ) : null}
                                {actionsFor(session).map(action => (
                                    <Button
                                        disabled={lifecycle.isPending}
                                        key={action}
                                        onClick={() => lifecycle.mutate({ session, action })}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        {action === "start" ? (
                                            <Play />
                                        ) : action === "complete" ? (
                                            <CheckCircle2 />
                                        ) : action === "restore" ? (
                                            <RotateCcw />
                                        ) : action === "archive" ? (
                                            <Archive />
                                        ) : null}
                                        {actionLabel[action]}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>

            <Sheet onOpenChange={open => (open ? undefined : setEditor(null))} open={editor !== null}>
                <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                    <SheetHeader>
                        <SheetTitle>{editor?.mode === "edit" ? "Edit session" : "New session"}</SheetTitle>
                        <SheetDescription>
                            Capture readiness, tags, and notes. Every save creates a new session revision.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {editor?.mode === "edit" ? (
                            <EditSession onSaved={invalidate} session={editor.session} />
                        ) : editor?.mode === "create" ? (
                            <CreateSession onSaved={invalidate} />
                        ) : null}
                    </div>
                </SheetContent>
            </Sheet>
        </main>
    );
}

/** Server-timestamp-anchored elapsed timer: recomputes from `startedAt` each second, survives reload. */
function ElapsedTimer({ startedAt }: { readonly startedAt: string }): React.JSX.Element {
    const [elapsedMs, setElapsedMs] = useState(() => Date.now() - Date.parse(startedAt));
    useEffect(() => {
        const tick = () => setElapsedMs(Date.now() - Date.parse(startedAt));
        tick();
        const handle = setInterval(tick, 1_000);
        return () => clearInterval(handle);
    }, [startedAt]);
    return (
        <Badge variant="info">
            <Timer className="size-3" />
            <span className="font-mono tabular-nums">{formatElapsed(elapsedMs)}</span>
        </Badge>
    );
}

function formatElapsed(milliseconds: number): string {
    const total = Math.max(0, Math.floor(milliseconds / 1_000));
    const hours = Math.floor(total / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":");
}

function CreateSession({ onSaved }: { readonly onSaved: () => void }): React.JSX.Element {
    const mutation = useMutation({
        mutationFn: (values: SessionFormValues) => createTrainingSession(sessionCreateInput(values)),
        onSuccess: onSaved,
    });
    return (
        <SessionForm
            defaultValues={sessionFormDefaults()}
            isSubmitting={mutation.isPending}
            onSubmit={async values => {
                await mutation.mutateAsync(values);
            }}
            submitError={mutation.error}
            submitLabel="Create session"
        />
    );
}

function EditSession({
    onSaved,
    session,
}: {
    readonly onSaved: () => void;
    readonly session: TrainingSessionSummary;
}): React.JSX.Element {
    const detail = useQuery(trainingSessionQueryOptions(session.id));
    const history = useQuery(trainingSessionRevisionHistoryQueryOptions(session.id));
    const mutation = useMutation({
        mutationFn: (values: SessionFormValues) => updateTrainingSession(session, sessionUpdateInput(values)),
        onSuccess: onSaved,
    });
    if (detail.isPending) return <FormLoading />;
    if (detail.isError) return <FormError message={detail.error.message} />;
    return (
        <div className="grid gap-6">
            <SessionForm
                defaultValues={sessionFormValues(detail.data)}
                isSubmitting={mutation.isPending}
                key={`${session.id}:${session.version}`}
                onSubmit={async values => {
                    await mutation.mutateAsync(values);
                }}
                submitError={mutation.error}
                submitLabel="Save changes"
            />
            {history.data && history.data.items.length > 0 ? (
                <section className="grid gap-2">
                    <h3 className="text-sm font-medium">Recent history</h3>
                    <ul className="grid gap-1">
                        {history.data.items.slice(0, 5).map(item => (
                            <li className="text-muted-foreground flex items-center gap-2 text-xs" key={item.version}>
                                <span className="font-mono tabular-nums">v{item.version}</span>
                                <span className="truncate">{item.summary}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    );
}

function FormLoading(): React.JSX.Element {
    return (
        <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
            <LoaderCircle className="animate-spin" /> Loading…
        </div>
    );
}

function FormError({ message }: { readonly message: string }): React.JSX.Element {
    return (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
            {message}
        </div>
    );
}
