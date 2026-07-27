import { DomainValidationError } from "#src/platform/domain/index";

export const profileStatuses = ["active", "archived"] as const;
export const profileSexes = ["female", "male", "intersex", "other"] as const;
export const massUnits = ["kg", "lb"] as const;
export const distanceUnits = ["km", "mi"] as const;
export const lengthUnits = ["cm", "in"] as const;

export type ProfileStatus = (typeof profileStatuses)[number];
export type ProfileSex = (typeof profileSexes)[number];
export type MassUnit = (typeof massUnits)[number];
export type DistanceUnit = (typeof distanceUnits)[number];
export type LengthUnit = (typeof lengthUnits)[number];

export interface UnitPreferences {
    readonly mass: MassUnit;
    readonly distance: DistanceUnit;
    readonly length: LengthUnit;
}

export interface CoreProfileState {
    readonly id: string;
    readonly status: ProfileStatus;
    readonly birthDate: string | null;
    readonly sex: ProfileSex | null;
    readonly heightMeters: string | null;
    readonly timeZone: string;
    readonly unitPreferences: UnitPreferences;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateCoreProfileInput {
    readonly id: string;
    readonly timeZone: string;
    readonly unitPreferences: UnitPreferences;
    readonly birthDate?: string | null;
    readonly sex?: ProfileSex | null;
    readonly heightMeters?: string | null;
}

export interface UpdateCoreProfileInput {
    readonly timeZone?: string;
    readonly unitPreferences?: UnitPreferences;
    readonly birthDate?: string | null;
    readonly sex?: ProfileSex | null;
    readonly heightMeters?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CANONICAL_METRES_PATTERN = /^\d+(?:\.\d{1,3})?$/;
const MAX_HEIGHT_METRES = 3;

export class CoreProfile {
    private constructor(private current: CoreProfileState) {}

    static create(input: CreateCoreProfileInput, now: Date): CoreProfile {
        const timestamp = isoTimestamp(now, "Core profile creation time");
        const state: CoreProfileState = {
            id: requiredUuid(input.id, "Core profile ID"),
            status: "active",
            birthDate: normalizeBirthDate(input.birthDate, now),
            sex: normalizeSex(input.sex),
            heightMeters: normalizeHeight(input.heightMeters),
            timeZone: requiredTimeZone(input.timeZone),
            unitPreferences: normalizeUnitPreferences(input.unitPreferences),
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new CoreProfile(immutableCopy(state));
    }

    static rehydrate(state: CoreProfileState): CoreProfile {
        const copied = immutableCopy(state);
        validateState(copied);
        return new CoreProfile(copied);
    }

    get state(): CoreProfileState {
        return immutableCopy(this.current);
    }

    update(input: UpdateCoreProfileInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.birthDate !== undefined ? { birthDate: normalizeBirthDate(input.birthDate, now) } : {}),
            ...(input.sex !== undefined ? { sex: normalizeSex(input.sex) } : {}),
            ...(input.heightMeters !== undefined ? { heightMeters: normalizeHeight(input.heightMeters) } : {}),
            ...(input.timeZone !== undefined ? { timeZone: requiredTimeZone(input.timeZone) } : {}),
            ...(input.unitPreferences !== undefined
                ? { unitPreferences: normalizeUnitPreferences(input.unitPreferences) }
                : {}),
            updatedAt: isoTimestamp(now, "Core profile update time"),
        });
    }

    archive(now: Date): this {
        if (this.current.status === "archived") throw new DomainValidationError("Core profile is already archived");
        const timestamp = isoTimestamp(now, "Core profile archive time");
        return this.replace({ ...this.current, status: "archived", archivedAt: timestamp, updatedAt: timestamp });
    }

    restore(now: Date): this {
        if (this.current.status === "active") throw new DomainValidationError("Core profile is already active");
        return this.replace({
            ...this.current,
            status: "active",
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Core profile restore time"),
        });
    }

    private replace(state: CoreProfileState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: CoreProfileState): void {
    requiredUuid(state.id, "Core profile ID");
    if (!profileStatuses.includes(state.status))
        throw new DomainValidationError(`Unknown core profile status '${state.status}'`);
    if (state.birthDate !== null) normalizeBirthDate(state.birthDate);
    if (state.sex !== null) normalizeSex(state.sex);
    if (state.heightMeters !== null) normalizeHeight(state.heightMeters);
    requiredTimeZone(state.timeZone);
    normalizeUnitPreferences(state.unitPreferences);
    isoTimestamp(new Date(state.createdAt), "Core profile creation time");
    isoTimestamp(new Date(state.updatedAt), "Core profile update time");
    if ((state.status === "active") !== (state.archivedAt === null))
        throw new DomainValidationError("Core profile archive state is inconsistent");
    if (state.archivedAt !== null) isoTimestamp(new Date(state.archivedAt), "Core profile archive time");
}

function normalizeBirthDate(value: string | null | undefined, now?: Date): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (!ISO_DATE_PATTERN.test(normalized))
        throw new DomainValidationError("Birth date must be an ISO calendar date (YYYY-MM-DD)", {
            birthDate: ["Use the YYYY-MM-DD format"],
        });
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized)
        throw new DomainValidationError(`Birth date '${normalized}' is not a real calendar date`, {
            birthDate: ["Enter a real calendar date"],
        });
    if (now && date.getTime() > now.getTime())
        throw new DomainValidationError("Birth date cannot be in the future", {
            birthDate: ["Birth date cannot be in the future"],
        });
    return normalized;
}

function normalizeSex(value: ProfileSex | null | undefined): ProfileSex | null {
    if (value == null) return null;
    if (!profileSexes.includes(value))
        throw new DomainValidationError(`Unknown sex '${value}'`, { sex: ["Unknown sex"] });
    return value;
}

function normalizeHeight(value: string | null | undefined): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (!CANONICAL_METRES_PATTERN.test(normalized))
        throw new DomainValidationError("Height must be a canonical metre value with up to three decimals", {
            heightMeters: ["Enter height in metres, e.g. 1.780"],
        });
    const metres = Number(normalized);
    if (!(metres > 0) || metres > MAX_HEIGHT_METRES)
        throw new DomainValidationError(`Height in metres must be greater than 0 and at most ${MAX_HEIGHT_METRES}`, {
            heightMeters: [`Height must be between 0 and ${MAX_HEIGHT_METRES} metres`],
        });
    return normalized;
}

function requiredTimeZone(value: string): string {
    const normalized = value.trim();
    if (normalized.length === 0)
        throw new DomainValidationError("Time zone is required", { timeZone: ["Time zone is required"] });
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: normalized });
    } catch {
        throw new DomainValidationError(`Time zone '${normalized}' is not a valid IANA time zone`, {
            timeZone: ["Use a valid IANA time zone, e.g. Europe/Sofia"],
        });
    }
    return normalized;
}

function normalizeUnitPreferences(value: UnitPreferences): UnitPreferences {
    return {
        mass: requireEnum(value?.mass, massUnits, "Mass unit"),
        distance: requireEnum(value?.distance, distanceUnits, "Distance unit"),
        length: requireEnum(value?.length, lengthUnits, "Length unit"),
    };
}

function requireEnum<Value extends string>(value: Value, allowed: readonly Value[], name: string): Value {
    if (!allowed.includes(value))
        throw new DomainValidationError(`${name} must be one of: ${allowed.join(", ")}`, {
            unitPreferences: [`${name} must be one of: ${allowed.join(", ")}`],
        });
    return value;
}

function requiredUuid(value: string, name: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
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
