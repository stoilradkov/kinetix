import { bigint, check, integer, jsonb, numeric, smallint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Promoted measurement columns for Training-owned tables. Call per table. */
export const trainingMeasurementColumns = () => ({
    massKg: numeric("mass_kg", { precision: 12, scale: 3 }),
    distanceM: numeric("distance_m", { precision: 14, scale: 3 }),
    durationMs: bigint("duration_ms", { mode: "bigint" }),
    speedMps: numeric("speed_mps", { precision: 12, scale: 4 }),
    powerW: numeric("power_w", { precision: 12, scale: 2 }),
    heartRateBpm: integer("heart_rate_bpm"),
    cadenceRpm: integer("cadence_rpm"),
    rpe: numeric("rpe", { precision: 3, scale: 1 }),
    rir: smallint("rir"),
    subjectiveRating: smallint("subjective_rating"),
    painRating: smallint("pain_rating"),
    percentage: numeric("percentage", { precision: 8, scale: 5 }),
    enteredMeasurements: jsonb("entered_measurements")
        .$type<Record<string, { value: number | string; unit: string }>>()
        .notNull()
        .default({}),
});

/** Critical checks mirrored from domain factories. Attach these to each owning table. */
export const trainingMeasurementChecks = (table: ReturnType<typeof trainingMeasurementColumns>) => [
    check("mass_nonnegative", sql`${table.massKg} is null or ${table.massKg} >= 0`),
    check("distance_nonnegative", sql`${table.distanceM} is null or ${table.distanceM} >= 0`),
    check("duration_nonnegative", sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
    check("speed_nonnegative", sql`${table.speedMps} is null or ${table.speedMps} >= 0`),
    check("power_nonnegative", sql`${table.powerW} is null or ${table.powerW} >= 0`),
    check(
        "rpe_range_step",
        sql`${table.rpe} is null or (${table.rpe} between 1 and 10 and mod(${table.rpe}, 0.5) = 0)`,
    ),
    check("rir_range", sql`${table.rir} is null or ${table.rir} between 0 and 10`),
    check(
        "subjective_rating_range",
        sql`${table.subjectiveRating} is null or ${table.subjectiveRating} between 1 and 5`,
    ),
    check("pain_rating_range", sql`${table.painRating} is null or ${table.painRating} between 0 and 10`),
    check("percentage_range", sql`${table.percentage} is null or ${table.percentage} between 0 and 100`),
];
