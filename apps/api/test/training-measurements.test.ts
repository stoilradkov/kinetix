import { describe, expect, it } from "vitest";

import { mapMassInput, mapPaceInput, toMeasurementDto } from "#src/modules/training/application/index";
import {
    DecimalValue,
    Distance,
    Duration,
    Mass,
    MeasurementValidationError,
    Rir,
    Rpe,
    SubjectiveRating,
} from "#src/modules/training/domain/index";
import {
    measurementRowMapper,
    type CanonicalMeasurementRow,
} from "#src/modules/training/infrastructure/measurement-row-mapper";

describe("Training measurements", () => {
    it("converts supported units with decimal-safe canonical values", () => {
        expect(Mass.from("2.2", "lb").canonical.toString()).toBe("0.997903214");
        expect(Distance.from("1", "mi").canonical.toString()).toBe("1609.344");
        expect(Duration.from("1.5", "min").milliseconds).toBe(90000n);
        expect(DecimalValue.from("1.2300").toString()).toBe("1.23");
    });

    it("keeps entered provenance through application mapping", () => {
        expect(toMeasurementDto(mapMassInput({ value: 220, unit: "lb" }))).toEqual({
            canonicalValue: "99.7903214",
            canonicalUnit: "kg",
            entered: { value: 220, unit: "lb" },
        });
        expect(mapPaceInput({ value: 5, unit: "min/km" }).canonical.toString()).toBe("3.333333333333");
    });

    it("enforces scales and negative values", () => {
        expect(() => Rpe.from(7.25)).toThrow(MeasurementValidationError);
        expect(Rpe.from(7.5).value.toString()).toBe("7.5");
        expect(Rir.from(0).value).toBe(0);
        expect(SubjectiveRating.from(5).value).toBe(5);
        expect(() => Mass.from(-1, "kg")).toThrow(expect.objectContaining({ code: "MEASUREMENT_NEGATIVE" }));
    });

    it("preserves null separately from zero at the Drizzle boundary", () => {
        const row: CanonicalMeasurementRow = {
            massKg: "0",
            distanceM: null,
            durationMs: 0n,
            speedMps: null,
            powerW: null,
            heartRateBpm: null,
            cadenceRpm: null,
            rpe: null,
            rir: null,
            enteredMeasurements: {},
        };
        const mapped = measurementRowMapper.fromRow(row);
        expect(mapped.mass?.canonical.toString()).toBe("0");
        expect(mapped.duration?.milliseconds).toBe(0n);
        expect(mapped.distance).toBeNull();
    });
});
