import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, ChevronLeft, LoaderCircle, MoreHorizontal, RotateCcw } from "lucide-react";

import type { TrainingSessionResponse, TrainingSessionStatusValue } from "@kinetix/types";

import { AdherenceDisplay } from "@/components/training/adherence-display";
import { RunningActivityDetail } from "@/components/training/running-activity-detail";
import { SessionMappingsDetail } from "@/components/training/session-mappings-detail";
import { StrengthActivityDetail } from "@/components/training/strength-activity-detail";
import { ActiveWorkout } from "@/components/training/active/active-workout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    adherenceFormulaQueryOptions,
    sessionAdherenceQueryOptions,
    trainingSessionQueryOptions,
    transitionTrainingSession,
} from "@/lib/api";

const statusVariant: Record<TrainingSessionStatusValue, "secondary" | "info" | "success"> = {
    draft: "secondary",
    in_progress: "info",
    completed: "success",
};

const statusLabel: Record<TrainingSessionStatusValue, string> = {
    draft: "Draft",
    in_progress: "In progress",
    completed: "Completed",
};

/**
 * Route entry for `/training/sessions/$id`. A live, non-archived session opens the interactive logger;
 * every other state (draft, completed, or archived) opens the read-only detail view so history can be
 * inspected without a mutation being one misclick away (design UX2).
 */
export function SessionDetailRoute({ sessionId }: { readonly sessionId: string }): React.JSX.Element {
    const session = useQuery(trainingSessionQueryOptions(sessionId));

    if (session.isPending)
        return (
            <div className="text-muted-foreground flex items-center gap-2 py-16 text-sm">
                <LoaderCircle className="animate-spin" /> Loading session…
            </div>
        );
    if (session.isError)
        return (
            <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                {session.error.message}
            </div>
        );
    if (session.data.status === "in_progress" && session.data.archivedAt === null)
        return <ActiveWorkout sessionId={sessionId} />;
    return <SessionDetail session={session.data} />;
}

type LifecycleAction = "reopen" | "archive" | "restore";

const lifecycleLabel: Record<LifecycleAction, string> = {
    reopen: "Reopen",
    archive: "Archive",
    restore: "Restore",
};

/** Lifecycle actions available from the read view, per state. Archiving is a separate soft-delete flag. */
function actionsFor(session: TrainingSessionResponse): readonly LifecycleAction[] {
    if (session.archivedAt !== null) return ["restore"];
    switch (session.status) {
        case "draft":
            return ["archive"];
        case "completed":
            return ["reopen", "archive"];
        case "in_progress":
            return ["archive"];
    }
}

/**
 * Read-only session detail (design 11.x; UX2). Renders the whole recorded tree — readiness/post
 * ratings, strength and running activities, pain records, tags, and planned-vs-actual mappings — with
 * its planned session and program named and navigable. Mutating lifecycle actions live in an overflow
 * menu, never as inline buttons, so viewing history never sits one misclick from a mutation.
 */
export function SessionDetail({ session }: { readonly session: TrainingSessionResponse }): React.JSX.Element {
    const queryClient = useQueryClient();
    const lifecycle = useMutation({
        mutationFn: (action: LifecycleAction) => transitionTrainingSession(session, action),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["training-session", session.id] });
            await queryClient.invalidateQueries({ queryKey: ["training-sessions"] });
        },
    });
    const actions = actionsFor(session);

    return (
        <div className="mx-auto max-w-4xl px-6 py-10">
            <Button asChild className="text-muted-foreground mb-4 -ml-2" size="sm" variant="ghost">
                <Link to="/training/sessions">
                    <ChevronLeft />
                    All sessions
                </Link>
            </Button>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="truncate text-2xl font-semibold">{session.title ?? "Untitled session"}</h1>
                        <Badge variant={statusVariant[session.status]}>{statusLabel[session.status]}</Badge>
                        {session.archivedAt !== null ? <Badge variant="outline">archived</Badge> : null}
                        <span className="text-muted-foreground font-mono text-xs tabular-nums">v{session.version}</span>
                    </div>
                    <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="font-mono tabular-nums">{session.localDate}</span>
                        {session.durationMinutes !== null ? (
                            <span className="font-mono tabular-nums">{session.durationMinutes} min</span>
                        ) : null}
                        <ProgramLink links={session.plannedLinks} />
                        <PlannedSessionName links={session.plannedLinks} />
                    </div>
                </div>
                {actions.length > 0 ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-label="Session actions" size="icon" variant="outline">
                                <MoreHorizontal />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {actions.map(action => (
                                <DropdownMenuItem
                                    disabled={lifecycle.isPending}
                                    key={action}
                                    onSelect={() => lifecycle.mutate(action)}
                                >
                                    {action === "restore" ? <RotateCcw /> : action === "archive" ? <Archive /> : null}
                                    {lifecycleLabel[action]}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>

            {lifecycle.isError ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive mt-4 rounded-lg border p-3 text-sm">
                    {lifecycle.error.message}
                </div>
            ) : null}

            <div className="mt-8 grid gap-6">
                <RatingsGrid session={session} />
                {session.tags.length > 0 ? (
                    <section className="grid gap-2">
                        <h3 className="text-sm font-medium">Tags</h3>
                        <div className="flex flex-wrap gap-1.5">
                            {session.tags.map(tag => (
                                <Badge key={tag} variant="secondary">
                                    {tag}
                                </Badge>
                            ))}
                        </div>
                    </section>
                ) : null}
                {session.notes ? (
                    <section className="grid gap-2">
                        <h3 className="text-sm font-medium">Notes</h3>
                        <p className="text-muted-foreground text-sm whitespace-pre-wrap">{session.notes}</p>
                    </section>
                ) : null}
                <StrengthActivityDetail activities={session.activities} />
                <RunningActivityDetail activities={session.activities} />
                <PainRecords records={session.painRecords} />
                <AdherenceSection session={session} />
                <SessionMappingsDetail session={session} />
                {isEmptySession(session) ? (
                    <p className="text-muted-foreground py-6 text-sm">This session has no recorded activities yet.</p>
                ) : null}
            </div>
        </div>
    );
}

/**
 * Adherence section (design UX5, §16.7). Shows the derived adherence read for a completed session — its
 * overall percentage, component scores, exclusions, divergence, evidence, formula version, and a
 * stale/pending/failed label. It is a projection recomputed by the worker, so an empty result set on a
 * completed session is surfaced as "recalculating" rather than hidden. Never shown for a draft session.
 */
function AdherenceSection({ session }: { readonly session: TrainingSessionResponse }): React.JSX.Element | null {
    const adherence = useQuery(sessionAdherenceQueryOptions(session.id));
    const formula = useQuery(adherenceFormulaQueryOptions);

    if (session.status !== "completed") return null;
    const results = adherence.data?.results ?? [];
    if (adherence.isPending && results.length === 0) return null;
    if (results.length === 0) {
        if (session.archivedAt !== null) return null;
        return (
            <section className="grid gap-2">
                <h3 className="text-sm font-medium">Adherence</h3>
                <p className="text-muted-foreground border-border rounded-lg border p-4 text-sm">
                    Adherence for this session is being calculated.
                </p>
            </section>
        );
    }
    return (
        <section className="grid gap-2">
            <h3 className="text-sm font-medium">Adherence</h3>
            <AdherenceDisplay formula={formula.data} results={results} />
        </section>
    );
}

/** True when the session carries no recorded content worth an inspector section. */
function isEmptySession(session: TrainingSessionResponse): boolean {
    return (
        session.activities.length === 0 &&
        session.painRecords.length === 0 &&
        session.plannedLinks.length === 0 &&
        session.tags.length === 0 &&
        session.notes === null
    );
}

/** Navigable link to the owning program, resolved from the first planned link that names one. */
function ProgramLink({ links }: { readonly links: TrainingSessionResponse["plannedLinks"] }): React.JSX.Element | null {
    const withProgram = links.find(link => link.programId !== null && link.programName !== null);
    if (!withProgram?.programId) return null;
    return (
        <Link
            className="text-foreground hover:text-primary underline underline-offset-4"
            params={{ id: withProgram.programId }}
            to="/training/programs/$id"
        >
            {withProgram.programName}
        </Link>
    );
}

/** The originating planned session's title, shown by name (no dedicated route exists to link it yet). */
function PlannedSessionName({
    links,
}: {
    readonly links: TrainingSessionResponse["plannedLinks"];
}): React.JSX.Element | null {
    const named = links.find(link => link.plannedSessionTitle !== null);
    if (!named?.plannedSessionTitle) return null;
    return <span>{named.plannedSessionTitle}</span>;
}

const readinessFields = [
    ["energy", "Energy"],
    ["motivation", "Motivation"],
    ["fatigue", "Fatigue"],
    ["soreness", "Soreness"],
    ["stress", "Stress"],
    ["recovery", "Recovery"],
] as const;

const postFields = [
    ["energy", "Energy"],
    ["motivation", "Motivation"],
    ["enjoyment", "Enjoyment"],
    ["difficulty", "Difficulty"],
    ["fatigue", "Fatigue"],
] as const;

/** Read-only pre-workout readiness and post-workout ratings; rendered only when something was recorded. */
function RatingsGrid({ session }: { readonly session: TrainingSessionResponse }): React.JSX.Element | null {
    const readiness = readinessFields.filter(([key]) => session.readiness[key] !== null);
    const post = postFields.filter(([key]) => session.postWorkout[key] !== null);
    if (readiness.length === 0 && post.length === 0 && !session.postWorkout.notes) return null;
    return (
        <section className="grid gap-4 sm:grid-cols-2">
            {readiness.length > 0 ? (
                <div className="border-border grid gap-2 rounded-lg border p-4">
                    <h3 className="text-sm font-medium">Readiness</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {readiness.map(([key, label]) => (
                            <Rating key={key} label={label} value={session.readiness[key]} />
                        ))}
                    </dl>
                </div>
            ) : null}
            {post.length > 0 || session.postWorkout.notes ? (
                <div className="border-border grid gap-2 rounded-lg border p-4">
                    <h3 className="text-sm font-medium">Post-workout</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {post.map(([key, label]) => (
                            <Rating key={key} label={label} value={session.postWorkout[key]} />
                        ))}
                    </dl>
                    {session.postWorkout.notes ? (
                        <p className="text-muted-foreground text-sm whitespace-pre-wrap">{session.postWorkout.notes}</p>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function Rating({ label, value }: { readonly label: string; readonly value: number | null }): React.JSX.Element {
    return (
        <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums">{value === null ? "—" : `${value}/5`}</dd>
        </div>
    );
}

const painSeverityVariant = (severity: number): "warning" | "destructive" =>
    severity >= 7 ? "destructive" : "warning";

/** Read-only list of pain records with their body area, side, and 0–10 severity. */
function PainRecords({
    records,
}: {
    readonly records: TrainingSessionResponse["painRecords"];
}): React.JSX.Element | null {
    if (records.length === 0) return null;
    return (
        <section className="grid gap-2">
            <h3 className="text-sm font-medium">Pain records</h3>
            <div className="border-border grid gap-2 rounded-lg border p-4">
                {records.map(record => (
                    <div className="flex flex-wrap items-center gap-1.5 text-sm" key={record.id}>
                        <Badge variant={painSeverityVariant(record.severity)}>{record.severity}/10</Badge>
                        <span className="font-medium">{record.bodyArea}</span>
                        <span className="text-muted-foreground">{record.side}</span>
                        {record.painType ? <span className="text-muted-foreground">· {record.painType}</span> : null}
                        {record.stoppedActivity ? <Badge variant="destructive">stopped activity</Badge> : null}
                        {record.onsetDuringSession ? <Badge variant="outline">onset in session</Badge> : null}
                    </div>
                ))}
            </div>
        </section>
    );
}
