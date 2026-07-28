import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle, Pencil, Plus } from "lucide-react";

import type { GoalStatusValue, InjuryStatusValue, TrainingGoalResponse, TrainingInjuryResponse } from "@kinetix/types";

import { CoreProfileForm } from "@/components/profile/core-profile-form";
import { GoalForm } from "@/components/profile/goal-form";
import { InjuryForm } from "@/components/profile/injury-form";
import { TrainingProfileForm } from "@/components/profile/training-profile-form";
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
    trainingProfileQueryOptions,
    updateGoal,
    updateInjury,
    updateProfile,
    updateTrainingProfile,
} from "@/lib/api";
import { goalCreateInput, goalFormDefaults, goalUpdateInput, type GoalFormValues } from "@/lib/goal-form";
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
