import { z } from "zod";

const finiteNonNegative = z.number().nonnegative();
export const massSchema = z.object({ value: finiteNonNegative, unit: z.enum(["kg", "lb"]) }).strict();
export const distanceSchema = z.object({ value: finiteNonNegative, unit: z.enum(["m", "cm", "km", "mi"]) }).strict();
export const durationSchema = z.object({ value: finiteNonNegative, unit: z.enum(["ms", "s", "min", "h"]) }).strict();
export const speedSchema = z.object({ value: finiteNonNegative, unit: z.enum(["m/s", "km/h", "mph"]) }).strict();
export const paceSchema = z
    .object({ value: finiteNonNegative.positive(), unit: z.enum(["min/km", "min/mi"]) })
    .strict();
export const speedOrPaceSchema = z.union([speedSchema, paceSchema]);
export const powerSchema = z.object({ value: finiteNonNegative, unit: z.literal("W") }).strict();
export const heartRateSchema = z.number().int().min(0).max(999);
export const cadenceSchema = z.number().int().min(0).max(999);
export const percentageSchema = z.number().min(0).max(100);
export const rpeSchema = z
    .number()
    .min(1)
    .max(10)
    .refine(value => value * 2 === Math.trunc(value * 2), "RPE must use 0.5 increments");
export const rirSchema = z.number().int().min(0).max(10);
export const subjectiveRatingSchema = z.number().int().min(1).max(5);
export const painRatingSchema = z.number().int().min(0).max(10);

export const measurementRangeSchema = <T extends z.ZodType>(valueSchema: T) =>
    z
        .object({ min: valueSchema, max: valueSchema })
        .strict()
        .refine(
            range => {
                const bounds = range as { min: unknown; max: unknown };
                return comparable(bounds.min) <= comparable(bounds.max);
            },
            { message: "Minimum cannot exceed maximum", path: ["max"] },
        );

function comparable(value: unknown): number {
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && "value" in value && typeof value.value === "number") return value.value;
    return Number.NaN;
}

export const measurementErrorCodeSchema = z.enum([
    "MEASUREMENT_NOT_FINITE",
    "MEASUREMENT_INVALID_DECIMAL",
    "MEASUREMENT_NEGATIVE",
    "MEASUREMENT_OUT_OF_RANGE",
    "MEASUREMENT_INCOMPATIBLE",
    "MEASUREMENT_RANGE_REVERSED",
]);

export type MassInput = z.infer<typeof massSchema>;
export type DistanceInput = z.infer<typeof distanceSchema>;
export type DurationInput = z.infer<typeof durationSchema>;
export type SpeedInput = z.infer<typeof speedSchema>;
export type PaceInput = z.infer<typeof paceSchema>;
export type PowerInput = z.infer<typeof powerSchema>;

/** JSON response shape; canonical remains a decimal string until serialization is explicitly requested. */
export const canonicalMeasurementResponseSchema = z.object({
    canonicalValue: z.string(),
    canonicalUnit: z.enum(["kg", "m", "ms", "m/s", "W", "bpm", "rpm", "%"]),
    entered: z.object({ value: z.number(), unit: z.string() }).nullable(),
});
