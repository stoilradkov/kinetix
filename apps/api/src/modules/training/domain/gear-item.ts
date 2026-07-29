import { DomainValidationError } from "#src/platform/domain/index";

import { Distance, MeasurementValidationError, type DistanceUnit } from "#src/modules/training/domain/measurement";

export const gearTypes = ["shoes", "equipment"] as const;
export const gearStatuses = ["active", "archived"] as const;
export const gearDistanceUnits = ["m", "km", "mi"] as const satisfies readonly DistanceUnit[];

export type GearType = (typeof gearTypes)[number];
export type GearStatus = (typeof gearStatuses)[number];
export type GearDistanceUnit = (typeof gearDistanceUnits)[number];

export interface GearDistanceInput {
    readonly value: number | string;
    readonly unit: GearDistanceUnit;
}

export interface GearItemState {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly gearType: GearType;
    readonly acquiredOn: string | null;
    readonly retiredOn: string | null;
    readonly distanceLimitM: string | null;
    readonly notes: string | null;
    readonly status: GearStatus;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateGearItemInput {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly gearType: GearType;
    readonly acquiredOn?: string | null;
    readonly retiredOn?: string | null;
    readonly distanceLimit?: GearDistanceInput | null;
    readonly notes?: string | null;
}

export interface UpdateGearItemInput {
    readonly name?: string;
    readonly gearType?: GearType;
    readonly acquiredOn?: string | null;
    readonly retiredOn?: string | null;
    readonly distanceLimit?: GearDistanceInput | null;
    readonly notes?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class GearItem {
    private constructor(private current: GearItemState) {}

    static create(input: CreateGearItemInput, now: Date): GearItem {
        const timestamp = isoTimestamp(now, "Gear item creation time");
        const state: GearItemState = {
            id: requiredUuid(input.id, "Gear item ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            name: requiredText(input.name, "Name", 120),
            gearType: normalizeType(input.gearType),
            acquiredOn: input.acquiredOn == null ? null : normalizeDate(input.acquiredOn, "Acquired date"),
            retiredOn: input.retiredOn == null ? null : normalizeDate(input.retiredOn, "Retired date"),
            distanceLimitM: input.distanceLimit == null ? null : positiveDistanceMetres(input.distanceLimit),
            notes: optionalText(input.notes, "Notes", 1_000),
            status: "active",
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new GearItem(immutableCopy(state));
    }

    static rehydrate(state: GearItemState): GearItem {
        const copied = immutableCopy(state);
        validateState(copied);
        return new GearItem(copied);
    }

    get state(): GearItemState {
        return immutableCopy(this.current);
    }

    update(input: UpdateGearItemInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.name !== undefined ? { name: requiredText(input.name, "Name", 120) } : {}),
            ...(input.gearType !== undefined ? { gearType: normalizeType(input.gearType) } : {}),
            ...(input.acquiredOn !== undefined
                ? { acquiredOn: input.acquiredOn === null ? null : normalizeDate(input.acquiredOn, "Acquired date") }
                : {}),
            ...(input.retiredOn !== undefined
                ? { retiredOn: input.retiredOn === null ? null : normalizeDate(input.retiredOn, "Retired date") }
                : {}),
            ...(input.distanceLimit !== undefined
                ? { distanceLimitM: input.distanceLimit === null ? null : positiveDistanceMetres(input.distanceLimit) }
                : {}),
            ...(input.notes !== undefined ? { notes: optionalText(input.notes, "Notes", 1_000) } : {}),
            updatedAt: isoTimestamp(now, "Gear item update time"),
        });
    }

    archive(now: Date): this {
        if (this.current.status === "archived") return this;
        return this.replace({
            ...this.current,
            status: "archived",
            archivedAt: isoTimestamp(now, "Gear item archive time"),
            updatedAt: isoTimestamp(now, "Gear item update time"),
        });
    }

    restore(now: Date): this {
        if (this.current.status === "active") return this;
        return this.replace({
            ...this.current,
            status: "active",
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Gear item update time"),
        });
    }

    private replace(state: GearItemState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: GearItemState): void {
    requiredUuid(state.id, "Gear item ID");
    requiredUuid(state.profileId, "Profile ID");
    requiredText(state.name, "Name", 120);
    normalizeType(state.gearType);
    normalizeStatus(state.status);
    if (state.acquiredOn !== null) normalizeDate(state.acquiredOn, "Acquired date");
    if (state.retiredOn !== null) {
        normalizeDate(state.retiredOn, "Retired date");
        if (state.acquiredOn !== null && state.retiredOn < state.acquiredOn)
            throw new DomainValidationError("Retired date cannot be before the acquired date", {
                retiredOn: ["Retired date cannot be before the acquired date"],
            });
    }
    if (state.distanceLimitM !== null) assertPositiveDistance(state.distanceLimitM);
    optionalText(state.notes, "Notes", 1_000);
    if ((state.status === "archived") !== (state.archivedAt !== null))
        throw new DomainValidationError("Archived gear must carry an archive timestamp");
    isoTimestamp(new Date(state.createdAt), "Gear item creation time");
    isoTimestamp(new Date(state.updatedAt), "Gear item update time");
}

function positiveDistanceMetres(input: GearDistanceInput): string {
    if (!gearDistanceUnits.includes(input.unit))
        throw new DomainValidationError(`Distance unit '${input.unit}' is not supported`);
    let metres;
    try {
        metres = Distance.from(input.value, input.unit).canonical;
    } catch (error) {
        if (error instanceof MeasurementValidationError)
            throw new DomainValidationError(error.message, { distanceLimit: [error.message] });
        throw error;
    }
    if (metres.compare(0) <= 0)
        throw new DomainValidationError("A distance limit must be greater than zero", {
            distanceLimit: ["Enter a positive distance"],
        });
    return metres.toString();
}

function assertPositiveDistance(value: string): void {
    if (Distance.fromCanonical(value).canonical.compare(0) <= 0)
        throw new DomainValidationError("A distance limit must be greater than zero");
}

function normalizeType(value: GearType): GearType {
    if (!gearTypes.includes(value))
        throw new DomainValidationError(`Unknown gear type '${value}'`, { gearType: ["Unknown gear type"] });
    return value;
}

function normalizeStatus(value: GearStatus): GearStatus {
    if (!gearStatuses.includes(value))
        throw new DomainValidationError(`Unknown gear status '${value}'`, { status: ["Unknown gear status"] });
    return value;
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

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}
