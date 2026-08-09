import type { TrainingSessionSummary } from "@kinetix/types";

/** A run of sessions that share the same Monday-anchored week, newest week first. */
export interface SessionWeek {
    /** ISO `YYYY-MM-DD` of the week's Monday (UTC), stable across viewer time zones. */
    readonly weekStart: string;
    /** Header label, e.g. `Week of Aug 4, 2026`. */
    readonly label: string;
    readonly sessions: readonly TrainingSessionSummary[];
}

const weekLabelFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
});

/** Parse a `YYYY-MM-DD` local date into a UTC-anchored `Date` (no zone drift). */
export function utcDate(localDate: string): Date {
    const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(year, month - 1, day));
}

/** The Monday (UTC) of the week containing `localDate`, as `YYYY-MM-DD`. */
function weekStartOf(localDate: string): string {
    const date = utcDate(localDate);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun … 6=Sat
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    return date.toISOString().slice(0, 10);
}

/**
 * Group a newest-first page of sessions under Monday-anchored week headers. Local dates are parsed as
 * UTC calendar days so the boundary never shifts with the viewer's zone, and first-seen week order is
 * preserved — since the feed arrives sorted `(localDate DESC, id DESC)`, that yields newest week first.
 */
export function groupSessionsByWeek(sessions: readonly TrainingSessionSummary[]): readonly SessionWeek[] {
    const weeks = new Map<string, TrainingSessionSummary[]>();
    for (const session of sessions) {
        const weekStart = weekStartOf(session.localDate);
        const bucket = weeks.get(weekStart);
        if (bucket) bucket.push(session);
        else weeks.set(weekStart, [session]);
    }
    return Array.from(weeks, ([weekStart, weekSessions]) => ({
        weekStart,
        label: `Week of ${weekLabelFormatter.format(utcDate(weekStart))}`,
        sessions: weekSessions,
    }));
}
