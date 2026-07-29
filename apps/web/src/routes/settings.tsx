import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle, Pencil, Plus } from "lucide-react";

import type {
    EquipmentIncrementResponse,
    GearItemResponse,
    GoalStatusValue,
    InjuryStatusValue,
    TrainingGoalResponse,
    TrainingInjuryResponse,
    TrainingMaxResponse,
    ZoneFamilyValue,
} from "@kinetix/types";

import { CoreProfileForm } from "@/components/profile/core-profile-form";
import { EquipmentIncrementForm } from "@/components/profile/equipment-increment-form";
import { GearForm } from "@/components/profile/gear-form";
import { GoalForm } from "@/components/profile/goal-form";
import { InjuryForm } from "@/components/profile/injury-form";
import { TrainingMaxForm } from "@/components/profile/training-max-form";
import { TrainingProfileForm } from "@/components/profile/training-profile-form";
import { ZoneForm } from "@/components/profile/zone-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MultiSelectOption } from "@/components/ui/multi-select-field";
import {
    createGoal,
    createInjury,
    createProfile,
    createTrainingProfile,
    exerciseFormCatalogQueryOptions,
    exerciseListQueryOptions,
    goalsQueryOptions,
    injuriesQueryOptions,
    profileQueryOptions,
    recordTrainingMax,
    trainingMaxHistoryQueryOptions,
    trainingMaxesQueryOptions,
    trainingProfileQueryOptions,
    updateGoal,
    updateInjury,
    updateProfile,
    updateTrainingProfile,
    changeGearStatus,
    createEquipmentIncrement,
    createGearItem,
    equipmentIncrementsQueryOptions,
    gearItemsQueryOptions,
    recordZoneDefinition,
    updateEquipmentIncrement,
    updateGearItem,
    zoneHistoryQueryOptions,
    zonesQueryOptions,
} from "@/lib/api";
import {
    equipmentIncrementCreateInput,
    equipmentIncrementFormDefaults,
    equipmentIncrementUpdateInput,
    type EquipmentIncrementFormValues,
} from "@/lib/equipment-increment-form";
import { gearCreateInput, gearFormDefaults, gearUpdateInput, type GearFormValues } from "@/lib/gear-form";
import { goalCreateInput, goalFormDefaults, goalUpdateInput, type GoalFormValues } from "@/lib/goal-form";
import { trainingMaxFormDefaults, trainingMaxRecordInput, type TrainingMaxFormValues } from "@/lib/training-max-form";
import { zoneFormDefaults, zoneRecordInput, type ZoneFormValues } from "@/lib/zone-form";
import { injuryCreateInput, injuryFormDefaults, injuryUpdateInput, type InjuryFormValues } from "@/lib/injury-form";
import {
    profileCreateInput,
    profileFormDefaults,
    profileUpdateInput,
    type ProfileFormValues,
} from "@/lib/profile-form";
import {
    trainingProfileCreateInput,
    trainingProfileFormDefaults,
    trainingProfileUpdateInput,
    type TrainingProfileFormValues,
} from "@/lib/training-profile-form";

export const Route = createFileRoute("/settings")({
    component: SettingsPage,
});

const sexLabels: Record<string, string> = {
    female: "Female",
    male: "Male",
    intersex: "Intersex",
    other: "Other",
};

function SettingsPage(): React.JSX.Element {
    const queryClient = useQueryClient();
    const profileQuery = useQuery(profileQueryOptions);
    const [editOpen, setEditOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const profile = profileQuery.data ?? null;

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["profile"] });
    };
    const createMutation = useMutation({
        mutationFn: (values: ProfileFormValues) => createProfile(profileCreateInput(values)),
        onSuccess: async () => {
            setCreateOpen(false);
            await refresh();
        },
    });
    const saveMutation = useMutation({
        mutationFn: (values: ProfileFormValues) => updateProfile(profile!, profileUpdateInput(values)),
        onSuccess: async () => {
            setEditOpen(false);
            await refresh();
        },
    });

    return (
        <main className="mx-auto max-w-3xl px-6 py-10">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <Badge variant="info">Profile</Badge>
                    <h1 className="mt-3 text-3xl font-semibold tracking-tight">Profile &amp; settings</h1>
                    <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                        The stable personal context and unit defaults used to interpret every training entry.
                    </p>
                </div>
                {profile ? (
                    <Button onClick={() => setEditOpen(true)} variant="outline">
                        <Pencil />
                        Edit
                    </Button>
                ) : null}
            </div>

            <div className="mt-8">
                {profileQuery.isPending ? (
                    <div className="bg-card text-muted-foreground flex min-h-40 items-center justify-center gap-2 rounded-xl border text-sm">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading profile…
                    </div>
                ) : profileQuery.isError ? (
                    <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-xl border p-4 text-sm">
                        {profileQuery.error.message}
                    </div>
                ) : profile ? (
                    <div className="bg-card rounded-xl border p-6">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                                Core profile
                            </h2>
                            <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                v{profile.version}
                            </span>
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 text-sm sm:grid-cols-3">
                            <Field label="Time zone" value={profile.timeZone} />
                            <Field
                                label="Units"
                                value={`${profile.unitPreferences.mass} · ${profile.unitPreferences.distance} · ${profile.unitPreferences.length}`}
                                mono
                            />
                            <Field label="Birth date" value={profile.birthDate ?? "—"} mono />
                            <Field label="Sex" value={profile.sex ? (sexLabels[profile.sex] ?? profile.sex) : "—"} />
                            <Field
                                label="Height"
                                value={profile.heightMeters ? `${profile.heightMeters} m` : "—"}
                                mono
                            />
                        </dl>
                    </div>
                ) : (
                    <div className="bg-card grid min-h-40 place-items-center rounded-xl border p-6 text-center">
                        <div>
                            <p className="font-medium">No profile yet</p>
                            <p className="text-muted-foreground mt-1 text-sm">
                                Create your core profile to set unit defaults and time zone.
                            </p>
                            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                                <Plus />
                                Create profile
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {profile ? <TrainingProfileSection /> : null}
            {profile ? <TrainingGoalsSection /> : null}
            {profile ? <TrainingMaxesSection /> : null}
            {profile ? <ZonesSection /> : null}
            {profile ? <EquipmentIncrementsSection /> : null}
            {profile ? <GearSection /> : null}
            {profile ? <TrainingInjuriesSection /> : null}

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Create profile</DialogTitle>
                        <DialogDescription>Set your time zone and unit defaults.</DialogDescription>
                    </DialogHeader>
                    <CoreProfileForm
                        defaultValues={profileFormDefaults(null)}
                        isSubmitting={createMutation.isPending}
                        onSubmit={async values => {
                            await createMutation.mutateAsync(values);
                        }}
                        submitError={createMutation.error}
                        submitLabel="Create profile"
                    />
                </DialogContent>
            </Dialog>

            <Dialog
                onOpenChange={open => {
                    setEditOpen(open);
                    if (!open) saveMutation.reset();
                }}
                open={editOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Edit profile</DialogTitle>
                        <DialogDescription>Leave birth date, sex, or height blank to clear them.</DialogDescription>
                    </DialogHeader>
                    {profile ? (
                        <CoreProfileForm
                            defaultValues={profileFormDefaults(profile)}
                            isSubmitting={saveMutation.isPending}
                            key={profile.version}
                            onSubmit={async values => {
                                await saveMutation.mutateAsync(values);
                            }}
                            submitError={saveMutation.error}
                            submitLabel="Save profile"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </main>
    );
}

function TrainingProfileSection(): React.JSX.Element {
    const queryClient = useQueryClient();
    const query = useQuery(trainingProfileQueryOptions);
    const [editOpen, setEditOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const profile = query.data ?? null;

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["training-profile"] });
    };
    const createMutation = useMutation({
        mutationFn: (values: TrainingProfileFormValues) => createTrainingProfile(trainingProfileCreateInput(values)),
        onSuccess: async () => {
            setCreateOpen(false);
            await refresh();
        },
    });
    const saveMutation = useMutation({
        mutationFn: (values: TrainingProfileFormValues) =>
            updateTrainingProfile(profile!, trainingProfileUpdateInput(values)),
        onSuccess: async () => {
            setEditOpen(false);
            await refresh();
        },
    });

    return (
        <div className="mt-6">
            {query.isPending ? (
                <div className="bg-card text-muted-foreground flex min-h-32 items-center justify-center gap-2 rounded-xl border text-sm">
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading training profile…
                </div>
            ) : query.isError ? (
                <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-xl border p-4 text-sm">
                    {query.error.message}
                </div>
            ) : profile ? (
                <div className="bg-card rounded-xl border p-6">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                            Training profile
                        </h2>
                        <div className="flex items-center gap-3">
                            <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                v{profile.version}
                            </span>
                            <Button onClick={() => setEditOpen(true)} size="sm" variant="outline">
                                <Pencil />
                                Edit
                            </Button>
                        </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 text-sm sm:grid-cols-3">
                        <Field label="Experience" value={capitalize(profile.experience)} />
                        <Field label="1RM rep cutoff" value={`${profile.oneRepMaxRepCutoff} reps`} mono />
                        <Field label="Hard-set RPE" value={`≥ ${profile.hardSetRpeThreshold}`} mono />
                        <Field label="Hard-set RIR" value={`≤ ${profile.hardSetRirThreshold}`} mono />
                        <Field label="Calculator" value={`v${profile.calculatorVersion}`} mono />
                        <Field label="Rules" value={`v${profile.ruleVersion}`} mono />
                    </dl>
                </div>
            ) : (
                <div className="bg-card grid min-h-32 place-items-center rounded-xl border p-6 text-center">
                    <div>
                        <p className="font-medium">No training profile yet</p>
                        <p className="text-muted-foreground mt-1 text-sm">
                            Set your experience and analytics defaults.
                        </p>
                        <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                            <Plus />
                            Create training profile
                        </Button>
                    </div>
                </div>
            )}

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Create training profile</DialogTitle>
                        <DialogDescription>Set your experience and analytics defaults.</DialogDescription>
                    </DialogHeader>
                    <TrainingProfileForm
                        defaultValues={trainingProfileFormDefaults(null)}
                        isSubmitting={createMutation.isPending}
                        onSubmit={async values => {
                            await createMutation.mutateAsync(values);
                        }}
                        submitError={createMutation.error}
                        submitLabel="Create training profile"
                    />
                </DialogContent>
            </Dialog>

            <Dialog
                onOpenChange={open => {
                    setEditOpen(open);
                    if (!open) saveMutation.reset();
                }}
                open={editOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Edit training profile</DialogTitle>
                        <DialogDescription>Experience and analytics defaults.</DialogDescription>
                    </DialogHeader>
                    {profile ? (
                        <TrainingProfileForm
                            defaultValues={trainingProfileFormDefaults(profile)}
                            isSubmitting={saveMutation.isPending}
                            key={profile.version}
                            onSubmit={async values => {
                                await saveMutation.mutateAsync(values);
                            }}
                            submitError={saveMutation.error}
                            submitLabel="Save training profile"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}

const goalTypeLabels: Record<string, string> = {
    strength: "Strength",
    endurance: "Endurance",
    body_composition: "Body composition",
    skill: "Skill",
    other: "Other",
};

const goalStatusVariants: Record<GoalStatusValue, "info" | "success" | "secondary"> = {
    active: "info",
    achieved: "success",
    abandoned: "secondary",
};

function TrainingGoalsSection(): React.JSX.Element {
    const queryClient = useQueryClient();
    const query = useQuery(goalsQueryOptions);
    const [createOpen, setCreateOpen] = useState(false);
    const [editGoal, setEditGoal] = useState<TrainingGoalResponse | null>(null);
    const goals = query.data?.items ?? [];

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["training-goals"] });
    };
    const createMutation = useMutation({
        mutationFn: (values: GoalFormValues) => createGoal(goalCreateInput(values)),
        onSuccess: async () => {
            setCreateOpen(false);
            await refresh();
        },
    });
    const saveMutation = useMutation({
        mutationFn: (values: GoalFormValues) => updateGoal(editGoal!, goalUpdateInput(values)),
        onSuccess: async () => {
            setEditGoal(null);
            await refresh();
        },
    });

    return (
        <div className="mt-6">
            <div className="bg-card rounded-xl border p-6">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                        Training goals
                    </h2>
                    <Button onClick={() => setCreateOpen(true)} size="sm">
                        <Plus />
                        Add goal
                    </Button>
                </div>

                {query.isPending ? (
                    <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading goals…
                    </div>
                ) : query.isError ? (
                    <div className="bg-destructive/10 text-destructive border-destructive/30 mt-4 rounded-lg border p-3 text-sm">
                        {query.error.message}
                    </div>
                ) : goals.length === 0 ? (
                    <p className="text-muted-foreground mt-4 text-sm">No goals yet. Add one to steer your training.</p>
                ) : (
                    <ul className="mt-4 divide-y">
                        {goals.map(goal => (
                            <li key={goal.id}>
                                <button
                                    className="hover:bg-muted/50 flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors"
                                    onClick={() => setEditGoal(goal)}
                                    type="button"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">
                                                {goalTypeLabels[goal.type] ?? goal.type}
                                            </span>
                                            <Badge variant={goalStatusVariants[goal.status]}>{goal.status}</Badge>
                                        </div>
                                        <p className="text-muted-foreground mt-1 truncate text-sm">
                                            {goal.targetValue
                                                ? `Target ${goal.targetValue} ${goal.targetUnit ?? ""}`.trim()
                                                : "No numeric target"}
                                            {goal.targetDate ? ` · by ${goal.targetDate}` : ""}
                                        </p>
                                    </div>
                                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                        P{goal.priority}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Add goal</DialogTitle>
                        <DialogDescription>New goals start active for your current profile.</DialogDescription>
                    </DialogHeader>
                    <GoalForm
                        defaultValues={goalFormDefaults(null)}
                        isSubmitting={createMutation.isPending}
                        onSubmit={async values => {
                            await createMutation.mutateAsync(values);
                        }}
                        submitError={createMutation.error}
                        submitLabel="Add goal"
                    />
                </DialogContent>
            </Dialog>

            <Dialog
                onOpenChange={open => {
                    if (!open) {
                        setEditGoal(null);
                        saveMutation.reset();
                    }
                }}
                open={editGoal !== null}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Edit goal</DialogTitle>
                        <DialogDescription>Update the target, timing, or status.</DialogDescription>
                    </DialogHeader>
                    {editGoal ? (
                        <GoalForm
                            defaultValues={goalFormDefaults(editGoal)}
                            isSubmitting={saveMutation.isPending}
                            key={`${editGoal.id}:${editGoal.version}`}
                            onSubmit={async values => {
                                await saveMutation.mutateAsync(values);
                            }}
                            showStatus
                            submitError={saveMutation.error}
                            submitLabel="Save goal"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}

const injuryStatusVariants: Record<InjuryStatusValue, "warning" | "info" | "success"> = {
    active: "warning",
    recovering: "info",
    resolved: "success",
};

function TrainingInjuriesSection(): React.JSX.Element {
    const queryClient = useQueryClient();
    const query = useQuery(injuriesQueryOptions);
    const catalogQuery = useQuery(exerciseFormCatalogQueryOptions);
    const exercisesQuery = useQuery(exerciseListQueryOptions("", "active"));
    const [createOpen, setCreateOpen] = useState(false);
    const [editInjury, setEditInjury] = useState<TrainingInjuryResponse | null>(null);
    const injuries = query.data?.items ?? [];

    const muscleOptions: MultiSelectOption[] = (catalogQuery.data?.muscles ?? []).map(muscle => ({
        value: muscle.id,
        label: muscle.name,
    }));
    const exerciseOptions: MultiSelectOption[] = (exercisesQuery.data?.items ?? []).map(exercise => ({
        value: exercise.id,
        label: exercise.name,
    }));

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["training-injuries"] });
    };
    const createMutation = useMutation({
        mutationFn: (values: InjuryFormValues) => createInjury(injuryCreateInput(values)),
        onSuccess: async () => {
            setCreateOpen(false);
            await refresh();
        },
    });
    const saveMutation = useMutation({
        mutationFn: (values: InjuryFormValues) => updateInjury(editInjury!, injuryUpdateInput(values)),
        onSuccess: async () => {
            setEditInjury(null);
            await refresh();
        },
    });

    return (
        <div className="mt-6">
            <div className="bg-card rounded-xl border p-6">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                        Injuries &amp; limitations
                    </h2>
                    <Button onClick={() => setCreateOpen(true)} size="sm">
                        <Plus />
                        Add injury
                    </Button>
                </div>

                {query.isPending ? (
                    <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading injuries…
                    </div>
                ) : query.isError ? (
                    <div className="bg-destructive/10 text-destructive border-destructive/30 mt-4 rounded-lg border p-3 text-sm">
                        {query.error.message}
                    </div>
                ) : injuries.length === 0 ? (
                    <p className="text-muted-foreground mt-4 text-sm">
                        No injuries recorded. Add one to inform safety checks.
                    </p>
                ) : (
                    <ul className="mt-4 divide-y">
                        {injuries.map(injury => (
                            <li key={injury.id}>
                                <button
                                    className="hover:bg-muted/50 flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors"
                                    onClick={() => setEditInjury(injury)}
                                    type="button"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{injury.name}</span>
                                            <Badge variant={injuryStatusVariants[injury.status]}>{injury.status}</Badge>
                                        </div>
                                        <p className="text-muted-foreground mt-1 truncate text-sm">
                                            {injury.bodyArea}
                                            {injury.side ? ` · ${injury.side}` : ""} · {injury.severity} · since{" "}
                                            {injury.onsetDate}
                                        </p>
                                    </div>
                                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                        {injury.muscleGroupIds.length + injury.exerciseIds.length} links
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Add injury</DialogTitle>
                        <DialogDescription>New injuries start active for your current profile.</DialogDescription>
                    </DialogHeader>
                    <InjuryForm
                        defaultValues={injuryFormDefaults(null)}
                        exerciseOptions={exerciseOptions}
                        isSubmitting={createMutation.isPending}
                        muscleOptions={muscleOptions}
                        onSubmit={async values => {
                            await createMutation.mutateAsync(values);
                        }}
                        submitError={createMutation.error}
                        submitLabel="Add injury"
                    />
                </DialogContent>
            </Dialog>

            <Dialog
                onOpenChange={open => {
                    if (!open) {
                        setEditInjury(null);
                        saveMutation.reset();
                    }
                }}
                open={editInjury !== null}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Edit injury</DialogTitle>
                        <DialogDescription>Update severity, status, dates, or catalog links.</DialogDescription>
                    </DialogHeader>
                    {editInjury ? (
                        <InjuryForm
                            defaultValues={injuryFormDefaults(editInjury)}
                            exerciseOptions={exerciseOptions}
                            isSubmitting={saveMutation.isPending}
                            key={`${editInjury.id}:${editInjury.version}`}
                            muscleOptions={muscleOptions}
                            onSubmit={async values => {
                                await saveMutation.mutateAsync(values);
                            }}
                            showStatus
                            submitError={saveMutation.error}
                            submitLabel="Save injury"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function maxTypeLabel(max: Pick<TrainingMaxResponse, "maxType" | "customLabel">): string {
    if (max.maxType === "custom") return max.customLabel ?? "Custom";
    return max.maxType === "estimated_1rm" ? "Est. 1RM" : "Training max";
}

function TrainingMaxesSection(): React.JSX.Element {
    const queryClient = useQueryClient();
    const query = useQuery(trainingMaxesQueryOptions());
    const exercisesQuery = useQuery(exerciseListQueryOptions("", "active"));
    const [createOpen, setCreateOpen] = useState(false);
    const [historySeries, setHistorySeries] = useState<Pick<
        TrainingMaxResponse,
        "exerciseId" | "maxType" | "customLabel"
    > | null>(null);
    const historyQuery = useQuery(trainingMaxHistoryQueryOptions(historySeries));
    const maxes = query.data?.items ?? [];

    const exerciseName = new Map((exercisesQuery.data?.items ?? []).map(exercise => [exercise.id, exercise.name]));
    const exerciseOptions = (exercisesQuery.data?.items ?? []).map(exercise => ({
        value: exercise.id,
        label: exercise.name,
    }));

    const createMutation = useMutation({
        mutationFn: (values: TrainingMaxFormValues) => recordTrainingMax(trainingMaxRecordInput(values)),
        onSuccess: async () => {
            setCreateOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["training-maxes"] });
            await queryClient.invalidateQueries({ queryKey: ["training-max-history"] });
        },
    });

    return (
        <div className="mt-6">
            <div className="bg-card rounded-xl border p-6">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                        Training maxima
                    </h2>
                    <Button onClick={() => setCreateOpen(true)} size="sm">
                        <Plus />
                        Record max
                    </Button>
                </div>

                {query.isPending ? (
                    <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading maxima…
                    </div>
                ) : query.isError ? (
                    <div className="bg-destructive/10 text-destructive border-destructive/30 mt-4 rounded-lg border p-3 text-sm">
                        {query.error.message}
                    </div>
                ) : maxes.length === 0 ? (
                    <p className="text-muted-foreground mt-4 text-sm">
                        No maxima yet. Record one to drive percentage-based loads.
                    </p>
                ) : (
                    <ul className="mt-4 divide-y">
                        {maxes.map(max => (
                            <li key={max.id}>
                                <button
                                    className="hover:bg-muted/50 flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors"
                                    onClick={() =>
                                        setHistorySeries({
                                            exerciseId: max.exerciseId,
                                            maxType: max.maxType,
                                            customLabel: max.customLabel,
                                        })
                                    }
                                    type="button"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">
                                                {exerciseName.get(max.exerciseId) ?? max.exerciseId}
                                            </span>
                                            <Badge variant="info">{maxTypeLabel(max)}</Badge>
                                        </div>
                                        <p className="text-muted-foreground mt-1 truncate text-sm">
                                            since {max.effectiveFrom.slice(0, 10)}
                                        </p>
                                    </div>
                                    <span className="font-mono text-sm tabular-nums">{max.valueKg} kg</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Record training max</DialogTitle>
                        <DialogDescription>
                            Recording a new value closes the current one and keeps it in history.
                        </DialogDescription>
                    </DialogHeader>
                    <TrainingMaxForm
                        defaultValues={trainingMaxFormDefaults()}
                        exerciseOptions={exerciseOptions}
                        isSubmitting={createMutation.isPending}
                        onSubmit={async values => {
                            await createMutation.mutateAsync(values);
                        }}
                        submitError={createMutation.error}
                        submitLabel="Record max"
                    />
                </DialogContent>
            </Dialog>

            <Dialog
                onOpenChange={open => {
                    if (!open) setHistorySeries(null);
                }}
                open={historySeries !== null}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>
                            {historySeries ? (exerciseName.get(historySeries.exerciseId) ?? "Exercise") : "History"} ·{" "}
                            {historySeries ? maxTypeLabel(historySeries) : ""}
                        </DialogTitle>
                        <DialogDescription>Effective-interval history for this max.</DialogDescription>
                    </DialogHeader>
                    {historyQuery.isPending ? (
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                            <LoaderCircle className="size-4 animate-spin" />
                            Loading history…
                        </div>
                    ) : historyQuery.isError ? (
                        <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border p-3 text-sm">
                            {historyQuery.error.message}
                        </div>
                    ) : (
                        <ul className="divide-y">
                            {(historyQuery.data?.items ?? [])
                                .slice()
                                .reverse()
                                .map(record => (
                                    <li className="flex items-center justify-between gap-3 py-3" key={record.id}>
                                        <div className="min-w-0">
                                            <span className="font-mono text-sm tabular-nums">{record.valueKg} kg</span>
                                            <p className="text-muted-foreground mt-1 text-sm">
                                                {record.effectiveFrom.slice(0, 10)} →{" "}
                                                {record.effectiveTo ? record.effectiveTo.slice(0, 10) : "current"}
                                            </p>
                                        </div>
                                        {record.effectiveTo === null ? <Badge variant="success">Current</Badge> : null}
                                    </li>
                                ))}
                        </ul>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

const zoneFamilyLabels: Record<ZoneFamilyValue, string> = {
    heart_rate: "Heart rate",
    pace: "Pace",
    power: "Power",
};

function ZonesSection(): React.JSX.Element {
    const queryClient = useQueryClient();
    const query = useQuery(zonesQueryOptions);
    const [createOpen, setCreateOpen] = useState(false);
    const [historyFamily, setHistoryFamily] = useState<ZoneFamilyValue | null>(null);
    const historyQuery = useQuery(zoneHistoryQueryOptions(historyFamily));
    const zones = query.data?.items ?? [];

    const createMutation = useMutation({
        mutationFn: (values: ZoneFormValues) => recordZoneDefinition(zoneRecordInput(values)),
        onSuccess: async () => {
            setCreateOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["training-zones"] });
            await queryClient.invalidateQueries({ queryKey: ["training-zone-history"] });
        },
    });

    return (
        <div className="mt-6">
            <div className="bg-card rounded-xl border p-6">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                        Training zones
                    </h2>
                    <Button onClick={() => setCreateOpen(true)} size="sm">
                        <Plus />
                        Record zones
                    </Button>
                </div>

                {query.isPending ? (
                    <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading zones…
                    </div>
                ) : query.isError ? (
                    <div className="bg-destructive/10 text-destructive border-destructive/30 mt-4 rounded-lg border p-3 text-sm">
                        {query.error.message}
                    </div>
                ) : zones.length === 0 ? (
                    <p className="text-muted-foreground mt-4 text-sm">
                        No zone definitions yet. Record heart-rate, pace, or power zones.
                    </p>
                ) : (
                    <ul className="mt-4 divide-y">
                        {zones.map(zone => (
                            <li key={zone.id}>
                                <button
                                    className="hover:bg-muted/50 flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors"
                                    onClick={() => setHistoryFamily(zone.family)}
                                    type="button"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{zoneFamilyLabels[zone.family]}</span>
                                            <Badge variant="info">{zone.method}</Badge>
                                        </div>
                                        <p className="text-muted-foreground mt-1 truncate text-sm">
                                            since {zone.effectiveFrom.slice(0, 10)}
                                        </p>
                                    </div>
                                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                        {zone.ranges.length} ranges
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Record zones</DialogTitle>
                        <DialogDescription>
                            Recording new zones for a family closes the current ones and keeps them in history.
                        </DialogDescription>
                    </DialogHeader>
                    <ZoneForm
                        defaultValues={zoneFormDefaults()}
                        isSubmitting={createMutation.isPending}
                        onSubmit={async values => {
                            await createMutation.mutateAsync(values);
                        }}
                        submitError={createMutation.error}
                        submitLabel="Record zones"
                    />
                </DialogContent>
            </Dialog>

            <Dialog onOpenChange={open => (open ? undefined : setHistoryFamily(null))} open={historyFamily !== null}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{historyFamily ? zoneFamilyLabels[historyFamily] : "Zones"} history</DialogTitle>
                        <DialogDescription>Effective-interval history for this family.</DialogDescription>
                    </DialogHeader>
                    {historyQuery.isPending ? (
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                            <LoaderCircle className="size-4 animate-spin" />
                            Loading history…
                        </div>
                    ) : (
                        <ul className="divide-y">
                            {(historyQuery.data?.items ?? [])
                                .slice()
                                .reverse()
                                .map(record => (
                                    <li className="flex items-center justify-between gap-3 py-3" key={record.id}>
                                        <div className="min-w-0">
                                            <span className="font-medium">{record.method}</span>
                                            <p className="text-muted-foreground mt-1 text-sm">
                                                {record.effectiveFrom.slice(0, 10)} →{" "}
                                                {record.effectiveTo ? record.effectiveTo.slice(0, 10) : "current"}
                                            </p>
                                        </div>
                                        {record.effectiveTo === null ? <Badge variant="success">Current</Badge> : null}
                                    </li>
                                ))}
                        </ul>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

const incrementScopeLabels: Record<EquipmentIncrementResponse["scope"], string> = {
    default: "Default",
    exercise: "Exercise",
    equipment: "Equipment",
};

function EquipmentIncrementsSection(): React.JSX.Element {
    const queryClient = useQueryClient();
    const query = useQuery(equipmentIncrementsQueryOptions);
    const exercisesQuery = useQuery(exerciseListQueryOptions("", "active"));
    const catalogQuery = useQuery(exerciseFormCatalogQueryOptions);
    const [createOpen, setCreateOpen] = useState(false);
    const [editIncrement, setEditIncrement] = useState<EquipmentIncrementResponse | null>(null);
    const increments = query.data?.items ?? [];

    const exerciseOptions = (exercisesQuery.data?.items ?? []).map(exercise => ({
        value: exercise.id,
        label: exercise.name,
    }));
    const equipmentOptions = (catalogQuery.data?.equipment ?? []).map(item => ({ value: item.id, label: item.name }));

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["training-equipment-increments"] });
    };
    const createMutation = useMutation({
        mutationFn: (values: EquipmentIncrementFormValues) =>
            createEquipmentIncrement(equipmentIncrementCreateInput(values)),
        onSuccess: async () => {
            setCreateOpen(false);
            await refresh();
        },
    });
    const saveMutation = useMutation({
        mutationFn: (values: EquipmentIncrementFormValues) =>
            updateEquipmentIncrement(editIncrement!, equipmentIncrementUpdateInput(values)),
        onSuccess: async () => {
            setEditIncrement(null);
            await refresh();
        },
    });

    return (
        <div className="mt-6">
            <div className="bg-card rounded-xl border p-6">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                        Load increments
                    </h2>
                    <Button onClick={() => setCreateOpen(true)} size="sm">
                        <Plus />
                        Add increment
                    </Button>
                </div>

                {query.isPending ? (
                    <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading increments…
                    </div>
                ) : query.isError ? (
                    <div className="bg-destructive/10 text-destructive border-destructive/30 mt-4 rounded-lg border p-3 text-sm">
                        {query.error.message}
                    </div>
                ) : increments.length === 0 ? (
                    <p className="text-muted-foreground mt-4 text-sm">
                        No increments yet. Add one to round percentage-based loads.
                    </p>
                ) : (
                    <ul className="mt-4 divide-y">
                        {increments.map(increment => (
                            <li key={increment.id}>
                                <button
                                    className="hover:bg-muted/50 flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors"
                                    onClick={() => setEditIncrement(increment)}
                                    type="button"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">
                                                {increment.label ?? incrementScopeLabels[increment.scope]}
                                            </span>
                                            <Badge variant="secondary">{incrementScopeLabels[increment.scope]}</Badge>
                                        </div>
                                        <p className="text-muted-foreground mt-1 truncate text-sm">
                                            {increment.minimumKg ? `min ${increment.minimumKg} kg · ` : ""}step{" "}
                                            {increment.incrementKg} kg
                                        </p>
                                    </div>
                                    <span className="font-mono text-sm tabular-nums">{increment.incrementKg} kg</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Add increment</DialogTitle>
                        <DialogDescription>Configure rounding for a scope.</DialogDescription>
                    </DialogHeader>
                    <EquipmentIncrementForm
                        defaultValues={equipmentIncrementFormDefaults(null)}
                        equipmentOptions={equipmentOptions}
                        exerciseOptions={exerciseOptions}
                        isSubmitting={createMutation.isPending}
                        onSubmit={async values => {
                            await createMutation.mutateAsync(values);
                        }}
                        submitError={createMutation.error}
                        submitLabel="Add increment"
                    />
                </DialogContent>
            </Dialog>

            <Dialog
                onOpenChange={open => {
                    if (!open) {
                        setEditIncrement(null);
                        saveMutation.reset();
                    }
                }}
                open={editIncrement !== null}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Edit increment</DialogTitle>
                        <DialogDescription>Update the step, minimum, or label.</DialogDescription>
                    </DialogHeader>
                    {editIncrement ? (
                        <EquipmentIncrementForm
                            defaultValues={equipmentIncrementFormDefaults(editIncrement)}
                            equipmentOptions={equipmentOptions}
                            exerciseOptions={exerciseOptions}
                            isSubmitting={saveMutation.isPending}
                            key={`${editIncrement.id}:${editIncrement.version}`}
                            lockScope
                            onSubmit={async values => {
                                await saveMutation.mutateAsync(values);
                            }}
                            submitError={saveMutation.error}
                            submitLabel="Save increment"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function GearSection(): React.JSX.Element {
    const queryClient = useQueryClient();
    const [includeArchived, setIncludeArchived] = useState(false);
    const query = useQuery(gearItemsQueryOptions(includeArchived));
    const [createOpen, setCreateOpen] = useState(false);
    const [editGear, setEditGear] = useState<GearItemResponse | null>(null);
    const gear = query.data?.items ?? [];

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["training-gear"] });
    };
    const createMutation = useMutation({
        mutationFn: (values: GearFormValues) => createGearItem(gearCreateInput(values)),
        onSuccess: async () => {
            setCreateOpen(false);
            await refresh();
        },
    });
    const saveMutation = useMutation({
        mutationFn: (values: GearFormValues) => updateGearItem(editGear!, gearUpdateInput(values)),
        onSuccess: async () => {
            setEditGear(null);
            await refresh();
        },
    });
    const statusMutation = useMutation({
        mutationFn: (item: GearItemResponse) => changeGearStatus(item),
        onSuccess: refresh,
    });

    return (
        <div className="mt-6">
            <div className="bg-card rounded-xl border p-6">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">
                        Shoes &amp; gear
                    </h2>
                    <div className="flex items-center gap-2">
                        <Button onClick={() => setIncludeArchived(value => !value)} size="sm" variant="ghost">
                            {includeArchived ? "Hide archived" : "Show archived"}
                        </Button>
                        <Button onClick={() => setCreateOpen(true)} size="sm">
                            <Plus />
                            Add gear
                        </Button>
                    </div>
                </div>

                {query.isPending ? (
                    <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading gear…
                    </div>
                ) : query.isError ? (
                    <div className="bg-destructive/10 text-destructive border-destructive/30 mt-4 rounded-lg border p-3 text-sm">
                        {query.error.message}
                    </div>
                ) : gear.length === 0 ? (
                    <p className="text-muted-foreground mt-4 text-sm">No gear yet. Add shoes or equipment to track.</p>
                ) : (
                    <ul className="mt-4 divide-y">
                        {gear.map(item => (
                            <li className="flex items-center justify-between gap-3 py-1" key={item.id}>
                                <button
                                    className="hover:bg-muted/50 flex flex-1 cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors"
                                    onClick={() => setEditGear(item)}
                                    type="button"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{item.name}</span>
                                            <Badge variant={item.status === "archived" ? "secondary" : "success"}>
                                                {item.status}
                                            </Badge>
                                        </div>
                                        <p className="text-muted-foreground mt-1 truncate text-sm">
                                            {item.gearType}
                                            {item.distanceLimitM ? ` · limit ${item.distanceLimitM} m` : ""}
                                        </p>
                                    </div>
                                </button>
                                <Button
                                    disabled={statusMutation.isPending}
                                    onClick={() => statusMutation.mutate(item)}
                                    size="sm"
                                    variant="outline"
                                >
                                    {item.status === "active" ? "Archive" : "Restore"}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Add gear</DialogTitle>
                        <DialogDescription>Track shoes or equipment for your runs.</DialogDescription>
                    </DialogHeader>
                    <GearForm
                        defaultValues={gearFormDefaults(null)}
                        isSubmitting={createMutation.isPending}
                        onSubmit={async values => {
                            await createMutation.mutateAsync(values);
                        }}
                        submitError={createMutation.error}
                        submitLabel="Add gear"
                    />
                </DialogContent>
            </Dialog>

            <Dialog
                onOpenChange={open => {
                    if (!open) {
                        setEditGear(null);
                        saveMutation.reset();
                    }
                }}
                open={editGear !== null}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Edit gear</DialogTitle>
                        <DialogDescription>Update details or the distance limit.</DialogDescription>
                    </DialogHeader>
                    {editGear ? (
                        <GearForm
                            defaultValues={gearFormDefaults(editGear)}
                            isSubmitting={saveMutation.isPending}
                            key={`${editGear.id}:${editGear.version}`}
                            onSubmit={async values => {
                                await saveMutation.mutateAsync(values);
                            }}
                            submitError={saveMutation.error}
                            submitLabel="Save gear"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function capitalize(value: string): string {
    return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.JSX.Element {
    return (
        <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
            <dd className={mono ? "mt-1 font-mono tabular-nums" : "mt-1"}>{value}</dd>
        </div>
    );
}
