import { describe, expect, it } from "vitest";

import { distanceSchema, durationSchema, massSchema, paceSchema, rpeSchema } from "#src/index";

describe("measurement schemas", () => {
    it("accepts every public unit", () => {
        expect(massSchema.parse({ value: 10, unit: "lb" })).toEqual({ value: 10, unit: "lb" });
        for (const unit of ["m", "cm", "km", "mi"] as const)
            expect(distanceSchema.safeParse({ value: 1, unit }).success).toBe(true);
        for (const unit of ["ms", "s", "min", "h"] as const)
            expect(durationSchema.safeParse({ value: 1, unit }).success).toBe(true);
        expect(paceSchema.safeParse({ value: 5, unit: "min/km" }).success).toBe(true);
    });

    it("rejects invalid values and effort increments", () => {
        expect(massSchema.safeParse({ value: Number.NaN, unit: "kg" }).success).toBe(false);
        expect(distanceSchema.safeParse({ value: -1, unit: "m" }).success).toBe(false);
        expect(rpeSchema.safeParse(7.25).success).toBe(false);
        expect(rpeSchema.safeParse(7.5).success).toBe(true);
    });
});

import { healthResponseSchema } from "#src/index";

describe("healthResponseSchema", () => {
    it("preserves the health wire contract", () => {
        expect(
            healthResponseSchema.parse({
                status: "ok",
                service: "kinetix-api",
                timestamp: "2026-07-12T12:00:00.000Z",
            }),
        ).toMatchObject({ status: "ok", service: "kinetix-api" });
    });
});
