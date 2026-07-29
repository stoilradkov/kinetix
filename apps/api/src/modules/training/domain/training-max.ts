import { DomainValidationError } from "#src/platform/domain/index";

import { Mass, MeasurementValidationError, type MassUnit } from "#src/modules/training/domain/measurement";

export const trainingMaxTypes = ["estimated_1rm", "training_max", "custom"] as const;
export const trainingMaxSources = [
    "web",
    "cli",
    "agent",
    "bulk_import",
    "progression_rule",
    "manual_correction",
    "provider_sync",
] as const;
export const trainingMaxUnits = ["kg", "lb"] as const satisfies readonly MassUnit[];

export type TrainingMaxType = (typeof trainingMaxTypes)[number];
export type TrainingMaxSource = (typeof trainingMaxSources)[number];
export type TrainingMaxUnit = (typeof trainingMaxUnits)[number];

/** One immutable point in an exercise's effective-interval training-max series. */
export interface TrainingMaxState {
    readonly id: string;
    readonly profileId: string;
    readonly exerciseId: string;
    readonly maxType: TrainingMaxType;
    readonly customLabel: string | null;
    readonly valueKg: string;
    readonly enteredValue: string;
    readonly enteredUnit: TrainingMaxUnit;
    readonly source: TrainingMaxSource;
    readonly note: string | null;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface RecordTrainingMaxInput {
    readonly id: string;
    readonly profileId: string;
    readonly exerciseId: string;
    readonly maxType: TrainingMaxType;
    readonly customLabel?: string | null;
    readonly value: number | string;
    readonly unit?: TrainingMaxUnit;
    readonly source?: TrainingMaxSource;
    readonly note?: string | null;
    readonly effectiveFrom?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TrainingMax {
    private constructor(private current: TrainingMaxState) {}

    static record(input: RecordTrainingMaxInput, now: Date): TrainingMax {
        const timestamp = isoTimestamp(now, "Training max creation time");
        const mass = canonicalMass(input.value, input.unit ?? "kg");
        const state: TrainingMaxState = {
            id: requiredUuid(input.id, "Training max ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            exerciseId: requiredUuid(input.exerciseId, "Exercise ID"),
            maxType: normalizeType(input.maxType),
            customLabel: normalizeCustomLabel(input.maxType, input.customLabel),
            valueKg: mass.canonical.toString(),
            enteredValue: mass.enteredValue.toString(),
            enteredUnit: mass.enteredUnit,
            source: normalizeSource(input.source ?? "web"),
            note: optionalText(input.note, "Note", 500),
            effectiveFrom:
                input.effectiveFrom === undefined ? timestamp : normalizeInstant(input.effectiveFrom, "Effective from"),
            effectiveTo: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new TrainingMax(immutableCopy(state));
    }

    static rehydrate(state: TrainingMaxState): TrainingMax {
        const copied = immutableCopy(state);
        validateState(copied);
        return new TrainingMax(copied);
    }

    get state(): TrainingMaxState {
        return immutableCopy(this.current);
    }

    /** Close the open interval so a newer record can take effect. */
    close(effectiveTo: string, now: Date): this {
        if (this.current.effectiveTo !== null)
            throw new DomainValidationError("Training max interval is already closed", {
                effectiveTo: ["This training max is not the current record"],
            });
        const boundary = normalizeInstant(effectiveTo, "Effective to");
        if (boundary <= this.current.effectiveFrom)
            throw new DomainValidationError("Effective-to must be after effective-from", {
                effectiveTo: ["A closing time must be after the record started"],
            });
        const next: TrainingMaxState = {
            ...this.current,
            effectiveTo: boundary,
            updatedAt: isoTimestamp(now, "Training max update time"),
        };
        validateState(next);
        this.current = immutableCopy(next);
        return this;
    }
}

/** Stable identity for one training-max series within a profile. */
export function trainingMaxSeriesKey(record: {
    readonly exerciseId: string;
    readonly maxType: TrainingMaxType;
    readonly customLabel: string | null;
}): string {
    return `${record.exerciseId}::${record.maxType}::${record.customLabel ?? ""}`;
}

/** The record in force at `at` (effectiveFrom <= at < effectiveTo), or null. */
export function resolveEffectiveTrainingMax(records: readonly TrainingMaxState[], at: string): TrainingMaxState | null {
    const instant = normalizeInstant(at, "Resolution instant");
    let match: TrainingMaxState | null = null;
    for (const record of records) {
        if (record.effectiveFrom > instant) continue;
        if (record.effectiveTo !== null && record.effectiveTo <= instant) continue;
        if (match === null || record.effectiveFrom > match.effectiveFrom) match = record;
    }
    return match ? immutableCopy(match) : null;
}

/** Assert an ordered series for one key has no overlapping intervals. */
export function assertTrainingMaxSeriesConsistent(records: readonly TrainingMaxState[]): void {
    const sorted = [...records].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    let openSeen = false;
    for (let index = 0; index < sorted.length; index += 1) {
        const current = sorted[index]!;
        if (current.effectiveTo === null) {
            if (openSeen) throw new DomainValidationError("A training-max series may have only one open interval");
            openSeen = true;
        }
        const next = sorted[index + 1];
        if (next && current.effectiveTo !== null && current.effectiveTo > next.effectiveFrom)
            throw new DomainValidationError("Training-max intervals must not overlap");
    }
}

function validateState(state: TrainingMaxState): void {
    requiredUuid(state.id, "Training max ID");
    requiredUuid(state.profileId, "Profile ID");
    requiredUuid(state.exerciseId, "Exercise ID");
    normalizeType(state.maxType);
    normalizeCustomLabel(state.maxType, state.customLabel);
    normalizeSource(state.source);
    if (!trainingMaxUnits.includes(state.enteredUnit))
        throw new DomainValidationError(`Unknown mass unit '${state.enteredUnit}'`, {
            unit: ["Unknown mass unit"],
        });
    assertPositiveDecimal(state.valueKg, "Value");
    assertPositiveDecimal(state.enteredValue, "Entered value");
    optionalText(state.note, "Note", 500);
    normalizeInstant(state.effectiveFrom, "Effective from");
    if (state.effectiveTo !== null) {
        normalizeInstant(state.effectiveTo, "Effective to");
        if (state.effectiveTo <= state.effectiveFrom)
            throw new DomainValidationError("Effective-to must be after effective-from", {
                effectiveTo: ["A closing time must be after the record started"],
            });
    }
    isoTimestamp(new Date(state.createdAt), "Training max creation time");
    isoTimestamp(new Date(state.updatedAt), "Training max update time");
}

function canonicalMass(value: number | string, unit: TrainingMaxUnit): Mass {
    let mass: Mass;
    try {
        mass = Mass.from(value, unit);
    } catch (error) {
        if (error instanceof MeasurementValidationError)
            throw new DomainValidationError(error.message, { value: [error.message] });
        throw error;
    }
    if (mass.canonical.compare(0) <= 0)
        throw new DomainValidationError("A training max must be greater than zero", {
            value: ["Enter a positive load"],
        });
    return mass;
}

function assertPositiveDecimal(value: string, name: string): void {
    let mass: Mass;
    try {
        mass = Mass.fromCanonical(value);
    } catch {
        throw new DomainValidationError(`${name} must be a positive number`, { value: [`${name} must be positive`] });
    }
    if (mass.canonical.compare(0) <= 0)
        throw new DomainValidationError(`${name} must be greater than zero`, { value: [`${name} must be positive`] });
}

function normalizeType(value: TrainingMaxType): TrainingMaxType {
    if (!trainingMaxTypes.includes(value))
        throw new DomainValidationError(`Unknown training max type '${value}'`, {
            maxType: ["Unknown training max type"],
        });
    return value;
}

function normalizeSource(value: TrainingMaxSource): TrainingMaxSource {
    if (!trainingMaxSources.includes(value))
        throw new DomainValidationError(`Unknown training max source '${value}'`, { source: ["Unknown source"] });
    return value;
}

function normalizeCustomLabel(maxType: TrainingMaxType, value: string | null | undefined): string | null {
    if (maxType === "custom") {
        const normalized = (value ?? "").trim().normalize("NFKC");
        if (normalized.length === 0 || normalized.length > 60)
            throw new DomainValidationError("A custom training max needs a label of 1 to 60 characters", {
                customLabel: ["Enter a label of 1 to 60 characters"],
            });
        return normalized;
    }
    if (value != null && value.trim().length > 0)
        throw new DomainValidationError("Only custom training maxima may carry a label", {
            customLabel: ["Remove the label unless the type is custom"],
        });
    return null;
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

function normalizeInstant(value: string, name: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new DomainValidationError(`${name} must be a valid ISO 8601 instant`);
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
