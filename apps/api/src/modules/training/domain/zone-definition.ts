import { DomainValidationError } from "#src/platform/domain/index";

import { DecimalValue } from "#src/modules/training/domain/measurement";

export const zoneFamilies = ["heart_rate", "pace", "power"] as const;
export const zoneSources = [
    "web",
    "cli",
    "agent",
    "bulk_import",
    "progression_rule",
    "manual_correction",
    "provider_sync",
] as const;

export type ZoneFamily = (typeof zoneFamilies)[number];
export type ZoneSource = (typeof zoneSources)[number];

/** Calculation methods per family (PRD RN-5). Cross-family use is rejected. */
export const zoneMethodsByFamily = {
    heart_rate: ["percent_max_hr", "percent_hr_reserve", "lactate_threshold", "manual"],
    pace: ["percent_threshold_pace", "manual"],
    power: ["percent_ftp", "manual"],
} as const satisfies Record<ZoneFamily, readonly string[]>;

export type ZoneMethod = (typeof zoneMethodsByFamily)[ZoneFamily][number];

/** Reference values a method requires in `config` and their ordering rule. */
const requiredConfigByMethod: Record<string, readonly string[]> = {
    percent_max_hr: ["maxHr"],
    percent_hr_reserve: ["maxHr", "restingHr"],
    lactate_threshold: ["thresholdHr"],
    percent_threshold_pace: ["thresholdPaceMps"],
    percent_ftp: ["ftpW"],
    manual: [],
};

export interface ZoneRangeState {
    readonly id: string;
    readonly position: number;
    readonly name: string;
    readonly lowerBound: string;
    readonly upperBound: string | null;
    readonly lowerInclusive: boolean;
    readonly upperInclusive: boolean;
}

export interface ZoneDefinitionState {
    readonly id: string;
    readonly profileId: string;
    readonly family: ZoneFamily;
    readonly method: ZoneMethod;
    readonly config: Readonly<Record<string, number>>;
    readonly ranges: readonly ZoneRangeState[];
    readonly source: ZoneSource;
    readonly note: string | null;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface ZoneRangeInput {
    readonly id: string;
    readonly position: number;
    readonly name: string;
    readonly lowerBound: number | string;
    readonly upperBound?: number | string | null;
    readonly lowerInclusive?: boolean;
    readonly upperInclusive?: boolean;
}

export interface RecordZoneDefinitionInput {
    readonly id: string;
    readonly profileId: string;
    readonly family: ZoneFamily;
    readonly method: ZoneMethod;
    readonly config?: Record<string, number>;
    readonly ranges: readonly ZoneRangeInput[];
    readonly source?: ZoneSource;
    readonly note?: string | null;
    readonly effectiveFrom?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ZoneDefinition {
    private constructor(private current: ZoneDefinitionState) {}

    static record(input: RecordZoneDefinitionInput, now: Date): ZoneDefinition {
        const timestamp = isoTimestamp(now, "Zone definition creation time");
        const state: ZoneDefinitionState = {
            id: requiredUuid(input.id, "Zone definition ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            family: normalizeFamily(input.family),
            method: normalizeMethod(input.family, input.method),
            config: normalizeConfig(input.method, input.config ?? {}),
            ranges: normalizeRanges(input.ranges),
            source: normalizeSource(input.source ?? "web"),
            note: optionalText(input.note, "Note", 500),
            effectiveFrom:
                input.effectiveFrom === undefined ? timestamp : normalizeInstant(input.effectiveFrom, "Effective from"),
            effectiveTo: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new ZoneDefinition(immutableCopy(state));
    }

    static rehydrate(state: ZoneDefinitionState): ZoneDefinition {
        const copied = immutableCopy(state);
        validateState(copied);
        return new ZoneDefinition(copied);
    }

    get state(): ZoneDefinitionState {
        return immutableCopy(this.current);
    }

    close(effectiveTo: string, now: Date): this {
        if (this.current.effectiveTo !== null)
            throw new DomainValidationError("Zone definition interval is already closed", {
                effectiveTo: ["This zone definition is not the current record"],
            });
        const boundary = normalizeInstant(effectiveTo, "Effective to");
        if (boundary <= this.current.effectiveFrom)
            throw new DomainValidationError("Effective-to must be after effective-from", {
                effectiveTo: ["A closing time must be after the record started"],
            });
        const next: ZoneDefinitionState = {
            ...this.current,
            effectiveTo: boundary,
            updatedAt: isoTimestamp(now, "Zone definition update time"),
        };
        validateState(next);
        this.current = immutableCopy(next);
        return this;
    }
}

/** The zone definition in force at `at` for a family series, or null. */
export function resolveEffectiveZoneDefinition(
    records: readonly ZoneDefinitionState[],
    at: string,
): ZoneDefinitionState | null {
    const instant = normalizeInstant(at, "Resolution instant");
    let match: ZoneDefinitionState | null = null;
    for (const record of records) {
        if (record.effectiveFrom > instant) continue;
        if (record.effectiveTo !== null && record.effectiveTo <= instant) continue;
        if (match === null || record.effectiveFrom > match.effectiveFrom) match = record;
    }
    return match ? immutableCopy(match) : null;
}

function validateState(state: ZoneDefinitionState): void {
    requiredUuid(state.id, "Zone definition ID");
    requiredUuid(state.profileId, "Profile ID");
    normalizeFamily(state.family);
    normalizeMethod(state.family, state.method);
    normalizeConfig(state.method, state.config);
    normalizeSource(state.source);
    if (state.ranges.length === 0)
        throw new DomainValidationError("A zone definition needs at least one range", {
            ranges: ["Add at least one zone range"],
        });
    normalizeRanges(state.ranges);
    optionalText(state.note, "Note", 500);
    normalizeInstant(state.effectiveFrom, "Effective from");
    if (state.effectiveTo !== null) {
        normalizeInstant(state.effectiveTo, "Effective to");
        if (state.effectiveTo <= state.effectiveFrom)
            throw new DomainValidationError("Effective-to must be after effective-from", {
                effectiveTo: ["A closing time must be after the record started"],
            });
    }
    isoTimestamp(new Date(state.createdAt), "Zone definition creation time");
    isoTimestamp(new Date(state.updatedAt), "Zone definition update time");
}

function normalizeRanges(ranges: readonly ZoneRangeInput[] | readonly ZoneRangeState[]): ZoneRangeState[] {
    const normalized = ranges.map(range => ({
        id: requiredUuid(range.id, "Zone range ID"),
        position: nonNegativeInteger(range.position, "Zone range position"),
        name: requiredText(range.name, "Zone range name", 60),
        lowerBound: nonNegativeDecimal(range.lowerBound, "Zone range lower bound"),
        upperBound: range.upperBound == null ? null : nonNegativeDecimal(range.upperBound, "Zone range upper bound"),
        lowerInclusive: range.lowerInclusive ?? true,
        upperInclusive: range.upperInclusive ?? false,
    }));
    const sorted = [...normalized].sort((a, b) => a.position - b.position);
    const positions = new Set<number>();
    for (let index = 0; index < sorted.length; index += 1) {
        const range = sorted[index]!;
        if (positions.has(range.position))
            throw new DomainValidationError("Zone range positions must be unique", {
                ranges: ["Each zone range needs a distinct position"],
            });
        positions.add(range.position);
        if (range.upperBound !== null && DecimalValue.from(range.upperBound).compare(range.lowerBound) <= 0)
            throw new DomainValidationError("A zone range upper bound must exceed its lower bound", {
                ranges: ["Upper bound must exceed lower bound"],
            });
        const next = sorted[index + 1];
        if (next) {
            if (range.upperBound === null)
                throw new DomainValidationError("Only the last zone range may be open-ended", {
                    ranges: ["Only the top zone may omit an upper bound"],
                });
            if (DecimalValue.from(range.upperBound).compare(next.lowerBound) > 0)
                throw new DomainValidationError("Zone ranges must not overlap", {
                    ranges: ["Zone ranges must be ordered and non-overlapping"],
                });
        }
    }
    return sorted;
}

function normalizeConfig(method: string, config: Record<string, number>): Record<string, number> {
    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(config)) {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
            throw new DomainValidationError(`Zone config '${key}' must be a positive number`, {
                config: [`${key} must be a positive number`],
            });
        normalized[key] = value;
    }
    for (const key of requiredConfigByMethod[method] ?? [])
        if (normalized[key] === undefined)
            throw new DomainValidationError(`Method '${method}' requires config value '${key}'`, {
                config: [`${key} is required for this method`],
            });
    if (method === "percent_hr_reserve" && normalized.maxHr! <= normalized.restingHr!)
        throw new DomainValidationError("Maximum heart rate must exceed resting heart rate", {
            config: ["maxHr must exceed restingHr"],
        });
    return normalized;
}

function normalizeFamily(value: ZoneFamily): ZoneFamily {
    if (!zoneFamilies.includes(value))
        throw new DomainValidationError(`Unknown zone family '${value}'`, { family: ["Unknown zone family"] });
    return value;
}

function normalizeMethod(family: ZoneFamily, value: ZoneMethod): ZoneMethod {
    const allowed = zoneMethodsByFamily[normalizeFamily(family)] as readonly string[];
    if (!allowed.includes(value))
        throw new DomainValidationError(`Method '${value}' is not valid for ${family} zones`, {
            method: [`Method must be one of: ${allowed.join(", ")}`],
        });
    return value;
}

function normalizeSource(value: ZoneSource): ZoneSource {
    if (!zoneSources.includes(value))
        throw new DomainValidationError(`Unknown zone source '${value}'`, { source: ["Unknown source"] });
    return value;
}

function nonNegativeDecimal(value: number | string, name: string): string {
    let decimal: DecimalValue;
    try {
        decimal = DecimalValue.from(value);
    } catch {
        throw new DomainValidationError(`${name} must be a number`, { ranges: [`${name} must be a number`] });
    }
    if (decimal.compare(0) < 0)
        throw new DomainValidationError(`${name} cannot be negative`, { ranges: [`${name} cannot be negative`] });
    return decimal.toString();
}

function nonNegativeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative integer`);
    return value;
}

function requiredText(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0 || normalized.length > maximumLength)
        throw new DomainValidationError(`${name} must be 1 to ${maximumLength} characters`);
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
