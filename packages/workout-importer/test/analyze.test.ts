import { describe, expect, it } from "vitest";

import { analyzeWorkbook } from "#src/analyze";
import type { ImportPolicy, WorkbookSnapshot } from "#src/model";

const policy: ImportPolicy = {
    excludedSheets: new Set(["Skip"]),
    excludedExerciseRules: [{ pattern: /\brun\b/i, reason: "Synthetic run exclusion" }],
    assumedBodyweightKg: 74.5,
    timeZone: "Europe/Athens",
    rpeApplication: "all_sets",
};

describe("analyzeWorkbook", () => {
    it("extracts program structure, excludes runs, and removes exact copied sessions", () => {
        const rows = [
            ["Meso 1", null, null, null, null, null, null],
            [null, null, null, null, null, null, null],
            ["Micro 1", null, null, null, null, null, null],
            [null, null, null, null, null, null, null],
            ["Day 1", null, null, null, null, 45_000, "Effort"],
            ["Bench press", "C", 3, "6-8", null, "50 x 6 6 6", 2],
            ["Easy Run", null, null, null, null, "5 x 1:00m", 2],
        ];
        const snapshot: WorkbookSnapshot = {
            schemaVersion: 1,
            source: { fileName: "fixture.xlsx", sha256: "a".repeat(64) },
            sheets: [
                { name: "Program", values: rows },
                { name: "Copy", values: rows },
                { name: "Skip", values: rows },
            ],
        };

        const result = analyzeWorkbook(snapshot, policy);
        expect(result.summary.sheetsIncluded).toBe(2);
        expect(result.summary.performedSessionCandidates).toBe(2);
        expect(result.summary.completedSessionCandidates).toBe(2);
        expect(result.summary.exactDuplicateSessions).toBe(1);
        expect(result.summary.distinctCompletedSessions).toBe(1);
        expect(result.summary.excludedExerciseRows).toBe(1);
        expect(result.distinctCompletedSessions[0]).toMatchObject({
            mesocycle: "Meso 1",
            microcycle: "Micro 1",
            dayLabel: "Day 1",
        });
    });

    it("keeps distinct workouts on the same date", () => {
        const snapshot: WorkbookSnapshot = {
            schemaVersion: 1,
            source: { fileName: "fixture.xlsx", sha256: "b".repeat(64) },
            sheets: [
                {
                    name: "Program",
                    values: [
                        ["Meso 1", null, null, null, null, null, null],
                        ["Micro 1", null, null, null, null, null, null],
                        ["Day 1", null, null, null, null, 45_000, null],
                        ["Bench press", null, 1, 5, null, "50 x 5", 3],
                        ["Day 2", null, null, null, null, 45_000, null],
                        ["Back squat", null, 1, 5, null, "80 x 5", 3],
                    ],
                },
            ],
        };

        const result = analyzeWorkbook(snapshot, policy);
        expect(result.summary.distinctCompletedSessions).toBe(2);
        expect(result.summary.datesWithDistinctSessions).toBe(1);
    });

    it("applies approved date corrections before duplicate and conflict analysis", () => {
        const snapshot: WorkbookSnapshot = {
            schemaVersion: 1,
            source: { fileName: "fixture.xlsx", sha256: "c".repeat(64) },
            sheets: [
                {
                    name: "Program",
                    values: [
                        ["Meso 1", null, null, null, null, null, null],
                        ["Micro 1", null, null, null, null, null, null],
                        ["Day 1", null, null, null, null, "2025-01-01", null],
                        ["Bench press", null, 1, 5, null, "50 x 5", 3],
                    ],
                },
            ],
        };
        const correctedPolicy: ImportPolicy = {
            ...policy,
            dateOverrides: new Map([
                ["Program!A3", { localDate: "2025-01-02", reason: "Synthetic approved correction" }],
            ]),
        };

        const result = analyzeWorkbook(snapshot, correctedPolicy);
        expect(result.completedSessions[0]).toMatchObject({
            localDate: "2025-01-02",
            dateError: null,
            dateCorrection: {
                originalLocalDate: "2025-01-01",
                localDate: "2025-01-02",
                reason: "Synthetic approved correction",
            },
        });
    });
});
