import { describe, expect, it } from "vitest";

import {
    ZoneDefinition,
    resolveEffectiveZoneDefinition,
    type RecordZoneDefinitionInput,
    type ZoneRangeInput,
} from "#src/modules/training/domain/index";

const ids = {
    def1: "0198a4db-d8da-7000-8000-000000001001",
    def2: "0198a4db-d8da-7000-8000-000000001002",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    r1: "0198a4db-d8da-7000-8000-000000001111",
    r2: "0198a4db-d8da-7000-8000-000000001112",
    r3: "0198a4db-d8da-7000-8000-000000001113",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function ranges(): ZoneRangeInput[] {
    return [
        { id: ids.r1, position: 0, name: "Z1", lowerBound: 0, upperBound: 120 },
        { id: ids.r2, position: 1, name: "Z2", lowerBound: 120, upperBound: 150 },
        { id: ids.r3, position: 2, name: "Z3", lowerBound: 150, upperBound: null },
    ];
}

function input(overrides: Partial<RecordZoneDefinitionInput> = {}): RecordZoneDefinitionInput {
    return {
        id: ids.def1,
        profileId: ids.profile,
        family: "heart_rate",
        method: "manual",
        ranges: ranges(),
        ...overrides,
    };
}

describe("ZoneDefinition domain", () => {
    it("records an ordered range set with defaults for inclusivity", () => {
        const state = ZoneDefinition.record(input(), now).state;
        expect(state.ranges).toHaveLength(3);
        expect(state.ranges[0]).toMatchObject({
            lowerBound: "0",
            upperBound: "120",
            lowerInclusive: true,
            upperInclusive: false,
        });
        expect(state.ranges[2]?.upperBound).toBeNull();
    });

    it("rejects a method that does not belong to the family", () => {
        expect(() => ZoneDefinition.record(input({ family: "power", method: "percent_max_hr" }), now)).toThrow();
    });

    it("requires the config values a method depends on", () => {
        expect(() => ZoneDefinition.record(input({ method: "percent_max_hr", config: {} }), now)).toThrow();
        expect(
            ZoneDefinition.record(input({ method: "percent_max_hr", config: { maxHr: 190 } }), now).state.config.maxHr,
        ).toBe(190);
        expect(() =>
            ZoneDefinition.record(input({ method: "percent_hr_reserve", config: { maxHr: 150, restingHr: 160 } }), now),
        ).toThrow();
    });

    it("rejects overlapping ranges and a non-terminal open range", () => {
        expect(() =>
            ZoneDefinition.record(
                input({
                    ranges: [
                        { id: ids.r1, position: 0, name: "Z1", lowerBound: 0, upperBound: 130 },
                        { id: ids.r2, position: 1, name: "Z2", lowerBound: 120, upperBound: 150 },
                    ],
                }),
                now,
            ),
        ).toThrow();
        expect(() =>
            ZoneDefinition.record(
                input({
                    ranges: [
                        { id: ids.r1, position: 0, name: "Z1", lowerBound: 0, upperBound: null },
                        { id: ids.r2, position: 1, name: "Z2", lowerBound: 120, upperBound: 150 },
                    ],
                }),
                now,
            ),
        ).toThrow();
    });

    it("resolves the definition in force at an instant", () => {
        const first = ZoneDefinition.rehydrate(
            ZoneDefinition.record(input({ id: ids.def1, effectiveFrom: "2026-01-01T00:00:00.000Z" }), now).state,
        ).close("2026-06-01T00:00:00.000Z", now).state;
        const second = ZoneDefinition.record(
            input({ id: ids.def2, effectiveFrom: "2026-06-01T00:00:00.000Z" }),
            now,
        ).state;
        expect(resolveEffectiveZoneDefinition([first, second], "2026-03-01T00:00:00.000Z")?.id).toBe(ids.def1);
        expect(resolveEffectiveZoneDefinition([first, second], "2026-07-01T00:00:00.000Z")?.id).toBe(ids.def2);
    });
});
