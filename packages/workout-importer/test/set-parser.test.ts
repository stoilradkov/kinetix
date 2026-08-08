import { describe, expect, it } from "vitest";

import { parseStrengthPerformance } from "#src/set-parser";

describe("parseStrengthPerformance", () => {
    it("expands one load followed by repetitions into performed sets", () => {
        expect(parseStrengthPerformance("55 x 6 6 6")).toEqual({
            raw: "55 x 6 6 6",
            sets: [
                { loadKg: 55, repetitions: 6, segmentIndex: 0, setIndex: 0 },
                { loadKg: 55, repetitions: 6, segmentIndex: 0, setIndex: 1 },
                { loadKg: 55, repetitions: 6, segmentIndex: 0, setIndex: 2 },
            ],
            errors: [],
        });
    });

    it("supports load changes and an omitted repeated load", () => {
        const result = parseStrengthPerformance("70 x 4, 62.5 x 7 7, x 6");
        expect(result.errors).toEqual([]);
        expect(result.sets.map(set => [set.loadKg, set.repetitions])).toEqual([
            [70, 4],
            [62.5, 7],
            [62.5, 7],
            [62.5, 6],
        ]);
    });

    it("reports unrecognized notation without inventing sets", () => {
        expect(parseStrengthPerformance("bodyweight maybe").errors).toEqual([
            "Unrecognized segment 1: bodyweight maybe",
        ]);
    });
});
