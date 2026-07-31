import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, LoaderCircle, Plus, Trash2 } from "lucide-react";

import type {
    ActivateProgramResponse,
    ChangeProgramStartDateResponse,
    PlannedSessionResponse,
    PlannedSessionStatusValue,
    ProgramSummary,
    SkipCancelReasonValue,
} from "@kinetix/types";

import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    activateProgram,
    changePlannedSessionOutcome,
    changeProgramStartDate,
    plannedSessionQueryOptions,
    programQueryOptions,
    programSessionsQueryOptions,
    reschedulePlannedSession,
    workoutTemplatesQueryOptions,
} from "@/lib/api";

const statusVariant: Record<PlannedSessionStatusValue, "success" | "info" | "warning" | "secondary" | "destructive"> = {
    planned: "info",
    completed: "success",
    partially_completed: "warning",
    skipped: "secondary",
    cancelled: "destructive",
};

const skipReasons: readonly SkipCancelReasonValue[] = [
    "illness",
    "fatigue",
    "pain",
    "schedule",
    "recovery",
    "equipment_unavailable",
    "other",
];

type SessionPlanRow = {
    readonly key: string;
    templateId: string;
    relativeWeek: string;
    relativeDay: string;
    sequence: string;
    localDate: string;
};

function emptyPlanRow(sequence: number): SessionPlanRow {
    return {
        key: crypto.randomUUID(),
        templateId: "",
        relativeWeek: "",
        relativeDay: "",
        sequence: String(sequence),
        localDate: "",
    };
}

/**
 * Activation builder: attach source templates to relative positions, then generate every planned
 * session in one call. Dated programs derive concrete dates server-side; relative/ordered programs
 * generate ordered unscheduled sessions. Collision warnings are shown, never silently applied.
 */
export function ActivateProgramPanel({
    program,
    onDone,
}: {
    readonly program: ProgramSummary;
    readonly onDone: () => void;
}): React.JSX.Element {
    const templates = useQuery(workoutTemplatesQueryOptions(false));
    const [rows, setRows] = useState<readonly SessionPlanRow[]>([emptyPlanRow(0)]);
    const [result, setResult] = useState<ActivateProgramResponse | null>(null);

    const mutation = useMutation({
        mutationFn: () =>
            activateProgram(program, {
                sessions: rows.map(row => ({
                    templateId: row.templateId,
                    sequence: Number(row.sequence),
                    ...(row.relativeWeek.trim() ? { relativeWeek: Number(row.relativeWeek) } : {}),
                    ...(row.relativeDay.trim() ? { relativeDay: Number(row.relativeDay) } : {}),
                    ...(row.localDate.trim() ? { localDate: row.localDate } : {}),
                })),
            }),
        onSuccess: setResult,
    });

    if (result) return <ActivationSummary result={result} onDone={onDone} />;

    const dated = program.scheduleMode === "dated";
    const canSubmit = rows.length > 0 && rows.every(row => row.templateId !== "") && !mutation.isPending;

    return (
        <div className="grid gap-5">
            <p className="text-muted-foreground text-sm">
                {dated
                    ? "Dates are derived from the program start date and each session's relative week/day. Leave a session date blank to derive it, or set one to override."
                    : "This program is unscheduled — sessions are generated in sequence order without calendar dates."}
            </p>

            {templates.isPending ? (
                <Loading label="Loading templates…" />
            ) : templates.isError ? (
                <ErrorBox message={templates.error.message} />
            ) : templates.data.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    Create a workout template first — there are none to plan.
                </p>
            ) : (
                <div className="grid gap-3">
                    {rows.map((row, index) => (
                        <div className="border-border grid gap-3 rounded-lg border p-3" key={row.key}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground text-xs font-medium">Session {index + 1}</span>
                                {rows.length > 1 ? (
                                    <Button
                                        onClick={() => setRows(current => current.filter(item => item.key !== row.key))}
                                        size="icon"
                                        variant="ghost"
                                    >
                                        <Trash2 />
                                    </Button>
                                ) : null}
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Template</Label>
                                <Select
                                    onValueChange={value => patchRow(setRows, row.key, { templateId: value })}
                                    value={row.templateId}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Choose a template" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {templates.data.items.map(template => (
                                            <SelectItem key={template.id} value={template.id}>
                                                {template.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <NumberField
                                    label="Sequence"
                                    onChange={value => patchRow(setRows, row.key, { sequence: value })}
                                    value={row.sequence}
                                />
                                {dated ? (
                                    <>
                                        <NumberField
                                            label="Week"
                                            onChange={value => patchRow(setRows, row.key, { relativeWeek: value })}
                                            value={row.relativeWeek}
                                        />
                                        <NumberField
                                            label="Day"
                                            onChange={value => patchRow(setRows, row.key, { relativeDay: value })}
                                            value={row.relativeDay}
                                        />
                                    </>
                                ) : null}
                            </div>
                            {dated ? (
                                <div className="grid gap-1.5">
                                    <Label>Date override (optional)</Label>
                                    <DateField
                                        onValueChange={value => patchRow(setRows, row.key, { localDate: value })}
                                        value={row.localDate}
                                    />
                                </div>
                            ) : null}
                        </div>
                    ))}
                    <Button
                        className="justify-self-start"
                        onClick={() => setRows(current => [...current, emptyPlanRow(current.length)])}
                        size="sm"
                        variant="outline"
                    >
                        <Plus />
                        Add session
                    </Button>
                </div>
            )}

            {mutation.isError ? <ErrorBox message={mutation.error.message} /> : null}
            <div className="flex justify-end">
                <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
                    {mutation.isPending ? <LoaderCircle className="animate-spin" /> : null}
                    Activate & generate
                </Button>
            </div>
        </div>
    );
}

function ActivationSummary({
    result,
    onDone,
}: {
    readonly result: ActivateProgramResponse;
    readonly onDone: () => void;
}): React.JSX.Element {
    return (
        <div className="grid gap-5">
            <div className="border-success/40 bg-success-muted rounded-lg border p-3 text-sm">
                <p className="text-success font-medium">
                    Generated {result.generatedSessions.length}{" "}
                    {result.generatedSessions.length === 1 ? "session" : "sessions"}
                </p>
            </div>
            <WarningsList warnings={result.warnings} />
            <ul className="grid gap-2">
                {result.generatedSessions.map(session => (
                    <li
                        className="border-border flex items-center justify-between gap-2 rounded-lg border p-3"
                        key={session.id}
                    >
                        <span className="truncate text-sm font-medium">{session.title ?? "Untitled session"}</span>
                        <span className="text-muted-foreground font-mono text-xs tabular-nums">
                            {session.localDate ?? "unscheduled"}
                        </span>
                    </li>
                ))}
            </ul>
            <div className="flex justify-end">
                <Button onClick={onDone}>Done</Button>
            </div>
        </div>
    );
}

/**
 * Read-only sessions view for an activated program plus per-session reschedule/skip/cancel. Overdue
 * sessions (still planned but past due) and schedule collisions are surfaced as badges/warnings;
 * nothing is auto-shifted. Dated programs also expose a start-date change from here.
 */
export function ProgramSessionsPanel({
    program,
    onChanged,
}: {
    readonly program: ProgramSummary;
    readonly onChanged: () => void;
}): React.JSX.Element {
    const detail = useQuery(programQueryOptions(program.id));
    const sessions = useQuery(programSessionsQueryOptions(program.id));
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

    return (
        <div className="grid gap-5">
            {program.scheduleMode === "dated" ? <ChangeStartDatePanel program={program} onChanged={onChanged} /> : null}
            {detail.data ? <WarningsList warnings={detail.data.warnings} /> : null}

            {sessions.isPending ? (
                <Loading label="Loading sessions…" />
            ) : sessions.isError ? (
                <ErrorBox message={sessions.error.message} />
            ) : sessions.data.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    No planned sessions yet. Activate the program to generate them.
                </p>
            ) : (
                <ul className="grid gap-2">
                    {sessions.data.items.map(session => (
                        <li key={session.plannedSessionId}>
                            <button
                                className="border-border hover:bg-muted flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-left"
                                onClick={() => setActiveSessionId(session.plannedSessionId)}
                                type="button"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium">
                                            {session.title ?? "Untitled session"}
                                        </span>
                                        <Badge variant={statusVariant[session.status]}>{session.status}</Badge>
                                        {session.overdue ? <Badge variant="destructive">overdue</Badge> : null}
                                    </div>
                                    <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                                        <span className="font-mono tabular-nums">
                                            {session.localDate ?? "unscheduled"}
                                        </span>
                                        {session.preferredTime ? (
                                            <span className="font-mono tabular-nums">{session.preferredTime}</span>
                                        ) : null}
                                    </div>
                                </div>
                                <CalendarClock className="text-muted-foreground size-4 shrink-0" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <SessionActionsDialog
                onChanged={onChanged}
                onOpenChange={open => (open ? undefined : setActiveSessionId(null))}
                sessionId={activeSessionId}
            />
        </div>
    );
}

function ChangeStartDatePanel({
    program,
    onChanged,
}: {
    readonly program: ProgramSummary;
    readonly onChanged: () => void;
}): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const [startDate, setStartDate] = useState(program.startDate ?? "");
    const [moved, setMoved] = useState<ChangeProgramStartDateResponse["movedSessions"] | null>(null);

    const mutation = useMutation({
        mutationFn: () => changeProgramStartDate(program, { startDate: startDate.trim() === "" ? null : startDate }),
        onSuccess: response => {
            setMoved(response.movedSessions);
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
            <div className="border-border flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                    <p className="text-sm font-medium">Start date</p>
                    <p className="text-muted-foreground font-mono text-xs tabular-nums">
                        {program.startDate ?? "not set"}
                    </p>
                </div>
                <Button onClick={() => setOpen(true)} size="sm" variant="outline">
                    Change start date
                </Button>
            </div>
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

function SessionActionsDialog({
    sessionId,
    onOpenChange,
    onChanged,
}: {
    readonly sessionId: string | null;
    readonly onOpenChange: (open: boolean) => void;
    readonly onChanged: () => void;
}): React.JSX.Element {
    const session = useQuery(plannedSessionQueryOptions(sessionId));

    return (
        <Dialog onOpenChange={onOpenChange} open={sessionId !== null}>
            <DialogContent>
                {session.isPending ? (
                    <Loading label="Loading session…" />
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

    const open = session.status === "planned";
    const busy = reschedule.isPending || outcome.isPending;

    return (
        <>
            <DialogHeader>
                <DialogTitle>{session.title ?? "Planned session"}</DialogTitle>
                <DialogDescription>
                    {open
                        ? "Reschedule to a new date, or skip/cancel with a reason."
                        : `This session is ${session.status} and can no longer be changed.`}
                </DialogDescription>
            </DialogHeader>

            {open ? (
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

type PlannedSessionResponseLite = Pick<
    PlannedSessionResponse,
    "id" | "version" | "title" | "status" | "localDate" | "preferredTime"
>;

function patchRow(
    setRows: React.Dispatch<React.SetStateAction<readonly SessionPlanRow[]>>,
    key: string,
    patch: Partial<SessionPlanRow>,
): void {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)));
}

function NumberField({
    label,
    value,
    onChange,
}: {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
}): React.JSX.Element {
    return (
        <div className="grid gap-1.5">
            <Label>{label}</Label>
            <Input
                inputMode="numeric"
                onChange={event => onChange(event.target.value.replace(/[^\d]/g, ""))}
                value={value}
            />
        </div>
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

function Loading({ label }: { readonly label: string }): React.JSX.Element {
    return (
        <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <LoaderCircle className="animate-spin" /> {label}
        </div>
    );
}

function ErrorBox({ message }: { readonly message: string }): React.JSX.Element {
    return (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
            {message}
        </div>
    );
}
