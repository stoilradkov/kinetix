import type { ImportPolicy } from "#src/model";

export const DEFAULT_IMPORT_POLICY: ImportPolicy = {
    excludedSheets: new Set(["530 mile", "5:30 mile", "Лист17", "Лист2"]),
    excludedExerciseRules: [
        { pattern: /\brun\b/i, reason: "Running is out of scope for this import" },
        { pattern: /threshold/i, reason: "Running is out of scope for this import" },
        { pattern: /^dashes$/i, reason: "Running is out of scope for this import" },
        { pattern: /^rowing$/i, reason: "Approved exclusion of distance-based conditioning" },
        { pattern: /^ski$/i, reason: "Approved exclusion of distance-based conditioning" },
        { pattern: /^a skip, b skip, c skip$/i, reason: "Approved exclusion of a combined drill row" },
    ],
    excludedSessionWindows: [
        {
            sheet: "SpeedPower",
            from: "2022-08-01",
            through: "2022-09-08",
            reason: "Approved removal of the unintentionally extended SpeedPower tail",
        },
    ],
    assumedBodyweightKg: 74.5,
    timeZone: "Europe/Athens",
    rpeApplication: "all_sets",
    dateOverrides: new Map([
        [
            "ULULR - 2026 winter!A25",
            { localDate: "2026-01-22", reason: "Approved correction; preserve the Meso 1 Micro 1 sequence" },
        ],
        [
            "ULULR - 2026 winter!A31",
            { localDate: "2026-01-23", reason: "Approved correction; preserve the Meso 1 Micro 1 sequence" },
        ],
        [
            "ULULR - 2026 winter!V25",
            { localDate: "2026-02-12", reason: "Approved correction of malformed 12.02.0206 value" },
        ],
        [
            "ULULR - 2026 winter!V31",
            { localDate: "2026-02-13", reason: "Approved correction; preserve the Meso 1 Micro 4 sequence" },
        ],
        [
            "ULULR - 2026 winter!A142",
            { localDate: "2026-04-17", reason: "Approved correction; preserve the Meso 4 Micro 1 sequence" },
        ],
        [
            "PPLUL2!H18",
            { localDate: "2025-03-19", reason: "Approved correction of an unintentional PPLUL2/List11 overlap" },
        ],
        [
            "PPLUL2!H68",
            { localDate: "2025-05-02", reason: "Approved correction of an unintentional PPLUL2/List11 overlap" },
        ],
    ]),
};

export function effortToRpe(effort: number, explicitFailureOrMax = false): number | null {
    switch (effort) {
        case 1:
            return 3;
        case 2:
            return 6;
        case 3:
            return 8;
        case 4:
            return explicitFailureOrMax ? 10 : 9;
        default:
            return null;
    }
}

const BODYWEIGHT_EXERCISE_PATTERNS = [
    /push[ -]?ups?/i,
    /pull[ -]?ups?/i,
    /chin[ -]?ups?/i,
    /^dips?$/i,
    /nordic/i,
    /broad jump/i,
    /box jump/i,
    /drop jump/i,
    /sissy squat/i,
    /hamstring slides?/i,
    /calf raise.*body/i,
    /inverted row/i,
    /plank/i,
    /bounds?$/i,
    /skips?$/i,
    /line hops?$/i,
    /step[ -]?ups?$/i,
    /standing jump/i,
    /pogo jumps?/i,
    /fast legs/i,
    /hip lock/i,
    /horse kicks/i,
    /wall sit/i,
    /clapping push/i,
    /reverse push/i,
    /jumping .*split squat/i,
    /kneeling jump/i,
];

export function plausiblyBodyweightExercise(name: string): boolean {
    return BODYWEIGHT_EXERCISE_PATTERNS.some(pattern => pattern.test(name.trim()));
}
