import fs from "node:fs/promises";
import path from "node:path";

import { buildLoadInferenceSuggestions } from "#src/load-inference";
import { buildDateInferenceSuggestions } from "#src/date-inference";
import type { CanonicalExerciseReview, ExerciseMappingReview, SourceExercise, WorkbookAnalysis } from "#src/model";

export async function writeAnalysisReports(
    analysis: WorkbookAnalysis,
    outputDirectory: string,
    exerciseMappings: readonly ExerciseMappingReview[] = [],
    canonicalExerciseReview: readonly CanonicalExerciseReview[] = [],
): Promise<void> {
    await fs.mkdir(outputDirectory, { recursive: true });
    await writeJson(path.join(outputDirectory, "summary.json"), {
        source: analysis.source,
        policy: analysis.policy,
        includedSheets: analysis.includedSheets,
        excludedSheets: analysis.excludedSheets,
        summary: analysis.summary,
    });
    await writeJson(path.join(outputDirectory, "sessions.json"), analysis.distinctCompletedSessions);

    await writeCsv(path.join(outputDirectory, "excluded-sessions.csv"), [
        ["source_id", "date", "sheet", "day", "reason"],
        ...analysis.excludedSessions.map(session => [
            session.sourceId,
            session.localDate,
            session.sheet,
            session.dayLabel,
            session.sessionExclusion?.reason,
        ]),
    ]);

    const sheetNames = [...new Set(analysis.sessions.map(session => session.sheet))].sort();
    await writeCsv(path.join(outputDirectory, "sheet-summary.csv"), [
        ["sheet", "day_headers", "completed_candidates", "distinct_completed", "empty_planned", "invalid_dates"],
        ...sheetNames.map(sheet => {
            const raw = analysis.sessions.filter(session => session.sheet === sheet);
            const candidates = analysis.completedSessions.filter(session => session.sheet === sheet);
            const distinct = analysis.distinctCompletedSessions.filter(session => session.sheet === sheet);
            return [
                sheet,
                raw.length,
                candidates.length,
                distinct.length,
                raw.length - candidates.length,
                distinct.filter(session => session.localDate === null).length,
            ];
        }),
    ]);

    const performedExercises = analysis.distinctCompletedSessions.flatMap(session => session.performedExercises);
    await writeCsv(path.join(outputDirectory, "excluded-exercises.csv"), [
        ["source_id", "date", "sheet", "cell", "exercise", "raw_performance", "reason"],
        ...analysis.distinctCompletedSessions.flatMap(session =>
            session.excludedExercises.map(exercise => [
                session.sourceId,
                session.localDate,
                exercise.sheet,
                exercise.performanceCell,
                exercise.rawName,
                exercise.rawPerformance,
                exercise.exclusionReason,
            ]),
        ),
    ]);
    const labelGroups = groupExercises(performedExercises);
    await writeCsv(path.join(outputDirectory, "exercise-labels.csv"), [
        ["normalized_label", "source_labels", "occurrences", "sheets"],
        ...[...labelGroups.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([normalized, exercises]) => [
                normalized,
                [...new Set(exercises.map(exercise => exercise.rawName))].sort().join(" | "),
                exercises.length,
                [...new Set(exercises.map(exercise => exercise.sheet))].sort().join(" | "),
            ]),
    ]);

    await writeCsv(path.join(outputDirectory, "parse-errors.csv"), [
        ["source_id", "sheet", "cell", "exercise", "raw_performance", "errors"],
        ...analysis.distinctCompletedSessions.flatMap(session =>
            session.performedExercises
                .filter(exercise => (exercise.parsedPerformance?.errors.length ?? 0) > 0)
                .map(exercise => [
                    session.sourceId,
                    exercise.sheet,
                    exercise.performanceCell,
                    exercise.rawName,
                    exercise.rawPerformance,
                    exercise.parsedPerformance?.errors.join(" | "),
                ]),
        ),
    ]);

    await writeCsv(path.join(outputDirectory, "invalid-dates.csv"), [
        ["source_id", "sheet", "header_cell", "day", "raw_date", "error"],
        ...analysis.distinctCompletedSessions
            .filter(session => session.localDate === null)
            .map(session => [
                session.sourceId,
                session.sheet,
                session.headerCell,
                session.dayLabel,
                String(session.rawDate ?? ""),
                session.dateError,
            ]),
    ]);

    await writeCsv(path.join(outputDirectory, "approved-date-corrections.csv"), [
        ["source_id", "sheet", "header_cell", "raw_date", "original_date", "corrected_date", "reason"],
        ...analysis.completedSessions
            .filter(session => session.dateCorrection !== undefined)
            .map(session => [
                session.sourceId,
                session.sheet,
                session.headerCell,
                String(session.rawDate ?? ""),
                session.dateCorrection?.originalLocalDate,
                session.dateCorrection?.localDate,
                session.dateCorrection?.reason,
            ]),
    ]);

    const dateSuggestions = buildDateInferenceSuggestions(analysis.distinctCompletedSessions);
    await writeJson(path.join(outputDirectory, "date-inference-review.json"), dateSuggestions);
    await writeCsv(path.join(outputDirectory, "date-inference-review.csv"), [
        [
            "source_id",
            "sheet",
            "header_cell",
            "day",
            "raw_date",
            "suggested_date",
            "confidence",
            "previous",
            "next",
            "reason",
        ],
        ...dateSuggestions.map(suggestion => [
            suggestion.sourceId,
            suggestion.sheet,
            suggestion.headerCell,
            suggestion.dayLabel,
            String(suggestion.rawDate ?? ""),
            suggestion.suggestedDate,
            suggestion.confidence,
            suggestion.previousSourceId && suggestion.previousDate
                ? `${suggestion.previousSourceId} ${suggestion.previousDate}`
                : "",
            suggestion.nextSourceId && suggestion.nextDate ? `${suggestion.nextSourceId} ${suggestion.nextDate}` : "",
            suggestion.reason,
        ]),
    ]);

    await writeCsv(path.join(outputDirectory, "exact-duplicates.csv"), [
        ["local_date", "canonical_source_id", "duplicate_source_ids"],
        ...analysis.exactDuplicateGroups.map(group => [
            group.localDate,
            group.canonicalSourceId,
            group.duplicateSourceIds.join(" | "),
        ]),
    ]);

    await writeCsv(path.join(outputDirectory, "date-conflicts.csv"), [
        ["local_date", "session_count", "source_ids"],
        ...analysis.dateConflictGroups.map(group => [
            group.localDate,
            group.sourceIds.length,
            group.sourceIds.join(" | "),
        ]),
    ]);

    const loadSuggestions = buildLoadInferenceSuggestions(
        analysis.distinctCompletedSessions,
        analysis.policy.assumedBodyweightKg,
    );
    await writeJson(path.join(outputDirectory, "zero-load-review.json"), loadSuggestions);
    await writeCsv(path.join(outputDirectory, "zero-load-review.csv"), [
        [
            "source_id",
            "date",
            "sheet",
            "cell",
            "exercise",
            "raw_performance",
            "status",
            "assumed_bodyweight_kg",
            "suggested_load_kg",
            "confidence",
            "previous_evidence",
            "next_evidence",
        ],
        ...loadSuggestions.map(suggestion => [
            suggestion.sourceId,
            suggestion.localDate,
            suggestion.sheet,
            suggestion.performanceCell,
            suggestion.exercise,
            suggestion.rawPerformance,
            suggestion.status,
            suggestion.assumedBodyweightKg,
            suggestion.suggestedLoadKg,
            suggestion.confidence,
            formatEvidence(suggestion.previousEvidence),
            formatEvidence(suggestion.nextEvidence),
        ]),
    ]);

    await writeCsv(path.join(outputDirectory, "effort-four-review.csv"), [
        ["source_id", "date", "sheet", "cell", "exercise", "raw_performance", "default_rpe", "review"],
        ...analysis.distinctCompletedSessions.flatMap(session =>
            session.performedExercises
                .filter(exercise => exercise.rawEffort === 4)
                .map(exercise => [
                    session.sourceId,
                    session.localDate,
                    exercise.sheet,
                    exercise.performanceCell,
                    exercise.rawName,
                    exercise.rawPerformance,
                    exercise.mappedRpe,
                    "set-rpe-10-only-if-failure-or-absolute-max-is-confirmed",
                ]),
        ),
    ]);

    if (exerciseMappings.length > 0) {
        await writeJson(path.join(outputDirectory, "exercise-mapping-review.json"), exerciseMappings);
        await writeCsv(path.join(outputDirectory, "exercise-mapping-review.csv"), [
            ["normalized_label", "source_labels", "occurrences", "status", "recommended_exercise_id", "candidates"],
            ...exerciseMappings.map(mapping => [
                mapping.normalizedLabel,
                mapping.sourceLabels.join(" | "),
                mapping.occurrences,
                mapping.status,
                mapping.recommendedExerciseId,
                mapping.candidates
                    .map(
                        candidate =>
                            `${candidate.name} [${candidate.slug}; ${candidate.ownership}; ${candidate.equipment ?? "no equipment"}; ${candidate.loadModel}; score=${candidate.score}]`,
                    )
                    .join(" | "),
            ]),
        ]);
    }

    if (canonicalExerciseReview.length > 0) {
        await writeJson(path.join(outputDirectory, "canonical-exercise-review.json"), canonicalExerciseReview);
        await writeCsv(path.join(outputDirectory, "canonical-exercise-review.csv"), [
            [
                "canonical_name",
                "source_labels",
                "occurrences",
                "status",
                "catalog_exercise_id",
                "catalog_slug",
                "reason",
                "examples",
            ],
            ...canonicalExerciseReview.map(review => [
                review.canonicalName,
                review.sourceLabels.join(" | "),
                review.occurrences,
                review.status,
                review.catalogExerciseId,
                review.catalogSlug,
                review.reason,
                review.examples.map(example => `${example.sourceId} ${example.rawPerformance}`).join(" | "),
            ]),
        ]);
    }
}

function formatEvidence(
    value: { sourceId: string; localDate: string; performanceCell: string; loadKg: number } | null,
): string {
    return value ? `${value.localDate} ${value.sourceId}/${value.performanceCell} ${value.loadKg}kg` : "";
}

function groupExercises(exercises: readonly SourceExercise[]): Map<string, SourceExercise[]> {
    const groups = new Map<string, SourceExercise[]>();
    for (const exercise of exercises) {
        const key = exercise.rawName.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
        const values = groups.get(key) ?? [];
        values.push(exercise);
        groups.set(key, values);
    }
    return groups;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeCsv(filePath: string, rows: readonly (readonly unknown[])[]): Promise<void> {
    const content = rows.map(row => row.map(csvValue).join(",")).join("\n");
    await fs.writeFile(filePath, `${content}\n`, "utf8");
}

function csvValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new TypeError("CSV report values must be strings, numbers, booleans, null, or undefined");
    }
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
