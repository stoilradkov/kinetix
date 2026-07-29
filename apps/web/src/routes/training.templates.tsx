import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, LoaderCircle, Pencil, Plus, RotateCcw } from "lucide-react";

import type { WorkoutTemplateSummary } from "@kinetix/types";

import { WorkoutTemplateForm } from "@/components/training/workout-template-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
    changeWorkoutTemplateStatus,
    createWorkoutTemplate,
    exerciseListQueryOptions,
    updateWorkoutTemplate,
    workoutTemplateQueryOptions,
    workoutTemplatesQueryOptions,
} from "@/lib/api";
import {
    workoutTemplateCreateInput,
    workoutTemplateFormDefaults,
    workoutTemplateFormValues,
    workoutTemplateUpdateInput,
    type WorkoutTemplateFormValues,
} from "@/lib/workout-template-form";

export const Route = createFileRoute("/training/templates")({ component: TemplatesPage });

type EditorState = { readonly mode: "create" } | { readonly mode: "edit"; readonly template: WorkoutTemplateSummary };

function TemplatesPage(): React.JSX.Element {
    const queryClient = useQueryClient();
    const [includeArchived, setIncludeArchived] = useState(false);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const templates = useQuery(workoutTemplatesQueryOptions(includeArchived));

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: ["training-templates"] }).then(() => setEditor(null));

    const statusMutation = useMutation({
        mutationFn: (input: { template: WorkoutTemplateSummary; action: "archive" | "restore" }) =>
            changeWorkoutTemplateStatus(input.template, input.action),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training-templates"] }),
    });

    return (
        <main className="mx-auto max-w-4xl px-6 py-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Workout templates</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Reusable strength, running, and mixed prescriptions. Editing a template publishes a new version
                        without touching plans already generated from it.
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
                        New template
                    </Button>
                </div>
            </div>

            <div className="mt-8 grid gap-3">
                {templates.isPending ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
                        <LoaderCircle className="animate-spin" /> Loading templates…
                    </div>
                ) : templates.isError ? (
                    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                        {templates.error.message}
                    </div>
                ) : templates.data.items.length === 0 ? (
                    <p className="text-muted-foreground py-10 text-sm">
                        No templates yet. Create one to start building sessions.
                    </p>
                ) : (
                    templates.data.items.map(template => (
                        <div
                            className="border-border flex items-center justify-between gap-3 rounded-lg border p-4"
                            key={template.id}
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="truncate font-medium">{template.name}</span>
                                    <Badge variant={template.status === "active" ? "success" : "secondary"}>
                                        {template.status}
                                    </Badge>
                                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                        v{template.version}
                                    </span>
                                </div>
                                {template.description ? (
                                    <p className="text-muted-foreground mt-1 truncate text-sm">
                                        {template.description}
                                    </p>
                                ) : null}
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {template.activities.length === 0 ? (
                                        <span className="text-muted-foreground text-xs">No activities</span>
                                    ) : (
                                        template.activities.map((activity, activityIndex) => (
                                            <Badge key={activityIndex} variant="outline">
                                                {activity.type === "strength"
                                                    ? `Strength · ${activity.exerciseCount} ${
                                                          activity.exerciseCount === 1 ? "exercise" : "exercises"
                                                      } · ${activity.setCount} ${activity.setCount === 1 ? "set" : "sets"}`
                                                    : `Running · ${activity.runStepCount} ${
                                                          activity.runStepCount === 1 ? "step" : "steps"
                                                      }`}
                                            </Badge>
                                        ))
                                    )}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <Button
                                    onClick={() => setEditor({ mode: "edit", template })}
                                    size="sm"
                                    variant="outline"
                                >
                                    <Pencil />
                                    Edit
                                </Button>
                                <Button
                                    disabled={statusMutation.isPending}
                                    onClick={() =>
                                        statusMutation.mutate({
                                            template,
                                            action: template.status === "active" ? "archive" : "restore",
                                        })
                                    }
                                    size="sm"
                                    variant="ghost"
                                >
                                    {template.status === "active" ? <Archive /> : <RotateCcw />}
                                    {template.status === "active" ? "Archive" : "Restore"}
                                </Button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <Sheet onOpenChange={open => (open ? undefined : setEditor(null))} open={editor !== null}>
                <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
                    <SheetHeader>
                        <SheetTitle>{editor?.mode === "edit" ? "Edit template" : "New template"}</SheetTitle>
                        <SheetDescription>
                            Order activities, exercises, groups, sets, and run steps. Saving publishes an immutable
                            prescription version.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {editor?.mode === "edit" ? (
                            <EditTemplate onSaved={invalidate} template={editor.template} />
                        ) : editor?.mode === "create" ? (
                            <CreateTemplate onSaved={invalidate} />
                        ) : null}
                    </div>
                </SheetContent>
            </Sheet>
        </main>
    );
}

function CreateTemplate({ onSaved }: { readonly onSaved: () => void }): React.JSX.Element {
    const exercises = useQuery(exerciseListQueryOptions("", "active"));
    const mutation = useMutation({
        mutationFn: (values: WorkoutTemplateFormValues) => createWorkoutTemplate(workoutTemplateCreateInput(values)),
        onSuccess: onSaved,
    });
    if (exercises.isPending) return <FormLoading />;
    if (exercises.isError) return <FormError message={exercises.error.message} />;
    return (
        <WorkoutTemplateForm
            defaultValues={workoutTemplateFormDefaults()}
            exercises={exercises.data.items}
            isSubmitting={mutation.isPending}
            onSubmit={async values => {
                await mutation.mutateAsync(values);
            }}
            submitError={mutation.error}
            submitLabel="Create template"
        />
    );
}

function EditTemplate({
    onSaved,
    template,
}: {
    readonly onSaved: () => void;
    readonly template: WorkoutTemplateSummary;
}): React.JSX.Element {
    const detail = useQuery(workoutTemplateQueryOptions(template.id));
    const exercises = useQuery(exerciseListQueryOptions("", "active"));
    const mutation = useMutation({
        mutationFn: (values: WorkoutTemplateFormValues) =>
            updateWorkoutTemplate(template, workoutTemplateUpdateInput(values)),
        onSuccess: onSaved,
    });
    if (detail.isPending || exercises.isPending) return <FormLoading />;
    if (detail.isError) return <FormError message={detail.error.message} />;
    if (exercises.isError) return <FormError message={exercises.error.message} />;
    return (
        <WorkoutTemplateForm
            defaultValues={workoutTemplateFormValues(detail.data)}
            exercises={exercises.data.items}
            isSubmitting={mutation.isPending}
            key={`${template.id}:${template.version}`}
            onSubmit={async values => {
                await mutation.mutateAsync(values);
            }}
            submitError={mutation.error}
            submitLabel="Save changes"
        />
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
