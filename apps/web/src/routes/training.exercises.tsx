import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
    Archive,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    History,
    Link2,
    Merge,
    Pencil,
    Plus,
    RotateCcw,
    Search,
    Unlink,
} from "lucide-react";

import type { ExerciseCatalogItemResponse, ExerciseMergePreviewResponse, ExerciseMergeResource } from "@kinetix/types";

import { ExerciseForm, ExerciseFormLoadState } from "@/components/training/exercise-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
    changeExerciseStatus,
    createExercise,
    exerciseFormCatalogQueryOptions,
    exerciseListQueryOptions,
    exerciseMergeHistoryQueryOptions,
    exerciseRevisionHistoryQueryOptions,
    mergeExercises,
    previewExerciseMerge,
    replaceExerciseAliases,
    replaceExerciseMuscles,
    replaceExerciseRelationships,
    revertExerciseMerge,
    updateExercise,
} from "@/lib/api";
import {
    commaValues,
    exerciseCreateInput,
    exerciseMetadataInput,
    type ExerciseFormCatalogs,
    type ExerciseFormValues,
} from "@/lib/exercise-form";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/training/exercises")({
    component: ExerciseCatalogPage,
});

type CatalogStatus = "active" | "archived" | "all";

const PAGE_SIZE = 8;

function ExerciseCatalogPage(): React.JSX.Element {
    const queryClient = useQueryClient();
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState<CatalogStatus>("active");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [page, setPage] = useState(1);
    const list = useQuery(exerciseListQueryOptions(search, status));
    const allExercises = useQuery(exerciseListQueryOptions("", "all"));
    const formCatalogs = useQuery(exerciseFormCatalogQueryOptions);
    const exercises = list.data?.items ?? [];
    const selected = allExercises.data?.items.find(exercise => exercise.id === selectedId) ?? null;

    const total = exercises.length;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * PAGE_SIZE;
    const pageItems = exercises.slice(start, start + PAGE_SIZE);

    const resetTo = (next: () => void) => {
        next();
        setPage(1);
    };

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["training"] });
    };
    const createMutation = useMutation({
        mutationFn: createExercise,
        onSuccess: async exercise => {
            setCreateOpen(false);
            setSelectedId(exercise.id);
            await refresh();
        },
    });
    const saveMutation = useMutation({
        mutationFn: async ({
            exercise,
            values,
        }: {
            exercise: ExerciseCatalogItemResponse;
            values: ExerciseFormValues;
        }) => {
            let current = await updateExercise(exercise, exerciseMetadataInput(values));
            current = await replaceExerciseAliases(current, commaValues(values.aliases));
            current = await replaceExerciseMuscles(current, [
                { muscleGroupId: values.primaryMuscleId, role: "primary" },
            ]);
            return current;
        },
        onSuccess: async exercise => {
            setSelectedId(exercise.id);
            await refresh();
        },
    });
    const statusMutation = useMutation({
        mutationFn: changeExerciseStatus,
        onSuccess: async exercise => {
            setSelectedId(exercise.id);
            await refresh();
        },
    });
    const relationshipMutation = useMutation({
        mutationFn: ({
            exercise,
            relationships,
        }: {
            exercise: ExerciseCatalogItemResponse;
            relationships: ExerciseCatalogItemResponse["relationships"];
        }) => replaceExerciseRelationships(exercise, { relationships }),
        onSuccess: refresh,
    });
    const revertMutation = useMutation({
        mutationFn: revertExerciseMerge,
        onSuccess: refresh,
    });
    // Create and save errors surface inside their own dialogs (via submitError); only the
    // inline drawer actions have nowhere else to report, so they bubble up to this banner.
    const error = [statusMutation.error, relationshipMutation.error, revertMutation.error].find(
        candidate => candidate instanceof Error,
    );

    return (
        <main className="mx-auto max-w-7xl px-6 py-10">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <Badge variant="info">Training catalog</Badge>
                    <h1 className="mt-3 text-3xl font-semibold tracking-tight">Exercise definitions</h1>
                    <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                        Search, version, relate, archive, and safely consolidate the definitions used by current
                        training data.
                    </p>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus />
                    New exercise
                </Button>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                    <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4" />
                    <Input
                        className="pl-9"
                        onChange={event => resetTo(() => setSearch(event.target.value))}
                        placeholder="Search names and aliases"
                        value={search}
                    />
                </div>
                <Select onValueChange={value => resetTo(() => setStatus(value as CatalogStatus))} value={status}>
                    <SelectTrigger className="w-full sm:w-40">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                        <SelectItem value="all">All states</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {error ? (
                <div className="bg-destructive/10 text-destructive border-destructive/30 mt-4 rounded-lg border p-3 text-sm">
                    {error.message}
                </div>
            ) : null}

            <div className="bg-card mt-6 overflow-hidden rounded-xl border">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Exercise</TableHead>
                                <TableHead>Pattern</TableHead>
                                <TableHead className="text-right">Version</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pageItems.map(exercise => (
                                <TableRow
                                    className={cn(
                                        "cursor-pointer",
                                        selected?.id === exercise.id ? "bg-muted" : undefined,
                                    )}
                                    key={exercise.id}
                                    onClick={() => {
                                        setSelectedId(exercise.id);
                                        setDetailOpen(true);
                                    }}
                                >
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{exercise.name}</span>
                                            <Badge variant={exercise.status === "active" ? "success" : "secondary"}>
                                                {exercise.status}
                                            </Badge>
                                        </div>
                                        <p className="text-muted-foreground mt-1 text-xs">{exercise.equipment.name}</p>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {exercise.movementPattern.name}
                                    </TableCell>
                                    <TableCell className="text-right font-mono tabular-nums">
                                        {exercise.version}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {!list.isPending && total === 0 ? (
                                <TableRow>
                                    <TableCell className="text-muted-foreground h-32 text-center" colSpan={3}>
                                        No exercises match this view.
                                    </TableCell>
                                </TableRow>
                            ) : null}
                        </TableBody>
                    </Table>
                </div>
                <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                        {total === 0 ? "No results" : `${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            disabled={safePage <= 1}
                            onClick={() => setPage(current => Math.max(1, current - 1))}
                            size="sm"
                            variant="outline"
                        >
                            <ChevronLeft />
                            Prev
                        </Button>
                        <span className="text-muted-foreground font-mono text-xs tabular-nums">
                            {safePage} / {pageCount}
                        </span>
                        <Button
                            disabled={safePage >= pageCount}
                            onClick={() => setPage(current => Math.min(pageCount, current + 1))}
                            size="sm"
                            variant="outline"
                        >
                            Next
                            <ChevronRight />
                        </Button>
                    </div>
                </div>
            </div>

            <Sheet onOpenChange={setDetailOpen} open={detailOpen}>
                <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
                    <SheetHeader className="sr-only">
                        <SheetTitle>{selected?.name ?? "Exercise"}</SheetTitle>
                        <SheetDescription>Exercise definition detail.</SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {selected && formCatalogs.data && allExercises.data ? (
                            <ExerciseDetail
                                allExercises={allExercises.data.items}
                                catalogs={formCatalogs.data}
                                exercise={selected}
                                onRelationships={relationships =>
                                    relationshipMutation.mutate({ exercise: selected, relationships })
                                }
                                onRevert={merge => revertMutation.mutate(merge)}
                                isSaving={saveMutation.isPending}
                                onSave={async values => {
                                    await saveMutation.mutateAsync({ exercise: selected, values });
                                }}
                                onStatus={() => statusMutation.mutate(selected)}
                                clearSaveError={() => saveMutation.reset()}
                                refresh={refresh}
                                saveError={saveMutation.error}
                            />
                        ) : (
                            <div className="text-muted-foreground grid min-h-40 place-items-center text-sm">
                                Loading…
                            </div>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
                    <DialogHeader className="border-b p-6">
                        <DialogTitle>Create exercise</DialogTitle>
                        <DialogDescription>
                            Create a user-owned definition with explicit analytics metadata.
                        </DialogDescription>
                    </DialogHeader>
                    {formCatalogs.data ? (
                        <ExerciseForm
                            catalogs={formCatalogs.data}
                            isSubmitting={createMutation.isPending}
                            onSubmit={async values => {
                                await createMutation.mutateAsync(exerciseCreateInput(values));
                            }}
                            submitError={createMutation.error}
                            submitLabel="Create exercise"
                        />
                    ) : (
                        <ExerciseFormLoadState error={formCatalogs.error} onRetry={() => void formCatalogs.refetch()} />
                    )}
                </DialogContent>
            </Dialog>
        </main>
    );
}

function ExerciseDetail({
    exercise,
    allExercises,
    catalogs,
    onSave,
    onStatus,
    onRelationships,
    onRevert,
    refresh,
    isSaving,
    saveError,
    clearSaveError,
}: {
    exercise: ExerciseCatalogItemResponse;
    allExercises: readonly ExerciseCatalogItemResponse[];
    catalogs: ExerciseFormCatalogs;
    isSaving: boolean;
    onSave: (values: ExerciseFormValues) => Promise<void>;
    onStatus: () => void;
    onRelationships: (relationships: ExerciseCatalogItemResponse["relationships"]) => void;
    onRevert: (merge: ExerciseMergeResource) => void;
    refresh: () => Promise<void>;
    saveError: Error | null;
    clearSaveError: () => void;
}): React.JSX.Element {
    const [editOpen, setEditOpen] = useState(false);
    const [mergeOpen, setMergeOpen] = useState(false);
    const [relationshipsOpen, setRelationshipsOpen] = useState(false);
    const revisions = useQuery(exerciseRevisionHistoryQueryOptions(exercise.id));
    const merges = useQuery(exerciseMergeHistoryQueryOptions(exercise.id));
    const names = new Map(allExercises.map(candidate => [candidate.id, candidate.name]));

    return (
        <div>
            {/* Header + actions cluster — all editing lives here, kept apart from the read-only sections below. */}
            <div className="flex flex-wrap items-start justify-between gap-4 pr-10">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-2xl font-semibold">{exercise.name}</h2>
                        <Badge variant={exercise.status === "active" ? "success" : "secondary"}>
                            {exercise.status}
                        </Badge>
                        <Badge variant={exercise.ownership === "seeded" ? "info" : "outline"}>
                            {exercise.ownership}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 font-mono text-xs">{exercise.slug}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setEditOpen(true)} size="sm" variant="outline">
                        <Pencil />
                        Edit
                    </Button>
                    {exercise.status === "active" ? (
                        <Button onClick={() => setMergeOpen(true)} size="sm" variant="outline">
                            <Merge />
                            Merge
                        </Button>
                    ) : null}
                    <Button onClick={onStatus} size="sm" variant="outline">
                        {exercise.status === "active" ? <Archive /> : <RotateCcw />}
                        {exercise.status === "active" ? "Archive" : "Restore"}
                    </Button>
                </div>
            </div>

            <Section title="Overview">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                    <Metadata label="Equipment" value={exercise.equipment.name} />
                    <Metadata label="Movement" value={exercise.movementPattern.name} />
                    <Metadata label="Classification" value={exercise.classification} />
                    <Metadata label="Laterality" value={exercise.laterality} />
                    <Metadata label="Repetition semantics" value={exercise.repetitionSemantics.replace("_", " ")} />
                    <Metadata label="Body position" value={exercise.bodyPosition} />
                </dl>
            </Section>

            <Section title="Muscles & measurements">
                <div className="flex flex-wrap gap-2">
                    {exercise.muscles.map(assignment => (
                        <Badge
                            key={assignment.muscle.id}
                            variant={assignment.role === "primary" ? "success" : "outline"}
                        >
                            {assignment.muscle.name} · {assignment.role}
                        </Badge>
                    ))}
                    {exercise.supportedMeasurements.map(measurement => (
                        <Badge key={measurement} variant="secondary">
                            {measurement.replaceAll("_", " ")}
                        </Badge>
                    ))}
                </div>
            </Section>

            <Section
                title="Relationships"
                aside={
                    <Button onClick={() => setRelationshipsOpen(true)} size="sm" variant="ghost">
                        <Link2 />
                        Edit
                    </Button>
                }
            >
                {exercise.relationships.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No related definitions.</p>
                ) : (
                    <ul className="divide-y text-sm">
                        {exercise.relationships.map(relationship => (
                            <li
                                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                                key={`${relationship.type}:${relationship.targetExerciseId}`}
                            >
                                <span className="truncate">
                                    {names.get(relationship.targetExerciseId) ?? relationship.targetExerciseId}
                                </span>
                                <Badge variant="outline">{relationship.type.replaceAll("_", " ")}</Badge>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <Section
                title="Definition history"
                aside={
                    <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs tabular-nums">
                        <History className="size-3.5" />v{exercise.version}
                    </span>
                }
            >
                {revisions.data && revisions.data.items.length > 0 ? (
                    <ul className="divide-y text-sm">
                        {revisions.data.items.slice(0, 4).map(revision => (
                            <li className="py-2.5 first:pt-0 last:pb-0" key={revision.version}>
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="font-medium">{revision.summary}</span>
                                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                        v{revision.version}
                                    </span>
                                </div>
                                <p className="text-muted-foreground mt-0.5 text-xs">{formatDate(revision.createdAt)}</p>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted-foreground text-sm">No revisions recorded.</p>
                )}
            </Section>

            <Section title="Merge history">
                {merges.data && merges.data.items.length > 0 ? (
                    <ul className="divide-y text-sm">
                        {merges.data.items.map(merge => (
                            <li className="py-3 first:pt-0 last:pb-0" key={merge.id}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="flex items-center gap-1.5">
                                            <span className="truncate">{merge.mergedExercise.name}</span>
                                            <ArrowRight className="text-muted-foreground size-3 shrink-0" />
                                            <span className="truncate">{merge.canonicalExercise.name}</span>
                                        </p>
                                        <p className="text-muted-foreground mt-0.5 text-xs">
                                            {formatDate(merge.appliedAt)}
                                        </p>
                                    </div>
                                    <Badge variant={merge.status === "applied" ? "warning" : "secondary"}>
                                        {merge.status}
                                    </Badge>
                                </div>
                                {merge.status === "applied" ? (
                                    <Button
                                        className="mt-2"
                                        onClick={() => onRevert(merge)}
                                        size="sm"
                                        variant="outline"
                                    >
                                        <Unlink />
                                        Revert merge
                                    </Button>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted-foreground text-sm">No merge decisions affect this definition.</p>
                )}
            </Section>

            <Dialog
                onOpenChange={open => {
                    setEditOpen(open);
                    if (!open) clearSaveError();
                }}
                open={editOpen}
            >
                <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
                    <DialogHeader className="border-b p-6">
                        <DialogTitle>Version {exercise.name}</DialogTitle>
                        <DialogDescription>
                            {exercise.ownership === "seeded"
                                ? "Saving creates your own definition and leaves the seeded parent immutable."
                                : "Saving appends an immutable revision to this definition."}
                        </DialogDescription>
                    </DialogHeader>
                    <ExerciseForm
                        catalogs={catalogs}
                        exercise={exercise}
                        isSubmitting={isSaving}
                        onSubmit={async values => {
                            await onSave(values);
                            setEditOpen(false);
                        }}
                        submitError={saveError}
                        submitLabel="Save new version"
                    />
                </DialogContent>
            </Dialog>

            <RelationshipsDialog
                allExercises={allExercises}
                exercise={exercise}
                key={`${exercise.id}:${exercise.version}`}
                onOpenChange={setRelationshipsOpen}
                onSave={relationships => {
                    onRelationships(relationships);
                    setRelationshipsOpen(false);
                }}
                open={relationshipsOpen}
            />

            <MergeDialog
                allExercises={allExercises}
                canonical={exercise}
                onApplied={async () => {
                    setMergeOpen(false);
                    await refresh();
                }}
                onOpenChange={setMergeOpen}
                open={mergeOpen}
            />
        </div>
    );
}

function RelationshipsDialog({
    exercise,
    allExercises,
    open,
    onOpenChange,
    onSave,
}: {
    exercise: ExerciseCatalogItemResponse;
    allExercises: readonly ExerciseCatalogItemResponse[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (relationships: ExerciseCatalogItemResponse["relationships"]) => void;
}): React.JSX.Element {
    const [relationships, setRelationships] = useState([...exercise.relationships]);
    const candidates = allExercises.filter(candidate => candidate.id !== exercise.id);
    const [targetId, setTargetId] = useState(candidates[0]?.id ?? "");
    const [type, setType] = useState<ExerciseCatalogItemResponse["relationships"][number]["type"]>("variation");
    const names = new Map(allExercises.map(candidate => [candidate.id, candidate.name]));

    const add = () => {
        if (
            !targetId ||
            relationships.some(relationship => relationship.targetExerciseId === targetId && relationship.type === type)
        )
            return;
        setRelationships(current => [...current, { targetExerciseId: targetId, type }]);
    };

    return (
        <Dialog onOpenChange={onOpenChange} open={open}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Edit relationships</DialogTitle>
                    <DialogDescription>
                        Link this definition to variations, progressions, or an analytics family.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2 sm:flex-row">
                    <Select onValueChange={setTargetId} value={targetId}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Target exercise" />
                        </SelectTrigger>
                        <SelectContent>
                            {candidates.map(candidate => (
                                <SelectItem key={candidate.id} value={candidate.id}>
                                    {candidate.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select onValueChange={value => setType(value as typeof type)} value={type}>
                        <SelectTrigger className="w-full sm:w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="variation">Variation</SelectItem>
                            <SelectItem value="progression">Progression</SelectItem>
                            <SelectItem value="regression">Regression</SelectItem>
                            <SelectItem value="analytics_family">Analytics family</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={add} type="button" variant="outline">
                        Add
                    </Button>
                </div>

                {relationships.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No related definitions yet.</p>
                ) : (
                    <ul className="divide-y rounded-lg border">
                        {relationships.map((relationship, index) => (
                            <li
                                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                                key={`${relationship.type}:${relationship.targetExerciseId}`}
                            >
                                <span className="truncate">
                                    {names.get(relationship.targetExerciseId) ?? relationship.targetExerciseId} ·{" "}
                                    <span className="text-muted-foreground">
                                        {relationship.type.replaceAll("_", " ")}
                                    </span>
                                </span>
                                <Button
                                    aria-label="Remove relationship"
                                    onClick={() =>
                                        setRelationships(current => current.filter((_, item) => item !== index))
                                    }
                                    size="icon"
                                    type="button"
                                    variant="ghost"
                                >
                                    <Unlink />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}

                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
                        Cancel
                    </Button>
                    <Button onClick={() => onSave(relationships)} type="button">
                        Save relationships
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function MergeDialog({
    canonical,
    allExercises,
    open,
    onOpenChange,
    onApplied,
}: {
    canonical: ExerciseCatalogItemResponse;
    allExercises: readonly ExerciseCatalogItemResponse[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApplied: () => Promise<void>;
}): React.JSX.Element {
    const candidates = allExercises.filter(
        exercise => exercise.id !== canonical.id && exercise.status === "active" && exercise.ownership === "user",
    );
    const [mergedId, setMergedId] = useState(candidates[0]?.id ?? "");
    const [reason, setReason] = useState("");
    const [preview, setPreview] = useState<ExerciseMergePreviewResponse | null>(null);
    const merged = allExercises.find(exercise => exercise.id === mergedId) ?? null;
    const previewMutation = useMutation({
        mutationFn: previewExerciseMerge,
        onSuccess: setPreview,
    });
    const mergeMutation = useMutation({
        mutationFn: mergeExercises,
        onSuccess: onApplied,
    });
    const input = merged
        ? {
              canonicalExerciseId: canonical.id,
              mergedExerciseId: merged.id,
              expectedCanonicalVersion: canonical.version,
              expectedMergedVersion: merged.version,
          }
        : null;

    return (
        <Dialog onOpenChange={onOpenChange} open={open}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Merge duplicate exercise</DialogTitle>
                    <DialogDescription>
                        Current references and aliases move to the canonical definition. Historical snapshots and
                        external IDs remain unchanged, and the decision can be reverted.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    <Label>Duplicate to merge</Label>
                    <Select
                        onValueChange={value => {
                            setMergedId(value);
                            setPreview(null);
                        }}
                        value={mergedId}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Choose a user-owned duplicate" />
                        </SelectTrigger>
                        <SelectContent>
                            {candidates.map(candidate => (
                                <SelectItem key={candidate.id} value={candidate.id}>
                                    {candidate.name} · v{candidate.version}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {preview ? (
                    <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
                        <ImpactCard
                            label="Before"
                            lines={[
                                preview.mergedExercise.name,
                                `${preview.totalReferenceCount} current references`,
                                `${preview.redirectedAliases.length} retained aliases`,
                            ]}
                        />
                        <ArrowRight className="text-muted-foreground mx-auto self-center" />
                        <ImpactCard
                            label="After"
                            lines={[
                                preview.canonicalExercise.name,
                                "Duplicate unavailable for new work",
                                "Historical snapshots preserved",
                            ]}
                        />
                    </div>
                ) : (
                    <Button
                        disabled={!input || previewMutation.isPending}
                        onClick={() => input && previewMutation.mutate(input)}
                        type="button"
                        variant="outline"
                    >
                        Preview impact
                    </Button>
                )}

                {preview ? (
                    <div className="space-y-2">
                        <Label htmlFor="merge-reason">Reason</Label>
                        <Textarea
                            id="merge-reason"
                            onChange={event => setReason(event.target.value)}
                            placeholder="Why these definitions are duplicates"
                            value={reason}
                        />
                    </div>
                ) : null}

                {previewMutation.error || mergeMutation.error ? (
                    <p className="text-destructive text-sm">
                        {(previewMutation.error ?? mergeMutation.error)?.message}
                    </p>
                ) : null}

                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
                        Cancel
                    </Button>
                    <Button
                        disabled={!preview || !input || mergeMutation.isPending}
                        onClick={() =>
                            input &&
                            mergeMutation.mutate({
                                ...input,
                                ...(reason.trim() ? { reason: reason.trim() } : {}),
                            })
                        }
                        type="button"
                    >
                        Merge and redirect
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Section({
    title,
    aside,
    children,
}: {
    title: string;
    aside?: React.ReactNode;
    children: React.ReactNode;
}): React.JSX.Element {
    return (
        <section className="mt-6 border-t pt-5">
            <div className="flex min-h-8 items-center justify-between gap-3">
                <h3 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                    {title}
                </h3>
                {aside}
            </div>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function Metadata({ label, value }: { label: string; value: string }): React.JSX.Element {
    return (
        <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
            <dd className="mt-1 capitalize">{value}</dd>
        </div>
    );
}

function ImpactCard({ label, lines }: { label: string; lines: readonly string[] }): React.JSX.Element {
    return (
        <div className="rounded-lg border p-4">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
            {lines.map((line, index) => (
                <p className={index === 0 ? "mt-2 font-medium" : "text-muted-foreground mt-1 text-xs"} key={line}>
                    {line}
                </p>
            ))}
        </div>
    );
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
