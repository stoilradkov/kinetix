import { Distance, Duration, Mass, Power, Speed } from "#src/modules/training/domain/index";

export type MassCommandValue = Readonly<{ value: number; unit: "kg" | "lb" }>;
export type DistanceCommandValue = Readonly<{ value: number; unit: "m" | "cm" | "km" | "mi" }>;
export type DurationCommandValue = Readonly<{ value: number; unit: "ms" | "s" | "min" | "h" }>;
export type PowerCommandValue = Readonly<{ value: number; unit: "W" }>;
export type SpeedCommandValue = Readonly<{ value: number; unit: "m/s" | "km/h" | "mph" }>;
export type PaceCommandValue = Readonly<{ value: number; unit: "min/km" | "min/mi" }>;

export type MeasurementDto = Readonly<{
    canonicalValue: string;
    canonicalUnit: "kg" | "m" | "ms" | "m/s" | "W";
    entered: Readonly<{ value: number; unit: string }>;
}>;

export const mapMassInput = (input: MassCommandValue): Mass => Mass.from(input.value, input.unit);
export const mapDistanceInput = (input: DistanceCommandValue): Distance => Distance.from(input.value, input.unit);
export const mapDurationInput = (input: DurationCommandValue): Duration => Duration.from(input.value, input.unit);
export const mapPowerInput = (input: PowerCommandValue): Power => Power.watts(input.value);
export const mapSpeedInput = (input: SpeedCommandValue): Speed => Speed.from(input.value, input.unit);
export const mapPaceInput = (input: PaceCommandValue): Speed => {
    const distance = Distance.from(1, input.unit === "min/km" ? "km" : "mi");
    return Speed.fromPace(Duration.from(input.value, "min"), distance);
};

export function toMeasurementDto(measurement: Mass | Distance | Duration | Speed | Power): MeasurementDto {
    const canonicalUnit =
        measurement instanceof Mass
            ? "kg"
            : measurement instanceof Distance
              ? "m"
              : measurement instanceof Duration
                ? "ms"
                : measurement instanceof Speed
                  ? "m/s"
                  : "W";
    return {
        canonicalValue: measurement.canonical.toString(),
        canonicalUnit,
        entered: { value: measurement.enteredValue.toNumber(), unit: measurement.enteredUnit },
    };
}
