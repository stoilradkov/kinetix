import type {
    ExerciseCatalogItem,
    ExerciseCatalogSnapshot,
    ExerciseMappingCandidate,
    ExerciseMappingReview,
    SourceExercise,
} from "#src/model";

const EXPANSIONS: readonly [RegExp, string][] = [
    [/\bdb\b/g, "dumbbell"],
    [/\bbb\b/g, "barbell"],
    [/\bohp\b/g, "overhead press"],
    [/\brdl\b/g, "romanian deadlift"],
    [/\bbg\b/g, "bulgarian"],
    [/\bmashine\b/g, "machine"],
    [/\bpush ups?\b/g, "push up"],
    [/\bpull ups?\b/g, "pull up"],
    [/\bfacepull\b/g, "face pull"],
    [/\bpulldown\b/g, "pull down"],
];

export function buildExerciseMappingReview(
    exercises: readonly SourceExercise[],
    catalog: ExerciseCatalogSnapshot,
): ExerciseMappingReview[] {
    const groups = new Map<string, SourceExercise[]>();
    for (const exercise of exercises) {
        const key = normalizeGeneralExerciseName(exercise.rawName);
        const values = groups.get(key) ?? [];
        values.push(exercise);
        groups.set(key, values);
    }

    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([normalizedLabel, occurrences]) => {
            const exact = catalog.items.filter(item => catalogTerms(item).has(normalizedLabel));
            if (exact.length > 0) {
                const candidates = exact.map(item => candidate(item, 1, "exact-name-or-alias"));
                return {
                    normalizedLabel,
                    sourceLabels: [...new Set(occurrences.map(value => value.rawName))].sort(),
                    occurrences: occurrences.length,
                    status: exact.length === 1 ? "exact" : "ambiguous",
                    recommendedExerciseId: preferredExact(exact)?.id ?? null,
                    candidates,
                };
            }

            const suggestions = catalog.items
                .filter(isUsefulSuggestionCandidate)
                .map(item => ({ item, score: bestSimilarity(normalizedLabel, catalogTerms(item)) }))
                .filter(value => value.score >= 0.28)
                .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
                .slice(0, 3)
                .map(value => candidate(value.item, value.score, "general-name-similarity"));

            return {
                normalizedLabel,
                sourceLabels: [...new Set(occurrences.map(value => value.rawName))].sort(),
                occurrences: occurrences.length,
                status: suggestions.length > 0 ? "suggested" : "unmatched",
                recommendedExerciseId: null,
                candidates: suggestions,
            };
        });
}

export function normalizeGeneralExerciseName(value: string): string {
    let normalized = value
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .replace(/[’']/g, "")
        .replace(/[-_/]+/g, " ")
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    for (const [pattern, replacement] of EXPANSIONS) normalized = normalized.replace(pattern, replacement);
    return normalized.replace(/\s+/g, " ").trim();
}

function catalogTerms(item: ExerciseCatalogItem): Set<string> {
    return new Set([item.name, ...item.aliases].map(normalizeGeneralExerciseName));
}

function preferredExact(items: readonly ExerciseCatalogItem[]): ExerciseCatalogItem | null {
    if (items.length === 1) return items[0] ?? null;
    const standardSeeded = items.filter(
        item =>
            item.ownership === "seeded" &&
            item.equipment?.analyticsMappingStatus === "standard" &&
            item.movementPattern?.analyticsMappingStatus === "standard",
    );
    return standardSeeded.length === 1 ? (standardSeeded[0] ?? null) : null;
}

function isUsefulSuggestionCandidate(item: ExerciseCatalogItem): boolean {
    return (
        item.ownership === "seeded" ||
        item.equipment?.analyticsMappingStatus === "standard" ||
        item.movementPattern?.analyticsMappingStatus === "standard"
    );
}

function bestSimilarity(source: string, terms: ReadonlySet<string>): number {
    return Math.max(0, ...[...terms].map(term => tokenDice(source, term)));
}

function tokenDice(left: string, right: string): number {
    const leftTokens = new Set(left.split(" ").filter(Boolean));
    const rightTokens = new Set(right.split(" ").filter(Boolean));
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
    const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
    return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function candidate(
    item: ExerciseCatalogItem,
    score: number,
    reason: ExerciseMappingCandidate["reason"],
): ExerciseMappingCandidate {
    return {
        id: item.id,
        slug: item.slug,
        name: item.name,
        ownership: item.ownership,
        equipment: item.equipment?.name ?? null,
        loadModel: item.loadModel,
        score: Number(score.toFixed(4)),
        reason,
    };
}
