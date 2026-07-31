import { DomainValidationError } from "#src/platform/domain/index";

import type { PlannedSessionStatus } from "#src/modules/training/domain/planned-session";
import type { ProgramBlockState, ProgramScheduleMode } from "#src/modules/training/domain/program";
import type { PlanningWarning } from "#src/modules/training/domain/program-planning";

/**
 * Pure schedule-expansion and date-shift policies (design 5.6, 10.3; PR-2/PR-5). Program activation
 * turns a program definition into deterministic generated-session specifications. Everything here is
 * framework-, clock-, and database-free: the caller supplies the calendar context (`today`) and this
 * module computes concrete local dates, overdue state, and start-date shifts by pure calendar
 * arithmetic on time-zone-naive `YYYY-MM-DD` dates. Operating in UTC keeps the arithmetic DST-safe —
 * a local date has no wall-clock component, so adding whole days never drifts across an offset change.
 */

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

/** One session's placement within a program, expanded into a concrete or unscheduled date. */
export interface SessionScheduleInput {
    /** Stable key identifying this plan (e.g. its index), echoed on the result and used in warnings. */
    readonly key: string;
    readonly sequence: number;
    readonly relativeWeek: number | null;
    readonly relativeDay: number | null;
    readonly preferredTime: string | null;
    /** Caller-provided date that overrides the derived one (kept for explicit one-off placement). */
    readonly explicitLocalDate?: string | null;
    /** Blocks this session belongs to; the earliest block's relative start week anchors the offset. */
    readonly blockIds?: readonly string[];
}

export interface ScheduleContext {
    readonly scheduleMode: ProgramScheduleMode;
    readonly startDate: string | null;
    readonly blocks: readonly ProgramBlockState[];
}

/** Deterministic generated-session specification produced by expansion. */
export interface GeneratedSessionSchedule {
    readonly key: string;
    readonly sequence: number;
    readonly localDate: string | null;
}

export interface ScheduleExpansion {
    readonly sessions: readonly GeneratedSessionSchedule[];
    readonly warnings: readonly PlanningWarning[];
}

/** Membership row shape consumed by the start-date shift policy. */
export interface ShiftableSession {
    readonly id: string;
    readonly localDate: string | null;
    readonly status: PlannedSessionStatus;
}

export interface SessionDateShift {
    readonly id: string;
    readonly fromDate: string;
    readonly toDate: string;
}

/**
 * Expand session plans into deterministic dated (or ordered-unscheduled) specifications. Dated
 * programs with a start date derive each session's local date from its block/session relative
 * position; relative/ordered or undated programs leave the date unset and rely on `sequence` order.
 * A caller-supplied `explicitLocalDate` always wins so one-off placements remain possible. Overlaps
 * are never errors — same-slot collisions surface as structured warnings (design 5.6).
 */
export function expandProgramSchedule(
    context: ScheduleContext,
    plans: readonly SessionScheduleInput[],
): ScheduleExpansion {
    const blockAnchors = blockWeekAnchors(context.blocks);
    const dated = context.scheduleMode === "dated" && context.startDate !== null;
    const sessions = [...plans]
        .sort((a, b) => a.sequence - b.sequence)
        .map(plan => ({
            key: plan.key,
            sequence: plan.sequence,
            localDate: resolveLocalDate(plan, context, dated, blockAnchors),
        }));
    return { sessions, warnings: scheduleCollisionWarnings(sessions, plans) };
}

/** Add (or subtract) whole days to a local date. DST-safe because it is pure UTC calendar math. */
export function addDaysToLocalDate(localDate: string, days: number): string {
    const base = parseLocalDate(localDate, "Local date");
    const shifted = new Date(base + days * MILLISECONDS_PER_DAY);
    return shifted.toISOString().slice(0, 10);
}

/** Whole-day difference `to - from` between two local dates (may be negative). */
export function daysBetweenLocalDates(from: string, to: string): number {
    return Math.round((parseLocalDate(to, "End date") - parseLocalDate(from, "Start date")) / MILLISECONDS_PER_DAY);
}

/** A missed session is one still planned whose local date is strictly before today (design PR-5). */
export function isPlannedSessionOverdue(
    session: { readonly localDate: string | null; readonly status: PlannedSessionStatus },
    today: string,
): boolean {
    return session.status === "planned" && session.localDate !== null && session.localDate < validToday(today);
}

/**
 * Compute the date shifts for a start-date change (design PR-5, AC "moves only incomplete future
 * sessions"). Only sessions that are still `planned` (incomplete) and dated today or later move by
 * the whole-day delta between the old and new start dates; completed, terminal, and already-overdue
 * sessions are left exactly where they are so the calendar never silently shifts around a missed
 * workout. Returns an empty list when the delta is zero.
 */
export function shiftProgramSessionDates(
    sessions: readonly ShiftableSession[],
    oldStartDate: string,
    newStartDate: string,
    today: string,
): readonly SessionDateShift[] {
    const delta = daysBetweenLocalDates(
        parseLocalDateString(oldStartDate, "Old start date"),
        parseLocalDateString(newStartDate, "New start date"),
    );
    const cutoff = validToday(today);
    if (delta === 0) return [];
    const shifts: SessionDateShift[] = [];
    for (const session of sessions) {
        if (session.status !== "planned" || session.localDate === null) continue;
        if (session.localDate < cutoff) continue;
        shifts.push({
            id: session.id,
            fromDate: session.localDate,
            toDate: addDaysToLocalDate(session.localDate, delta),
        });
    }
    return shifts;
}

function resolveLocalDate(
    plan: SessionScheduleInput,
    context: ScheduleContext,
    dated: boolean,
    blockAnchors: ReadonlyMap<string, number>,
): string | null {
    if (plan.explicitLocalDate != null) return parseLocalDateString(plan.explicitLocalDate, "Session local date");
    if (!dated || context.startDate === null) return null;
    const anchorWeek = earliestBlockAnchor(plan.blockIds ?? [], blockAnchors);
    const offsetDays = (anchorWeek + (plan.relativeWeek ?? 0)) * 7 + (plan.relativeDay ?? 0);
    return addDaysToLocalDate(context.startDate, offsetDays);
}

/** Map each block id to the effective relative start week it contributes to child sessions. */
function blockWeekAnchors(blocks: readonly ProgramBlockState[]): ReadonlyMap<string, number> {
    const anchors = new Map<string, number>();
    for (const block of blocks) if (block.relativeStartWeek !== null) anchors.set(block.id, block.relativeStartWeek);
    return anchors;
}

function earliestBlockAnchor(blockIds: readonly string[], anchors: ReadonlyMap<string, number>): number {
    let earliest: number | null = null;
    for (const blockId of blockIds) {
        const anchor = anchors.get(blockId);
        if (anchor !== undefined && (earliest === null || anchor < earliest)) earliest = anchor;
    }
    return earliest ?? 0;
}

function scheduleCollisionWarnings(
    sessions: readonly GeneratedSessionSchedule[],
    plans: readonly SessionScheduleInput[],
): readonly PlanningWarning[] {
    const preferredTimeByKey = new Map(plans.map(plan => [plan.key, plan.preferredTime]));
    const bySlot = new Map<string, string[]>();
    for (const session of sessions) {
        if (session.localDate === null) continue;
        const slot = `${session.localDate}T${preferredTimeByKey.get(session.key) ?? "*"}`;
        (bySlot.get(slot) ?? bySlot.set(slot, []).get(slot)!).push(session.key);
    }
    const warnings: PlanningWarning[] = [];
    for (const [slot, keys] of bySlot)
        if (keys.length > 1)
            warnings.push({
                code: "schedule_collision",
                message: `${keys.length} generated sessions share ${slot}`,
                evidence: { slot, sessionKeys: keys },
            });
    return warnings;
}

function parseLocalDate(value: string, name: string): number {
    const parsed = new Date(`${parseLocalDateString(value, name)}T00:00:00Z`).getTime();
    return parsed;
}

function parseLocalDateString(value: string, name: string): string {
    const normalized = value.trim();
    if (!LOCAL_DATE_PATTERN.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime()))
        throw new DomainValidationError(`${name} must be a valid YYYY-MM-DD date`);
    return normalized;
}

function validToday(today: string): string {
    return parseLocalDateString(today, "Today");
}
