import { describe, expect, it } from "vitest";

import {
    ONE_RM_FORMULAS,
    estimate1RM,
    is1RMEligibleReps,
    median,
    oneRmEstimate,
    roundKg,
} from "#src/modules/training/domain/estimated-1rm";

/**
 * Golden vectors for the six retained estimated-1RM formulas and the primary median (issue #45, A3;
 * design §16.5, §21). The expected values are the published formulas rounded to the canonical 0.01 kg.
 */
describe("estimated-1RM formulas — golden vectors", () => {
    it("scores every formula for 100 kg × 5 reps", () => {
        const estimate = oneRmEstimate(100, 5);
        expect(estimate.formulas).toEqual({
            epley: 116.67,
            brzycki: 112.5,
            lombardi: 117.46,
            mayhew: 119.01,
            oconner: 112.5,
            wathan: 116.58,
        });
        // median of [112.5, 112.5, 116.58, 116.67, 117.46, 119.01] = mean(116.58, 116.67)
        expect(estimate.primary).toBe(116.63);
    });

    it("is the identity for Brzycki/Lombardi at a single repetition and disagrees otherwise", () => {
        const estimate = oneRmEstimate(100, 1);
        expect(estimate.formulas).toEqual({
            epley: 103.33,
            brzycki: 100,
            lombardi: 100,
            mayhew: 108.86,
            oconner: 102.5,
            wathan: 101.3,
        });
        expect(estimate.primary).toBe(101.9);
    });

    it("holds at the boundary rep counts and other loads", () => {
        expect(oneRmEstimate(140, 3).primary).toBe(153.29);
        expect(oneRmEstimate(60, 10).primary).toBe(79.28);
        expect(oneRmEstimate(100, 12).primary).toBe(137.7);
    });

    it("returns null for a non-positive load or sub-1 rep count", () => {
        for (const formula of ONE_RM_FORMULAS) {
            expect(estimate1RM(0, 5, formula)).toBeNull();
            expect(estimate1RM(-10, 5, formula)).toBeNull();
            expect(estimate1RM(100, 0, formula)).toBeNull();
        }
    });
});

describe("median — odd and even counts, ties, precision", () => {
    it("returns the middle value for an odd count", () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([5])).toBe(5);
    });

    it("averages the two central values for an even count", () => {
        expect(median([1, 2, 3, 4])).toBe(2.5);
        expect(median([116.58, 116.67])).toBeCloseTo(116.625, 5);
    });

    it("handles ties without collapsing them", () => {
        expect(median([2, 2, 2, 4])).toBe(2);
    });

    it("ignores non-finite inputs and returns null for an empty set", () => {
        expect(median([Number.NaN, 5, Number.POSITIVE_INFINITY])).toBe(5);
        expect(median([])).toBeNull();
    });
});

describe("1RM repetition eligibility window", () => {
    it("accepts integer reps within [min, cutoff] and rejects the rest", () => {
        expect(is1RMEligibleReps(1, 1, 12)).toBe(true);
        expect(is1RMEligibleReps(12, 1, 12)).toBe(true);
        expect(is1RMEligibleReps(13, 1, 12)).toBe(false);
        expect(is1RMEligibleReps(0, 1, 12)).toBe(false);
        expect(is1RMEligibleReps(5.5, 1, 12)).toBe(false);
    });

    it("honours a configured cutoff override", () => {
        expect(is1RMEligibleReps(8, 1, 5)).toBe(false);
        expect(is1RMEligibleReps(5, 1, 5)).toBe(true);
    });
});

describe("roundKg", () => {
    it("rounds to the canonical 0.01 kg", () => {
        expect(roundKg(116.625)).toBe(116.63);
        expect(roundKg(100)).toBe(100);
        expect(roundKg(112.5)).toBe(112.5);
    });
});
