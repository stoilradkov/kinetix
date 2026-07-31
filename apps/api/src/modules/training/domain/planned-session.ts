import { DomainValidationError } from "#src/platform/domain/index";

/**
 * PlannedSession — a versioned, archivable revision root owning schedule, lifecycle state, and a
 * pointer to its current immutable SessionPrescription (design 5.7, 10.3). Membership in programs
 * and blocks lives in join rows outside the aggregate, so one planned session can belong to
 * several programs/blocks with independent relative positions.
 *
 * Like {@link ../domain/workout-template}, the aggregate knows nothing about prescription
 * structure; publishing/cloning the tree stays in the SessionPrescription model and each edit
 * hands the aggregate a freshly published prescription ID.
 */

export const plannedSessionStatuses = ["planned", "completed", "partially_completed", "skipped", "cancelled"] as const;
export type PlannedSessionStatus = (typeof plannedSessionStatuses)[number];

export const skipCancelReasons = [
    "illness",
    "fatigue",
    "pain",
    "schedule",
    "recovery",
    "equipment_unavailable",
    "other",
] as const;
export type SkipCancelReason = (typeof skipCancelReasons)[number];

/** Statuses that require a structured skip/cancel reason slot (the reason value itself is optional). */
const REASONED_STATUSES: readonly PlannedSessionStatus[] = ["skipped", "cancelled"];

export interface PlannedSessionState {
    readonly id: string;
    readonly profileId: string;
    readonly title: string | null;
    readonly status: PlannedSessionStatus;
    readonly localDate: string | null;
    readonly timeZone: string | null;
    readonly preferredTime: string | null;
    readonly expectedDurationMinutes: number | null;
    readonly notes: string | null;
    readonly tags: readonly string[];
    readonly skipReason: SkipCancelReason | null;
    readonly skipNotes: string | null;
    readonly currentPrescriptionId: string;
    readonly sourceTemplateId: string | null;
    readonly sourceTemplateVersion: number | null;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreatePlannedSessionInput {
    readonly id: string;
    readonly profileId: string;
    readonly currentPrescriptionId: string;
    readonly title?: string | null;
    readonly localDate?: string | null;
    readonly timeZone?: string | null;
    readonly preferredTime?: string | null;
    readonly expectedDurationMinutes?: number | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly sourceTemplateId?: string | null;
    readonly sourceTemplateVersion?: number | null;
}

export interface UpdatePlannedSessionInput {
    readonly title?: string | null;
    readonly localDate?: string | null;
    readonly timeZone?: string | null;
    readonly preferredTime?: string | null;
    readonly expectedDurationMinutes?: number | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    /** Present when an edit republishes the prescription tree and advances the current pointer. */
    readonly currentPrescriptionId?: string;
}

export interface CompletePlannedSessionInput {
    readonly partial?: boolean;
}

export interface ReschedulePlannedSessionInput {
    readonly localDate?: string | null;
    readonly timeZone?: string | null;
    readonly preferredTime?: string | null;
}

export interface SkipCancelInput {
    readonly reason?: SkipCancelReason | null;
    readonly notes?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PREFERRED_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class PlannedSession {
    private constructor(private current: PlannedSessionState) {}

    static create(input: CreatePlannedSessionInput, now: Date): PlannedSession {
        const timestamp = isoTimestamp(now, "Planned session creation time");
        const hasTemplate = input.sourceTemplateId != null;
        const state: PlannedSessionState = {
            id: requiredUuid(input.id, "Planned session ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            title: optionalText(input.title, "Title", 160),
            status: "planned",
            localDate: optionalLocalDate(input.localDate, "Local date"),
            timeZone: optionalText(input.timeZone, "Time zone", 80),
            preferredTime: optionalPreferredTime(input.preferredTime),
            expectedDurationMinutes: optionalInteger(input.expectedDurationMinutes, "Expected duration"),
            notes: optionalText(input.notes, "Notes", 4_000),
            tags: normalizeTags(input.tags ?? []),
            skipReason: null,
            skipNotes: null,
            currentPrescriptionId: requiredUuid(input.currentPrescriptionId, "Current prescription ID"),
            sourceTemplateId: hasTemplate ? requiredUuid(input.sourceTemplateId, "Source template ID") : null,
            sourceTemplateVersion: hasTemplate
                ? requiredPositiveInteger(input.sourceTemplateVersion, "Source template version")
                : null,
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new PlannedSession(immutableCopy(state));
    }

    static rehydrate(state: PlannedSessionState): PlannedSession {
        const copied = immutableCopy(state);
        validateState(copied);
        return new PlannedSession(copied);
    }

    get state(): PlannedSessionState {
        return immutableCopy(this.current);
    }

    update(input: UpdatePlannedSessionInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.title !== undefined ? { title: optionalText(input.title, "Title", 160) } : {}),
            ...(input.localDate !== undefined ? { localDate: optionalLocalDate(input.localDate, "Local date") } : {}),
            ...(input.timeZone !== undefined ? { timeZone: optionalText(input.timeZone, "Time zone", 80) } : {}),
            ...(input.preferredTime !== undefined ? { preferredTime: optionalPreferredTime(input.preferredTime) } : {}),
            ...(input.expectedDurationMinutes !== undefined
                ? { expectedDurationMinutes: optionalInteger(input.expectedDurationMinutes, "Expected duration") }
                : {}),
            ...(input.notes !== undefined ? { notes: optionalText(input.notes, "Notes", 4_000) } : {}),
            ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
            ...(input.currentPrescriptionId !== undefined
                ? { currentPrescriptionId: requiredUuid(input.currentPrescriptionId, "Current prescription ID") }
                : {}),
            updatedAt: isoTimestamp(now, "Planned session update time"),
        });
    }

    /**
     * Move an open session to a new date/time. Rescheduling is only meaningful while the session is
     * still planned — a completed, skipped, or cancelled session keeps the schedule it was resolved
     * against, so this rejects rather than silently editing a terminal session (design PR-5).
     */
    reschedule(input: ReschedulePlannedSessionInput, now: Date): this {
        this.assertOpen("reschedule");
        return this.replace({
            ...this.current,
            ...(input.localDate !== undefined ? { localDate: optionalLocalDate(input.localDate, "Local date") } : {}),
            ...(input.timeZone !== undefined ? { timeZone: optionalText(input.timeZone, "Time zone", 80) } : {}),
            ...(input.preferredTime !== undefined ? { preferredTime: optionalPreferredTime(input.preferredTime) } : {}),
            updatedAt: isoTimestamp(now, "Planned session update time"),
        });
    }

    complete(input: CompletePlannedSessionInput, now: Date): this {
        this.assertOpen("complete");
        return this.replace({
            ...this.current,
            status: input.partial ? "partially_completed" : "completed",
            skipReason: null,
            skipNotes: null,
            updatedAt: isoTimestamp(now, "Planned session update time"),
        });
    }

    skip(input: SkipCancelInput, now: Date): this {
        return this.terminateWithReason("skipped", input, now);
    }

    cancel(input: SkipCancelInput, now: Date): this {
        return this.terminateWithReason("cancelled", input, now);
    }

    /** Return a terminal session to the planned state (e.g. undo a skip), keeping its schedule. */
    reopen(now: Date): this {
        if (this.current.status === "planned") return this;
        return this.replace({
            ...this.current,
            status: "planned",
            skipReason: null,
            skipNotes: null,
            updatedAt: isoTimestamp(now, "Planned session update time"),
        });
    }

    archive(now: Date): this {
        if (this.current.archivedAt !== null) return this;
        return this.replace({
            ...this.current,
            archivedAt: isoTimestamp(now, "Planned session archive time"),
            updatedAt: isoTimestamp(now, "Planned session update time"),
        });
    }

    restore(now: Date): this {
        if (this.current.archivedAt === null) return this;
        return this.replace({
            ...this.current,
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Planned session update time"),
        });
    }

    private terminateWithReason(status: PlannedSessionStatus, input: SkipCancelInput, now: Date): this {
        this.assertOpen(status);
        return this.replace({
            ...this.current,
            status,
            skipReason: input.reason == null ? null : normalizeReason(input.reason),
            skipNotes: optionalText(input.notes, "Reason notes", 2_000),
            updatedAt: isoTimestamp(now, "Planned session update time"),
        });
    }

    private assertOpen(action: string): void {
        if (this.current.status !== "planned")
            throw new DomainValidationError(`Cannot ${action} a ${this.current.status} planned session`, {
                status: [`Cannot ${action} a ${this.current.status} planned session`],
            });
    }

    private replace(state: PlannedSessionState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: PlannedSessionState): void {
    requiredUuid(state.id, "Planned session ID");
    requiredUuid(state.profileId, "Profile ID");
    requiredUuid(state.currentPrescriptionId, "Current prescription ID");
    normalizeStatus(state.status);
    optionalText(state.title, "Title", 160);
    optionalLocalDate(state.localDate, "Local date");
    optionalPreferredTime(state.preferredTime);
    normalizeTags(state.tags);
    if (state.skipReason !== null) normalizeReason(state.skipReason);
    if (!REASONED_STATUSES.includes(state.status) && (state.skipReason !== null || state.skipNotes !== null))
        throw new DomainValidationError("Only skipped or cancelled sessions may carry a reason", {
            skipReason: ["Only skipped or cancelled sessions may carry a reason"],
        });
    if ((state.sourceTemplateId === null) !== (state.sourceTemplateVersion === null))
        throw new DomainValidationError("Source template ID and version must be provided together", {
            sourceTemplateId: ["Source template ID and version must be provided together"],
        });
    isoTimestamp(new Date(state.createdAt), "Planned session creation time");
    isoTimestamp(new Date(state.updatedAt), "Planned session update time");
}

function normalizeStatus(value: PlannedSessionStatus): PlannedSessionStatus {
    if (!plannedSessionStatuses.includes(value))
        throw new DomainValidationError(`Unknown planned session status '${value}'`, {
            status: ["Unknown planned session status"],
        });
    return value;
}

function normalizeReason(value: SkipCancelReason): SkipCancelReason {
    if (!skipCancelReasons.includes(value))
        throw new DomainValidationError(`Unknown skip/cancel reason '${value}'`, {
            skipReason: ["Unknown skip/cancel reason"],
        });
    return value;
}

function normalizeTags(values: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = value.trim().normalize("NFKC");
        if (normalized.length === 0 || normalized.length > 80)
            throw new DomainValidationError("Tag must be 1 to 80 characters", {
                tags: ["Tag must be 1 to 80 characters"],
            });
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}

function requiredUuid(value: string, name: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function requiredPositiveInteger(value: number | null | undefined, name: string): number {
    if (value == null || !Number.isInteger(value) || value <= 0)
        throw new DomainValidationError(`${name} must be a positive integer`);
    return value;
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) return null;
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function optionalInteger(value: number | null | undefined, name: string): number | null {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative integer`);
    return value;
}

function optionalLocalDate(value: string | null | undefined, name: string): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (normalized.length === 0) return null;
    if (!LOCAL_DATE_PATTERN.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime()))
        throw new DomainValidationError(`${name} must be a valid YYYY-MM-DD date`);
    return normalized;
}

function optionalPreferredTime(value: string | null | undefined): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (normalized.length === 0) return null;
    if (!PREFERRED_TIME_PATTERN.test(normalized))
        throw new DomainValidationError("Preferred time must be a valid HH:MM value");
    return normalized;
}

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}
