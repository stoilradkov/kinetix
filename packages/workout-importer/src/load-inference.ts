import { normalizeGeneralExerciseName } from "#src/catalog-mapping";
import { canonicalizeSourceExerciseName } from "#src/exercise-canonicalization";
import type { LoadInferenceEvidence, LoadInferenceSuggestion, SourceExercise, SourceSession } from "#src/model";
import { plausiblyBodyweightExercise } from "#src/policy";

export function buildLoadInferenceSuggestions(
    sessions: readonly SourceSession[],
    assumedBodyweightKg: number,
): LoadInferenceSuggestion[] {
    const observations = sessions.flatMap(session =>
        session.performedExercises.flatMap(exercise => {
            const loadKg = representativeNonzeroLoad(exercise);
            if (loadKg === null || session.localDate === null) return [];
            return [
                {
                    key: key(session.sheet, exercise.rawName),
                    globalKey: globalKey(exercise.rawName),
                    sourceId: session.sourceId,
                    localDate: session.localDate,
                    performanceCell: exercise.performanceCell,
                    loadKg,
                } satisfies LoadInferenceEvidence & { key: string; globalKey: string },
            ];
        }),
    );

    return sessions.flatMap(session =>
        session.performedExercises
            .filter(exercise => exercise.parsedPerformance?.sets.some(set => set.loadKg === 0))
            .map(exercise => {
                if (plausiblyBodyweightExercise(exercise.rawName))
                    return {
                        sourceId: session.sourceId,
                        localDate: session.localDate,
                        sheet: session.sheet,
                        performanceCell: exercise.performanceCell,
                        exercise: exercise.rawName,
                        rawPerformance: exercise.rawPerformance ?? "",
                        status: "bodyweight" as const,
                        assumedBodyweightKg,
                        suggestedLoadKg: 0,
                        confidence: "high" as const,
                        previousEvidence: null,
                        nextEvidence: null,
                    };

                const localMatching = observations.filter(value => value.key === key(session.sheet, exercise.rawName));
                const matching =
                    localMatching.length > 0
                        ? localMatching
                        : observations.filter(value => value.globalKey === globalKey(exercise.rawName));
                const previous = nearestEvidence(matching, session.localDate, "previous");
                const next = nearestEvidence(matching, session.localDate, "next");
                const suggestion = chooseSuggestion(previous, next);
                return {
                    sourceId: session.sourceId,
                    localDate: session.localDate,
                    sheet: session.sheet,
                    performanceCell: exercise.performanceCell,
                    exercise: exercise.rawName,
                    rawPerformance: exercise.rawPerformance ?? "",
                    status: suggestion.loadKg === null ? ("unresolved" as const) : ("suggested" as const),
                    assumedBodyweightKg: null,
                    suggestedLoadKg: suggestion.loadKg,
                    confidence: suggestion.confidence,
                    previousEvidence: stripKey(previous),
                    nextEvidence: stripKey(next),
                };
            }),
    );
}

function representativeNonzeroLoad(exercise: SourceExercise): number | null {
    const loads = exercise.parsedPerformance?.sets.map(set => set.loadKg).filter(load => load > 0) ?? [];
    return loads[0] ?? null;
}

function key(sheet: string, exercise: string): string {
    return `${sheet}\u0000${normalizeGeneralExerciseName(exercise)}`;
}

function globalKey(exercise: string): string {
    return canonicalizeSourceExerciseName(exercise);
}

function nearestEvidence<T extends LoadInferenceEvidence & { key: string; globalKey: string }>(
    observations: readonly T[],
    localDate: string | null,
    direction: "previous" | "next",
): T | null {
    if (localDate === null) return null;
    const candidates = observations.filter(value =>
        direction === "previous" ? value.localDate < localDate : value.localDate > localDate,
    );
    candidates.sort((left, right) =>
        direction === "previous"
            ? right.localDate.localeCompare(left.localDate)
            : left.localDate.localeCompare(right.localDate),
    );
    return candidates[0] ?? null;
}

function chooseSuggestion(
    previous: LoadInferenceEvidence | null,
    next: LoadInferenceEvidence | null,
): { loadKg: number | null; confidence: "high" | "medium" | "low" | null } {
    if (previous && next && previous.loadKg === next.loadKg) return { loadKg: next.loadKg, confidence: "high" };
    if (next && previous) {
        const delta = Math.abs(next.loadKg - previous.loadKg);
        return { loadKg: next.loadKg, confidence: delta <= 2.5 ? "medium" : "low" };
    }
    if (next) return { loadKg: next.loadKg, confidence: "medium" };
    if (previous) return { loadKg: previous.loadKg, confidence: "medium" };
    return { loadKg: null, confidence: null };
}

function stripKey<T extends LoadInferenceEvidence & { key: string; globalKey: string }>(
    value: T | null,
): LoadInferenceEvidence | null {
    if (!value) return null;
    return {
        sourceId: value.sourceId,
        localDate: value.localDate,
        performanceCell: value.performanceCell,
        loadKg: value.loadKg,
    };
}
