import { describe, expect, it } from "vitest";

import type { ManualHealthRecordResponse } from "@kinetix/types";

import {
    fromLocalDateTime,
    healthRecordCreateInput,
    healthRecordFormDefaults,
    healthRecordFormSchema,
    healthRecordUpdateInput,
    toLocalDateTime,
    type HealthRecordFormValues,
} from "@/lib/health-record-form";

function values(overrides: Partial<HealthRecordFormValues> = {}): HealthRecordFormValues {
    return {
        type: "body_weight",
        effectiveAt: "2026-07-28T06:30",
        timeZone: "",
        notes: "",
        massKg: "82.5",
        beatsPerMinute: "",
        sleepStart: "",
        sleepEnd: "",
        score: "",
        scaleMin: "0",
        scaleMax: "100",
        ...overrides,
    };
}

describe("health record form schema", () => {
    it("accepts a valid reading per type", () => {
        expect(healthRecordFormSchema.safeParse(values()).success).toBe(true);
        expect(
            healthRecordFormSchema.safeParse(values({ type: "resting_heart_rate", beatsPerMinute: "52" })).success,
        ).toBe(true);
        expect(
            healthRecordFormSchema.safeParse(
                values({
                    type: "sleep",
                    effectiveAt: "",
                    sleepStart: "2026-07-27T22:00",
                    sleepEnd: "2026-07-28T06:00",
                }),
            ).success,
        ).toBe(true);
        expect(healthRecordFormSchema.safeParse(values({ type: "daily_readiness", score: "74" })).success).toBe(true);
    });

    it("rejects out-of-range readings and bad interval/time zone", () => {
        expect(healthRecordFormSchema.safeParse(values({ massKg: "0" })).success).toBe(false);
        expect(healthRecordFormSchema.safeParse(values({ massKg: "1001" })).success).toBe(false);
        expect(
            healthRecordFormSchema.safeParse(values({ type: "resting_heart_rate", beatsPerMinute: "10" })).success,
        ).toBe(false);
        expect(healthRecordFormSchema.safeParse(values({ type: "daily_readiness", score: "120" })).success).toBe(false);
        expect(
            healthRecordFormSchema.safeParse(
                values({
                    type: "sleep",
                    effectiveAt: "",
                    sleepStart: "2026-07-28T06:00",
                    sleepEnd: "2026-07-27T22:00",
                }),
            ).success,
        ).toBe(false);
        expect(healthRecordFormSchema.safeParse(values({ timeZone: "Mars/Olympus" })).success).toBe(false);
        expect(healthRecordFormSchema.safeParse(values({ effectiveAt: "2026-13-40T06:30" })).success).toBe(false);
    });
});

describe("health record form mappers", () => {
    it("round-trips a body-weight record into and out of form values", () => {
        const record: ManualHealthRecordResponse = {
            id: "0198a4db-d8da-7000-8000-0000000000b1",
            profileId: "0198a4db-d8da-7000-8000-0000000000b9",
            type: "body_weight",
            source: "manual",
            effectiveAt: fromLocalDateTime("2026-07-28T06:30"),
            timeZone: "Europe/Sofia",
            notes: "morning",
            body: { type: "body_weight", massKg: 82.5 },
            bodySchemaVersion: 1,
            archivedAt: null,
            version: 2,
            createdAt: "2026-07-28T12:00:00.000Z",
            updatedAt: "2026-07-28T12:00:00.000Z",
        };
        expect(healthRecordFormDefaults(record)).toMatchObject({
            type: "body_weight",
            effectiveAt: "2026-07-28T06:30",
            timeZone: "Europe/Sofia",
            notes: "morning",
            massKg: "82.5",
        });
    });

    it("builds a body-weight create request with a canonical instant", () => {
        const input = healthRecordCreateInput(values({ timeZone: "  ", notes: "  " }));
        expect(input.body).toEqual({ type: "body_weight", massKg: 82.5 });
        expect(toLocalDateTime(input.effectiveAt)).toBe("2026-07-28T06:30");
        expect(input).not.toHaveProperty("timeZone");
        expect(input).not.toHaveProperty("notes");
    });

    it("uses the sleep end as the record's effective instant", () => {
        const input = healthRecordCreateInput(
            values({ type: "sleep", effectiveAt: "", sleepStart: "2026-07-27T22:00", sleepEnd: "2026-07-28T06:00" }),
        );
        expect(input.body).toEqual({
            type: "sleep",
            startAt: fromLocalDateTime("2026-07-27T22:00"),
            endAt: fromLocalDateTime("2026-07-28T06:00"),
        });
        expect(input.effectiveAt).toBe(fromLocalDateTime("2026-07-28T06:00"));
    });

    it("clears blank optionals with explicit null when updating", () => {
        const input = healthRecordUpdateInput(values({ timeZone: "", notes: "" }));
        expect(input).toMatchObject({ timeZone: null, notes: null, body: { type: "body_weight", massKg: 82.5 } });
    });
});
