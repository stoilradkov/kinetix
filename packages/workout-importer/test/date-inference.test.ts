import { describe, expect, it } from "vitest";

import { buildDateInferenceSuggestions } from "#src/date-inference";
import type { SourceSession } from "#src/model";

describe("buildDateInferenceSuggestions", () => {
    it("fills the missing weekly slot between matching program days", () => {
        const result = buildDateInferenceSuggestions([
            session("previous", "Meso 1", "Micro 3", "2026-02-05"),
            session("target", "Meso 1", "Micro 4", null),
            session("next", "Meso 2", "Micro 1", "2026-02-19"),
        ]);
        expect(result[0]).toMatchObject({ suggestedDate: "2026-02-12", confidence: "high" });
    });
});

function session(sourceId: string, mesocycle: string, microcycle: string, localDate: string | null): SourceSession {
    return {
        sourceId,
        sheet: "Program",
        mesocycle,
        microcycle,
        dayLabel: "Day 4",
        headerRow: 1,
        blockColumn: 1,
        headerCell: "A1",
        rawDate: localDate,
        localDate,
        dateError: localDate ? null : "bad date",
        exercises: [],
        performedExercises: [],
        excludedExercises: [],
        hasPerformance: true,
        exactFingerprint: sourceId,
    };
}
