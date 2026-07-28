import { describe, expect, it } from "vitest";

import {
    ManualHealthRecord,
    promoteHealthRecord,
    sleepDurationMinutes,
    type CreateManualHealthRecordInput,
    type HealthRecordBody,
} from "#src/modules/health-data/domain/index";

const ids = {
    record: "0198a4db-d8da-7000-8000-0000000000a1",
    profile: "0198a4db-d8da-7000-8000-0000000000a2",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function input(
    body: HealthRecordBody,
    overrides: Partial<CreateManualHealthRecordInput> = {},
): CreateManualHealthRecordInput {
    return {
        id: ids.record,
        profileId: ids.profile,
        effectiveAt: "2026-07-28T06:30:00.000Z",
        body,
        ...overrides,
    };
}

describe("ManualHealthRecord", () => {
    it("creates a manual body-weight record and promotes its mass", () => {
        const record = ManualHealthRecord.create(input({ type: "body_weight", massKg: 82.126 }), now);
        expect(record.state).toMatchObject({
            id: ids.record,
            profileId: ids.profile,
            type: "body_weight",
            source: "manual",
            effectiveAt: "2026-07-28T06:30:00.000Z",
            archivedAt: null,
            body: { type: "body_weight", massKg: 82.126 },
        });
        expect(promoteHealthRecord(record.state).massKg).toBe(82.126);
    });

    it("normalizes the effective instant and an IANA time zone", () => {
        const record = ManualHealthRecord.create(
            input(
                { type: "resting_heart_rate", beatsPerMinute: 52 },
                {
                    effectiveAt: "2026-07-28T08:30:00+02:00",
                    timeZone: "Europe/Berlin",
                },
            ),
            now,
        );
        expect(record.state.effectiveAt).toBe("2026-07-28T06:30:00.000Z");
        expect(record.state.timeZone).toBe("Europe/Berlin");
    });

    it("rejects an unknown time zone", () => {
        expect(() =>
            ManualHealthRecord.create(
                input({ type: "resting_heart_rate", beatsPerMinute: 52 }, { timeZone: "Mars/Olympus" }),
                now,
            ),
        ).toThrow(/time zone/i);
    });

    it("validates body-weight and resting-heart-rate ranges", () => {
        expect(() => ManualHealthRecord.create(input({ type: "body_weight", massKg: 0 }), now)).toThrow(/body weight/i);
        expect(() => ManualHealthRecord.create(input({ type: "body_weight", massKg: 1001 }), now)).toThrow(
            /body weight/i,
        );
        expect(() => ManualHealthRecord.create(input({ type: "resting_heart_rate", beatsPerMinute: 10 }), now)).toThrow(
            /resting heart rate/i,
        );
        expect(() =>
            ManualHealthRecord.create(input({ type: "resting_heart_rate", beatsPerMinute: 60.5 }), now),
        ).toThrow(/whole number/i);
    });

    it("validates the sleep interval and promotes its duration", () => {
        const record = ManualHealthRecord.create(
            input(
                { type: "sleep", startAt: "2026-07-27T22:00:00.000Z", endAt: "2026-07-28T06:00:00.000Z" },
                { effectiveAt: "2026-07-28T06:00:00.000Z" },
            ),
            now,
        );
        expect(
            sleepDurationMinutes({
                type: "sleep",
                startAt: "2026-07-27T22:00:00.000Z",
                endAt: "2026-07-28T06:00:00.000Z",
            }),
        ).toBe(480);
        expect(promoteHealthRecord(record.state).sleepDurationMinutes).toBe(480);

        expect(() =>
            ManualHealthRecord.create(
                input({ type: "sleep", startAt: "2026-07-28T06:00:00.000Z", endAt: "2026-07-27T22:00:00.000Z" }),
                now,
            ),
        ).toThrow(/after the start/i);
        expect(() =>
            ManualHealthRecord.create(
                input({ type: "sleep", startAt: "2026-07-26T00:00:00.000Z", endAt: "2026-07-28T06:00:00.000Z" }),
                now,
            ),
        ).toThrow(/24 hours/i);
    });

    it("validates readiness scores against their scale", () => {
        const record = ManualHealthRecord.create(
            input({ type: "daily_readiness", score: 74, scaleMin: 0, scaleMax: 100 }),
            now,
        );
        expect(record.state.body).toEqual({ type: "daily_readiness", score: 74, scaleMin: 0, scaleMax: 100 });
        expect(promoteHealthRecord(record.state).readinessScore).toBe(74);

        expect(() =>
            ManualHealthRecord.create(input({ type: "daily_readiness", score: 120, scaleMin: 0, scaleMax: 100 }), now),
        ).toThrow(/readiness score/i);
        expect(() =>
            ManualHealthRecord.create(input({ type: "daily_readiness", score: 5, scaleMin: 10, scaleMax: 1 }), now),
        ).toThrow(/scale maximum/i);
    });

    it("updates the body but forbids changing the record type", () => {
        const record = ManualHealthRecord.create(input({ type: "body_weight", massKg: 82 }), now);
        const later = new Date("2026-07-29T12:00:00.000Z");
        const updated = record.update({ body: { type: "body_weight", massKg: 81.4 }, notes: "morning" }, later);
        expect(updated.state.body).toEqual({ type: "body_weight", massKg: 81.4 });
        expect(updated.state.updatedAt).toBe("2026-07-29T12:00:00.000Z");

        expect(() => updated.update({ body: { type: "resting_heart_rate", beatsPerMinute: 52 } }, later)).toThrow(
            /type cannot change/i,
        );
    });

    it("archives a record and refuses further edits", () => {
        const record = ManualHealthRecord.create(input({ type: "body_weight", massKg: 82 }), now);
        const archived = record.archive(now);
        expect(archived.state.archivedAt).toBe(now.toISOString());
        expect(() => archived.archive(now)).toThrow(/already archived/i);
        expect(() => archived.update({ notes: "x" }, now)).toThrow(/archived/i);
    });

    it("rehydrates persisted state and re-validates invariants", () => {
        const state = ManualHealthRecord.create(input({ type: "body_weight", massKg: 82 }), now).state;
        expect(ManualHealthRecord.rehydrate(state).state).toEqual(state);
        expect(() => ManualHealthRecord.rehydrate({ ...state, type: "sleep" })).toThrow(/body type/i);
    });
});
