import { DomainValidationError } from "#src/platform/domain/index";

export const injurySides = ["left", "right", "bilateral"] as const;
export const injurySeverities = ["mild", "moderate", "severe"] as const;
export const injuryStatuses = ["active", "recovering", "resolved"] as const;

export type InjurySide = (typeof injurySides)[number];
export type InjurySeverity = (typeof injurySeverities)[number];
export type InjuryStatus = (typeof injuryStatuses)[number];

export interface TrainingInjuryState {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly bodyArea: string;
    readonly side: InjurySide | null;
    readonly severity: InjurySeverity;
    readonly status: InjuryStatus;
    readonly onsetDate: string;
    readonly resolvedDate: string | null;
    readonly notes: string | null;
    readonly muscleGroupIds: readonly string[];
    readonly exerciseIds: readonly string[];
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateTrainingInjuryInput {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly bodyArea: string;
    readonly side?: InjurySide | null;
    readonly severity?: InjurySeverity;
    readonly status?: InjuryStatus;
    readonly onsetDate?: string;
    readonly resolvedDate?: string | null;
    readonly notes?: string | null;
    readonly muscleGroupIds?: readonly string[];
    readonly exerciseIds?: readonly string[];
}

export interface UpdateTrainingInjuryInput {
    readonly name?: string;
    readonly bodyArea?: string;
    readonly side?: InjurySide | null;
    readonly severity?: InjurySeverity;
    readonly status?: InjuryStatus;
    readonly onsetDate?: string;
    readonly resolvedDate?: string | null;
    readonly notes?: string | null;
    readonly muscleGroupIds?: readonly string[];
    readonly exerciseIds?: readonly string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class TrainingInjury {
    private constructor(private current: TrainingInjuryState) {}

    static create(input: CreateTrainingInjuryInput, now: Date): TrainingInjury {
        const timestamp = isoTimestamp(now, "Training injury creation time");
        const status = normalizeStatus(input.status ?? "active");
        const state: TrainingInjuryState = {
            id: requiredUuid(input.id, "Training injury ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            name: requiredText(input.name, "Name", 200),
            bodyArea: requiredText(input.bodyArea, "Body area", 120),
            side: input.side == null ? null : normalizeSide(input.side),
            severity: normalizeSeverity(input.severity ?? "moderate"),
            status,
            onsetDate: normalizeDate(input.onsetDate ?? now.toISOString().slice(0, 10), "Onset date"),
            resolvedDate: input.resolvedDate == null ? null : normalizeDate(input.resolvedDate, "Resolved date"),
            notes: optionalText(input.notes, "Notes", 2_000),
            muscleGroupIds: normalizeIdSet(input.muscleGroupIds ?? [], "Muscle group ID"),
            exerciseIds: normalizeIdSet(input.exerciseIds ?? [], "Exercise ID"),
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new TrainingInjury(immutableCopy(state));
    }

    static rehydrate(state: TrainingInjuryState): TrainingInjury {
        const copied = immutableCopy(state);
        validateState(copied);
        return new TrainingInjury(copied);
    }

    get state(): TrainingInjuryState {
        return immutableCopy(this.current);
    }

    update(input: UpdateTrainingInjuryInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.name !== undefined ? { name: requiredText(input.name, "Name", 200) } : {}),
            ...(input.bodyArea !== undefined ? { bodyArea: requiredText(input.bodyArea, "Body area", 120) } : {}),
            ...(input.side !== undefined ? { side: input.side === null ? null : normalizeSide(input.side) } : {}),
            ...(input.severity !== undefined ? { severity: normalizeSeverity(input.severity) } : {}),
            ...(input.status !== undefined ? { status: normalizeStatus(input.status) } : {}),
            ...(input.onsetDate !== undefined ? { onsetDate: normalizeDate(input.onsetDate, "Onset date") } : {}),
            ...(input.resolvedDate !== undefined
                ? {
                      resolvedDate:
                          input.resolvedDate === null ? null : normalizeDate(input.resolvedDate, "Resolved date"),
                  }
                : {}),
            ...(input.notes !== undefined ? { notes: optionalText(input.notes, "Notes", 2_000) } : {}),
            ...(input.muscleGroupIds !== undefined
                ? { muscleGroupIds: normalizeIdSet(input.muscleGroupIds, "Muscle group ID") }
                : {}),
            ...(input.exerciseIds !== undefined
                ? { exerciseIds: normalizeIdSet(input.exerciseIds, "Exercise ID") }
                : {}),
            updatedAt: isoTimestamp(now, "Training injury update time"),
        });
    }

    private replace(state: TrainingInjuryState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: TrainingInjuryState): void {
    requiredUuid(state.id, "Training injury ID");
    requiredUuid(state.profileId, "Profile ID");
    requiredText(state.name, "Name", 200);
    requiredText(state.bodyArea, "Body area", 120);
    if (state.side !== null) normalizeSide(state.side);
    normalizeSeverity(state.severity);
    normalizeStatus(state.status);
    normalizeDate(state.onsetDate, "Onset date");
    if (state.resolvedDate !== null) {
        normalizeDate(state.resolvedDate, "Resolved date");
        if (state.resolvedDate < state.onsetDate)
            throw new DomainValidationError("Resolved date cannot be before the onset date", {
                resolvedDate: ["Resolved date cannot be before the onset date"],
            });
    }
    if ((state.status === "resolved") !== (state.resolvedDate !== null))
        throw new DomainValidationError("A resolved date is required exactly when the injury is resolved", {
            resolvedDate: ["Set a resolved date only when the status is resolved"],
        });
    optionalText(state.notes, "Notes", 2_000);
    normalizeIdSet(state.muscleGroupIds, "Muscle group ID");
    normalizeIdSet(state.exerciseIds, "Exercise ID");
    isoTimestamp(new Date(state.createdAt), "Training injury creation time");
    isoTimestamp(new Date(state.updatedAt), "Training injury update time");
}

function normalizeSide(value: InjurySide): InjurySide {
    if (!injurySides.includes(value))
        throw new DomainValidationError(`Unknown injury side '${value}'`, { side: ["Unknown injury side"] });
    return value;
}

function normalizeSeverity(value: InjurySeverity): InjurySeverity {
    if (!injurySeverities.includes(value))
        throw new DomainValidationError(`Unknown injury severity '${value}'`, {
            severity: ["Unknown injury severity"],
        });
    return value;
}

function normalizeStatus(value: InjuryStatus): InjuryStatus {
    if (!injuryStatuses.includes(value))
        throw new DomainValidationError(`Unknown injury status '${value}'`, { status: ["Unknown injury status"] });
    return value;
}

function normalizeIdSet(values: readonly string[], name: string): readonly string[] {
    const normalized = values.map(value => requiredUuid(value, name));
    if (new Set(normalized).size !== normalized.length)
        throw new DomainValidationError(`${name} links must be unique`, {
            links: [`Each ${name.toLowerCase()} may be linked only once`],
        });
    return normalized;
}

function normalizeDate(value: string, name: string): string {
    const normalized = value.trim();
    if (!ISO_DATE_PATTERN.test(normalized))
        throw new DomainValidationError(`${name} must be an ISO calendar date (YYYY-MM-DD)`);
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized)
        throw new DomainValidationError(`${name} '${normalized}' is not a real calendar date`);
    return normalized;
}

function requiredText(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) throw new DomainValidationError(`${name} is required`);
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function requiredUuid(value: string, name: string): string {
    const normalized = value.trim();
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

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}
