import { describe, expect, it } from "vitest";

import {
    assertWithinBulkLimits,
    assignBulkTreeIds,
    normalizeRunStepTargets,
    normalizeStrengthSetTargets,
    type BulkBlockRef,
} from "#src/modules/training/domain/index";

function counter(): () => string {
    let index = 0;
    return () => {
        index += 1;
        return `0198a4db-d8da-7000-8000-${index.toString(16).padStart(12, "0")}`;
    };
}

describe("assignBulkTreeIds", () => {
    it("mints ids and resolves parent references by external id", () => {
        const blocks: BulkBlockRef[] = [
            { externalId: "meso", parentExternalId: null },
            { externalId: "micro", parentExternalId: "meso" },
        ];
        const ids = assignBulkTreeIds(blocks, ["s1", "s2"], counter());
        const meso = ids.blockIdByExternalId.get("meso")!;
        const micro = ids.blocks.find(block => block.externalId === "micro")!;
        expect(micro.parentBlockId).toBe(meso);
        expect(ids.sessionIdByExternalId.size).toBe(2);
        expect(ids.programId).not.toBe(meso);
    });

    it("rejects a dangling parent reference", () => {
        expect(() =>
            assignBulkTreeIds([{ externalId: "micro", parentExternalId: "ghost" }], [], counter()),
        ).toThrowError(/unknown parent/i);
    });

    it("rejects duplicate block external ids", () => {
        expect(() =>
            assignBulkTreeIds(
                [
                    { externalId: "dup", parentExternalId: null },
                    { externalId: "dup", parentExternalId: null },
                ],
                [],
                counter(),
            ),
        ).toThrowError(/duplicate block/i);
    });

    it("rejects duplicate session external ids", () => {
        expect(() => assignBulkTreeIds([], ["s1", "s1"], counter())).toThrowError(/duplicate session/i);
    });
});

describe("assertWithinBulkLimits", () => {
    const base = {
        blocks: 0,
        sessions: 0,
        activitiesPerSession: [],
        exercisesPerActivity: [],
        setsPerExercise: [],
        runStepsPerActivity: [],
    };

    it("passes for a bounded tree", () => {
        expect(() => assertWithinBulkLimits({ ...base, blocks: 3, sessions: 10 })).not.toThrow();
    });

    it("rejects too many sessions", () => {
        expect(() => assertWithinBulkLimits({ ...base, sessions: 100_000 })).toThrowError(/limit/i);
    });
});

describe("normalizeStrengthSetTargets", () => {
    it("converts pounds to canonical kilograms and preserves entered provenance", () => {
        const raw = normalizeStrengthSetTargets({
            repsMin: 5,
            repsMax: 5,
            loadMin: { value: 100, unit: "lb" },
        });
        expect(raw.loadKgMin).toBe("45.359237");
        expect(raw.repsMin).toBe(5);
        expect(raw.enteredTargets).toMatchObject({ loadMin: { value: 100, unit: "lb" } });
    });

    it("converts entered rest minutes to milliseconds", () => {
        const raw = normalizeStrengthSetTargets({ restMin: { value: 2, unit: "min" } });
        expect(raw.restMsMin).toBe(120_000);
    });

    it("distinguishes an omitted field from an explicit null", () => {
        const raw = normalizeStrengthSetTargets({ loadMin: null });
        expect(raw.loadKgMin).toBeNull();
        expect("loadKgMax" in raw).toBe(false);
    });
});

describe("normalizeRunStepTargets", () => {
    it("normalizes distance and pace to canonical metres and metres-per-second", () => {
        const raw = normalizeRunStepTargets({
            distanceMin: { value: 5, unit: "km" },
            speedMin: { value: 5, unit: "min/km" },
        });
        expect(raw.distanceMMin).toBe("5000");
        // 5 min/km = 1000 m / 300 s = 3.333... m/s
        expect(raw.speedMpsMin?.startsWith("3.33")).toBe(true);
    });
});
