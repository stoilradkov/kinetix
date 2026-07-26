import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, ArrowRight, History, Merge, Pencil, Plus, RotateCcw, Search, Unlink } from "lucide-react";

import type {
    ExerciseCatalogItemResponse,
    ExerciseMergePreviewResponse,
    ExerciseMergeResource,
    ExtensibleCatalogItemResponse,
    MuscleCatalogItemResponse,
} from "@kinetix/types";

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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/training/exercises")({
    component: ExerciseCatalogPage,
});

type CatalogStatus = "active" | "archived" | "all";

interface ExerciseDraft {
    slug: string;
    name: string;
    aliases: string;
    equipmentTypeId: string;
    movementPatternId: string;
    classification: "compound" | "isolation";
    laterality: "bilateral" | "unilateral";
    bodyPosition: string;
    repetitionSemantics: "total" | "per_side" | "alternating";
    loadModel: "external_only" | "full_bodyweight_plus_added_minus_assistance" | "manual_effective_load" | "none";
    supportedMeasurements: string;
    primaryMuscleId: string;
    notes: string;
    position: string;
}

function ExerciseCatalogPage(): React.JSX.Element {
    const queryClient = useQueryClient();
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState<CatalogStatus>("active");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const list = useQuery(exerciseListQueryOptions(search, status));
    const allExercises = useQuery(exerciseListQueryOptions("", "all"));
    const formCatalogs = useQuery(exerciseFormCatalogQueryOptions);
    const exercises = list.data?.items ?? [];
    const visibleSelectedId = exercises.some(exercise => exercise.id === selectedId)
        ? selectedId
        : (exercises[0]?.id ?? null);
    const selected = allExercises.data?.items.find(exercise => exercise.id === visibleSelectedId) ?? null;

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
        mutationFn: async ({ exercise, draft }: { exercise: ExerciseCatalogItemResponse; draft: ExerciseDraft }) => {
            let current = await updateExercise(exercise, metadataInput(draft));
            current = await replaceExerciseAliases(current, commaValues(draft.aliases));
            current = await replaceExerciseMuscles(current, [
                { muscleGroupId: draft.primaryMuscleId, role: "primary" },
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
    const error = [
        createMutation.error,
        saveMutation.error,
        statusMutation.error,
        relationshipMutation.error,
        revertMutation.error,
    ].find(candidate => candidate instanceof Error);

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
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Search names and aliases"
                        value={search}
                    />
                </div>
                <Select onValueChange={value => setStatus(value as CatalogStatus)} value={status}>
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

            <div className="mt-6 grid min-h-[36rem] overflow-hidden rounded-xl border lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)]">
                <section className="overflow-x-auto border-b lg:border-r lg:border-b-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Exercise</TableHead>
                                <TableHead>Pattern</TableHead>
                                <TableHead className="text-right">Version</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {exercises.map(exercise => (
                                <TableRow
                                    className={cn(
                                        "cursor-pointer",
                                        selected?.id === exercise.id ? "bg-muted" : undefined,
                                    )}
                                    key={exercise.id}
                                    onClick={() => setSelectedId(exercise.id)}
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
                            {!list.isPending && exercises.length === 0 ? (
                                <TableRow>
                                    <TableCell className="text-muted-foreground h-32 text-center" colSpan={3}>
                                        No exercises match this view.
                                    </TableCell>
                                </TableRow>
                            ) : null}
                        </TableBody>
                    </Table>
                </section>

                <section className="bg-card p-6">
                    {selected && formCatalogs.data && allExercises.data ? (
                        <ExerciseDetail
                            allExercises={allExercises.data.items}
                            catalogs={formCatalogs.data}
                            exercise={selected}
                            onRelationships={relationships =>
                                relationshipMutation.mutate({ exercise: selected, relationships })
                            }
                            onRevert={merge => revertMutation.mutate(merge)}
                            onSave={draft => saveMutation.mutate({ exercise: selected, draft })}
                            onStatus={() => statusMutation.mutate(selected)}
                            refresh={refresh}
                        />
                    ) : (
                        <div className="grid h-full place-items-center text-center">
                            <div>
                                <p className="font-medium">Select an exercise</p>
                                <p className="text-muted-foreground mt-1 text-sm">
                                    Its metadata, revisions, relationships, and merge history appear here.
                                </p>
                            </div>
                        </div>
                    )}
                </section>
            </div>

            <Dialog onOpenChange={setCreateOpen} open={createOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Create exercise</DialogTitle>
                        <DialogDescription>
                            Create a user-owned definition with explicit analytics metadata.
                        </DialogDescription>
                    </DialogHeader>
                    {formCatalogs.data ? (
                        <ExerciseForm
                            catalogs={formCatalogs.data}
                            onSubmit={draft => createMutation.mutate(createInput(draft))}
                            submitLabel="Create exercise"
                        />
                    ) : null}
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
}: {
    exercise: ExerciseCatalogItemResponse;
    allExercises: readonly ExerciseCatalogItemResponse[];
    catalogs: ExerciseFormCatalogs;
    onSave: (draft: ExerciseDraft) => void;
    onStatus: () => void;
    onRelationships: (relationships: ExerciseCatalogItemResponse["relationships"]) => void;
    onRevert: (merge: ExerciseMergeResource) => void;
    refresh: () => Promise<void>;
}): React.JSX.Element {
    const [editOpen, setEditOpen] = useState(false);
    const [mergeOpen, setMergeOpen] = useState(false);
    const revisions = useQuery(exerciseRevisionHistoryQueryOptions(exercise.id));
    const merges = useQuery(exerciseMergeHistoryQueryOptions(exercise.id));

    return (
        <div>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold">{exercise.name}</h2>
                        <Badge variant={exercise.ownership === "seeded" ? "info" : "outline"}>
                            {exercise.ownership}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 font-mono text-xs">{exercise.slug}</p>
                </div>
                <div className="flex gap-2">
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
                </div>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                <Metadata label="Equipment" value={exercise.equipment.name} />
                <Metadata label="Movement" value={exercise.movementPattern.name} />
                <Metadata label="Classification" value={exercise.classification} />
                <Metadata label="Laterality" value={exercise.laterality} />
                <Metadata label="Repetition semantics" value={exercise.repetitionSemantics.replace("_", " ")} />
                <Metadata label="Body position" value={exercise.bodyPosition} />
            </dl>

            <div className="mt-6">
                <h3 className="text-sm font-semibold">Muscles and measurements</h3>
                <div className="mt-2 flex flex-wrap gap-2">
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
            </div>

            <RelationshipEditor
                allExercises={allExercises}
                exercise={exercise}
                key={`${exercise.id}:${exercise.version}`}
                onSave={onRelationships}
            />

            <section className="mt-7 border-t pt-6">
                <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <History className="size-4" />
                        Definition history
                    </h3>
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">v{exercise.version}</span>
                </div>
                <div className="mt-3 space-y-2">
                    {revisions.data?.items.slice(0, 4).map(revision => (
                        <div className="bg-muted rounded-lg p-3 text-xs" key={revision.version}>
                            <div className="flex justify-between gap-3">
                                <span>{revision.summary}</span>
                                <span className="font-mono tabular-nums">v{revision.version}</span>
                            </div>
                            <p className="text-muted-foreground mt-1">{formatDate(revision.createdAt)}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="mt-7 border-t pt-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Merge className="size-4" />
                    Merge history
                </h3>
                <div className="mt-3 space-y-2">
                    {merges.data?.items.map(merge => (
                        <div className="rounded-lg border p-3 text-xs" key={merge.id}>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p>
                                        {merge.mergedExercise.name} <ArrowRight className="mx-1 inline size-3" />{" "}
                                        {merge.canonicalExercise.name}
                                    </p>
                                    <p className="text-muted-foreground mt-1">{formatDate(merge.appliedAt)}</p>
                                </div>
                                <Badge variant={merge.status === "applied" ? "warning" : "secondary"}>
                                    {merge.status}
                                </Badge>
                            </div>
                            {merge.status === "applied" ? (
                                <Button className="mt-3" onClick={() => onRevert(merge)} size="sm" variant="outline">
                                    <Unlink />
                                    Revert merge
                                </Button>
                            ) : null}
                        </div>
                    ))}
                    {merges.data?.items.length === 0 ? (
                        <p className="text-muted-foreground text-xs">No merge decisions affect this definition.</p>
                    ) : null}
                </div>
            </section>

            <div className="mt-7 border-t pt-6">
                <Button onClick={onStatus} size="sm" variant="outline">
                    {exercise.status === "active" ? <Archive /> : <RotateCcw />}
                    {exercise.status === "active" ? "Archive" : "Restore"}
                </Button>
            </div>

            <Dialog onOpenChange={setEditOpen} open={editOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
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
                        onSubmit={draft => {
                            onSave(draft);
                            setEditOpen(false);
                        }}
                        submitLabel="Save new version"
                    />
                </DialogContent>
            </Dialog>

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

function RelationshipEditor({
    exercise,
    allExercises,
    onSave,
}: {
    exercise: ExerciseCatalogItemResponse;
    allExercises: readonly ExerciseCatalogItemResponse[];
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
        <section className="mt-7 border-t pt-6">
            <h3 className="text-sm font-semibold">Relationships</h3>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
                <Button onClick={add} size="sm" type="button" variant="outline">
                    Add
                </Button>
            </div>
            <div className="mt-3 space-y-2">
                {relationships.map((relationship, index) => (
                    <div
                        className="bg-muted flex items-center justify-between rounded-lg p-2 text-xs"
                        key={`${relationship.type}:${relationship.targetExerciseId}`}
                    >
                        <span>
                            {names.get(relationship.targetExerciseId) ?? relationship.targetExerciseId} ·{" "}
                            {relationship.type.replaceAll("_", " ")}
                        </span>
                        <Button
                            aria-label="Remove relationship"
                            onClick={() => setRelationships(current => current.filter((_, item) => item !== index))}
                            size="icon"
                            type="button"
                            variant="ghost"
                        >
                            <Unlink />
                        </Button>
                    </div>
                ))}
            </div>
            <Button className="mt-3" onClick={() => onSave(relationships)} size="sm" variant="outline">
                Save relationships
            </Button>
        </section>
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

function ExerciseForm({
    catalogs,
    exercise,
    submitLabel,
    onSubmit,
}: {
    catalogs: ExerciseFormCatalogs;
    exercise?: ExerciseCatalogItemResponse;
    submitLabel: string;
    onSubmit: (draft: ExerciseDraft) => void;
}): React.JSX.Element {
    const [draft, setDraft] = useState(() => draftFrom(exercise, catalogs));
    const field = <Key extends keyof ExerciseDraft>(key: Key, value: ExerciseDraft[Key]) =>
        setDraft(current => ({ ...current, [key]: value }));

    return (
        <form
            className="grid gap-5"
            onSubmit={event => {
                event.preventDefault();
                onSubmit(draft);
            }}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Name">
                    <Input onChange={event => field("name", event.target.value)} required value={draft.name} />
                </FormField>
                <FormField label="Slug">
                    <Input onChange={event => field("slug", event.target.value)} required value={draft.slug} />
                </FormField>
            </div>
            <FormField label="Aliases" hint="Comma-separated">
                <Input onChange={event => field("aliases", event.target.value)} value={draft.aliases} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                    items={catalogs.equipment}
                    label="Equipment"
                    onValueChange={value => field("equipmentTypeId", value)}
                    value={draft.equipmentTypeId}
                />
                <SelectField
                    items={catalogs.movementPatterns}
                    label="Movement pattern"
                    onValueChange={value => field("movementPatternId", value)}
                    value={draft.movementPatternId}
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
                <EnumField
                    items={[
                        ["compound", "Compound"],
                        ["isolation", "Isolation"],
                    ]}
                    label="Classification"
                    onValueChange={value => field("classification", value as ExerciseDraft["classification"])}
                    value={draft.classification}
                />
                <EnumField
                    items={[
                        ["bilateral", "Bilateral"],
                        ["unilateral", "Unilateral"],
                    ]}
                    label="Laterality"
                    onValueChange={value => field("laterality", value as ExerciseDraft["laterality"])}
                    value={draft.laterality}
                />
                <FormField label="Body position">
                    <Input
                        onChange={event => field("bodyPosition", event.target.value)}
                        required
                        value={draft.bodyPosition}
                    />
                </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <EnumField
                    items={[
                        ["total", "Total"],
                        ["per_side", "Per side"],
                        ["alternating", "Alternating"],
                    ]}
                    label="Repetition semantics"
                    onValueChange={value => field("repetitionSemantics", value as ExerciseDraft["repetitionSemantics"])}
                    value={draft.repetitionSemantics}
                />
                <EnumField
                    items={[
                        ["external_only", "External load"],
                        ["full_bodyweight_plus_added_minus_assistance", "Bodyweight ± load"],
                        ["manual_effective_load", "Manual effective load"],
                        ["none", "No load"],
                    ]}
                    label="Load model"
                    onValueChange={value => field("loadModel", value as ExerciseDraft["loadModel"])}
                    value={draft.loadModel}
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                    items={catalogs.muscles}
                    label="Primary muscle"
                    onValueChange={value => field("primaryMuscleId", value)}
                    value={draft.primaryMuscleId}
                />
                <FormField label="Measurements" hint="Comma-separated contract values">
                    <Input
                        onChange={event => field("supportedMeasurements", event.target.value)}
                        required
                        value={draft.supportedMeasurements}
                    />
                </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <FormField label="Notes">
                    <Textarea onChange={event => field("notes", event.target.value)} value={draft.notes} />
                </FormField>
                <FormField label="Position">
                    <Input
                        min="0"
                        onChange={event => field("position", event.target.value)}
                        type="number"
                        value={draft.position}
                    />
                </FormField>
            </div>
            <DialogFooter>
                <Button type="submit">{submitLabel}</Button>
            </DialogFooter>
        </form>
    );
}

type ExerciseFormCatalogs = {
    equipment: readonly ExtensibleCatalogItemResponse[];
    movementPatterns: readonly ExtensibleCatalogItemResponse[];
    muscles: readonly MuscleCatalogItemResponse[];
};

function FormField({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}): React.JSX.Element {
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <Label>{label}</Label>
                {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
            </div>
            {children}
        </div>
    );
}

function SelectField({
    label,
    items,
    value,
    onValueChange,
}: {
    label: string;
    items: readonly { id: string; name: string }[];
    value: string;
    onValueChange: (value: string) => void;
}): React.JSX.Element {
    return (
        <FormField label={label}>
            <Select onValueChange={onValueChange} value={value}>
                <SelectTrigger className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {items.map(item => (
                        <SelectItem key={item.id} value={item.id}>
                            {item.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FormField>
    );
}

function EnumField({
    label,
    items,
    value,
    onValueChange,
}: {
    label: string;
    items: readonly (readonly [string, string])[];
    value: string;
    onValueChange: (value: string) => void;
}): React.JSX.Element {
    return (
        <FormField label={label}>
            <Select onValueChange={onValueChange} value={value}>
                <SelectTrigger className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {items.map(([itemValue, label]) => (
                        <SelectItem key={itemValue} value={itemValue}>
                            {label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FormField>
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
        <div className="bg-muted rounded-lg p-4">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
            {lines.map((line, index) => (
                <p className={index === 0 ? "mt-2 font-medium" : "text-muted-foreground mt-1 text-xs"} key={line}>
                    {line}
                </p>
            ))}
        </div>
    );
}

function draftFrom(exercise: ExerciseCatalogItemResponse | undefined, catalogs: ExerciseFormCatalogs): ExerciseDraft {
    return {
        slug: exercise?.slug ?? "",
        name: exercise?.name ?? "",
        aliases: exercise?.aliases.join(", ") ?? "",
        equipmentTypeId: exercise?.equipment.id ?? catalogs.equipment[0]?.id ?? "",
        movementPatternId: exercise?.movementPattern.id ?? catalogs.movementPatterns[0]?.id ?? "",
        classification: exercise?.classification ?? "compound",
        laterality: exercise?.laterality ?? "bilateral",
        bodyPosition: exercise?.bodyPosition ?? "standing",
        repetitionSemantics: exercise?.repetitionSemantics ?? "total",
        loadModel: exercise?.loadModel ?? "external_only",
        supportedMeasurements: exercise?.supportedMeasurements.join(", ") ?? "repetitions, external_load",
        primaryMuscleId:
            exercise?.muscles.find(assignment => assignment.role === "primary")?.muscle.id ??
            catalogs.muscles[0]?.id ??
            "",
        notes: exercise?.notes ?? "",
        position: String(exercise?.position ?? 0),
    };
}

function metadataInput(draft: ExerciseDraft) {
    return {
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        equipmentTypeId: draft.equipmentTypeId,
        movementPatternId: draft.movementPatternId,
        classification: draft.classification,
        laterality: draft.laterality,
        bodyPosition: draft.bodyPosition.trim(),
        repetitionSemantics: draft.repetitionSemantics,
        loadModel: draft.loadModel,
        supportedMeasurements: commaValues(draft.supportedMeasurements),
        notes: draft.notes.trim() || null,
        position: Number(draft.position),
    };
}

function createInput(draft: ExerciseDraft) {
    return {
        ...metadataInput(draft),
        aliases: commaValues(draft.aliases),
        muscles: [{ muscleGroupId: draft.primaryMuscleId, role: "primary" }],
        tagIds: [],
        relationships: [],
    };
}

function commaValues(value: string): string[] {
    return value
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
