import type { ProgramResponse, ProgramSessionMembership } from "@kinetix/types";

import { utcDate } from "@/lib/session-weeks";

/**
 * Read helpers for the program detail hub (issue #67). Planned sessions are grouped into the
 * collapsible sections the hub renders, and a program's schedule position is summarised as a
 * "week X of Y" (or completion) progress reading. All pure so they are unit-testable in isolation.
 */

/** A collapsible section of planned sessions — a relative/calendar week or the unscheduled bucket. */
export interface PlannedSessionGroup {
    readonly key: string;
    readonly label: string;
    readonly sessions: readonly ProgramSessionMembership[];
    /** True for the trailing catch-all of sessions with no week/date, rendered last and open. */
    readonly unscheduled: boolean;
}

const weekOfFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
});

const DATE_BUCKET_BASE = 1_000_000;
const UNSCHEDULED_ORDER = Number.MAX_SAFE_INTEGER;

/** The Monday (UTC) of the week containing `localDate`, as `YYYY-MM-DD`. */
function weekStartOf(localDate: string): string {
    const date = utcDate(localDate);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun … 6=Sat
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    return date.toISOString().slice(0, 10);
}

interface Bucket {
    readonly key: string;
    readonly label: string;
    readonly order: number;
    readonly unscheduled: boolean;
}

/**
 * A session's section: prefer the explicit relative week (`Week 1` = relativeWeek 0), fall back to the
 * calendar week its date lands in, and drop sessions with neither into a trailing unscheduled bucket.
 */
function bucketOf(session: ProgramSessionMembership): Bucket {
    if (session.relativeWeek !== null)
        return {
            key: `w${session.relativeWeek}`,
            label: `Week ${session.relativeWeek + 1}`,
            order: session.relativeWeek,
            unscheduled: false,
        };
    if (session.localDate !== null) {
        const weekStart = weekStartOf(session.localDate);
        return {
            key: `d${weekStart}`,
            label: `Week of ${weekOfFormatter.format(utcDate(weekStart))}`,
            order: DATE_BUCKET_BASE + utcDate(weekStart).getTime() / 86_400_000,
            unscheduled: false,
        };
    }
    return { key: "unscheduled", label: "Unscheduled", order: UNSCHEDULED_ORDER, unscheduled: true };
}

/** Order within a section: earliest day first, then activation sequence, then date, then title. */
function compareSessions(a: ProgramSessionMembership, b: ProgramSessionMembership): number {
    const dayA = a.relativeDay ?? Number.MAX_SAFE_INTEGER;
    const dayB = b.relativeDay ?? Number.MAX_SAFE_INTEGER;
    if (dayA !== dayB) return dayA - dayB;
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    if (a.localDate !== b.localDate) return (a.localDate ?? "").localeCompare(b.localDate ?? "");
    return (a.title ?? "").localeCompare(b.title ?? "");
}

/**
 * Group a program's planned sessions into ordered collapsible sections. Relative-week programs get
 * `Week N` sections, dated programs fall back to `Week of <date>`, and anything unscheduled trails in
 * its own section — so every session is always placed exactly once.
 */
export function groupPlannedSessions(sessions: readonly ProgramSessionMembership[]): readonly PlannedSessionGroup[] {
    const groups = new Map<string, { bucket: Bucket; sessions: ProgramSessionMembership[] }>();
    for (const session of sessions) {
        const bucket = bucketOf(session);
        const existing = groups.get(bucket.key);
        if (existing) existing.sessions.push(session);
        else groups.set(bucket.key, { bucket, sessions: [session] });
    }
    return Array.from(groups.values())
        .sort((a, b) => a.bucket.order - b.bucket.order)
        .map(group => ({
            key: group.bucket.key,
            label: group.bucket.label,
            unscheduled: group.bucket.unscheduled,
            sessions: [...group.sessions].sort(compareSessions),
        }));
}

/** A program's headline progress reading: elapsed weeks for dated programs, else sessions completed. */
export interface ProgramProgress {
    readonly current: number;
    readonly total: number;
    readonly percent: number;
    readonly label: string;
}

const DAYS_PER_WEEK = 7;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Whole-week count between two `YYYY-MM-DD` dates (start inclusive), never negative. */
function weeksBetween(from: string, to: string): number {
    const days = (utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000;
    return Math.max(0, Math.floor(days / DAYS_PER_WEEK));
}

/**
 * Summarise where the program stands. A dated program with a start date reads as "Week X of Y" (Y is
 * the number of scheduled weeks; X is how many weeks have elapsed since the start, clamped in range).
 * Everything else falls back to a completed-session count. Returns null when there is nothing to show.
 */
export function programProgress(
    program: ProgramResponse,
    groups: readonly PlannedSessionGroup[],
    today: string,
): ProgramProgress | null {
    const totalWeeks = groups.filter(group => !group.unscheduled).length;
    if (program.scheduleMode === "dated" && program.startDate !== null && totalWeeks > 0) {
        const current = clamp(weeksBetween(program.startDate, today) + 1, 1, totalWeeks);
        return {
            current,
            total: totalWeeks,
            percent: Math.round((current / totalWeeks) * 100),
            label: `Week ${current} of ${totalWeeks}`,
        };
    }
    const all = groups.flatMap(group => group.sessions);
    if (all.length === 0) return null;
    const completed = all.filter(session => session.status === "completed").length;
    return {
        current: completed,
        total: all.length,
        percent: Math.round((completed / all.length) * 100),
        label: `${completed} of ${all.length} session${all.length === 1 ? "" : "s"} complete`,
    };
}
