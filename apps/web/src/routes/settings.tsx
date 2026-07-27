import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle, Pencil, Plus } from "lucide-react";

import { CoreProfileForm } from "@/components/profile/core-profile-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createProfile, profileQueryOptions, updateProfile } from "@/lib/api";
import {
    profileCreateInput,
    profileFormDefaults,
    profileUpdateInput,
    type ProfileFormValues,
} from "@/lib/profile-form";

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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.JSX.Element {
    return (
        <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
            <dd className={mono ? "mt-1 font-mono tabular-nums" : "mt-1"}>{value}</dd>
        </div>
    );
}
