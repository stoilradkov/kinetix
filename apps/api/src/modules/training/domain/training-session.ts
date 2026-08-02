import { DomainValidationError } from "#src/platform/domain/index";

/**
 * TrainingSession — the versioned, archivable write/concurrency boundary for live and retrospective
 * workouts (design 5.8, 11.1, 11.6). It owns session time/state, pre-workout readiness, post-workout
 * ratings, pain records, ordered typed activity placeholders, notes, and tags. Strength/run child
 * detail and planned/actual mappings are layered on by later issues; every child mutation modelled
 * here flows through this aggregate so the session version advances atomically.
 *
 * Lifecycle is `draft → in_progress → completed`, with completed sessions reopenable back to
 * `in_progress` for corrections. Soft deletion is a separate `archivedAt` flag (independent of
 * status, like {@link ./planned-session}) so archiving/restoring never loses lifecycle state.
 */

export const trainingSessionStatuses = ["draft", "in_progress", "completed"] as const;
export type TrainingSessionStatus = (typeof trainingSessionStatuses)[number];

export const sessionActivityTypes = ["strength", "running"] as const;
export type SessionActivityType = (typeof sessionActivityTypes)[number];

export const painSides = ["left", "right", "bilateral"] as const;
export type PainSide = (typeof painSides)[number];

/** Pre-workout readiness on a 1–5 scale; every field is optional and missing values stay explicit. */
export interface PreWorkoutReadiness {
    readonly energy: number | null;
    readonly motivation: number | null;
    readonly fatigue: number | null;
    readonly soreness: number | null;
    readonly stress: number | null;
    readonly recovery: number | null;
}

/** Post-workout/session ratings on a 1–5 scale plus optional free-text notes. */
export interface PostWorkoutRatings {
    readonly energy: number | null;
    readonly motivation: number | null;
    readonly enjoyment: number | null;
    readonly difficulty: number | null;
    readonly fatigue: number | null;
    readonly notes: string | null;
}

/**
 * Ordered typed activity placeholder. It carries timing, effort, feeling, notes, and tags but no
 * strength/run detail yet (design 11.1, TS-3); later issues extend it with structured children.
 */
export interface SessionActivityState {
    readonly id: string;
    readonly type: SessionActivityType;
    readonly position: number;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
    readonly durationSeconds: number | null;
    readonly rpe: number | null;
    readonly feeling: string | null;
    readonly notes: string | null;
    readonly tags: readonly string[];
}

/**
 * Pain/discomfort record (design 11.1, TS-6). `activityId`, when set, must reference an activity of
 * the same session. Exercise/set links are modelled as plain nullable IDs because the actual
 * occurrence/set tables arrive with strength detail in a later issue.
 */
export interface PainRecordState {
    readonly id: string;
    readonly activityId: string | null;
    readonly exerciseOccurrenceId: string | null;
    readonly performedSetId: string | null;
    readonly bodyArea: string;
    readonly side: PainSide;
    readonly severity: number;
    readonly painType: string | null;
    readonly onsetDuringSession: boolean;
    readonly stoppedActivity: boolean;
    readonly notes: string | null;
}

export interface TrainingSessionState {
    readonly id: string;
    readonly profileId: string;
    readonly status: TrainingSessionStatus;
    readonly title: string | null;
    readonly localDate: string;
    readonly timeZone: string;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
    readonly durationMinutes: number | null;
    readonly readiness: PreWorkoutReadiness;
    readonly postWorkout: PostWorkoutRatings;
    readonly notes: string | null;
    readonly tags: readonly string[];
    readonly sourcePlannedSessionId: string | null;
    readonly activities: readonly SessionActivityState[];
    readonly painRecords: readonly PainRecordState[];
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateTrainingSessionInput {
    readonly id: string;
    readonly profileId: string;
    readonly localDate: string;
    readonly timeZone: string;
    readonly title?: string | null;
    readonly sourcePlannedSessionId?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly readiness?: Partial<PreWorkoutReadiness>;
    readonly postWorkout?: Partial<PostWorkoutRatings>;
    readonly activities?: readonly SessionActivityInput[];
    readonly painRecords?: readonly PainRecordInput[];
}

export interface SessionActivityInput {
    readonly id: string;
    readonly type: SessionActivityType;
    readonly position: number;
    readonly startedAt?: string | null;
    readonly endedAt?: string | null;
    readonly durationSeconds?: number | null;
    readonly rpe?: number | null;
    readonly feeling?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
}

export interface PainRecordInput {
    readonly id: string;
    readonly activityId?: string | null;
    readonly exerciseOccurrenceId?: string | null;
    readonly performedSetId?: string | null;
    readonly bodyArea: string;
    readonly side: PainSide;
    readonly severity: number;
    readonly painType?: string | null;
    readonly onsetDuringSession?: boolean;
    readonly stoppedActivity?: boolean;
    readonly notes?: string | null;
}

export interface UpdateTrainingSessionInput {
    readonly title?: string | null;
    readonly localDate?: string;
    readonly timeZone?: string;
    readonly startedAt?: string | null;
    readonly endedAt?: string | null;
    readonly durationMinutes?: number | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly readiness?: Partial<PreWorkoutReadiness>;
    readonly postWorkout?: Partial<PostWorkoutRatings>;
    readonly activities?: readonly SessionActivityInput[];
    readonly painRecords?: readonly PainRecordInput[];
}

export interface CompleteTrainingSessionInput {
    readonly endedAt?: string | null;
    readonly durationMinutes?: number | null;
    readonly postWorkout?: Partial<PostWorkoutRatings>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_READINESS: PreWorkoutReadiness = {
    energy: null,
    motivation: null,
    fatigue: null,
    soreness: null,
    stress: null,
    recovery: null,
};

const EMPTY_POST_WORKOUT: PostWorkoutRatings = {
    energy: null,
    motivation: null,
    enjoyment: null,
    difficulty: null,
    fatigue: null,
    notes: null,
};

export class TrainingSession {
    private constructor(private current: TrainingSessionState) {}

    static create(input: CreateTrainingSessionInput, now: Date): TrainingSession {
        const timestamp = isoTimestamp(now, "Training session creation time");
        const state: TrainingSessionState = {
            id: requiredUuid(input.id, "Training session ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            status: "draft",
            title: optionalText(input.title, "Title", 160),
            localDate: requiredLocalDate(input.localDate, "Local date"),
            timeZone: requiredTimeZone(input.timeZone),
            startedAt: null,
            endedAt: null,
            durationMinutes: null,
            readiness: readinessFrom(input.readiness),
            postWorkout: postWorkoutFrom(input.postWorkout),
            notes: optionalText(input.notes, "Notes", 4_000),
            tags: normalizeTags(input.tags ?? []),
            sourcePlannedSessionId:
                input.sourcePlannedSessionId == null
                    ? null
                    : requiredUuid(input.sourcePlannedSessionId, "Source planned session ID"),
            activities: normalizeActivities(input.activities ?? []),
            painRecords: [],
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        // Pain records reference activities, so normalize them against the freshly built activity set.
        const withPain: TrainingSessionState = {
            ...state,
            painRecords: normalizePainRecords(input.painRecords ?? [], state.activities),
        };
        validateState(withPain);
        return new TrainingSession(immutableCopy(withPain));
    }

    static rehydrate(state: TrainingSessionState): TrainingSession {
        const copied = immutableCopy(state);
        validateState(copied);
        return new TrainingSession(copied);
    }

    get state(): TrainingSessionState {
        return immutableCopy(this.current);
    }

    /** Move a draft session into progress, stamping the server-provided start instant (design 11.6). */
    start(now: Date): this {
        if (this.current.status !== "draft") this.reject("start", "Only a draft session can be started");
        const startedAt = isoTimestamp(now, "Training session start time");
        return this.replace({
            ...this.current,
            status: "in_progress",
            startedAt: this.current.startedAt ?? startedAt,
            updatedAt: startedAt,
        });
    }

    update(input: UpdateTrainingSessionInput, now: Date): this {
        if (this.current.status === "completed") this.reject("update", "Reopen a completed session before editing it");
        const activities =
            input.activities !== undefined ? normalizeActivities(input.activities) : this.current.activities;
        const painRecords =
            input.painRecords !== undefined
                ? normalizePainRecords(input.painRecords, activities)
                : reconcilePainRecords(this.current.painRecords, activities);
        return this.replace({
            ...this.current,
            ...(input.title !== undefined ? { title: optionalText(input.title, "Title", 160) } : {}),
            ...(input.localDate !== undefined ? { localDate: requiredLocalDate(input.localDate, "Local date") } : {}),
            ...(input.timeZone !== undefined ? { timeZone: requiredTimeZone(input.timeZone) } : {}),
            ...(input.startedAt !== undefined ? { startedAt: optionalInstant(input.startedAt, "Start time") } : {}),
            ...(input.endedAt !== undefined ? { endedAt: optionalInstant(input.endedAt, "End time") } : {}),
            ...(input.durationMinutes !== undefined
                ? { durationMinutes: optionalInteger(input.durationMinutes, "Duration minutes") }
                : {}),
            ...(input.notes !== undefined ? { notes: optionalText(input.notes, "Notes", 4_000) } : {}),
            ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
            ...(input.readiness !== undefined
                ? { readiness: mergeReadiness(this.current.readiness, input.readiness) }
                : {}),
            ...(input.postWorkout !== undefined
                ? { postWorkout: mergePostWorkout(this.current.postWorkout, input.postWorkout) }
                : {}),
            activities,
            painRecords,
            updatedAt: isoTimestamp(now, "Training session update time"),
        });
    }

    complete(input: CompleteTrainingSessionInput, now: Date): this {
        if (this.current.status !== "in_progress")
            this.reject("complete", "Only an in-progress session can be completed");
        const timestamp = isoTimestamp(now, "Training session completion time");
        const endedAt =
            input.endedAt !== undefined
                ? optionalInstant(input.endedAt, "End time")
                : (this.current.endedAt ?? timestamp);
        return this.replace({
            ...this.current,
            status: "completed",
            endedAt: endedAt ?? timestamp,
            ...(input.durationMinutes !== undefined
                ? { durationMinutes: optionalInteger(input.durationMinutes, "Duration minutes") }
                : {}),
            ...(input.postWorkout !== undefined
                ? { postWorkout: mergePostWorkout(this.current.postWorkout, input.postWorkout) }
                : {}),
            updatedAt: timestamp,
        });
    }

    /** Return a completed session to in-progress so corrections can be recorded (design 11.6 step 5). */
    reopen(now: Date): this {
        if (this.current.status !== "completed") this.reject("reopen", "Only a completed session can be reopened");
        return this.replace({
            ...this.current,
            status: "in_progress",
            updatedAt: isoTimestamp(now, "Training session update time"),
        });
    }

    archive(now: Date): this {
        if (this.current.archivedAt !== null) return this;
        return this.replace({
            ...this.current,
            archivedAt: isoTimestamp(now, "Training session archive time"),
            updatedAt: isoTimestamp(now, "Training session update time"),
        });
    }

    restore(now: Date): this {
        if (this.current.archivedAt === null) return this;
        return this.replace({
            ...this.current,
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Training session update time"),
        });
    }

    private reject(action: string, reason: string): never {
        throw new DomainValidationError(`Cannot ${action} a ${this.current.status} training session: ${reason}`, {
            status: [reason],
        });
    }

    private replace(state: TrainingSessionState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: TrainingSessionState): void {
    requiredUuid(state.id, "Training session ID");
    requiredUuid(state.profileId, "Profile ID");
    normalizeStatus(state.status);
    optionalText(state.title, "Title", 160);
    requiredLocalDate(state.localDate, "Local date");
    requiredTimeZone(state.timeZone);
    validateReadiness(state.readiness);
    validatePostWorkout(state.postWorkout);
    normalizeTags(state.tags);
    if (state.sourcePlannedSessionId !== null) requiredUuid(state.sourcePlannedSessionId, "Source planned session ID");
    const startedAt = optionalInstant(state.startedAt, "Start time");
    const endedAt = optionalInstant(state.endedAt, "End time");
    if (endedAt !== null && startedAt === null)
        throw new DomainValidationError("A session cannot have an end time without a start time", {
            endedAt: ["A session cannot have an end time without a start time"],
        });
    if (startedAt !== null && endedAt !== null && new Date(endedAt).getTime() < new Date(startedAt).getTime())
        throw new DomainValidationError("End time cannot precede start time", {
            endedAt: ["End time cannot precede start time"],
        });
    optionalInteger(state.durationMinutes, "Duration minutes");
    if (state.status !== "draft" && startedAt === null)
        throw new DomainValidationError("An in-progress or completed session must have a start time", {
            startedAt: ["An in-progress or completed session must have a start time"],
        });
    if (state.status === "completed" && endedAt === null)
        throw new DomainValidationError("A completed session must have an end time", {
            endedAt: ["A completed session must have an end time"],
        });
    validateActivities(state.activities);
    validatePainRecords(state.painRecords, state.activities);
    isoTimestamp(new Date(state.createdAt), "Training session creation time");
    isoTimestamp(new Date(state.updatedAt), "Training session update time");
}

function normalizeStatus(value: TrainingSessionStatus): TrainingSessionStatus {
    if (!trainingSessionStatuses.includes(value))
        throw new DomainValidationError(`Unknown training session status '${value}'`, {
            status: ["Unknown training session status"],
        });
    return value;
}

function readinessFrom(input: Partial<PreWorkoutReadiness> | undefined): PreWorkoutReadiness {
    return mergeReadiness(EMPTY_READINESS, input ?? {});
}

function mergeReadiness(current: PreWorkoutReadiness, patch: Partial<PreWorkoutReadiness>): PreWorkoutReadiness {
    const next: PreWorkoutReadiness = {
        energy: patch.energy !== undefined ? optionalScale(patch.energy, "Readiness energy", 1, 5) : current.energy,
        motivation:
            patch.motivation !== undefined
                ? optionalScale(patch.motivation, "Readiness motivation", 1, 5)
                : current.motivation,
        fatigue:
            patch.fatigue !== undefined ? optionalScale(patch.fatigue, "Readiness fatigue", 1, 5) : current.fatigue,
        soreness:
            patch.soreness !== undefined ? optionalScale(patch.soreness, "Readiness soreness", 1, 5) : current.soreness,
        stress: patch.stress !== undefined ? optionalScale(patch.stress, "Readiness stress", 1, 5) : current.stress,
        recovery:
            patch.recovery !== undefined ? optionalScale(patch.recovery, "Readiness recovery", 1, 5) : current.recovery,
    };
    return next;
}

function postWorkoutFrom(input: Partial<PostWorkoutRatings> | undefined): PostWorkoutRatings {
    return mergePostWorkout(EMPTY_POST_WORKOUT, input ?? {});
}

function mergePostWorkout(current: PostWorkoutRatings, patch: Partial<PostWorkoutRatings>): PostWorkoutRatings {
    return {
        energy: patch.energy !== undefined ? optionalScale(patch.energy, "Post-workout energy", 1, 5) : current.energy,
        motivation:
            patch.motivation !== undefined
                ? optionalScale(patch.motivation, "Post-workout motivation", 1, 5)
                : current.motivation,
        enjoyment:
            patch.enjoyment !== undefined
                ? optionalScale(patch.enjoyment, "Post-workout enjoyment", 1, 5)
                : current.enjoyment,
        difficulty:
            patch.difficulty !== undefined
                ? optionalScale(patch.difficulty, "Post-workout difficulty", 1, 5)
                : current.difficulty,
        fatigue:
            patch.fatigue !== undefined ? optionalScale(patch.fatigue, "Post-workout fatigue", 1, 5) : current.fatigue,
        notes: patch.notes !== undefined ? optionalText(patch.notes, "Post-workout notes", 4_000) : current.notes,
    };
}

function validateReadiness(readiness: PreWorkoutReadiness): void {
    optionalScale(readiness.energy, "Readiness energy", 1, 5);
    optionalScale(readiness.motivation, "Readiness motivation", 1, 5);
    optionalScale(readiness.fatigue, "Readiness fatigue", 1, 5);
    optionalScale(readiness.soreness, "Readiness soreness", 1, 5);
    optionalScale(readiness.stress, "Readiness stress", 1, 5);
    optionalScale(readiness.recovery, "Readiness recovery", 1, 5);
}

function validatePostWorkout(post: PostWorkoutRatings): void {
    optionalScale(post.energy, "Post-workout energy", 1, 5);
    optionalScale(post.motivation, "Post-workout motivation", 1, 5);
    optionalScale(post.enjoyment, "Post-workout enjoyment", 1, 5);
    optionalScale(post.difficulty, "Post-workout difficulty", 1, 5);
    optionalScale(post.fatigue, "Post-workout fatigue", 1, 5);
    optionalText(post.notes, "Post-workout notes", 4_000);
}

function normalizeActivities(inputs: readonly SessionActivityInput[]): readonly SessionActivityState[] {
    return inputs.map(input => {
        const startedAt = optionalInstant(input.startedAt, "Activity start time");
        const endedAt = optionalInstant(input.endedAt, "Activity end time");
        return {
            id: requiredUuid(input.id, "Activity ID"),
            type: normalizeActivityType(input.type),
            position: requiredNonNegativeInteger(input.position, "Activity position"),
            startedAt,
            endedAt,
            durationSeconds: optionalInteger(input.durationSeconds, "Activity duration"),
            rpe: optionalScale(input.rpe, "Activity RPE", 0, 10),
            feeling: optionalText(input.feeling, "Activity feeling", 2_000),
            notes: optionalText(input.notes, "Activity notes", 4_000),
            tags: normalizeTags(input.tags ?? []),
        };
    });
}

function validateActivities(activities: readonly SessionActivityState[]): void {
    const positions = new Set<number>();
    const ids = new Set<string>();
    for (const activity of activities) {
        requiredUuid(activity.id, "Activity ID");
        if (ids.has(activity.id))
            throw new DomainValidationError(`Duplicate activity ID '${activity.id}'`, {
                activities: ["Activity IDs must be unique"],
            });
        ids.add(activity.id);
        normalizeActivityType(activity.type);
        requiredNonNegativeInteger(activity.position, "Activity position");
        if (positions.has(activity.position))
            throw new DomainValidationError(`Duplicate activity position ${activity.position}`, {
                activities: ["Activity positions must be unique"],
            });
        positions.add(activity.position);
        const startedAt = optionalInstant(activity.startedAt, "Activity start time");
        const endedAt = optionalInstant(activity.endedAt, "Activity end time");
        if (endedAt !== null && startedAt === null)
            throw new DomainValidationError("An activity cannot have an end time without a start time", {
                activities: ["An activity cannot have an end time without a start time"],
            });
        if (startedAt !== null && endedAt !== null && new Date(endedAt).getTime() < new Date(startedAt).getTime())
            throw new DomainValidationError("Activity end time cannot precede its start time", {
                activities: ["Activity end time cannot precede its start time"],
            });
        optionalInteger(activity.durationSeconds, "Activity duration");
        optionalScale(activity.rpe, "Activity RPE", 0, 10);
    }
}

/** Drop pain-record activity links whose activity was removed by an edit, keeping the tree consistent. */
function reconcilePainRecords(
    records: readonly PainRecordState[],
    activities: readonly SessionActivityState[],
): readonly PainRecordState[] {
    const activityIds = new Set(activities.map(activity => activity.id));
    return records.map(record =>
        record.activityId !== null && !activityIds.has(record.activityId) ? { ...record, activityId: null } : record,
    );
}

function normalizePainRecords(
    inputs: readonly PainRecordInput[],
    activities: readonly SessionActivityState[],
): readonly PainRecordState[] {
    const activityIds = new Set(activities.map(activity => activity.id));
    return inputs.map(input => {
        const activityId = input.activityId == null ? null : requiredUuid(input.activityId, "Pain activity ID");
        if (activityId !== null && !activityIds.has(activityId))
            throw new DomainValidationError("Pain record references an unknown activity", {
                painRecords: ["Pain record references an unknown activity"],
            });
        return {
            id: requiredUuid(input.id, "Pain record ID"),
            activityId,
            exerciseOccurrenceId:
                input.exerciseOccurrenceId == null
                    ? null
                    : requiredUuid(input.exerciseOccurrenceId, "Pain exercise occurrence ID"),
            performedSetId:
                input.performedSetId == null ? null : requiredUuid(input.performedSetId, "Pain performed set ID"),
            bodyArea: requiredText(input.bodyArea, "Pain body area", 120),
            side: normalizePainSide(input.side),
            severity: requiredScale(input.severity, "Pain severity", 0, 10),
            painType: optionalText(input.painType, "Pain type", 120),
            onsetDuringSession: Boolean(input.onsetDuringSession ?? false),
            stoppedActivity: Boolean(input.stoppedActivity ?? false),
            notes: optionalText(input.notes, "Pain notes", 4_000),
        };
    });
}

function validatePainRecords(records: readonly PainRecordState[], activities: readonly SessionActivityState[]): void {
    const activityIds = new Set(activities.map(activity => activity.id));
    const ids = new Set<string>();
    for (const record of records) {
        requiredUuid(record.id, "Pain record ID");
        if (ids.has(record.id))
            throw new DomainValidationError(`Duplicate pain record ID '${record.id}'`, {
                painRecords: ["Pain record IDs must be unique"],
            });
        ids.add(record.id);
        if (record.activityId !== null && !activityIds.has(record.activityId))
            throw new DomainValidationError("Pain record references an unknown activity", {
                painRecords: ["Pain record references an unknown activity"],
            });
        requiredText(record.bodyArea, "Pain body area", 120);
        normalizePainSide(record.side);
        requiredScale(record.severity, "Pain severity", 0, 10);
    }
}

function normalizeActivityType(value: SessionActivityType): SessionActivityType {
    if (!sessionActivityTypes.includes(value))
        throw new DomainValidationError(`Unknown activity type '${value}'`, {
            activities: ["Unknown activity type"],
        });
    return value;
}

function normalizePainSide(value: PainSide): PainSide {
    if (!painSides.includes(value))
        throw new DomainValidationError(`Unknown pain side '${value}'`, { painRecords: ["Unknown pain side"] });
    return value;
}

/** Case-insensitive tag normalization: trim + NFKC, dedup by folded value, keep first-seen display (TS-7). */
function normalizeTags(values: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = value.trim().normalize("NFKC");
        if (normalized.length === 0 || normalized.length > 80)
            throw new DomainValidationError("Tag must be 1 to 80 characters", {
                tags: ["Tag must be 1 to 80 characters"],
            });
        const folded = normalized.toLocaleLowerCase();
        if (!seen.has(folded)) {
            seen.add(folded);
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

function requiredText(value: string, name: string, maximumLength: number): string {
    const normalized = (value ?? "").trim().normalize("NFKC");
    if (normalized.length === 0) throw new DomainValidationError(`${name} is required`);
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) return null;
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function requiredNonNegativeInteger(value: number, name: string): number {
    if (!Number.isInteger(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative integer`);
    return value;
}

function optionalInteger(value: number | null | undefined, name: string): number | null {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative integer`);
    return value;
}

function requiredScale(value: number, name: string, min: number, max: number): number {
    if (!Number.isInteger(value) || value < min || value > max)
        throw new DomainValidationError(`${name} must be an integer between ${min} and ${max}`);
    return value;
}

function optionalScale(value: number | null | undefined, name: string, min: number, max: number): number | null {
    if (value == null) return null;
    return requiredScale(value, name, min, max);
}

function requiredLocalDate(value: string, name: string): string {
    const normalized = (value ?? "").trim();
    if (!LOCAL_DATE_PATTERN.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime()))
        throw new DomainValidationError(`${name} must be a valid YYYY-MM-DD date`);
    return normalized;
}

function requiredTimeZone(value: string): string {
    const normalized = (value ?? "").trim();
    if (normalized.length === 0 || normalized.length > 80)
        throw new DomainValidationError("Time zone must be a valid IANA identifier");
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: normalized });
    } catch {
        throw new DomainValidationError(`Time zone '${normalized}' is not a valid IANA identifier`);
    }
    return normalized;
}

function optionalInstant(value: string | null | undefined, name: string): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (normalized.length === 0) return null;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw new DomainValidationError(`${name} must be a valid instant`);
    return parsed.toISOString();
}

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}
