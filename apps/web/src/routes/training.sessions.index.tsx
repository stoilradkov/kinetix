import { useEffect, useMemo, useState } from "react";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Dumbbell, Plus } from "lucide-react";
import { z } from "zod";

import { trainingSessionStatusSchema, type TrainingSessionStatusValue } from "@kinetix/types";

import { SessionForm } from "@/components/training/session-form";
import { SessionsFeed } from "@/components/training/sessions-feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createTrainingSession, startEmptyTrainingSession, trainingSessionsInfiniteQueryOptions } from "@/lib/api";
import { sessionCreateInput, sessionFormDefaults, type SessionFormValues } from "@/lib/session-form";

/**
 * URL-persisted feed filters (design UX3; issue #66) so a filtered view is bookmarkable. A malformed
 * value is dropped rather than crashing the route, falling back to the unfiltered feed.
 */
const sessionsSearchSchema = z.object({
    q: z.string().min(1).optional().catch(undefined),
    status: trainingSessionStatusSchema.optional().catch(undefined),
    archived: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/training/sessions/")({
    component: SessionsPage,
    validateSearch: sessionsSearchSchema,
});

const PAGE_SIZE = 50;

function SessionsPage(): React.JSX.Element {
    const navigate = useNavigate({ from: Route.fullPath });
    const search = Route.useSearch();
    const queryClient = useQueryClient();
    const [creating, setCreating] = useState(false);
    const [searchText, setSearchText] = useState(search.q ?? "");

    // Debounce the free-text box into the `q` search param so keystrokes don't spam the keyset walk or
    // the browser history; the URL (and query) only move once typing settles.
    useEffect(() => {
        const trimmed = searchText.trim();
        const next = trimmed === "" ? undefined : trimmed;
        const handle = setTimeout(() => {
            void navigate({ search: prev => ({ ...prev, q: next }) });
        }, 300);
        return () => clearTimeout(handle);
    }, [searchText, navigate]);

    const feed = useInfiniteQuery(
        trainingSessionsInfiniteQueryOptions({
            limit: PAGE_SIZE,
            search: search.q,
            status: search.status,
            includeArchived: search.archived,
        }),
    );
    const sessions = useMemo(() => feed.data?.pages.flatMap(page => page.items) ?? [], [feed.data]);

    const startEmpty = useMutation({
        mutationFn: () => startEmptyTrainingSession(),
        onSuccess: async session => {
            await queryClient.invalidateQueries({ queryKey: ["training-sessions"] });
            await navigate({ to: "/training/sessions/$id", params: { id: session.id } });
        },
    });

    const onCreated = async () => {
        await queryClient.invalidateQueries({ queryKey: ["training-sessions"] });
        setCreating(false);
    };

    return (
        <main className="mx-auto max-w-4xl px-6 py-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Sessions</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Your training history, newest first. Open any session to review what you did or pick up a live
                        workout.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        disabled={startEmpty.isPending}
                        onClick={() => startEmpty.mutate()}
                        size="sm"
                        variant="outline"
                    >
                        <Dumbbell />
                        Start empty
                    </Button>
                    <Button onClick={() => setCreating(true)} size="sm">
                        <Plus />
                        New session
                    </Button>
                </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                    aria-label="Search sessions"
                    className="sm:max-w-xs"
                    onChange={event => setSearchText(event.target.value)}
                    placeholder="Search by title, tag, or notes…"
                    value={searchText}
                />
                <div className="flex items-center gap-2">
                    <Select
                        onValueChange={value =>
                            navigate({
                                search: prev => ({
                                    ...prev,
                                    status: value === "all" ? undefined : (value as TrainingSessionStatusValue),
                                }),
                            })
                        }
                        value={search.status ?? "all"}
                    >
                        <SelectTrigger className="w-full sm:w-40" size="sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All statuses</SelectItem>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="in_progress">In progress</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button
                        onClick={() =>
                            navigate({ search: prev => ({ ...prev, archived: prev.archived ? undefined : true }) })
                        }
                        size="sm"
                        variant={search.archived ? "default" : "outline"}
                    >
                        {search.archived ? "Showing archived" : "Show archived"}
                    </Button>
                </div>
            </div>

            <div className="mt-8">
                <SessionsFeed
                    error={feed.error}
                    hasNextPage={feed.hasNextPage}
                    isError={feed.isError}
                    isFetchingNextPage={feed.isFetchingNextPage}
                    isPending={feed.isPending}
                    onLoadMore={() => feed.fetchNextPage()}
                    sessions={sessions}
                />
            </div>

            <Sheet onOpenChange={open => (open ? undefined : setCreating(false))} open={creating}>
                <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                    <SheetHeader>
                        <SheetTitle>New session</SheetTitle>
                        <SheetDescription>
                            Capture readiness, tags, and notes. Every save creates a new session revision.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {creating ? <CreateSession onSaved={onCreated} /> : null}
                    </div>
                </SheetContent>
            </Sheet>
        </main>
    );
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
