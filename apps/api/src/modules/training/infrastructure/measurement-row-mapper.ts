import {
    Cadence,
    Distance,
    Duration,
    HeartRate,
    Mass,
    Power,
    Rir,
    Rpe,
    Speed,
    type DecimalInput,
} from "#src/modules/training/domain/index";

export type EnteredMeasurement = Readonly<{ value: number | string; unit: string }>;

/** Shape shared by Training persistence adapters; numeric columns intentionally remain strings. */
export interface CanonicalMeasurementRow {
    massKg: string | null;
    distanceM: string | null;
    durationMs: bigint | null;
    speedMps: string | null;
    powerW: string | null;
    heartRateBpm: number | null;
    cadenceRpm: number | null;
    rpe: string | null;
    rir: number | null;
    enteredMeasurements: Record<string, EnteredMeasurement>;
}

const entered = (value: DecimalInput, unit: string): EnteredMeasurement => ({ value: String(value), unit });

export const measurementRowMapper = {
    mass(value: Mass): Pick<CanonicalMeasurementRow, "massKg" | "enteredMeasurements"> {
        return {
            massKg: value.canonical.toString(),
            enteredMeasurements: { mass: entered(value.enteredValue, value.enteredUnit) },
        };
    },
    distance(value: Distance): Pick<CanonicalMeasurementRow, "distanceM" | "enteredMeasurements"> {
        return {
            distanceM: value.canonical.toString(),
            enteredMeasurements: { distance: entered(value.enteredValue, value.enteredUnit) },
        };
    },
    duration(value: Duration): Pick<CanonicalMeasurementRow, "durationMs" | "enteredMeasurements"> {
        return {
            durationMs: value.milliseconds,
            enteredMeasurements: { duration: entered(value.enteredValue, value.enteredUnit) },
        };
    },
    speed(value: Speed): Pick<CanonicalMeasurementRow, "speedMps" | "enteredMeasurements"> {
        return {
            speedMps: value.canonical.toString(),
            enteredMeasurements: { speed: entered(value.enteredValue, value.enteredUnit) },
        };
    },
    power(value: Power): Pick<CanonicalMeasurementRow, "powerW" | "enteredMeasurements"> {
        return {
            powerW: value.canonical.toString(),
            enteredMeasurements: { power: entered(value.enteredValue, value.enteredUnit) },
        };
    },
    fromRow(row: CanonicalMeasurementRow) {
        return {
            mass: row.massKg === null ? null : Mass.fromCanonical(row.massKg),
            distance: row.distanceM === null ? null : Distance.fromCanonical(row.distanceM),
            duration: row.durationMs === null ? null : Duration.fromCanonical(row.durationMs),
            speed: row.speedMps === null ? null : Speed.fromCanonical(row.speedMps),
            power: row.powerW === null ? null : Power.watts(row.powerW),
            heartRate: row.heartRateBpm === null ? null : HeartRate.bpm(row.heartRateBpm),
            cadence: row.cadenceRpm === null ? null : Cadence.rpm(row.cadenceRpm),
            rpe: row.rpe === null ? null : Rpe.from(row.rpe),
            rir: row.rir === null ? null : Rir.from(row.rir),
        };
    },
};
