import { DomainValidationError } from "#src/platform/domain/index";

export const healthRecordTypes = ["body_weight", "sleep", "resting_heart_rate", "daily_readiness"] as const;
export const healthRecordSources = ["manual"] as const;

export type HealthRecordType = (typeof healthRecordTypes)[number];
export type HealthRecordSource = (typeof healthRecordSources)[number];

/** The current schema version of the structured JSON body persisted per record. */
export const HEALTH_RECORD_BODY_SCHEMA_VERSION = 1;

export interface BodyWeightBody {
    readonly type: "body_weight";
    readonly massKg: number;
}

export interface SleepBody {
    readonly type: "sleep";
    readonly startAt: string;
    readonly endAt: string;
}

export interface RestingHeartRateBody {
    readonly type: "resting_heart_rate";
    readonly beatsPerMinute: number;
}

export interface DailyReadinessBody {
    readonly type: "daily_readiness";
    readonly score: number;
    readonly scaleMin: number;
    readonly scaleMax: number;
}

/** Canonical, fully-populated body stored on the record. */
export type HealthRecordBody = BodyWeightBody | SleepBody | RestingHeartRateBody | DailyReadinessBody;

/** Readiness as accepted from callers: the scale bounds default to 0–100. */
export interface DailyReadinessBodyInput {
    readonly type: "daily_readiness";
    readonly score: number;
    readonly scaleMin?: number;
    readonly scaleMax?: number;
}

/** Body shape accepted on create/update before the domain fills defaults. */
export type HealthRecordBodyInput = BodyWeightBody | SleepBody | RestingHeartRateBody | DailyReadinessBodyInput;

export interface ManualHealthRecordState {
    readonly id: string;
    readonly profileId: string;
    readonly type: HealthRecordType;
    readonly source: HealthRecordSource;
    readonly effectiveAt: string;
    readonly timeZone: string | null;
    readonly notes: string | null;
    readonly body: HealthRecordBody;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateManualHealthRecordInput {
    readonly id: string;
    readonly profileId: string;
    readonly effectiveAt: string;
    readonly timeZone?: string | null;
    readonly notes?: string | null;
    readonly body: HealthRecordBodyInput;
    readonly source?: HealthRecordSource;
}

export interface UpdateManualHealthRecordInput {
    readonly effectiveAt?: string;
    readonly timeZone?: string | null;
    readonly notes?: string | null;
    readonly body?: HealthRecordBodyInput;
}

/** Promoted numeric columns derived from the record body, one set of fields per type. */
export interface HealthRecordPromotion {
    readonly massKg: number | null;
    readonly restingHeartRateBpm: number | null;
    readonly sleepStartAt: string | null;
    readonly sleepEndAt: string | null;
    readonly sleepDurationMinutes: number | null;
    readonly readinessScore: number | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SLEEP_MINUTES = 24 * 60;

export class ManualHealthRecord {
    private constructor(private current: ManualHealthRecordState) {}

    static create(input: CreateManualHealthRecordInput, now: Date): ManualHealthRecord {
        const timestamp = isoTimestamp(now, "Health record creation time");
        const body = normalizeBody(input.body);
        const state: ManualHealthRecordState = {
            id: requiredUuid(input.id, "Health record ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            type: body.type,
            source: normalizeSource(input.source ?? "manual"),
            effectiveAt: isoInstant(input.effectiveAt, "Effective time"),
            timeZone: normalizeTimeZone(input.timeZone),
            notes: optionalText(input.notes, "Notes", 2_000),
            body,
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new ManualHealthRecord(immutableCopy(state));
    }

    static rehydrate(state: ManualHealthRecordState): ManualHealthRecord {
        const copied = immutableCopy(state);
        validateState(copied);
        return new ManualHealthRecord(copied);
    }

    get state(): ManualHealthRecordState {
        return immutableCopy(this.current);
    }

    update(input: UpdateManualHealthRecordInput, now: Date): this {
        if (this.current.archivedAt !== null)
            throw new DomainValidationError("An archived health record cannot be edited", {
                archivedAt: ["Restore the record before editing it"],
            });
        const nextBody = input.body === undefined ? this.current.body : normalizeBody(input.body);
        if (nextBody.type !== this.current.type)
            throw new DomainValidationError("A health record's type cannot change", {
                type: ["The record type is fixed once created"],
            });
        return this.replace({
            ...this.current,
            ...(input.effectiveAt !== undefined
                ? { effectiveAt: isoInstant(input.effectiveAt, "Effective time") }
                : {}),
            ...(input.timeZone !== undefined ? { timeZone: normalizeTimeZone(input.timeZone) } : {}),
            ...(input.notes !== undefined ? { notes: optionalText(input.notes, "Notes", 2_000) } : {}),
            body: nextBody,
            updatedAt: isoTimestamp(now, "Health record update time"),
        });
    }

    archive(now: Date): this {
        if (this.current.archivedAt !== null) throw new DomainValidationError("Health record is already archived");
        const timestamp = isoTimestamp(now, "Health record archive time");
        return this.replace({ ...this.current, archivedAt: timestamp, updatedAt: timestamp });
    }

    private replace(state: ManualHealthRecordState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

/** Compute the promoted numeric columns for a record, keeping the mapping in one pure place. */
export function promoteHealthRecord(state: ManualHealthRecordState): HealthRecordPromotion {
    const empty: HealthRecordPromotion = {
        massKg: null,
        restingHeartRateBpm: null,
        sleepStartAt: null,
        sleepEndAt: null,
        sleepDurationMinutes: null,
        readinessScore: null,
    };
    const body = state.body;
    switch (body.type) {
        case "body_weight":
            return { ...empty, massKg: body.massKg };
        case "resting_heart_rate":
            return { ...empty, restingHeartRateBpm: body.beatsPerMinute };
        case "sleep":
            return {
                ...empty,
                sleepStartAt: body.startAt,
                sleepEndAt: body.endAt,
                sleepDurationMinutes: sleepDurationMinutes(body),
            };
        case "daily_readiness":
            return { ...empty, readinessScore: body.score };
    }
}

export function sleepDurationMinutes(body: SleepBody): number {
    return Math.round((new Date(body.endAt).getTime() - new Date(body.startAt).getTime()) / 60_000);
}

function validateState(state: ManualHealthRecordState): void {
    requiredUuid(state.id, "Health record ID");
    requiredUuid(state.profileId, "Profile ID");
    normalizeSource(state.source);
    isoInstant(state.effectiveAt, "Effective time");
    normalizeTimeZone(state.timeZone);
    optionalText(state.notes, "Notes", 2_000);
    const body = normalizeBody(state.body);
    if (body.type !== state.type)
        throw new DomainValidationError("Health record body type must match the record type", {
            type: ["The record type must equal its body discriminator"],
        });
    if (state.archivedAt !== null) isoTimestamp(new Date(state.archivedAt), "Health record archive time");
    isoTimestamp(new Date(state.createdAt), "Health record creation time");
    isoTimestamp(new Date(state.updatedAt), "Health record update time");
}

function normalizeBody(body: HealthRecordBodyInput): HealthRecordBody {
    if (body == null || typeof body !== "object")
        throw new DomainValidationError("Health record body is required", { body: ["Provide a record body"] });
    switch (body.type) {
        case "body_weight":
            return { type: "body_weight", massKg: measurement(body.massKg, "Body weight (kg)", 0, 1_000, 3) };
        case "resting_heart_rate":
            return {
                type: "resting_heart_rate",
                beatsPerMinute: integer(body.beatsPerMinute, "Resting heart rate (bpm)", 20, 250),
            };
        case "sleep": {
            const startAt = isoInstant(body.startAt, "Sleep start time");
            const endAt = isoInstant(body.endAt, "Sleep end time");
            const minutes = sleepDurationMinutes({ type: "sleep", startAt, endAt });
            if (minutes <= 0)
                throw new DomainValidationError("Sleep end time must be after the start time", {
                    endAt: ["Sleep must end after it starts"],
                });
            if (minutes > MAX_SLEEP_MINUTES)
                throw new DomainValidationError("A single sleep record cannot exceed 24 hours", {
                    endAt: ["Sleep interval cannot exceed 24 hours"],
                });
            return { type: "sleep", startAt, endAt };
        }
        case "daily_readiness": {
            const scaleMin = integer(body.scaleMin ?? 0, "Readiness scale minimum", 0, 1_000);
            const scaleMax = integer(body.scaleMax ?? 100, "Readiness scale maximum", 0, 1_000);
            if (scaleMax <= scaleMin)
                throw new DomainValidationError("Readiness scale maximum must exceed its minimum", {
                    scaleMax: ["Scale maximum must be greater than the minimum"],
                });
            const score = integer(body.score, "Readiness score", scaleMin, scaleMax);
            return { type: "daily_readiness", score, scaleMin, scaleMax };
        }
        default:
            throw new DomainValidationError(`Unknown health record type '${(body as { type?: string }).type}'`, {
                type: ["Unknown health record type"],
            });
    }
}

function normalizeSource(value: HealthRecordSource): HealthRecordSource {
    if (!healthRecordSources.includes(value))
        throw new DomainValidationError(`Unknown health record source '${value}'`, {
            source: ["Only manual records are supported"],
        });
    return value;
}

function normalizeTimeZone(value: string | null | undefined): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (normalized.length === 0) return null;
    try {
        // Throws RangeError for an unknown IANA zone; keeps time-zone semantics honest.
        new Intl.DateTimeFormat("en-US", { timeZone: normalized });
    } catch {
        throw new DomainValidationError(`'${normalized}' is not a valid IANA time zone`, {
            timeZone: ["Provide a valid IANA time zone"],
        });
    }
    return normalized;
}

function measurement(
    value: number,
    name: string,
    minExclusive: number,
    maxInclusive: number,
    decimals: number,
): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new DomainValidationError(`${name} must be a finite number`);
    const rounded = Math.round(value * 10 ** decimals) / 10 ** decimals;
    if (rounded <= minExclusive || rounded > maxInclusive)
        throw new DomainValidationError(`${name} must be greater than ${minExclusive} and at most ${maxInclusive}`);
    return rounded;
}

function integer(value: number, name: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isInteger(value))
        throw new DomainValidationError(`${name} must be a whole number`);
    if (value < min || value > max) throw new DomainValidationError(`${name} must be between ${min} and ${max}`);
    return value;
}

function requiredUuid(value: string, name: string): string {
    const normalized = String(value ?? "").trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
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

function isoInstant(value: string, name: string): string {
    const normalized = String(value ?? "").trim();
    const date = new Date(normalized);
    if (normalized.length === 0 || Number.isNaN(date.getTime()))
        throw new DomainValidationError(`${name} must be an ISO 8601 date-time`);
    return date.toISOString();
}

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}
