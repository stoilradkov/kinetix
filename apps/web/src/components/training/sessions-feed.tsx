import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleDashed, Dumbbell, Footprints, LoaderCircle, type LucideIcon } from "lucide-react";

import type { SessionActivityTypeValue, TrainingSessionStatusValue, TrainingSessionSummary } from "@kinetix/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { groupSessionsByWeek, utcDate } from "@/lib/session-weeks";

const rowDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
});

export interface SessionsFeedProps {
    readonly sessions: readonly TrainingSessionSummary[];
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly error?: Error | null;
    readonly hasNextPage: boolean;
    readonly isFetchingNextPage: boolean;
    readonly onLoadMore: () => void;
}

/**
 * Newest-first, week-grouped sessions feed (design UX3; issue #66). Rows are differentiable at a glance
 * — date, title, program, content summary, and a subdued status — and the list stays bounded behind an
 * explicit Load-more control rather than rendering the whole history.
 */
export function SessionsFeed({
    sessions,
    isPending,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
}: SessionsFeedProps): React.JSX.Element {
    if (isPending)
        return (
            <div className="text-muted-foreground flex items-center gap-2 py-16 text-sm">
                <LoaderCircle className="animate-spin" /> Loading sessions…
            </div>
        );
    if (isError)
        return (
            <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                {error?.message ?? "Could not load sessions."}
            </div>
        );
    if (sessions.length === 0)
        return <p className="text-muted-foreground py-16 text-center text-sm">No sessions match these filters yet.</p>;

    const weeks = groupSessionsByWeek(sessions);
    return (
        <div className="grid gap-8">
            {weeks.map(week => (
                <section className="grid gap-2" key={week.weekStart}>
                    <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {week.label} · {week.sessions.length} session{week.sessions.length === 1 ? "" : "s"}
                    </h2>
                    <div className="border-border divide-border divide-y rounded-lg border">
                        {week.sessions.map(session => (
                            <SessionRow key={session.id} session={session} />
                        ))}
                    </div>
                </section>
            ))}
            {hasNextPage ? (
                <div className="flex justify-center">
                    <Button disabled={isFetchingNextPage} onClick={onLoadMore} variant="outline">
                        {isFetchingNextPage ? <LoaderCircle className="animate-spin" /> : null}
                        Load more
                    </Button>
                </div>
            ) : (
                <p className="text-muted-foreground text-center text-xs">You've reached the start of your history.</p>
            )}
        </div>
    );
}

/** One session as a compact, clickable feed row that opens its detail view (#65). */
function SessionRow({ session }: { readonly session: TrainingSessionSummary }): React.JSX.Element {
    return (
        <Link
            className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors"
            params={{ id: session.id }}
            to="/training/sessions/$id"
        >
            <span className="text-muted-foreground w-24 shrink-0 font-mono text-xs tabular-nums">
                {rowDateFormatter.format(utcDate(session.localDate))}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{session.title ?? "Untitled session"}</span>
                    {session.archivedAt !== null ? <Badge variant="outline">Archived</Badge> : null}
                </div>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <ContentSummary session={session} />
                    {session.programName !== null ? (
                        <>
                            <span aria-hidden>·</span>
                            <span className="truncate">{session.programName}</span>
                        </>
                    ) : null}
                </div>
            </div>
            <StatusIndicator archivedAt={session.archivedAt} status={session.status} />
        </Link>
    );
}

const activityKindLabel: Record<SessionActivityTypeValue, string> = {
    strength: "Strength",
    running: "Running",
};

const activityKindIcon: Record<SessionActivityTypeValue, LucideIcon> = {
    strength: Dumbbell,
    running: Footprints,
};

/** Bounded "what happened" line — the activity kinds present plus the total set count. */
function ContentSummary({ session }: { readonly session: TrainingSessionSummary }): React.JSX.Element {
    if (session.activityKinds.length === 0) return <span>No activities</span>;
    return (
        <span className="flex items-center gap-x-2">
            {session.activityKinds.map(kind => {
                const Icon = activityKindIcon[kind];
                return (
                    <span className="flex items-center gap-1" key={kind}>
                        <Icon className="size-3.5" />
                        {activityKindLabel[kind]}
                    </span>
                );
            })}
            {session.totalSetCount > 0 ? (
                <span className="font-mono tabular-nums">
                    {session.totalSetCount} set{session.totalSetCount === 1 ? "" : "s"}
                </span>
            ) : null}
        </span>
    );
}

/**
 * Subdued status affordance. Completed is the norm across an imported history, so it reads as a quiet
 * muted check rather than a green pill on every row; only the notable states (draft, in progress) get a
 * badge.
 */
function StatusIndicator({
    status,
    archivedAt,
}: {
    readonly status: TrainingSessionStatusValue;
    readonly archivedAt: string | null;
}): React.JSX.Element {
    if (archivedAt !== null) return <span className="w-24 shrink-0" />;
    switch (status) {
        case "completed":
            return (
                <span className="text-muted-foreground flex w-24 shrink-0 items-center justify-end gap-1 text-xs">
                    <CircleCheck className="size-4" />
                    <span className="sr-only">Completed</span>
                </span>
            );
        case "in_progress":
            return (
                <span className="flex w-24 shrink-0 justify-end">
                    <Badge variant="info">In progress</Badge>
                </span>
            );
        case "draft":
            return (
                <span className="text-muted-foreground flex w-24 shrink-0 items-center justify-end gap-1 text-xs">
                    <CircleDashed className="size-4" />
                    <span className="sr-only">Draft</span>
                </span>
            );
    }
}
