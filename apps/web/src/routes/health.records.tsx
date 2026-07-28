import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";

import type { HealthRecordTypeValue, ManualHealthRecordResponse } from "@kinetix/types";

import { HealthRecordForm } from "@/components/health/health-record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { archiveHealthRecord, createHealthRecord, healthRecordsQueryOptions, updateHealthRecord } from "@/lib/api";
import {
    healthRecordCreateInput,
    healthRecordFormDefaults,
    healthRecordUpdateInput,
    type HealthRecordFormValues,
} from "@/lib/health-record-form";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/health/records")({
    component: HealthRecordsPage,
});

type TypeFilter = HealthRecordTypeValue | "all";
type StateFilter = "active" | "all";

const PAGE_SIZE = 8;

const typeLabels: Record<HealthRecordTypeValue, string> = {
    body_weight: "Body weight",
    sleep: "Sleep",
    resting_heart_rate: "Resting HR",
    daily_readiness: "Daily readiness",
};

function HealthRecordsPage(): React.JSX.Element {
    const queryClient = useQueryClient();
    const [type, setType] = useState<TypeFilter>("all");
    const [state, setState] = useState<StateFilter>("active");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [page, setPage] = useState(1);

    const list = useQuery(healthRecordsQueryOptions(type, state === "all"));
    const all = useQuery(healthRecordsQueryOptions("all", true));
    const records = [...(list.data?.items ?? [])].sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
    const selected = all.data?.items.find(record => record.id === selectedId) ?? null;

    const total = records.length;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * PAGE_SIZE;
    const pageItems = records.slice(start, start + PAGE_SIZE);

    const resetTo = (next: () => void) => {
        next();
        setPage(1);
    };

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["health-records"] });
    };
    const createMutation = useMutation({
        mutationFn: createHealthRecord,
        onSuccess: async record => {
            setCreateOpen(false);
            setSelectedId(record.id);
            await refresh();
        },
    });
    const saveMutation = useMutation({
        mutationFn: ({ record, values }: { record: ManualHealthRecordResponse; values: HealthRecordFormValues }) =>
            updateHealthRecord(record, healthRecordUpdateInput(values)),
        onSuccess: async record => {
            setSelectedId(record.id);
            await refresh();
        },
    });
    const archiveMutation = useMutation({
        mutationFn: archiveHealthRecord,
        onSuccess: async record => {
            setSelectedId(record.id);
            await refresh();
        },
    });

    return (
        <main className="mx-auto max-w-7xl px-6 py-10">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <Badge variant="info">Health data</Badge>
                    <h1 className="mt-3 text-3xl font-semibold tracking-tight">Manual health records</h1>
                    <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                        Enter body weight, sleep, resting heart rate, and daily readiness by hand until provider sync
                        arrives.
                    </p>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus />
                    Record data
                </Button>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Select onValueChange={value => resetTo(() => setType(value as TypeFilter))} value={type}>
                    <SelectTrigger className="w-full sm:w-56">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        <SelectItem value="body_weight">Body weight</SelectItem>
                        <SelectItem value="sleep">Sleep</SelectItem>
                        <SelectItem value="resting_heart_rate">Resting heart rate</SelectItem>
                        <SelectItem value="daily_readiness">Daily readiness</SelectItem>
                    </SelectContent>
                </Select>
                <Select onValueChange={value => resetTo(() => setState(value as StateFilter))} value={state}>
                    <SelectTrigger className="w-full sm:w-44">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="all">Include archived</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="bg-card mt-6 overflow-hidden rounded-xl border">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Reading</TableHead>
                                <TableHead>When</TableHead>
                                <TableHead className="text-right">Version</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pageItems.map(record => (
                                <TableRow
                                    className={cn(
                                        "cursor-pointer",
                                        selected?.id === record.id ? "bg-muted" : undefined,
                                    )}
                                    key={record.id}
                                    onClick={() => {
                                        setSelectedId(record.id);
                                        setDetailOpen(true);
                                    }}
                                >
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{typeLabels[record.type]}</span>
                                            {record.archivedAt ? <Badge variant="secondary">archived</Badge> : null}
                                        </div>
                                        <p className="text-muted-foreground mt-1 font-mono text-xs tabular-nums">
                                            {formatValue(record)}
                                        </p>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {formatDateTime(record.effectiveAt)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono tabular-nums">
                                        {record.version}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {!list.isPending && total === 0 ? (
                                <TableRow>
                                    <TableCell className="text-muted-foreground h-32 text-center" colSpan={3}>
                                        No records match this view.
                                    </TableCell>
                                </TableRow>
                            ) : null}
                        </TableBody>
                    </Table>
                </div>
                <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                        {total === 0 ? "No results" : `${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            disabled={safePage <= 1}
                            onClick={() => setPage(current => Math.max(1, current - 1))}
                            size="sm"
                            variant="outline"
                        >
                            <ChevronLeft />
                            Prev
                        </Button>
                        <span className="text-muted-foreground font-mono text-xs tabular-nums">
                            {safePage} / {pageCount}
                        </span>
                        <Button
                            disabled={safePage >= pageCount}
                            onClick={() => setPage(current => Math.min(pageCount, current + 1))}
                            size="sm"
                            variant="outline"
                        >
                            Next
                            <ChevronRight />
                        </Button>
                    </div>
                </div>
            </div>

            <Sheet onOpenChange={setDetailOpen} open={detailOpen}>
                <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
                    <SheetHeader className="sr-only">
                        <SheetTitle>{selected ? typeLabels[selected.type] : "Health record"}</SheetTitle>
                        <SheetDescription>Health record detail.</SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6">
                        {selected ? (
                            <HealthRecordDetail
                                clearSaveError={() => saveMutation.reset()}
                                isSaving={saveMutation.isPending}
                                onArchive={() => archiveMutation.mutate(selected)}
                                onSave={async values => {
                                    await saveMutation.mutateAsync({ record: selected, values });
                                }}
                                record={selected}
                                saveError={saveMutation.error}
                            />
                        ) : (
                            <div className="text-muted-foreground grid min-h-40 place-items-center text-sm">
                                Loading…
                            </div>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            <Dialog
                onOpenChange={open => {
                    setCreateOpen(open);
                    if (!open) createMutation.reset();
                }}
                open={createOpen}
            >
                <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                    <DialogHeader className="border-b p-6">
                        <DialogTitle>Record health data</DialogTitle>
                        <DialogDescription>Enter one reading. Its type is fixed once saved.</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <HealthRecordForm
                            defaultValues={healthRecordFormDefaults()}
                            isSubmitting={createMutation.isPending}
                            onSubmit={async values => {
                                await createMutation.mutateAsync(healthRecordCreateInput(values));
                            }}
                            submitError={createMutation.error}
                            submitLabel="Save record"
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </main>
    );
}

function HealthRecordDetail({
    record,
    isSaving,
    onArchive,
    onSave,
    saveError,
    clearSaveError,
}: {
    record: ManualHealthRecordResponse;
    isSaving: boolean;
    onArchive: () => void;
    onSave: (values: HealthRecordFormValues) => Promise<void>;
    saveError: Error | null;
    clearSaveError: () => void;
}): React.JSX.Element {
    const [editOpen, setEditOpen] = useState(false);

    return (
        <div>
            <div className="flex flex-wrap items-start justify-between gap-4 pr-10">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-2xl font-semibold">{typeLabels[record.type]}</h2>
                        <Badge variant={record.archivedAt ? "secondary" : "success"}>
                            {record.archivedAt ? "archived" : "active"}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 font-mono text-xs tabular-nums">{formatValue(record)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {record.archivedAt ? null : (
                        <Button onClick={() => setEditOpen(true)} size="sm" variant="outline">
                            <Pencil />
                            Edit
                        </Button>
                    )}
                    {record.archivedAt ? null : (
                        <Button onClick={onArchive} size="sm" variant="outline">
                            <Archive />
                            Archive
                        </Button>
                    )}
                </div>
            </div>

            <Section title="Reading">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                    <Metadata label="Value" value={formatValue(record)} />
                    <Metadata label="Effective" value={formatDateTime(record.effectiveAt)} />
                    <Metadata label="Source" value={record.source} />
                    <Metadata label="Time zone" value={record.timeZone ?? "—"} />
                </dl>
            </Section>

            {record.type === "sleep" && record.body.type === "sleep" ? (
                <Section title="Sleep window">
                    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                        <Metadata label="Start" value={formatDateTime(record.body.startAt)} />
                        <Metadata label="End" value={formatDateTime(record.body.endAt)} />
                    </dl>
                </Section>
            ) : null}

            <Section title="Notes">
                <p className={cn("text-sm", record.notes ? undefined : "text-muted-foreground")}>
                    {record.notes ?? "No notes recorded."}
                </p>
            </Section>

            <Dialog
                onOpenChange={open => {
                    setEditOpen(open);
                    if (!open) clearSaveError();
                }}
                open={editOpen}
            >
                <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                    <DialogHeader className="border-b p-6">
                        <DialogTitle>Edit {typeLabels[record.type].toLowerCase()}</DialogTitle>
                        <DialogDescription>Saving appends an immutable revision to this record.</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <HealthRecordForm
                            defaultValues={healthRecordFormDefaults(record)}
                            isSubmitting={isSaving}
                            lockedType
                            onSubmit={async values => {
                                await onSave(values);
                                setEditOpen(false);
                            }}
                            submitError={saveError}
                            submitLabel="Save revision"
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
    return (
        <section className="mt-6 border-t pt-5">
            <h3 className="text-muted-foreground font-mono text-xs font-semibold tracking-wide uppercase">{title}</h3>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function Metadata({ label, value }: { label: string; value: string }): React.JSX.Element {
    return (
        <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
            <dd className="mt-1">{value}</dd>
        </div>
    );
}

function formatValue(record: ManualHealthRecordResponse): string {
    const body = record.body;
    switch (body.type) {
        case "body_weight":
            return `${body.massKg} kg`;
        case "resting_heart_rate":
            return `${body.beatsPerMinute} bpm`;
        case "sleep": {
            const minutes = Math.round((new Date(body.endAt).getTime() - new Date(body.startAt).getTime()) / 60_000);
            return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
        }
        case "daily_readiness":
            return `${body.score} / ${body.scaleMax ?? 100}`;
    }
}

function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
