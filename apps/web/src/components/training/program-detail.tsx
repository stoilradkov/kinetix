import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
    Ban,
    CalendarClock,
    CircleCheck,
    CircleDashed,
    CircleSlash,
    LoaderCircle,
    MoreHorizontal,
    SquareArrowOutUpRight,
    type LucideIcon,
} from "lucide-react";

import type {
    PlannedSessionResponse,
    PlannedSessionStatusValue,
    ProgramResponse,
    ProgramSessionMembership,
    ProgramStatusValue,
    SkipCancelReasonValue,
} from "@kinetix/types";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    changePlannedSessionOutcome,
    changeProgramStartDate,
    plannedSessionQueryOptions,
    programQueryOptions,
    programSessionsQueryOptions,
    reschedulePlannedSession,
} from "@/lib/api";
import { groupPlannedSessions, programProgress, type PlannedSessionGroup } from "@/lib/program-hub";
import { utcDate } from "@/lib/session-weeks";

const statusVariant: Record<ProgramStatusValue, "success" | "info" | "warning" | "secondary" | "milestone"> = {
    draft: "secondary",
    active: "success",
    paused: "warning",
    completed: "milestone",
    archived: "secondary",
};

const rowDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
});

const rangeFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
});

const skipReasons: readonly SkipCancelReasonValue[] = [
    "illness",
    "fatigue",
    "pain",
    "schedule",
    "recovery",
    "equipment_unavailable",
    "other",
];

/**
 * Program detail hub (issue #67). The addressable landing surface for one program: a header with its
 * status, date range, and schedule progress; the planned sessions grouped into collapsible week
 * sections, each row showing completion state and linking forward to the performed session when one
 * exists (#65); and the reschedule/skip/cancel and start-date actions gathered here rather than in a
 * throwaway sheet.
 */
export function ProgramDetailRoute({ programId }: { readonly programId: string }): React.JSX.Element {
    const program = useQuery(programQueryOptions(programId));
    const sessions = useQuery(programSessionsQueryOptions(programId));

    if (program.isPending || sessions.isPending)
        return (
            <div className="text-muted-foreground flex items-center gap-2 py-16 text-sm">
                <LoaderCircle className="animate-spin" /> Loading program…
            </div>
        );
    if (program.isError) return <PageError message={program.error.message} />;
    if (sessions.isError) return <PageError message={sessions.error.message} />;

    return <ProgramDetail program={program.data} sessions={sessions.data.items} />;
}

export function ProgramDetail({
    program,
    sessions,
}: {
    readonly program: ProgramResponse;
    readonly sessions: readonly ProgramSessionMembership[];
}): React.JSX.Element {
    const queryClient = useQueryClient();
    const groups = groupPlannedSessions(sessions);
    const today = new Date().toISOString().slice(0, 10);
    const progress = programProgress(program, groups, today);

    const invalidate = () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: ["training-program", program.id] }),
            queryClient.invalidateQueries({ queryKey: ["training-program-sessions", program.id] }),
        ]);

    return (
        <main className="mx-auto max-w-4xl px-6 py-10">
            <Breadcrumb>
                <BreadcrumbList>
                    <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                            <Link to="/training/programs">Programs</Link>
                        </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                        <BreadcrumbPage>{program.name}</BreadcrumbPage>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>

            <header className="mt-6 grid gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-2xl font-semibold">{program.name}</h1>
                            <Badge variant={statusVariant[program.status]}>{program.status}</Badge>
                            <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                v{program.version}
                            </span>
                        </div>
                        <p className="text-muted-foreground mt-1 text-sm">
                            <DateRange endDate={program.endDate} startDate={program.startDate} /> ·{" "}
                            {program.scheduleMode}
                        </p>
                    </div>
                    {program.scheduleMode === "dated" ? (
                        <ChangeStartDate onChanged={invalidate} program={program} />
                    ) : null}
                </div>

                {progress ? (
                    <div className="grid gap-1.5">
                        <div className="text-muted-foreground flex items-center justify-between text-xs">
                            <span className="font-medium">{progress.label}</span>
                            <span className="font-mono tabular-nums">{progress.percent}%</span>
                        </div>
                        <Progress value={progress.percent} />
                    </div>
                ) : null}

                <WarningsList warnings={program.warnings} />
            </header>

            <section className="mt-8">
                {sessions.length === 0 ? (
                    <p className="text-muted-foreground py-10 text-sm">
                        No planned sessions yet. Activate this program to generate them.
                    </p>
                ) : (
                    <Accordion className="w-full" defaultValue={groups.map(group => group.key)} type="multiple">
                        {groups.map(group => (
                            <SessionGroup group={group} key={group.key} onChanged={invalidate} />
                        ))}
                    </Accordion>
                )}
            </section>
        </main>
    );
}

function SessionGroup({
    group,
    onChanged,
}: {
    readonly group: PlannedSessionGroup;
    readonly onChanged: () => void;
}): React.JSX.Element {
    return (
        <AccordionItem value={group.key}>
            <AccordionTrigger>
                <span className="flex items-center gap-2">
                    <span>{group.label}</span>
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                        · {group.sessions.length}
                    </span>
                </span>
            </AccordionTrigger>
            <AccordionContent>
                <ul className="grid gap-2">
                    {group.sessions.map(session => (
                        <PlannedSessionRow key={session.plannedSessionId} onChanged={onChanged} session={session} />
                    ))}
                </ul>
            </AccordionContent>
        </AccordionItem>
    );
}

interface StateDisplay {
    readonly icon: LucideIcon;
    readonly label: string;
    readonly tone: string;
}

/** Completion state as an icon + label pair (never colour alone), tuned to Kinetic Calm semantics. */
function stateDisplay(status: PlannedSessionStatusValue): StateDisplay {
    switch (status) {
        case "completed":
            return { icon: CircleCheck, label: "Completed", tone: "text-success" };
        case "partially_completed":
            return { icon: CircleSlash, label: "Partial", tone: "text-warning" };
        case "planned":
            return { icon: CircleDashed, label: "Upcoming", tone: "text-foreground" };
        case "skipped":
            return { icon: Ban, label: "Skipped", tone: "text-muted-foreground" };
        case "cancelled":
            return { icon: Ban, label: "Cancelled", tone: "text-muted-foreground" };
    }
}

function PlannedSessionRow({
    session,
    onChanged,
}: {
    readonly session: ProgramSessionMembership;
    readonly onChanged: () => void;
}): React.JSX.Element {
    const [actionsOpen, setActionsOpen] = useState(false);
    const state = stateDisplay(session.status);
    const StateIcon = state.icon;

    return (
        <li className="border-border flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{session.title ?? "Untitled session"}</span>
                    {session.overdue ? <Badge variant="destructive">overdue</Badge> : null}
                </div>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-mono tabular-nums">
                        {session.localDate === null
                            ? "unscheduled"
                            : rowDateFormatter.format(utcDate(session.localDate))}
                    </span>
                    {session.preferredTime !== null ? (
                        <span className="font-mono tabular-nums">{session.preferredTime}</span>
                    ) : null}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <span className={`flex items-center gap-1 text-xs ${state.tone}`}>
                    <StateIcon className="size-4" />
                    {state.label}
                </span>
                {session.actualSessionId !== null ? (
                    <Button asChild size="sm" variant="outline">
                        <Link params={{ id: session.actualSessionId }} to="/training/sessions/$id">
                            <SquareArrowOutUpRight />
                            View session
                        </Link>
                    </Button>
                ) : null}
                {session.status === "planned" ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost">
                                <MoreHorizontal />
                                <span className="sr-only">Session actions</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setActionsOpen(true)}>
                                <CalendarClock />
                                Reschedule, skip, or cancel
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>

            <SessionActionsDialog
                onChanged={onChanged}
                onOpenChange={setActionsOpen}
                open={actionsOpen}
                plannedSessionId={session.plannedSessionId}
            />
        </li>
    );
}

function SessionActionsDialog({
    plannedSessionId,
    open,
    onOpenChange,
    onChanged,
}: {
    readonly plannedSessionId: string;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly onChanged: () => void;
}): React.JSX.Element {
    const session = useQuery(plannedSessionQueryOptions(open ? plannedSessionId : null));

    return (
        <Dialog onOpenChange={onOpenChange} open={open}>
            <DialogContent>
                {session.isPending ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                        <LoaderCircle className="animate-spin" /> Loading session…
                    </div>
                ) : session.isError ? (
                    <ErrorBox message={session.error.message} />
                ) : session.data ? (
                    <SessionActions
                        onDone={() => {
                            onChanged();
                            onOpenChange(false);
                        }}
                        session={session.data}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

type PlannedSessionResponseLite = Pick<
    PlannedSessionResponse,
    "id" | "version" | "title" | "status" | "localDate" | "preferredTime"
>;

function SessionActions({
    session,
    onDone,
}: {
    readonly session: PlannedSessionResponseLite;
    readonly onDone: () => void;
}): React.JSX.Element {
    const queryClient = useQueryClient();
    const [localDate, setLocalDate] = useState(session.localDate ?? "");
    const [preferredTime, setPreferredTime] = useState(session.preferredTime ?? "");
    const [reason, setReason] = useState<SkipCancelReasonValue | "">("");
    const [notes, setNotes] = useState("");

    const invalidateSession = () =>
        queryClient.invalidateQueries({ queryKey: ["training-planned-session", session.id] });

    const reschedule = useMutation({
        mutationFn: () =>
            reschedulePlannedSession(session, {
                localDate: localDate.trim() === "" ? null : localDate,
                ...(preferredTime.trim() ? { preferredTime } : { preferredTime: null }),
            }),
        onSuccess: async () => {
            await invalidateSession();
            onDone();
        },
    });

    const outcome = useMutation({
        mutationFn: (action: "skip" | "cancel") =>
            changePlannedSessionOutcome(session, action, {
                ...(reason === "" ? {} : { reason }),
                ...(notes.trim() ? { notes } : {}),
            }),
        onSuccess: async () => {
            await invalidateSession();
            onDone();
        },
    });

    const isOpen = session.status === "planned";
    const busy = reschedule.isPending || outcome.isPending;

    return (
        <>
            <DialogHeader>
                <DialogTitle>{session.title ?? "Planned session"}</DialogTitle>
                <DialogDescription>
                    {isOpen
                        ? "Reschedule to a new date, or skip/cancel with a reason."
                        : `This session is ${session.status} and can no longer be changed.`}
                </DialogDescription>
            </DialogHeader>

            {isOpen ? (
                <div className="grid gap-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                            <Label>Date</Label>
                            <DateField onValueChange={setLocalDate} value={localDate} />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Preferred time</Label>
                            <Input
                                onChange={event => setPreferredTime(event.target.value)}
                                placeholder="HH:MM"
                                value={preferredTime}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <Button disabled={busy} onClick={() => reschedule.mutate()} variant="outline">
                            {reschedule.isPending ? <LoaderCircle className="animate-spin" /> : null}
                            Reschedule
                        </Button>
                    </div>

                    <div className="border-border grid gap-3 border-t pt-4">
                        <div className="grid gap-1.5">
                            <Label>Reason (optional)</Label>
                            <Select onValueChange={value => setReason(value as SkipCancelReasonValue)} value={reason}>
                                <SelectTrigger>
                                    <SelectValue placeholder="No reason" />
                                </SelectTrigger>
                                <SelectContent>
                                    {skipReasons.map(value => (
                                        <SelectItem key={value} value={value}>
                                            {value.replace(/_/g, " ")}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Notes (optional)</Label>
                            <Textarea onChange={event => setNotes(event.target.value)} rows={2} value={notes} />
                        </div>
                    </div>
                    {reschedule.isError ? <ErrorBox message={reschedule.error.message} /> : null}
                    {outcome.isError ? <ErrorBox message={outcome.error.message} /> : null}
                    <DialogFooter>
                        <Button disabled={busy} onClick={() => outcome.mutate("skip")} variant="ghost">
                            Skip
                        </Button>
                        <Button
                            className="border-destructive/40 text-destructive hover:bg-destructive/10"
                            disabled={busy}
                            onClick={() => outcome.mutate("cancel")}
                            variant="outline"
                        >
                            Cancel session
                        </Button>
                    </DialogFooter>
                </div>
            ) : (
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </DialogFooter>
            )}
        </>
    );
}

function ChangeStartDate({
    program,
    onChanged,
}: {
    readonly program: ProgramResponse;
    readonly onChanged: () => void;
}): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const [startDate, setStartDate] = useState(program.startDate ?? "");
    const [moved, setMoved] = useState<
        { readonly id: string; readonly fromDate: string; readonly toDate: string }[] | null
    >(null);

    const mutation = useMutation({
        mutationFn: () => changeProgramStartDate(program, { startDate: startDate.trim() === "" ? null : startDate }),
        onSuccess: response => {
            setMoved([...response.movedSessions]);
            onChanged();
        },
    });

    return (
        <Dialog
            onOpenChange={next => {
                setOpen(next);
                if (!next) {
                    setMoved(null);
                    mutation.reset();
                }
            }}
            open={open}
        >
            <Button onClick={() => setOpen(true)} size="sm" variant="outline">
                <CalendarClock />
                Change start date
            </Button>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Change start date</DialogTitle>
                    <DialogDescription>
                        Only incomplete future sessions move by the same offset. Overdue and completed sessions stay
                        put.
                    </DialogDescription>
                </DialogHeader>
                {moved ? (
                    <div className="grid gap-2 text-sm">
                        <p className="font-medium">
                            Moved {moved.length} {moved.length === 1 ? "session" : "sessions"}
                        </p>
                        <ul className="grid gap-1">
                            {moved.map(shift => (
                                <li
                                    className="text-muted-foreground flex items-center gap-2 font-mono text-xs tabular-nums"
                                    key={shift.id}
                                >
                                    <span>{shift.fromDate}</span>
                                    <span>→</span>
                                    <span className="text-foreground">{shift.toDate}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <div className="grid gap-1.5">
                        <Label>New start date</Label>
                        <DateField onValueChange={setStartDate} value={startDate} />
                    </div>
                )}
                {mutation.isError ? <ErrorBox message={mutation.error.message} /> : null}
                <DialogFooter>
                    {moved ? (
                        <DialogClose asChild>
                            <Button>Done</Button>
                        </DialogClose>
                    ) : (
                        <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                            {mutation.isPending ? <LoaderCircle className="animate-spin" /> : null}
                            Apply
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function DateRange({
    startDate,
    endDate,
}: {
    readonly startDate: string | null;
    readonly endDate: string | null;
}): React.JSX.Element {
    if (startDate === null && endDate === null) return <span>No dates set</span>;
    const start = startDate === null ? "—" : rangeFormatter.format(utcDate(startDate));
    const end = endDate === null ? "—" : rangeFormatter.format(utcDate(endDate));
    return (
        <span className="font-mono tabular-nums">
            {start} → {end}
        </span>
    );
}

function WarningsList({
    warnings,
}: {
    readonly warnings: readonly { readonly message: string }[];
}): React.JSX.Element | null {
    if (warnings.length === 0) return null;
    return (
        <div className="border-warning/40 bg-warning-muted rounded-lg border p-3 text-sm" role="status">
            <p className="text-warning font-medium">Planning warnings</p>
            <ul className="text-foreground mt-1 list-disc pl-5">
                {warnings.map((warning, index) => (
                    <li key={index}>{warning.message}</li>
                ))}
            </ul>
        </div>
    );
}

function PageError({ message }: { readonly message: string }): React.JSX.Element {
    return (
        <main className="mx-auto max-w-4xl px-6 py-10">
            <ErrorBox message={message} />
        </main>
    );
}

function ErrorBox({ message }: { readonly message: string }): React.JSX.Element {
    return (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
            {message}
        </div>
    );
}
