import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, CalendarClock, LoaderCircle, Pencil, Play, Plus, RotateCcw } from "lucide-react";

import type { ProgramStatusValue, ProgramSummary } from "@kinetix/types";

import { ProgramForm } from "@/components/training/program-form";
import { ActivateProgramPanel, ProgramSessionsPanel } from "@/components/training/program-scheduling";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
    changeProgramStatus,
    createProgram,
    programQueryOptions,
    programRevisionHistoryQueryOptions,
    programsQueryOptions,
    updateProgram,
} from "@/lib/api";
import {
    programCreateInput,
    programFormDefaults,
    programFormValues,
    programUpdateInput,
    type ProgramFormValues,
} from "@/lib/program-form";

export const Route = createFileRoute("/training/programs")({ component: ProgramsPage });

type EditorState = { readonly mode: "create" } | { readonly mode: "edit"; readonly program: ProgramSummary };

type SchedulerState = { readonly mode: "activate" | "sessions"; readonly program: ProgramSummary };

type StatusAction = "pause" | "resume" | "complete" | "archive" | "restore";

const statusVariant: Record<ProgramStatusValue, "success" | "info" | "warning" | "secondary" | "milestone"> = {
    draft: "secondary",
    active: "success",
    paused: "warning",
    completed: "milestone",
    archived: "secondary",
};

/** Contextual lifecycle actions offered per status (activation and session management have their own buttons). */
function actionsFor(status: ProgramStatusValue): readonly StatusAction[] {
    switch (status) {
        case "active":
            return ["pause", "complete", "archive"];
        case "paused":
            return ["resume", "complete", "archive"];
        case "draft":
        case "completed":
            return ["archive"];
        case "archived":
            return ["restore"];
    }
}

const actionLabel: Record<StatusAction, string> = {
    pause: "Pause",
    resume: "Resume",
    complete: "Complete",
    archive: "Archive",
    restore: "Restore",
};

function ProgramsPage(): React.JSX.Element {
    const queryClient = useQueryClient();
    const [includeArchived, setIncludeArchived] = useState(false);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [scheduler, setScheduler] = useState<SchedulerState | null>(null);
    const programs = useQuery(programsQueryOptions(includeArchived));

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: ["training-programs"] }).then(() => setEditor(null));

    const invalidateSchedule = (programId: string) =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: ["training-programs"] }),
            queryClient.invalidateQueries({ queryKey: ["training-program", programId] }),
            queryClient.invalidateQueries({ queryKey: ["training-program-sessions", programId] }),
        ]);

    const statusMutation = useMutation({
        mutationFn: (input: { program: ProgramSummary; action: StatusAction }) =>
            changeProgramStatus(input.program, input.action),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training-programs"] }),
    });

    return (
        <main className="mx-auto max-w-4xl px-6 py-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Programs</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Organise nested blocks and planned sessions across relative, dated, or ordered schedules.
                        Overlaps are allowed and surfaced as warnings.
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
                        New program
                    </Button>
                </div>
            </div>

            <div className="mt-8 grid gap-3">
                {programs.isPending ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
                        <LoaderCircle className="animate-spin" /> Loading programs…
                    </div>
                ) : programs.isError ? (
                    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                        {programs.error.message}
                    </div>
                ) : programs.data.items.length === 0 ? (
                    <p className="text-muted-foreground py-10 text-sm">
                        No programs yet. Create one to plan your training.
                    </p>
                ) : (
                    programs.data.items.map(program => (
                        <div
                            className="border-border flex items-center justify-between gap-3 rounded-lg border p-4"
                            key={program.id}
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="truncate font-medium">{program.name}</span>
                                    <Badge variant={statusVariant[program.status]}>{program.status}</Badge>
                                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                        v{program.version}
                                    </span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    <Badge variant="outline">{program.scheduleMode}</Badge>
                                    <Badge variant="outline">
                                        {program.blockCount} {program.blockCount === 1 ? "block" : "blocks"}
                                    </Badge>
                                    <Badge variant="outline">
                                        {program.sessionCount} {program.sessionCount === 1 ? "session" : "sessions"}
                                    </Badge>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                {program.status === "draft" ? (
                                    <Button onClick={() => setScheduler({ mode: "activate", program })} size="sm">
                                        <Play />
                                        Activate
                                    </Button>
                                ) : program.status !== "archived" ? (
                                    <Button
                                        onClick={() => setScheduler({ mode: "sessions", program })}
                                        size="sm"
                                        variant="outline"
                                    >
                                        <CalendarClock />
                                        Sessions
                                    </Button>
                                ) : null}
                                <Button
                                    onClick={() => setEditor({ mode: "edit", program })}
                                    size="sm"
                                    variant="outline"
                                >
                                    <Pencil />
                                    Edit
                                </Button>
                                {actionsFor(program.status).map(action => (
                                    <Button
                                        disabled={statusMutation.isPending}
                                        key={action}
                                        onClick={() => statusMutation.mutate({ program, action })}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        {action === "restore" ? (
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
                <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
                    <SheetHeader>
                        <SheetTitle>{editor?.mode === "edit" ? "Edit program" : "New program"}</SheetTitle>
                        <SheetDescription>
                            Set schedule and structure the block tree. Every save creates a new program revision.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {editor?.mode === "edit" ? (
                            <EditProgram onSaved={invalidate} program={editor.program} />
                        ) : editor?.mode === "create" ? (
                            <CreateProgram onSaved={invalidate} />
                        ) : null}
                    </div>
                </SheetContent>
            </Sheet>

            <Sheet onOpenChange={open => (open ? undefined : setScheduler(null))} open={scheduler !== null}>
                <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
                    <SheetHeader>
                        <SheetTitle>
                            {scheduler?.mode === "activate" ? "Activate program" : "Planned sessions"}
                        </SheetTitle>
                        <SheetDescription>
                            {scheduler?.mode === "activate"
                                ? "Attach templates to generate every planned session in one step."
                                : "Reschedule, skip, or cancel sessions. Overdue sessions and collisions are flagged, never auto-shifted."}
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {scheduler?.mode === "activate" ? (
                            <ActivateProgramPanel
                                onDone={() => invalidateSchedule(scheduler.program.id).then(() => setScheduler(null))}
                                program={scheduler.program}
                            />
                        ) : scheduler?.mode === "sessions" ? (
                            <ProgramSessionsPanel
                                onChanged={() => void invalidateSchedule(scheduler.program.id)}
                                program={scheduler.program}
                            />
                        ) : null}
                    </div>
                </SheetContent>
            </Sheet>
        </main>
    );
}

function CreateProgram({ onSaved }: { readonly onSaved: () => void }): React.JSX.Element {
    const mutation = useMutation({
        mutationFn: (values: ProgramFormValues) => createProgram(programCreateInput(values)),
        onSuccess: onSaved,
    });
    return (
        <ProgramForm
            defaultValues={programFormDefaults()}
            isSubmitting={mutation.isPending}
            onSubmit={async values => {
                await mutation.mutateAsync(values);
            }}
            submitError={mutation.error}
            submitLabel="Create program"
        />
    );
}

function EditProgram({
    onSaved,
    program,
}: {
    readonly onSaved: () => void;
    readonly program: ProgramSummary;
}): React.JSX.Element {
    const detail = useQuery(programQueryOptions(program.id));
    const history = useQuery(programRevisionHistoryQueryOptions(program.id));
    const mutation = useMutation({
        mutationFn: (values: ProgramFormValues) => updateProgram(program, programUpdateInput(values)),
        onSuccess: onSaved,
    });
    if (detail.isPending) return <FormLoading />;
    if (detail.isError) return <FormError message={detail.error.message} />;
    return (
        <div className="grid gap-6">
            {detail.data.warnings.length > 0 ? (
                <div className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm" role="status">
                    <p className="font-medium">Planning warnings</p>
                    <ul className="mt-1 list-disc pl-5">
                        {detail.data.warnings.map((warning, index) => (
                            <li key={index}>{warning.message}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            <ProgramForm
                defaultValues={programFormValues(detail.data)}
                isSubmitting={mutation.isPending}
                key={`${program.id}:${program.version}`}
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
