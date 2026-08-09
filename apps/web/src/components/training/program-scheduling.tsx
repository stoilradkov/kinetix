import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";

import type { ActivateProgramResponse, ProgramSummary } from "@kinetix/types";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { activateProgram, workoutTemplatesQueryOptions } from "@/lib/api";

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
