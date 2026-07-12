const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export class MeasurementValidationError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = "MeasurementValidationError";
        this.code = code;
    }
}

/** Exact base-10 value used at every persistence and conversion boundary. */
export class DecimalValue {
    readonly coefficient: bigint;
    readonly scale: number;

    private constructor(coefficient: bigint, scale: number) {
        let normalizedCoefficient = coefficient;
        let normalizedScale = scale;
        while (normalizedScale > 0 && normalizedCoefficient % 10n === 0n) {
            normalizedCoefficient /= 10n;
            normalizedScale -= 1;
        }
        this.coefficient = normalizedCoefficient;
        this.scale = normalizedScale;
        Object.freeze(this);
    }

    static from(value: DecimalValue | string | number | bigint): DecimalValue {
        if (value instanceof DecimalValue) return value;
        if (typeof value === "bigint") return new DecimalValue(value, 0);
        if (typeof value === "number" && !Number.isFinite(value)) {
            throw new MeasurementValidationError("MEASUREMENT_NOT_FINITE", "Measurement must be finite");
        }
        const source = String(value);
        if (!DECIMAL_PATTERN.test(source)) {
            throw new MeasurementValidationError("MEASUREMENT_INVALID_DECIMAL", "Measurement must be a decimal number");
        }
        const [mantissa, exponentText = "0"] = source.toLowerCase().split("e");
        const negative = mantissa!.startsWith("-");
        const unsigned = mantissa!.replace(/^[+-]/, "");
        const [whole, fraction = ""] = unsigned.split(".");
        const exponent = Number(exponentText);
        const digits = `${whole || "0"}${fraction}`.replace(/^0+(?=\d)/, "");
        const scale = fraction.length - exponent;
        const coefficient = BigInt(`${negative ? "-" : ""}${digits || "0"}`);
        return scale < 0
            ? new DecimalValue(coefficient * 10n ** BigInt(-scale), 0)
            : new DecimalValue(coefficient, scale);
    }

    multiply(value: DecimalValue | string | number | bigint): DecimalValue {
        const other = DecimalValue.from(value);
        return new DecimalValue(this.coefficient * other.coefficient, this.scale + other.scale);
    }

    divide(value: DecimalValue | string | number | bigint, scale = 12): DecimalValue {
        const other = DecimalValue.from(value);
        if (other.coefficient === 0n)
            throw new MeasurementValidationError("MEASUREMENT_DIVIDE_BY_ZERO", "Cannot divide by zero");
        const numerator = this.coefficient * 10n ** BigInt(scale + other.scale);
        const denominator = other.coefficient * 10n ** BigInt(this.scale);
        return new DecimalValue(numerator / denominator, scale);
    }

    compare(value: DecimalValue | string | number | bigint): number {
        const other = DecimalValue.from(value);
        const scale = Math.max(this.scale, other.scale);
        const left = this.coefficient * 10n ** BigInt(scale - this.scale);
        const right = other.coefficient * 10n ** BigInt(scale - other.scale);
        return left < right ? -1 : left > right ? 1 : 0;
    }

    toString(): string {
        const negative = this.coefficient < 0n;
        const digits = (negative ? -this.coefficient : this.coefficient).toString().padStart(this.scale + 1, "0");
        const value = this.scale === 0 ? digits : `${digits.slice(0, -this.scale)}.${digits.slice(-this.scale)}`;
        return `${negative ? "-" : ""}${value}`;
    }

    toNumber(): number {
        return Number(this.toString());
    }
}

export type DecimalInput = string | number | bigint | DecimalValue;
export type MassUnit = "kg" | "lb";
export type DistanceUnit = "m" | "cm" | "km" | "mi";
export type DurationUnit = "ms" | "s" | "min" | "h";
export type SpeedUnit = "m/s" | "km/h" | "mph";

function nonNegative(value: DecimalInput, field: string): DecimalValue {
    const decimal = DecimalValue.from(value);
    if (decimal.compare(0) < 0)
        throw new MeasurementValidationError("MEASUREMENT_NEGATIVE", `${field} cannot be negative`);
    return decimal;
}

abstract class CanonicalDecimalMeasurement<U extends string> {
    protected constructor(
        readonly canonical: DecimalValue,
        readonly enteredValue: DecimalValue,
        readonly enteredUnit: U,
    ) {
        Object.freeze(this);
    }
}

const massFactors: Record<MassUnit, string> = { kg: "1", lb: "0.45359237" };
export class Mass extends CanonicalDecimalMeasurement<MassUnit> {
    static from(value: DecimalInput, unit: MassUnit): Mass {
        const entered = nonNegative(value, "Mass");
        return new Mass(entered.multiply(massFactors[unit]), entered, unit);
    }
    static fromCanonical(value: DecimalInput, enteredValue: DecimalInput = value, enteredUnit: MassUnit = "kg"): Mass {
        return new Mass(nonNegative(value, "Mass"), nonNegative(enteredValue, "Mass"), enteredUnit);
    }
}

const distanceFactors: Record<DistanceUnit, string> = { m: "1", cm: "0.01", km: "1000", mi: "1609.344" };
export class Distance extends CanonicalDecimalMeasurement<DistanceUnit> {
    static from(value: DecimalInput, unit: DistanceUnit): Distance {
        const entered = nonNegative(value, "Distance");
        return new Distance(entered.multiply(distanceFactors[unit]), entered, unit);
    }
    static fromCanonical(
        value: DecimalInput,
        enteredValue: DecimalInput = value,
        enteredUnit: DistanceUnit = "m",
    ): Distance {
        return new Distance(nonNegative(value, "Distance"), nonNegative(enteredValue, "Distance"), enteredUnit);
    }
}

const durationFactors: Record<DurationUnit, string> = { ms: "1", s: "1000", min: "60000", h: "3600000" };
export class Duration extends CanonicalDecimalMeasurement<DurationUnit> {
    static from(value: DecimalInput, unit: DurationUnit): Duration {
        const entered = nonNegative(value, "Duration");
        const milliseconds = entered.multiply(durationFactors[unit]);
        if (milliseconds.scale !== 0)
            throw new MeasurementValidationError(
                "DURATION_SUB_MILLISECOND",
                "Duration must resolve to whole milliseconds",
            );
        return new Duration(milliseconds, entered, unit);
    }
    static fromCanonical(
        milliseconds: bigint,
        enteredValue: DecimalInput = milliseconds,
        enteredUnit: DurationUnit = "ms",
    ): Duration {
        return new Duration(nonNegative(milliseconds, "Duration"), nonNegative(enteredValue, "Duration"), enteredUnit);
    }
    get milliseconds(): bigint {
        return this.canonical.coefficient;
    }
}

const speedFactors: Record<SpeedUnit, string> = { "m/s": "1", "km/h": "0.277777777777", mph: "0.44704" };
export class Speed extends CanonicalDecimalMeasurement<SpeedUnit> {
    static from(value: DecimalInput, unit: SpeedUnit): Speed {
        const entered = nonNegative(value, "Speed");
        return new Speed(entered.multiply(speedFactors[unit]), entered, unit);
    }
    static fromPace(duration: Duration, distance: Distance): Speed {
        if (distance.canonical.compare(0) === 0)
            throw new MeasurementValidationError("PACE_ZERO_DISTANCE", "Pace requires a positive distance");
        const canonical = distance.canonical.divide(duration.canonical.divide(1000));
        return new Speed(canonical, canonical, "m/s");
    }
    static fromCanonical(value: DecimalInput): Speed {
        const canonical = nonNegative(value, "Speed");
        return new Speed(canonical, canonical, "m/s");
    }
}

export class Power extends CanonicalDecimalMeasurement<"W"> {
    static watts(value: DecimalInput): Power {
        const v = nonNegative(value, "Power");
        return new Power(v, v, "W");
    }
}

function integerInRange(value: number, min: number, max: number, code: string): number {
    if (!Number.isInteger(value) || value < min || value > max)
        throw new MeasurementValidationError(code, `Value must be a whole number from ${min} to ${max}`);
    return value;
}

export class HeartRate {
    private constructor(readonly bpm: number) {
        Object.freeze(this);
    }
    static bpm(value: number): HeartRate {
        return new HeartRate(integerInRange(value, 0, 999, "HEART_RATE_OUT_OF_RANGE"));
    }
}
export class Cadence {
    private constructor(readonly rpm: number) {
        Object.freeze(this);
    }
    static rpm(value: number): Cadence {
        return new Cadence(integerInRange(value, 0, 999, "CADENCE_OUT_OF_RANGE"));
    }
}
export class Percentage {
    private constructor(readonly value: DecimalValue) {
        Object.freeze(this);
    }
    static from(value: DecimalInput): Percentage {
        const v = DecimalValue.from(value);
        if (v.compare(0) < 0 || v.compare(100) > 0)
            throw new MeasurementValidationError("PERCENTAGE_OUT_OF_RANGE", "Percentage must be from 0 to 100");
        return new Percentage(v);
    }
    get ratio(): DecimalValue {
        return this.value.divide(100);
    }
}
export class Rpe {
    private constructor(readonly value: DecimalValue) {
        Object.freeze(this);
    }
    static from(value: DecimalInput): Rpe {
        const v = DecimalValue.from(value);
        if (v.compare(1) < 0 || v.compare(10) > 0 || v.multiply(2).scale !== 0)
            throw new MeasurementValidationError("RPE_OUT_OF_RANGE", "RPE must be from 1 to 10 in 0.5 increments");
        return new Rpe(v);
    }
}
export class Rir {
    private constructor(readonly value: number) {
        Object.freeze(this);
    }
    static from(value: number): Rir {
        return new Rir(integerInRange(value, 0, 10, "RIR_OUT_OF_RANGE"));
    }
}
export class SubjectiveRating {
    private constructor(readonly value: number) {
        Object.freeze(this);
    }
    static from(value: number): SubjectiveRating {
        return new SubjectiveRating(integerInRange(value, 1, 5, "SUBJECTIVE_RATING_OUT_OF_RANGE"));
    }
}
export class PainRating {
    private constructor(readonly value: number) {
        Object.freeze(this);
    }
    static from(value: number): PainRating {
        return new PainRating(integerInRange(value, 0, 10, "PAIN_RATING_OUT_OF_RANGE"));
    }
}

export function assertRange<T extends { canonical: DecimalValue }>(minimum: T, maximum: T): void {
    if (minimum.constructor !== maximum.constructor)
        throw new MeasurementValidationError(
            "MEASUREMENT_INCOMPATIBLE",
            "Range bounds must use compatible measurements",
        );
    if (minimum.canonical.compare(maximum.canonical) > 0)
        throw new MeasurementValidationError("MEASUREMENT_RANGE_REVERSED", "Minimum cannot exceed maximum");
}
