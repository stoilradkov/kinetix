export type SnapshotCellValue = string | number | boolean | null;

export interface WorkbookSnapshot {
    readonly schemaVersion: 1;
    readonly source: {
        readonly fileName: string;
        readonly sha256: string;
    };
    readonly sheets: readonly WorkbookSheetSnapshot[];
}

export interface WorkbookSheetSnapshot {
    readonly name: string;
    readonly values: readonly (readonly SnapshotCellValue[])[];
    readonly formulas?: readonly (readonly SnapshotCellValue[])[];
}

export interface ImportPolicy {
    readonly excludedSheets: ReadonlySet<string>;
    readonly excludedExerciseRules: readonly ExcludedExerciseRule[];
    readonly excludedSessionWindows?: readonly ExcludedSessionWindow[];
    readonly assumedBodyweightKg: number;
    readonly timeZone: string;
    readonly rpeApplication: "all_sets";
    readonly dateOverrides?: ReadonlyMap<string, ApprovedDateOverride>;
}

export interface ExcludedExerciseRule {
    readonly pattern: RegExp;
    readonly reason: string;
}

export interface ExcludedSessionWindow {
    readonly sheet: string;
    readonly from: string;
    readonly through: string;
    readonly reason: string;
}

export interface ApprovedDateOverride {
    readonly localDate: string;
    readonly reason: string;
}

export interface ParsedSet {
    readonly loadKg: number;
    readonly repetitions: number;
    readonly segmentIndex: number;
    readonly setIndex: number;
}

export interface ParsedPerformance {
    readonly raw: string;
    readonly sets: readonly ParsedSet[];
    readonly errors: readonly string[];
}

export interface SourceExercise {
    readonly sheet: string;
    readonly row: number;
    readonly blockColumn: number;
    readonly nameCell: string;
    readonly performanceCell: string;
    readonly rawName: string;
    readonly muscleTags: string | null;
    readonly prescribedSets: SnapshotCellValue;
    readonly prescribedReps: SnapshotCellValue;
    readonly rawPerformance: string | null;
    readonly rawEffort: number | null;
    readonly mappedRpe: number | null;
    readonly effortNeedsMaxReview: boolean;
    readonly excludedByPolicy: boolean;
    readonly exclusionReason: string | null;
    readonly parsedPerformance: ParsedPerformance | null;
}

export interface SourceSession {
    readonly sourceId: string;
    readonly sheet: string;
    readonly mesocycle: string | null;
    readonly microcycle: string | null;
    readonly dayLabel: string;
    readonly headerRow: number;
    readonly blockColumn: number;
    readonly headerCell: string;
    readonly rawDate: SnapshotCellValue;
    readonly localDate: string | null;
    readonly dateError: string | null;
    readonly dateCorrection?: ApprovedDateOverride & { readonly originalLocalDate: string | null };
    readonly exercises: readonly SourceExercise[];
    readonly performedExercises: readonly SourceExercise[];
    readonly excludedExercises: readonly SourceExercise[];
    readonly hasPerformance: boolean;
    readonly sessionExclusion?: { readonly reason: string };
    readonly exactFingerprint: string | null;
}

export interface WorkbookAnalysis {
    readonly source: WorkbookSnapshot["source"];
    readonly policy: {
        readonly excludedSheets: readonly string[];
        readonly assumedBodyweightKg: number;
        readonly timeZone: string;
        readonly rpeApplication: "all_sets";
    };
    readonly includedSheets: readonly string[];
    readonly excludedSheets: readonly string[];
    readonly sessions: readonly SourceSession[];
    readonly excludedSessions: readonly SourceSession[];
    readonly completedSessions: readonly SourceSession[];
    readonly exactDuplicateGroups: readonly ExactDuplicateGroup[];
    readonly distinctCompletedSessions: readonly SourceSession[];
    readonly dateConflictGroups: readonly DateConflictGroup[];
    readonly summary: AnalysisSummary;
}

export interface ExactDuplicateGroup {
    readonly fingerprint: string;
    readonly localDate: string | null;
    readonly canonicalSourceId: string;
    readonly duplicateSourceIds: readonly string[];
}

export interface DateConflictGroup {
    readonly localDate: string;
    readonly sourceIds: readonly string[];
}

export interface AnalysisSummary {
    readonly sheetsIncluded: number;
    readonly sheetsExcluded: number;
    readonly rawDayHeaders: number;
    readonly performedSessionCandidates: number;
    readonly completedSessionCandidates: number;
    readonly excludedSessionCandidates: number;
    readonly emptyPlannedSessions: number;
    readonly exactDuplicateSessions: number;
    readonly distinctCompletedSessions: number;
    readonly datesWithDistinctSessions: number;
    readonly performedExerciseRows: number;
    readonly parsedSets: number;
    readonly parseErrorRows: number;
    readonly distinctExerciseLabels: number;
    readonly zeroLoadRows: number;
    readonly suspiciousZeroLoadRows: number;
    readonly invalidOrMissingDates: number;
    readonly excludedExerciseRows: number;
    readonly effortFourRows: number;
}

export interface ExerciseCatalogSnapshot {
    readonly schemaVersion: number;
    readonly items: readonly ExerciseCatalogItem[];
}

export interface TaxonomyCatalogSnapshot {
    readonly schemaVersion: number;
    readonly items: readonly TaxonomyCatalogItem[];
}

export interface TaxonomyCatalogItem {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
}

export interface HistoricalEnvelopeAudit {
    readonly sourceWorkbookSha256: string;
    readonly payloadChecksum: string;
    readonly programs: number;
    readonly plannedSessions: number;
    readonly completedSessions: number;
    readonly strengthActivities: number;
    readonly exerciseOccurrences: number;
    readonly performedSets: number;
    readonly existingCatalogExercises: number;
    readonly proposedExercises: number;
    readonly programSummaries: readonly HistoricalProgramAudit[];
    readonly inferredZeroLoadRows: {
        readonly bodyweight: number;
        readonly surroundingValue: number;
        readonly unresolved: number;
    };
}

export interface HistoricalProgramAudit {
    readonly sourceSheet: string;
    readonly name: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly plannedSessions: number;
    readonly macrocycles: number;
    readonly mesocycles: number;
    readonly microcycles: number;
}

export interface ExerciseCatalogItem {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly ownership: "seeded" | "user";
    readonly equipment: {
        readonly name: string;
        readonly analyticsMappingStatus: string;
    } | null;
    readonly movementPattern: {
        readonly name: string;
        readonly analyticsMappingStatus: string;
    } | null;
    readonly repetitionSemantics: string;
    readonly loadModel: string;
    readonly supportedMeasurements: readonly string[];
}

export interface ExerciseMappingReview {
    readonly normalizedLabel: string;
    readonly sourceLabels: readonly string[];
    readonly occurrences: number;
    readonly status: "exact" | "ambiguous" | "suggested" | "unmatched";
    readonly recommendedExerciseId: string | null;
    readonly candidates: readonly ExerciseMappingCandidate[];
}

export interface ExerciseMappingCandidate {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly ownership: "seeded" | "user";
    readonly equipment: string | null;
    readonly loadModel: string;
    readonly score: number;
    readonly reason: "exact-name-or-alias" | "general-name-similarity";
}

export interface CanonicalExerciseReview {
    readonly canonicalName: string;
    readonly sourceLabels: readonly string[];
    readonly occurrences: number;
    readonly status: "catalog" | "proposed" | "needs_review";
    readonly catalogExerciseId: string | null;
    readonly catalogSlug: string | null;
    readonly reason: string;
    readonly examples: readonly { readonly sourceId: string; readonly rawPerformance: string }[];
}

export interface LoadInferenceSuggestion {
    readonly sourceId: string;
    readonly localDate: string | null;
    readonly sheet: string;
    readonly performanceCell: string;
    readonly exercise: string;
    readonly rawPerformance: string;
    readonly status: "bodyweight" | "suggested" | "unresolved";
    readonly assumedBodyweightKg: number | null;
    readonly suggestedLoadKg: number | null;
    readonly confidence: "high" | "medium" | "low" | null;
    readonly previousEvidence: LoadInferenceEvidence | null;
    readonly nextEvidence: LoadInferenceEvidence | null;
}

export interface LoadInferenceEvidence {
    readonly sourceId: string;
    readonly localDate: string;
    readonly performanceCell: string;
    readonly loadKg: number;
}

export interface DateInferenceSuggestion {
    readonly sourceId: string;
    readonly sheet: string;
    readonly headerCell: string;
    readonly dayLabel: string;
    readonly rawDate: SnapshotCellValue;
    readonly suggestedDate: string | null;
    readonly confidence: "high" | "medium" | "low" | null;
    readonly previousSourceId: string | null;
    readonly previousDate: string | null;
    readonly nextSourceId: string | null;
    readonly nextDate: string | null;
    readonly reason: string;
}
