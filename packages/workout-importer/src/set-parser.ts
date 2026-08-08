import type { ParsedPerformance, ParsedSet } from "#src/model";

const LOAD_AND_REPS = /^\s*(?<load>-?\d+(?:\.\d+)?)?\s*[x×]\s*(?<reps>.+?)\s*$/i;

export function parseStrengthPerformance(raw: string): ParsedPerformance {
    const cleaned = raw.trim();
    if (cleaned === "") return { raw, sets: [], errors: ["Empty performance"] };

    const segments = cleaned.split(/\s*[,;]\s*/).filter(Boolean);
    const sets: ParsedSet[] = [];
    const errors: string[] = [];
    let previousLoad: number | null = null;

    for (const [segmentIndex, segment] of segments.entries()) {
        const match = LOAD_AND_REPS.exec(segment);
        if (!match?.groups) {
            errors.push(`Unrecognized segment ${segmentIndex + 1}: ${segment}`);
            continue;
        }

        const loadToken = match.groups.load;
        const repsToken = match.groups.reps;
        const load: number | null = loadToken === undefined ? previousLoad : Number(loadToken);
        if (load === null || !Number.isFinite(load)) {
            errors.push(`Missing load in segment ${segmentIndex + 1}: ${segment}`);
            continue;
        }
        previousLoad = load;

        const tokens = repsToken?.match(/\d+(?:\.\d+)?/g) ?? [];
        if (tokens.length === 0) {
            errors.push(`Missing repetitions in segment ${segmentIndex + 1}: ${segment}`);
            continue;
        }

        for (const [setIndex, token] of tokens.entries()) {
            const repetitions = Number(token);
            if (!Number.isInteger(repetitions) || repetitions < 0) {
                errors.push(`Invalid repetitions '${token}' in segment ${segmentIndex + 1}`);
                continue;
            }
            sets.push({ loadKg: load, repetitions, segmentIndex, setIndex });
        }
    }

    return { raw, sets, errors };
}
