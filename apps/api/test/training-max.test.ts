import { describe, expect, it } from "vitest";

import {
    TrainingMax,
    assertTrainingMaxSeriesConsistent,
    resolveEffectiveTrainingMax,
    trainingMaxSeriesKey,
    type RecordTrainingMaxInput,
    type TrainingMaxState,
} from "#src/modules/training/domain/index";

const ids = {
    max1: "0198a4db-d8da-7000-8000-0000000000f1",
    max2: "0198a4db-d8da-7000-8000-0000000000f2",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    exercise: "0198a4db-d8da-7000-8000-0000000000a1",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function input(overrides: Partial<RecordTrainingMaxInput> = {}): RecordTrainingMaxInput {
    return {
        id: ids.max1,
        profileId: ids.profile,
        exerciseId: ids.exercise,
        maxType: "training_max",
        value: 100,
        unit: "kg",
        ...overrides,
    };
}

describe("TrainingMax domain", () => {
    it("records a canonical kg value and defaults the effective interval to now", () => {
        const state = TrainingMax.record(input(), now).state;
        expect(state).toMatchObject({
            valueKg: "100",
            enteredUnit: "kg",
            effectiveFrom: "2026-07-28T12:00:00.000Z",
            effectiveTo: null,
            source: "web",
        });
    });

    it("converts entered pounds to canonical kilograms while preserving provenance", () => {
        const state = TrainingMax.record(input({ value: 100, unit: "lb" }), now).state;
        expect(state.enteredValue).toBe("100");
        expect(state.enteredUnit).toBe("lb");
        expect(state.valueKg).toBe("45.359237");
    });

    it("requires a label for custom maxima and forbids it otherwise", () => {
        expect(() => TrainingMax.record(input({ maxType: "custom" }), now)).toThrow();
        expect(TrainingMax.record(input({ maxType: "custom", customLabel: "Opener" }), now).state.customLabel).toBe(
            "Opener",
        );
        expect(() => TrainingMax.record(input({ maxType: "training_max", customLabel: "x" }), now)).toThrow();
    });

    it("rejects a non-positive load", () => {
        expect(() => TrainingMax.record(input({ value: 0 }), now)).toThrow();
    });

    it("closes an open interval and refuses to close it twice or before it started", () => {
        const open = TrainingMax.record(input({ effectiveFrom: "2026-01-01T00:00:00.000Z" }), now);
        const closed = TrainingMax.rehydrate(open.state).close("2026-06-01T00:00:00.000Z", now);
        expect(closed.state.effectiveTo).toBe("2026-06-01T00:00:00.000Z");
        expect(() => TrainingMax.rehydrate(closed.state).close("2026-07-01T00:00:00.000Z", now)).toThrow();
        expect(() => TrainingMax.rehydrate(open.state).close("2025-12-01T00:00:00.000Z", now)).toThrow();
    });

    it("resolves the effective record at an instant and keys series independently", () => {
        const first: TrainingMaxState = TrainingMax.rehydrate(
            TrainingMax.record(input({ id: ids.max1, effectiveFrom: "2026-01-01T00:00:00.000Z" }), now).state,
        ).close("2026-06-01T00:00:00.000Z", now).state;
        const second = TrainingMax.record(
            input({ id: ids.max2, value: 110, effectiveFrom: "2026-06-01T00:00:00.000Z" }),
            now,
        ).state;
        const series = [first, second];

        expect(resolveEffectiveTrainingMax(series, "2026-03-01T00:00:00.000Z")?.id).toBe(ids.max1);
        expect(resolveEffectiveTrainingMax(series, "2026-07-01T00:00:00.000Z")?.id).toBe(ids.max2);
        expect(resolveEffectiveTrainingMax(series, "2025-01-01T00:00:00.000Z")).toBeNull();
        expect(() => assertTrainingMaxSeriesConsistent(series)).not.toThrow();
        expect(trainingMaxSeriesKey(second)).toBe(`${ids.exercise}::training_max::`);
    });

    it("detects overlapping intervals in a series", () => {
        const a = TrainingMax.rehydrate(
            TrainingMax.record(input({ id: ids.max1, effectiveFrom: "2026-01-01T00:00:00.000Z" }), now).state,
        ).close("2026-06-01T00:00:00.000Z", now).state;
        const b = TrainingMax.record(input({ id: ids.max2, effectiveFrom: "2026-03-01T00:00:00.000Z" }), now).state;
        expect(() => assertTrainingMaxSeriesConsistent([a, b])).toThrow();
    });
});
