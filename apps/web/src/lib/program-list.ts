import type { ProgramStatusValue, ProgramSummary } from "@kinetix/types";

import { utcDate } from "@/lib/session-weeks";

/**
 * Pure helpers for the programs list (issue #68): the segmented lifecycle tabs, Kinetic-Calm badge
 * variants per status, start-date-descending sort, and a human date range for the card. Kept free of
 * React so tab filtering, ordering, and badge mapping are unit-testable in isolation.
 */

/** Lifecycle tabs shown on the programs page, in display order; `active` is the default. */
export type ProgramTab = "active" | "draft" | "completed" | "archived";

export const PROGRAM_TABS: readonly { readonly value: ProgramTab; readonly label: string }[] = [
    { value: "active", label: "Active" },
    { value: "draft", label: "Draft" },
    { value: "completed", label: "Completed" },
    { value: "archived", label: "Archived" },
];

export const DEFAULT_PROGRAM_TAB: ProgramTab = "active";

/** A paused program is a temporarily-suspended active program, so it lives under the Active tab. */
const TAB_STATUSES: Record<ProgramTab, readonly ProgramStatusValue[]> = {
    active: ["active", "paused"],
    draft: ["draft"],
    completed: ["completed"],
    archived: ["archived"],
};

/**
 * Badge variant per lifecycle status under Kinetic Calm: `active` is the one green (`success`) badge on
 * the page, `completed`/`archived` are muted `secondary`, `draft` is a plain `outline`, and `paused`
 * warns. Amber `milestone` is deliberately unused — a lifecycle state is not a rare one-off win.
 */
export function programBadgeVariant(status: ProgramStatusValue): "success" | "warning" | "secondary" | "outline" {
    switch (status) {
        case "active":
            return "success";
        case "paused":
            return "warning";
        case "completed":
            return "secondary";
        case "archived":
            return "secondary";
        case "draft":
            return "outline";
    }
}

/** Keep only the programs whose status belongs under the selected tab. */
export function filterProgramsByTab(programs: readonly ProgramSummary[], tab: ProgramTab): readonly ProgramSummary[] {
    const statuses = TAB_STATUSES[tab];
    return programs.filter(program => statuses.includes(program.status));
}

/**
 * Newest program first: dated programs sort by `startDate` descending, undated ones (unscheduled
 * drafts) fall to the bottom, and ties break on `createdAt` descending so order is stable.
 */
export function sortProgramsByStartDate(programs: readonly ProgramSummary[]): readonly ProgramSummary[] {
    return [...programs].sort((a, b) => {
        if (a.startDate !== b.startDate) {
            if (a.startDate === null) return 1;
            if (b.startDate === null) return -1;
            return a.startDate < b.startDate ? 1 : -1;
        }
        return a.createdAt < b.createdAt ? 1 : -1;
    });
}

const dayFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
});
const dayNoYearFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
});

/**
 * The program's schedule window as display text, e.g. `Aug 3 – Nov 2, 2026`, `From Aug 3, 2026`, or
 * `null` when unscheduled. `YYYY-MM-DD` dates are read as UTC calendar days so no viewer zone shifts
 * the label. The shared start year is elided when both ends fall in the same year.
 */
export function formatProgramDateRange(program: ProgramSummary): string | null {
    const { startDate, endDate } = program;
    if (startDate === null) return null;
    if (endDate === null) return `From ${dayFormatter.format(utcDate(startDate))}`;
    const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
    const start = sameYear ? dayNoYearFormatter.format(utcDate(startDate)) : dayFormatter.format(utcDate(startDate));
    return `${start} – ${dayFormatter.format(utcDate(endDate))}`;
}
