import { describe, expect, it } from "vitest";

import { buildLoadInferenceSuggestions } from "#src/load-inference";
import type { ParsedPerformance, SourceExercise, SourceSession } from "#src/model";

describe("buildLoadInferenceSuggestions", () => {
    it("uses agreeing surrounding observations with high confidence", () => {
        const sessions = [
            session("before", "2025-01-01", exercise("Leg extension", 50)),
            session("target", "2025-01-08", exercise("Leg extension", 0)),
            session("after", "2025-01-15", exercise("Leg extension", 50)),
        ];
        expect(buildLoadInferenceSuggestions(sessions, 74.5)[0]).toMatchObject({
            status: "suggested",
            suggestedLoadKg: 50,
            confidence: "high",
        });
    });

    it("uses the nearest following observation when surrounding values differ", () => {
        const sessions = [
            session("before", "2025-01-01", exercise("RDL", 45)),
            session("target", "2025-01-08", exercise("RDL", 0)),
            session("after", "2025-01-15", exercise("RDL", 50)),
        ];
        expect(buildLoadInferenceSuggestions(sessions, 74.5)[0]).toMatchObject({
            suggestedLoadKg: 50,
            confidence: "low",
        });
    });

    it("classifies bodyweight zeroes without external-load inference", () => {
        const result = buildLoadInferenceSuggestions([session("target", "2025-01-08", exercise("Pull ups", 0))], 74.5);
        expect(result[0]).toMatchObject({ status: "bodyweight", assumedBodyweightKg: 74.5, suggestedLoadKg: 0 });
    });

    it("falls back to the same canonical exercise in another program", () => {
        const sessions = [
            session("before", "2025-01-01", exercise("One hand Triceps pushdown", 15), "Earlier Program"),
            session("target", "2025-02-01", exercise("One hand Triceps pushdown", 0), "Later Program"),
        ];
        expect(buildLoadInferenceSuggestions(sessions, 74.5)[0]).toMatchObject({
            status: "suggested",
            suggestedLoadKg: 15,
            confidence: "medium",
        });
    });

    it("recognizes zero-load jumping drills as bodyweight work", () => {
        const result = buildLoadInferenceSuggestions(
            [session("target", "2025-01-08", exercise("Single leg bounds", 0))],
            74.5,
        );
        expect(result[0]).toMatchObject({ status: "bodyweight", assumedBodyweightKg: 74.5 });
    });
});

function session(
    sourceId: string,
    localDate: string,
    performedExercise: SourceExercise,
    sheet = "Program",
): SourceSession {
    return {
        sourceId,
        sheet,
        mesocycle: "Meso 1",
        microcycle: "Micro 1",
        dayLabel: "Day 1",
        headerRow: 1,
        blockColumn: 1,
        headerCell: "A1",
        rawDate: localDate,
        localDate,
        dateError: null,
        exercises: [performedExercise],
        performedExercises: [performedExercise],
        excludedExercises: [],
        hasPerformance: true,
        exactFingerprint: sourceId,
    };
}

function exercise(rawName: string, loadKg: number): SourceExercise {
    const parsedPerformance: ParsedPerformance = {
        raw: `${loadKg} x 10`,
        sets: [{ loadKg, repetitions: 10, segmentIndex: 0, setIndex: 0 }],
        errors: [],
    };
    return {
        sheet: "Program",
        row: 2,
        blockColumn: 1,
        nameCell: "A2",
        performanceCell: "F2",
        rawName,
        muscleTags: null,
        prescribedSets: 1,
        prescribedReps: 10,
        rawPerformance: parsedPerformance.raw,
        rawEffort: 2,
        mappedRpe: 6,
        effortNeedsMaxReview: false,
        excludedByPolicy: false,
        exclusionReason: null,
        parsedPerformance,
    };
}
