import type { DateInferenceSuggestion, SourceSession } from "#src/model";

const DAY_MS = 86_400_000;

export function buildDateInferenceSuggestions(sessions: readonly SourceSession[]): DateInferenceSuggestion[] {
    return sessions
        .filter(session => session.hasPerformance && session.localDate === null)
        .map(session => {
            const order = logicalOrder(session);
            const peers = sessions
                .filter(
                    candidate =>
                        candidate.sheet === session.sheet &&
                        candidate.localDate !== null &&
                        normalizeDay(candidate.dayLabel) === normalizeDay(session.dayLabel),
                )
                .map(candidate => ({ session: candidate, order: logicalOrder(candidate) }))
                .filter(candidate => candidate.order !== null && order !== null);
            const previous =
                peers
                    .filter(candidate => candidate.order! < order!)
                    .sort((left, right) => right.order! - left.order!)[0]?.session ?? null;
            const next =
                peers
                    .filter(candidate => candidate.order! > order!)
                    .sort((left, right) => left.order! - right.order!)[0]?.session ?? null;
            const suggestion = interpolateWeeklyDate(previous?.localDate ?? null, next?.localDate ?? null);
            return {
                sourceId: session.sourceId,
                sheet: session.sheet,
                headerCell: session.headerCell,
                dayLabel: session.dayLabel,
                rawDate: session.rawDate,
                suggestedDate: suggestion.date,
                confidence: suggestion.confidence,
                previousSourceId: previous?.sourceId ?? null,
                previousDate: previous?.localDate ?? null,
                nextSourceId: next?.sourceId ?? null,
                nextDate: next?.localDate ?? null,
                reason: suggestion.reason,
            };
        });
}

function logicalOrder(session: SourceSession): number | null {
    const meso = numericSuffix(session.mesocycle);
    const micro = numericSuffix(session.microcycle);
    const day = numericSuffix(session.dayLabel);
    if (meso === null || micro === null || day === null) return null;
    return meso * 10_000 + micro * 100 + day;
}

function numericSuffix(value: string | null): number | null {
    if (!value) return null;
    const match = /\d+/.exec(value);
    return match ? Number(match[0]) : null;
}

function normalizeDay(value: string): string {
    return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function interpolateWeeklyDate(
    previous: string | null,
    next: string | null,
): { date: string | null; confidence: "high" | "medium" | "low" | null; reason: string } {
    if (previous && next) {
        const previousMs = Date.parse(`${previous}T00:00:00Z`);
        const nextMs = Date.parse(`${next}T00:00:00Z`);
        const gapDays = (nextMs - previousMs) / DAY_MS;
        if (gapDays === 14)
            return {
                date: new Date(previousMs + 7 * DAY_MS).toISOString().slice(0, 10),
                confidence: "high",
                reason: "Exactly one weekly slot between matching day labels",
            };
        return {
            date: new Date(previousMs + (nextMs - previousMs) / 2).toISOString().slice(0, 10),
            confidence: "low",
            reason: `Matching day labels bracket the value by ${gapDays} days`,
        };
    }
    if (previous)
        return {
            date: shift(previous, 7),
            confidence: "medium",
            reason: "One weekly step after the nearest matching day label",
        };
    if (next)
        return {
            date: shift(next, -7),
            confidence: "medium",
            reason: "One weekly step before the nearest matching day label",
        };
    return { date: null, confidence: null, reason: "No dated matching day-label neighbors" };
}

function shift(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
