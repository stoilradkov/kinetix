import { DomainValidationError } from "#src/platform/domain/index";

import {
    DecimalValue,
    Mass,
    MeasurementValidationError,
    type MassUnit,
} from "#src/modules/training/domain/measurement";

export const equipmentIncrementScopes = ["default", "exercise", "equipment"] as const;
export const equipmentIncrementUnits = ["kg", "lb"] as const satisfies readonly MassUnit[];

export type EquipmentIncrementScope = (typeof equipmentIncrementScopes)[number];
export type EquipmentIncrementUnit = (typeof equipmentIncrementUnits)[number];

export interface EquipmentIncrementState {
    readonly id: string;
    readonly profileId: string;
    readonly scope: EquipmentIncrementScope;
    readonly exerciseId: string | null;
    readonly equipmentTypeId: string | null;
    readonly incrementKg: string;
    readonly minimumKg: string | null;
    readonly label: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface MassInputValue {
    readonly value: number | string;
    readonly unit: EquipmentIncrementUnit;
}

export interface CreateEquipmentIncrementInput {
    readonly id: string;
    readonly profileId: string;
    readonly scope: EquipmentIncrementScope;
    readonly exerciseId?: string | null;
    readonly equipmentTypeId?: string | null;
    readonly increment: MassInputValue;
    readonly minimum?: MassInputValue | null;
    readonly label?: string | null;
}

export interface UpdateEquipmentIncrementInput {
    readonly increment?: MassInputValue;
    readonly minimum?: MassInputValue | null;
    readonly label?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EquipmentIncrement {
    private constructor(private current: EquipmentIncrementState) {}

    static create(input: CreateEquipmentIncrementInput, now: Date): EquipmentIncrement {
        const timestamp = isoTimestamp(now, "Equipment increment creation time");
        const scope = normalizeScope(input.scope);
        const state: EquipmentIncrementState = {
            id: requiredUuid(input.id, "Equipment increment ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            scope,
            exerciseId: scopeTarget(scope, "exercise", input.exerciseId, "Exercise ID"),
            equipmentTypeId: scopeTarget(scope, "equipment", input.equipmentTypeId, "Equipment type ID"),
            incrementKg: positiveMassKg(input.increment, "Increment"),
            minimumKg: input.minimum == null ? null : nonNegativeMassKg(input.minimum, "Minimum"),
            label: optionalText(input.label, "Label", 80),
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new EquipmentIncrement(immutableCopy(state));
    }

    static rehydrate(state: EquipmentIncrementState): EquipmentIncrement {
        const copied = immutableCopy(state);
        validateState(copied);
        return new EquipmentIncrement(copied);
    }

    get state(): EquipmentIncrementState {
        return immutableCopy(this.current);
    }

    update(input: UpdateEquipmentIncrementInput, now: Date): this {
        const next: EquipmentIncrementState = {
            ...this.current,
            ...(input.increment !== undefined ? { incrementKg: positiveMassKg(input.increment, "Increment") } : {}),
            ...(input.minimum !== undefined
                ? { minimumKg: input.minimum === null ? null : nonNegativeMassKg(input.minimum, "Minimum") }
                : {}),
            ...(input.label !== undefined ? { label: optionalText(input.label, "Label", 80) } : {}),
            updatedAt: isoTimestamp(now, "Equipment increment update time"),
        };
        validateState(next);
        this.current = immutableCopy(next);
        return this;
    }
}

/**
 * Deterministic exercise-specific rounding: round a canonical kg load to the
 * nearest achievable value at or above the minimum, with ties rounding up
 * (toward the heavier load). Works in integer thousandths of a kilogram.
 */
export function roundLoadToIncrement(
    loadKg: number | string,
    increment: Pick<EquipmentIncrementState, "incrementKg" | "minimumKg">,
): string {
    const load = thousandths(loadKg, "Load");
    const step = thousandths(increment.incrementKg, "Increment");
    const base = increment.minimumKg === null ? 0n : thousandths(increment.minimumKg, "Minimum");
    if (step <= 0n) throw new DomainValidationError("Increment must be greater than zero");
    const diff = load - base;
    if (diff <= 0n) return fromThousandths(base);
    // floor((2*diff + step) / (2*step)) rounds halves up without floating point.
    const steps = (2n * diff + step) / (2n * step);
    return fromThousandths(base + steps * step);
}

function validateState(state: EquipmentIncrementState): void {
    requiredUuid(state.id, "Equipment increment ID");
    requiredUuid(state.profileId, "Profile ID");
    const scope = normalizeScope(state.scope);
    scopeTarget(scope, "exercise", state.exerciseId, "Exercise ID");
    scopeTarget(scope, "equipment", state.equipmentTypeId, "Equipment type ID");
    assertPositiveDecimal(state.incrementKg, "Increment");
    if (state.minimumKg !== null) assertNonNegativeDecimal(state.minimumKg, "Minimum");
    optionalText(state.label, "Label", 80);
    isoTimestamp(new Date(state.createdAt), "Equipment increment creation time");
    isoTimestamp(new Date(state.updatedAt), "Equipment increment update time");
}

function scopeTarget(
    scope: EquipmentIncrementScope,
    target: "exercise" | "equipment",
    value: string | null | undefined,
    name: string,
): string | null {
    if (scope === target) {
        if (value == null) throw new DomainValidationError(`${name} is required for a ${target}-scoped increment`);
        return requiredUuid(value, name);
    }
    if (value != null) throw new DomainValidationError(`${name} is only allowed for a ${target}-scoped increment`);
    return null;
}

function positiveMassKg(input: MassInputValue, name: string): string {
    const mass = massKg(input, name);
    if (mass.compare(0) <= 0)
        throw new DomainValidationError(`${name} must be greater than zero`, {
            increment: [`${name} must be positive`],
        });
    return mass.toString();
}

function nonNegativeMassKg(input: MassInputValue, name: string): string {
    const mass = massKg(input, name);
    if (mass.compare(0) < 0)
        throw new DomainValidationError(`${name} cannot be negative`, { minimum: [`${name} cannot be negative`] });
    return mass.toString();
}

function massKg(input: MassInputValue, name: string): DecimalValue {
    if (!equipmentIncrementUnits.includes(input.unit))
        throw new DomainValidationError(`${name} unit '${input.unit}' is not supported`);
    try {
        return Mass.from(input.value, input.unit).canonical;
    } catch (error) {
        if (error instanceof MeasurementValidationError)
            throw new DomainValidationError(error.message, { increment: [error.message] });
        throw error;
    }
}

function assertPositiveDecimal(value: string, name: string): void {
    if (DecimalValue.from(value).compare(0) <= 0) throw new DomainValidationError(`${name} must be greater than zero`);
}

function assertNonNegativeDecimal(value: string, name: string): void {
    if (DecimalValue.from(value).compare(0) < 0) throw new DomainValidationError(`${name} cannot be negative`);
}

function thousandths(value: number | string, name: string): bigint {
    let scaled: DecimalValue;
    try {
        scaled = DecimalValue.from(value).multiply(1000);
    } catch {
        throw new DomainValidationError(`${name} must be a number`);
    }
    if (scaled.scale !== 0) throw new DomainValidationError(`${name} must have at most three decimal places`);
    return scaled.coefficient;
}

function fromThousandths(value: bigint): string {
    return DecimalValue.from(value.toString()).divide(1000, 3).toString();
}

function normalizeScope(value: EquipmentIncrementScope): EquipmentIncrementScope {
    if (!equipmentIncrementScopes.includes(value))
        throw new DomainValidationError(`Unknown increment scope '${value}'`, { scope: ["Unknown scope"] });
    return value;
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
