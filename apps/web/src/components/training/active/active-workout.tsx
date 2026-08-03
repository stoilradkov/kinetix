import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
    ArrowDown,
    ArrowUp,
    CheckCircle2,
    ChevronLeft,
    LoaderCircle,
    Plus,
    RefreshCw,
    Repeat,
    TriangleAlert,
} from "lucide-react";

import type { ActiveTrainingSessionResponse, TrainingSessionResponse } from "@kinetix/types";

import { ExercisePicker } from "@/components/training/active/exercise-picker";
import { ElapsedTimer, RestTimer } from "@/components/training/session-timers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DecimalField } from "@/components/ui/decimal-field";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    activeTrainingSessionQueryOptions,
    addSessionActivity,
    completeTrainingSession,
    completionPreviewQueryOptions,
    recordPerformedSet,
    reorderSessionActivities,
    substituteOccurrence,
    VersionConflictError,
} from "@/lib/api";
import {
    buildActivityGrids,
    emptySetEntry,
    recordSetRequestFrom,
    type OccurrenceGrid,
    type PlannedActualRow,
    type SetEntryStatus,
    type SetEntryValues,
} from "@/lib/active-session";

type SessionRef = { readonly id: string; readonly version: number };

export function ActiveWorkout({ sessionId }: { readonly sessionId: string }): React.JSX.Element {
    const view = useQuery(activeTrainingSessionQueryOptions(sessionId));

    if (view.isPending)
        return (
            <div className="text-muted-foreground flex items-center gap-2 py-16 text-sm">
                <LoaderCircle className="animate-spin" /> Loading workout…
            </div>
        );
    if (view.isError)
        return (
            <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                {view.error.message}
            </div>
        );
    return <ActiveWorkoutBody view={view.data} />;
}

function ActiveWorkoutBody({ view }: { readonly view: ActiveTrainingSessionResponse }): React.JSX.Element {
    const queryClient = useQueryClient();
    const [conflict, setConflict] = useState(false);
    const session: SessionRef = { id: view.id, version: view.version };

    const runner = useMutation({
        mutationFn: (task: () => Promise<TrainingSessionResponse>) => task(),
        onSuccess: async () => {
            setConflict(false);
            await queryClient.invalidateQueries({ queryKey: ["training-session-active", view.id] });
            await queryClient.invalidateQueries({ queryKey: ["training-sessions"] });
        },
        onError: error => {
            if (error instanceof VersionConflictError) setConflict(true);
        },
    });
    const run = (task: () => Promise<TrainingSessionResponse>) => runner.mutate(task);
    const activityGrids = buildActivityGrids(view);

    const reorder = (index: number, direction: -1 | 1) => {
        const ids = view.activities.map(activity => activity.id);
        const target = index + direction;
        if (target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target]!, ids[index]!];
        run(() => reorderSessionActivities(session, { activityIds: ids }));
    };

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            <div className="flex flex-col gap-3">
                <Button asChild className="w-fit" size="sm" variant="ghost">
                    <Link to="/training/sessions">
                        <ChevronLeft /> All sessions
                    </Link>
                </Button>
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-semibold">{view.title ?? "Workout"}</h1>
                    <Badge variant={view.status === "completed" ? "success" : "info"}>
                        {view.status === "in_progress" ? "In progress" : view.status === "completed" ? "Completed" : "Draft"}
                    </Badge>
                    {view.startedAt !== null && view.status === "in_progress" ? (
                        <ElapsedTimer startedAt={view.startedAt} />
                    ) : null}
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">v{view.version}</span>
                </div>
            </div>

            {conflict ? (
                <div className="border-destructive/30 bg-destructive/10 flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
                    <TriangleAlert className="text-destructive size-4 shrink-0" />
                    <span className="text-destructive flex-1">
                        This workout changed elsewhere. Reload to see the latest before making more edits — your last
                        change was not saved.
                    </span>
                    <Button
                        onClick={async () => {
                            await queryClient.invalidateQueries({ queryKey: ["training-session-active", view.id] });
                            setConflict(false);
                        }}
                        size="sm"
                        variant="outline"
                    >
                        <RefreshCw /> Reload
                    </Button>
                </div>
            ) : null}

            {runner.isError && !conflict ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
                    {runner.error.message}
                </div>
            ) : null}

            <RestTimer />

            {activityGrids.length === 0 ? (
                <p className="text-muted-foreground text-sm">No exercises yet. Add one to start logging sets.</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {activityGrids.map((activity, index) =>
                        activity.occurrences.map(grid => (
                            <OccurrenceCard
                                busy={runner.isPending}
                                grid={grid}
                                index={index}
                                key={grid.occurrence.id}
                                onReorder={reorder}
                                reorderable={activityGrids.length > 1}
                                run={run}
                                session={session}
                            />
                        )),
                    )}
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <AddExerciseDialog busy={runner.isPending} position={view.activities.length} run={run} session={session} />
                <CompleteWorkoutDialog session={session} />
            </div>
        </div>
    );
}

function OccurrenceCard({
    busy,
    grid,
    index,
    onReorder,
    reorderable,
    run,
    session,
}: {
    readonly busy: boolean;
    readonly grid: OccurrenceGrid;
    readonly index: number;
    readonly onReorder: (index: number, direction: -1 | 1) => void;
    readonly reorderable: boolean;
    readonly run: (task: () => Promise<TrainingSessionResponse>) => void;
    readonly session: SessionRef;
}): React.JSX.Element {
    const activityId = grid.activityId;
    return (
        <section className="border-border rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="font-medium">{grid.occurrence.snapshot.name}</span>
                    <Badge variant="outline">{grid.occurrence.snapshot.repetitionSemantics}</Badge>
                </div>
                <div className="flex items-center gap-1">
                    {reorderable ? (
                        <>
                            <Button
                                aria-label="Move up"
                                disabled={busy || index === 0}
                                onClick={() => onReorder(index, -1)}
                                size="icon"
                                variant="ghost"
                            >
                                <ArrowUp />
                            </Button>
                            <Button
                                aria-label="Move down"
                                disabled={busy}
                                onClick={() => onReorder(index, 1)}
                                size="icon"
                                variant="ghost"
                            >
                                <ArrowDown />
                            </Button>
                        </>
                    ) : null}
                    <SubstituteDialog
                        activityId={activityId}
                        busy={busy}
                        occurrenceId={grid.occurrence.id}
                        run={run}
                        session={session}
                    />
                </div>
            </div>
            <div className="flex flex-col gap-2">
                {grid.rows.map((row, rowIndex) => (
                    <SetRow
                        activityId={activityId}
                        busy={busy}
                        key={row.key}
                        occurrenceId={grid.occurrence.id}
                        position={rowIndex}
                        row={row}
                        run={run}
                        session={session}
                    />
                ))}
                <SetRow
                    activityId={activityId}
                    added
                    busy={busy}
                    occurrenceId={grid.occurrence.id}
                    position={grid.rows.length}
                    run={run}
                    session={session}
                />
            </div>
        </section>
    );
}

function SetRow({
    activityId,
    added,
    busy,
    occurrenceId,
    position,
    row,
    run,
    session,
}: {
    readonly activityId: string;
    readonly added?: boolean;
    readonly busy: boolean;
    readonly occurrenceId: string;
    readonly position: number;
    readonly row?: PlannedActualRow;
    readonly run: (task: () => Promise<TrainingSessionResponse>) => void;
    readonly session: SessionRef;
}): React.JSX.Element {
    const performed = row?.performedSet ?? null;
    const [values, setValues] = useState<SetEntryValues>(() =>
        performed
            ? {
                  reps: performed.measurements.reps?.toString() ?? "",
                  loadKg: performed.measurements.externalLoad?.value?.toString() ?? "",
                  rpe: performed.measurements.rpe?.toString() ?? "",
                  status: (performed.status === "added" ? "completed" : performed.status) as SetEntryStatus,
              }
            : emptySetEntry,
    );
    const setId = performed?.id ?? crypto.randomUUID();

    const log = () =>
        run(() =>
            recordPerformedSet(
                session,
                recordSetRequestFrom({
                    activityId,
                    occurrenceId,
                    setId,
                    position,
                    prescribedSetId: row?.prescribedSetId ?? null,
                    values,
                }),
            ),
        );

    return (
        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
                {added ? (
                    <Badge variant="secondary">extra</Badge>
                ) : row?.prescribedLabel !== null && row?.prescribedLabel !== undefined ? (
                    <Badge variant="info">
                        <span className="font-mono tabular-nums">{row.prescribedLabel}</span>
                    </Badge>
                ) : (
                    <Badge variant="outline">unplanned</Badge>
                )}
                <Input
                    aria-label="Reps"
                    className="w-16"
                    inputMode="numeric"
                    onChange={event => setValues(current => ({ ...current, reps: event.target.value }))}
                    placeholder="reps"
                    value={values.reps}
                />
                <DecimalField
                    aria-label="Load in kilograms"
                    className="w-24"
                    onValueChange={loadKg => setValues(current => ({ ...current, loadKg }))}
                    placeholder="load"
                    suffix="kg"
                    value={values.loadKg}
                />
                <Input
                    aria-label="RPE"
                    className="w-16"
                    inputMode="decimal"
                    onChange={event => setValues(current => ({ ...current, rpe: event.target.value }))}
                    placeholder="RPE"
                    value={values.rpe}
                />
                <Select
                    onValueChange={status => setValues(current => ({ ...current, status: status as SetEntryStatus }))}
                    value={values.status}
                >
                    <SelectTrigger className="w-32" size="sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="partial">Partial</SelectItem>
                        <SelectItem value="skipped">Skipped</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <Button disabled={busy} onClick={log} size="sm" variant={performed ? "outline" : "default"}>
                {performed ? "Update" : "Log"}
            </Button>
        </div>
    );
}

function AddExerciseDialog({
    busy,
    position,
    run,
    session,
}: {
    readonly busy: boolean;
    readonly position: number;
    readonly run: (task: () => Promise<TrainingSessionResponse>) => void;
    readonly session: SessionRef;
}): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
    return (
        <Dialog onOpenChange={setOpen} open={open}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                    <Plus /> Add exercise
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add exercise</DialogTitle>
                    <DialogDescription>Add a strength exercise to this workout.</DialogDescription>
                </DialogHeader>
                <ExercisePicker onSelect={setSelected} selectedId={selected?.id} />
                <DialogFooter>
                    <Button
                        disabled={busy || selected === null}
                        onClick={() => {
                            if (!selected) return;
                            run(() =>
                                addSessionActivity(session, {
                                    activity: {
                                        id: crypto.randomUUID(),
                                        type: "strength",
                                        position,
                                        strength: {
                                            occurrences: [
                                                { id: crypto.randomUUID(), exerciseId: selected.id, position: 0 },
                                            ],
                                        },
                                    },
                                }),
                            );
                            setSelected(null);
                            setOpen(false);
                        }}
                    >
                        Add
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function SubstituteDialog({
    activityId,
    busy,
    occurrenceId,
    run,
    session,
}: {
    readonly activityId: string;
    readonly busy: boolean;
    readonly occurrenceId: string;
    readonly run: (task: () => Promise<TrainingSessionResponse>) => void;
    readonly session: SessionRef;
}): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
    const [reason, setReason] = useState("");
    return (
        <Dialog onOpenChange={setOpen} open={open}>
            <DialogTrigger asChild>
                <Button aria-label="Substitute exercise" size="icon" variant="ghost">
                    <Repeat />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Substitute exercise</DialogTitle>
                    <DialogDescription>Swap this exercise for another and record why.</DialogDescription>
                </DialogHeader>
                <ExercisePicker onSelect={setSelected} selectedId={selected?.id} />
                <Input onChange={event => setReason(event.target.value)} placeholder="Reason (optional)" value={reason} />
                <DialogFooter>
                    <Button
                        disabled={busy || selected === null}
                        onClick={() => {
                            if (!selected) return;
                            run(() =>
                                substituteOccurrence(session, {
                                    activityId,
                                    occurrenceId,
                                    newExerciseId: selected.id,
                                    reason: reason.trim() || undefined,
                                }),
                            );
                            setSelected(null);
                            setReason("");
                            setOpen(false);
                        }}
                    >
                        Substitute
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CompleteWorkoutDialog({ session }: { readonly session: SessionRef }): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const preview = useQuery(completionPreviewQueryOptions(session.id, open));
    const complete = useMutation({
        mutationFn: () => completeTrainingSession(session),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["training-sessions"] });
            await navigate({ to: "/training/sessions" });
        },
    });

    return (
        <Dialog onOpenChange={setOpen} open={open}>
            <DialogTrigger asChild>
                <Button size="sm">
                    <CheckCircle2 /> Complete workout
                </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>Review &amp; complete</DialogTitle>
                    <DialogDescription>Check these before finishing. You can reopen later to correct.</DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {preview.isPending ? (
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                            <LoaderCircle className="animate-spin" /> Checking…
                        </div>
                    ) : preview.isError ? (
                        <p className="text-destructive text-sm">{preview.error.message}</p>
                    ) : (
                        <div className="flex flex-col gap-4">
                            <section className="flex flex-col gap-2">
                                <h3 className="text-sm font-medium">Validation</h3>
                                {preview.data.issues.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">Everything looks complete.</p>
                                ) : (
                                    preview.data.issues.map((issue, index) => (
                                        <div className="flex items-start gap-2 text-sm" key={`${issue.code}-${index}`}>
                                            <Badge variant={issue.severity === "blocker" ? "destructive" : "warning"}>
                                                {issue.severity}
                                            </Badge>
                                            <span>{issue.message}</span>
                                        </div>
                                    ))
                                )}
                            </section>
                            {preview.data.plannedOutcomes.length > 0 ? (
                                <section className="flex flex-col gap-2">
                                    <h3 className="text-sm font-medium">Planned sessions</h3>
                                    {preview.data.plannedOutcomes.map(outcome => (
                                        <div
                                            className="flex items-center gap-2 text-sm"
                                            key={outcome.plannedSessionId}
                                        >
                                            <Badge
                                                variant={
                                                    outcome.projectedStatus === "completed" ? "success" : "info"
                                                }
                                            >
                                                {outcome.projectedStatus.replace("_", " ")}
                                            </Badge>
                                            <span className="text-muted-foreground font-mono tabular-nums text-xs">
                                                {outcome.coveredSetCount}/{outcome.prescribedSetCount} sets
                                            </span>
                                        </div>
                                    ))}
                                </section>
                            ) : null}
                        </div>
                    )}
                </div>
                <DialogFooter className="p-6 pt-0">
                    {complete.isError ? (
                        <p className="text-destructive w-full text-sm" role="alert">
                            {complete.error.message}
                        </p>
                    ) : null}
                    <Button disabled={complete.isPending} onClick={() => complete.mutate()}>
                        {complete.isPending ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
                        Complete workout
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
