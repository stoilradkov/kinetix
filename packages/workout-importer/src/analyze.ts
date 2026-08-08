import crypto from "node:crypto";

import { parseSourceDate, recoverRepTarget } from "#src/date";
import type {
    DateConflictGroup,
    ExactDuplicateGroup,
    ImportPolicy,
    SourceExercise,
    SourceSession,
    WorkbookAnalysis,
    WorkbookSheetSnapshot,
    WorkbookSnapshot,
} from "#src/model";
import { effortToRpe, plausiblyBodyweightExercise } from "#src/policy";
import { parseStrengthPerformance } from "#src/set-parser";

const DAY_LABEL = /^Day\s*\d+\b/i;
const MESOCYCLE_LABEL = /^Meso\s*\d+/i;
const MICROCYCLE_LABEL = /^Micro\s*\d+/i;
const COLUMN_GROUP_WIDTH = 7;

export function analyzeWorkbook(snapshot: WorkbookSnapshot, policy: ImportPolicy): WorkbookAnalysis {
    validateSnapshot(snapshot);
    const includedSheets = snapshot.sheets.filter(sheet => !policy.excludedSheets.has(sheet.name));
    const excludedSheets = snapshot.sheets.filter(sheet => policy.excludedSheets.has(sheet.name));
    const sessions = includedSheets.flatMap(sheet => extractSheetSessions(sheet, policy));
    const performedCandidates = sessions.filter(session => session.hasPerformance);
    const excludedSessions = performedCandidates.filter(session => session.sessionExclusion !== undefined);
    const completedSessions = performedCandidates.filter(session => session.sessionExclusion === undefined);
    const { duplicates, distinct } = deduplicateCompletedSessions(completedSessions);
    const dateConflicts = groupDateConflicts(distinct);

    const performedExercises = distinct.flatMap(session => session.performedExercises);
    const parsedSets = performedExercises.flatMap(exercise => exercise.parsedPerformance?.sets ?? []);
    const zeroLoadRows = performedExercises.filter(exercise =>
        exercise.parsedPerformance?.sets.some(set => set.loadKg === 0),
    );

    return {
        source: snapshot.source,
        policy: {
            excludedSheets: [...policy.excludedSheets].sort(),
            assumedBodyweightKg: policy.assumedBodyweightKg,
            timeZone: policy.timeZone,
            rpeApplication: policy.rpeApplication,
        },
        includedSheets: includedSheets.map(sheet => sheet.name),
        excludedSheets: excludedSheets.map(sheet => sheet.name),
        sessions,
        excludedSessions,
        completedSessions,
        exactDuplicateGroups: duplicates,
        distinctCompletedSessions: distinct,
        dateConflictGroups: dateConflicts,
        summary: {
            sheetsIncluded: includedSheets.length,
            sheetsExcluded: excludedSheets.length,
            rawDayHeaders: sessions.length,
            performedSessionCandidates: performedCandidates.length,
            completedSessionCandidates: completedSessions.length,
            excludedSessionCandidates: excludedSessions.length,
            emptyPlannedSessions: sessions.filter(session => !session.hasPerformance).length,
            exactDuplicateSessions: duplicates.reduce((total, group) => total + group.duplicateSourceIds.length, 0),
            distinctCompletedSessions: distinct.length,
            datesWithDistinctSessions: dateConflicts.length,
            performedExerciseRows: performedExercises.length,
            parsedSets: parsedSets.length,
            parseErrorRows: performedExercises.filter(exercise => (exercise.parsedPerformance?.errors.length ?? 0) > 0)
                .length,
            distinctExerciseLabels: new Set(performedExercises.map(exercise => normalizeLabel(exercise.rawName))).size,
            zeroLoadRows: zeroLoadRows.length,
            suspiciousZeroLoadRows: zeroLoadRows.filter(exercise => !plausiblyBodyweightExercise(exercise.rawName))
                .length,
            invalidOrMissingDates: distinct.filter(session => session.localDate === null).length,
            excludedExerciseRows: distinct.reduce((total, session) => total + session.excludedExercises.length, 0),
            effortFourRows: performedExercises.filter(exercise => exercise.rawEffort === 4).length,
        },
    };
}

function validateSnapshot(snapshot: WorkbookSnapshot): void {
    if (snapshot.schemaVersion !== 1) throw new Error("Unsupported workbook snapshot schema version");
    if (!snapshot.source?.sha256 || !Array.isArray(snapshot.sheets)) throw new Error("Invalid workbook snapshot");
}

function extractSheetSessions(sheet: WorkbookSheetSnapshot, policy: ImportPolicy): SourceSession[] {
    const width = Math.max(0, ...sheet.values.map(row => row.length));
    const sessions: SourceSession[] = [];

    for (let baseColumn = 0; baseColumn + 6 < width; baseColumn += COLUMN_GROUP_WIDTH) {
        for (let rowIndex = 0; rowIndex < sheet.values.length; rowIndex += 1) {
            const rawDay = sheet.values[rowIndex]?.[baseColumn];
            if (typeof rawDay !== "string" || !DAY_LABEL.test(rawDay.trim())) continue;

            const nextHeader = findNextDayRow(sheet, rowIndex + 1, baseColumn);
            const endRow = nextHeader === null ? sheet.values.length : nextHeader;
            const exercises: SourceExercise[] = [];

            for (let exerciseRow = rowIndex + 1; exerciseRow < endRow; exerciseRow += 1) {
                const row = sheet.values[exerciseRow] ?? [];
                const rawName = row[baseColumn];
                if (typeof rawName !== "string" || rawName.trim() === "") continue;
                if (MESOCYCLE_LABEL.test(rawName) || MICROCYCLE_LABEL.test(rawName)) continue;

                const performanceValue = row[baseColumn + 5];
                const rawPerformance =
                    typeof performanceValue === "string" && performanceValue.trim() !== ""
                        ? performanceValue.trim()
                        : null;
                const exclusionRule = policy.excludedExerciseRules.find(rule => rule.pattern.test(rawName));
                const excludedByPolicy = exclusionRule !== undefined;
                const parsedPerformance =
                    rawPerformance && !excludedByPolicy ? parseStrengthPerformance(rawPerformance) : null;
                const effortValue = row[baseColumn + 6];
                const rawEffort = typeof effortValue === "number" && Number.isFinite(effortValue) ? effortValue : null;
                const muscleTagsValue = row[baseColumn + 1];

                exercises.push({
                    sheet: sheet.name,
                    row: exerciseRow + 1,
                    blockColumn: baseColumn + 1,
                    nameCell: a1(baseColumn, exerciseRow),
                    performanceCell: a1(baseColumn + 5, exerciseRow),
                    rawName: rawName.trim(),
                    muscleTags: typeof muscleTagsValue === "string" ? muscleTagsValue.trim() || null : null,
                    prescribedSets: row[baseColumn + 2] ?? null,
                    prescribedReps: recoverRepTarget(row[baseColumn + 3] ?? null),
                    rawPerformance,
                    rawEffort,
                    mappedRpe: rawEffort === null ? null : effortToRpe(rawEffort),
                    effortNeedsMaxReview: rawEffort === 4,
                    excludedByPolicy,
                    exclusionReason: exclusionRule?.reason ?? null,
                    parsedPerformance,
                });
            }

            const performedExercises = exercises.filter(
                exercise => exercise.rawPerformance !== null && !exercise.excludedByPolicy,
            );
            const excludedExercises = exercises.filter(
                exercise => exercise.rawPerformance !== null && exercise.excludedByPolicy,
            );
            const rawDate = sheet.values[rowIndex]?.[baseColumn + 5] ?? null;
            const parsedDate = parseSourceDate(rawDate);
            const mesocycle = findPrecedingLabel(sheet, rowIndex, 0, MESOCYCLE_LABEL);
            const microcycle = findPrecedingLabel(sheet, rowIndex, baseColumn, MICROCYCLE_LABEL, mesocycle?.row);
            const sourceId = `${sheet.name}!${a1(baseColumn, rowIndex)}`;
            const approvedDate = policy.dateOverrides?.get(sourceId);
            const localDate = approvedDate?.localDate ?? parsedDate.localDate;
            const excludedSessionWindow = policy.excludedSessionWindows?.find(
                window =>
                    window.sheet === sheet.name &&
                    localDate !== null &&
                    localDate >= window.from &&
                    localDate <= window.through,
            );
            const exactFingerprint =
                performedExercises.length === 0
                    ? null
                    : fingerprint({
                          localDate,
                          dayLabel: rawDay.trim(),
                          exercises: performedExercises.map(exercise => ({
                              name: normalizeLabel(exercise.rawName),
                              performance: normalizeWhitespace(exercise.rawPerformance ?? ""),
                              effort: exercise.rawEffort,
                          })),
                      });

            sessions.push({
                sourceId,
                sheet: sheet.name,
                mesocycle: mesocycle?.label ?? null,
                microcycle: microcycle?.label ?? null,
                dayLabel: rawDay.trim(),
                headerRow: rowIndex + 1,
                blockColumn: baseColumn + 1,
                headerCell: a1(baseColumn, rowIndex),
                rawDate,
                localDate,
                dateError: approvedDate ? null : parsedDate.error,
                dateCorrection: approvedDate ? { ...approvedDate, originalLocalDate: parsedDate.localDate } : undefined,
                exercises,
                performedExercises,
                excludedExercises,
                hasPerformance: performedExercises.length > 0,
                sessionExclusion: excludedSessionWindow ? { reason: excludedSessionWindow.reason } : undefined,
                exactFingerprint,
            });
        }
    }

    return sessions;
}

function findNextDayRow(sheet: WorkbookSheetSnapshot, startRow: number, column: number): number | null {
    for (let row = startRow; row < sheet.values.length; row += 1) {
        const value = sheet.values[row]?.[column];
        if (typeof value === "string" && DAY_LABEL.test(value.trim())) return row;
    }
    return null;
}

function findPrecedingLabel(
    sheet: WorkbookSheetSnapshot,
    fromRow: number,
    column: number,
    pattern: RegExp,
    lowerBound = 0,
): { label: string; row: number } | null {
    for (let row = fromRow; row >= lowerBound; row -= 1) {
        const value = sheet.values[row]?.[column];
        if (typeof value === "string" && pattern.test(value.trim())) return { label: value.trim(), row };
    }
    return null;
}

function deduplicateCompletedSessions(sessions: readonly SourceSession[]): {
    duplicates: ExactDuplicateGroup[];
    distinct: SourceSession[];
} {
    const byFingerprint = new Map<string, SourceSession[]>();
    for (const session of sessions) {
        if (!session.exactFingerprint) continue;
        const values = byFingerprint.get(session.exactFingerprint) ?? [];
        values.push(session);
        byFingerprint.set(session.exactFingerprint, values);
    }

    const duplicateIds = new Set<string>();
    const duplicates: ExactDuplicateGroup[] = [];
    for (const [fingerprintValue, values] of byFingerprint) {
        if (values.length < 2) continue;
        const [canonical, ...copies] = values;
        if (!canonical) continue;
        copies.forEach(copy => duplicateIds.add(copy.sourceId));
        duplicates.push({
            fingerprint: fingerprintValue,
            localDate: canonical.localDate,
            canonicalSourceId: canonical.sourceId,
            duplicateSourceIds: copies.map(copy => copy.sourceId),
        });
    }

    return { duplicates, distinct: sessions.filter(session => !duplicateIds.has(session.sourceId)) };
}

function groupDateConflicts(sessions: readonly SourceSession[]): DateConflictGroup[] {
    const byDate = new Map<string, SourceSession[]>();
    for (const session of sessions) {
        if (!session.localDate) continue;
        const values = byDate.get(session.localDate) ?? [];
        values.push(session);
        byDate.set(session.localDate, values);
    }
    return [...byDate]
        .filter(([, values]) => values.length > 1)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([localDate, values]) => ({ localDate, sourceIds: values.map(value => value.sourceId) }));
}

function fingerprint(value: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeLabel(value: string): string {
    return normalizeWhitespace(value).toLocaleLowerCase("en-US");
}

function normalizeWhitespace(value: string): string {
    return value.trim().normalize("NFKC").replace(/\s+/g, " ");
}

function a1(columnIndex: number, rowIndex: number): string {
    let column = "";
    for (let value = columnIndex + 1; value > 0; value = Math.floor((value - 1) / 26))
        column = String.fromCharCode(65 + ((value - 1) % 26)) + column;
    return `${column}${rowIndex + 1}`;
}

export function isSuspiciousZeroLoad(exercise: SourceExercise): boolean {
    return (
        (exercise.parsedPerformance?.sets.some(set => set.loadKg === 0) ?? false) &&
        !plausiblyBodyweightExercise(exercise.rawName)
    );
}
