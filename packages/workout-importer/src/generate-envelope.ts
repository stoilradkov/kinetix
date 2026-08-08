import crypto from "node:crypto";

import {
    historicalImportEnvelopeSchema,
    type BulkProgramInput,
    type BulkProposedExercise,
    type HistoricalCompletedSession,
    type HistoricalImportEnvelope,
} from "@kinetix/types";

import { catalogSlugForCanonicalName, canonicalizeSourceExerciseName } from "#src/exercise-canonicalization";
import { buildLoadInferenceSuggestions } from "#src/load-inference";
import type {
    ExerciseCatalogItem,
    ExerciseCatalogSnapshot,
    HistoricalEnvelopeAudit,
    LoadInferenceSuggestion,
    SourceExercise,
    SourceSession,
    TaxonomyCatalogItem,
    TaxonomyCatalogSnapshot,
    WorkbookAnalysis,
} from "#src/model";
import { plausiblyBodyweightExercise } from "#src/policy";

const DEFAULT_NAMESPACE = "stoil-workout-history-v1";
const GENERATED_BY = "@kinetix/workout-importer@0.1.0";
const DURATION_EXERCISE = /\b(plank|wall sit)\b/i;

export interface HistoricalProgramMetadata {
    readonly name: string;
    readonly rationale: string;
}

const PROGRAM_METADATA: Readonly<Record<string, HistoricalProgramMetadata>> = {
    Лист1: {
        name: "Full Body 3-Day — Summer 2021",
        rationale: "inferred from three weekly sessions that each combine lower-body, push, and pull work",
    },
    Hyperthrophy: {
        name: "Hypertrophy 4-Day — 2021–2022",
        rationale: "normalized from the source title and its four-day hypertrophy structure",
    },
    SpeedPower: {
        name: "Speed & Power 4-Day — 2022",
        rationale: "normalized from the source title and its four-day speed, power, and strength structure",
    },
    PPLUL: {
        name: "Push/Pull/Legs/Upper/Lower — 2022–2023",
        rationale: "expanded from the source PPLUL title and five-day split",
    },
    Лист8: {
        name: "Push/Pull/Legs/Upper/Lower — Spring 2023",
        rationale: "inferred from the recurring push, pull, legs, upper, and lower day sequence",
    },
    Лист10: {
        name: "Olympic Power + Upper/Lower Hybrid — 2023–2024",
        rationale: "inferred from Olympic-lift and plyometric A sessions paired with upper/lower strength sessions",
    },
    Лист11: {
        name: "Upper/Lower/Upper/Lower/Upper — 2024",
        rationale: "inferred from the recurring five-day upper, lower, upper, lower, and upper-accessory sequence",
    },
    ULULU: {
        name: "Upper/Lower/Upper/Lower/Upper — Winter 2024–2025",
        rationale: "expanded from the source ULULU title and five-day split",
    },
    PPLUL2: {
        name: "Push/Pull/Legs/Upper/Lower 2 — 2025",
        rationale: "expanded from the source PPLUL2 title and five-day split",
    },
    "PPLUL3-Autumn": {
        name: "Push/Pull/Legs/Upper/Lower 3 — Autumn 2025",
        rationale: "expanded from the source PPLUL3-Autumn title and five-day split",
    },
    Explosivepower: {
        name: "Explosive Power — Winter 2025–2026",
        rationale: "normalized from the source title and its power-focused upper/lower structure",
    },
    "ULULR - 2026 winter": {
        name: "Upper/Lower/Upper/Lower/Recovery — Winter 2026",
        rationale: "expanded from the source ULULR title and five-day split",
    },
    Лист25: {
        name: "Upper/Lower 4-Day — Summer 2026",
        rationale: "inferred from the recurring upper, lower, upper, and lower day sequence",
    },
};

interface EnvelopeCatalogs {
    readonly exercises: ExerciseCatalogSnapshot;
    readonly equipment: TaxonomyCatalogSnapshot;
    readonly movementPatterns: TaxonomyCatalogSnapshot;
    readonly muscles: TaxonomyCatalogSnapshot;
}

interface ExerciseResolution {
    readonly canonicalName: string;
    readonly catalogItem: ExerciseCatalogItem | null;
    readonly proposed: BulkProposedExercise | null;
}

interface GeneratedSessionPair {
    readonly planned: NonNullable<BulkProgramInput["sessions"]>[number];
    readonly completed: HistoricalCompletedSession;
}

export interface GeneratedHistoricalEnvelope {
    readonly envelope: HistoricalImportEnvelope;
    readonly audit: HistoricalEnvelopeAudit;
}

export interface HistoricalEnvelopeOptions {
    readonly namespace?: string;
}

export function buildHistoricalImportEnvelope(
    analysis: WorkbookAnalysis,
    catalogs: EnvelopeCatalogs,
    options: HistoricalEnvelopeOptions = {},
): GeneratedHistoricalEnvelope {
    assertAnalysisReady(analysis);
    const loadSuggestions = buildLoadInferenceSuggestions(
        analysis.distinctCompletedSessions,
        analysis.policy.assumedBodyweightKg,
    );
    const loadBySource = new Map(loadSuggestions.map(value => [loadKey(value.sourceId, value.performanceCell), value]));
    const resolutions = buildExerciseResolutions(analysis.distinctCompletedSessions, catalogs);

    const programs: BulkProgramInput[] = [];
    const completedSessions: HistoricalCompletedSession[] = [];
    for (const sheet of analysis.includedSheets) {
        const sessions = analysis.distinctCompletedSessions
            .filter(session => session.sheet === sheet)
            .sort(compareSessions);
        if (sessions.length === 0) continue;
        const programExternalId = programId(sheet);
        const metadata = historicalProgramMetadata(sheet);
        const startDate = sessions[0]!.localDate!;
        const endDate = sessions.at(-1)!.localDate!;
        const blocks = buildBlocks(sheet, metadata.name, sessions);
        const pairs = sessions.map((session, sequence) =>
            buildSessionPair(
                session,
                sequence,
                programExternalId,
                startDate,
                blocks.sessionBlockIds.get(session.sourceId) ?? [],
                resolutions,
                loadBySource,
                analysis.policy.assumedBodyweightKg,
            ),
        );

        programs.push({
            externalId: programExternalId,
            name: metadata.name,
            description: `Historical program reconstructed from workbook sheet '${sheet}'; ${metadata.rationale}.`,
            scheduleMode: "dated",
            startDate,
            endDate,
            blocks: blocks.blocks,
            sessions: pairs.map(pair => pair.planned),
        });
        completedSessions.push(...pairs.map(pair => pair.completed));
    }

    const unsignedEnvelope = {
        schemaVersion: 1 as const,
        source: {
            namespace: options.namespace ?? DEFAULT_NAMESPACE,
            generatedBy: GENERATED_BY,
            payloadId: `workouts-${analysis.source.sha256.slice(0, 16)}`,
        },
        mode: "create" as const,
        createMissingExercises: true,
        programs,
        completedSessions,
    };
    const checksum = sha256(canonicalize(unsignedEnvelope));
    const envelope = historicalImportEnvelopeSchema.parse({
        ...unsignedEnvelope,
        source: { ...unsignedEnvelope.source, checksum },
    });
    const uniqueResolutions = [...resolutions.values()];

    return {
        envelope,
        audit: {
            sourceWorkbookSha256: analysis.source.sha256,
            payloadChecksum: checksum,
            programs: programs.length,
            plannedSessions: programs.reduce((total, program) => total + (program.sessions?.length ?? 0), 0),
            completedSessions: completedSessions.length,
            strengthActivities: completedSessions.reduce((total, session) => total + session.activities.length, 0),
            exerciseOccurrences: completedSessions.reduce(
                (total, session) =>
                    total +
                    session.activities.reduce(
                        (activityTotal, activity) =>
                            activityTotal + (activity.type === "strength" ? activity.strength.occurrences.length : 0),
                        0,
                    ),
                0,
            ),
            performedSets: completedSessions.reduce(
                (total, session) =>
                    total +
                    session.activities.reduce(
                        (activityTotal, activity) =>
                            activityTotal +
                            (activity.type === "strength"
                                ? activity.strength.occurrences.reduce(
                                      (occurrenceTotal, occurrence) =>
                                          occurrenceTotal + occurrence.performedSets.length,
                                      0,
                                  )
                                : 0),
                        0,
                    ),
                0,
            ),
            existingCatalogExercises: uniqueResolutions.filter(value => value.catalogItem !== null).length,
            proposedExercises: uniqueResolutions.filter(value => value.proposed !== null).length,
            programSummaries: programs.map(program => ({
                sourceSheet: program.externalId?.slice("program:".length) ?? program.name,
                name: program.name,
                startDate: program.startDate!,
                endDate: program.endDate!,
                plannedSessions: program.sessions?.length ?? 0,
                macrocycles: program.blocks?.filter(block => block.type === "macrocycle").length ?? 0,
                mesocycles: program.blocks?.filter(block => block.type === "mesocycle").length ?? 0,
                microcycles: program.blocks?.filter(block => block.type === "microcycle").length ?? 0,
            })),
            inferredZeroLoadRows: {
                bodyweight: loadSuggestions.filter(value => value.status === "bodyweight").length,
                surroundingValue: loadSuggestions.filter(value => value.status === "suggested").length,
                unresolved: loadSuggestions.filter(value => value.status === "unresolved").length,
            },
        },
    };
}

export function historicalProgramMetadata(sheet: string): HistoricalProgramMetadata {
    return (
        PROGRAM_METADATA[sheet] ?? {
            name: sheet,
            rationale: "preserved from the source sheet title",
        }
    );
}

function assertAnalysisReady(analysis: WorkbookAnalysis): void {
    if (analysis.summary.parseErrorRows > 0)
        throw new Error(`Cannot generate an envelope with ${analysis.summary.parseErrorRows} parse-error rows`);
    if (analysis.summary.invalidOrMissingDates > 0)
        throw new Error(`Cannot generate an envelope with ${analysis.summary.invalidOrMissingDates} invalid dates`);
    if (analysis.distinctCompletedSessions.length === 0) throw new Error("No completed sessions remain after cleanup");
}

function buildExerciseResolutions(
    sessions: readonly SourceSession[],
    catalogs: EnvelopeCatalogs,
): ReadonlyMap<string, ExerciseResolution> {
    const exercises = sessions.flatMap(session => session.performedExercises);
    const byCanonical = new Map<string, SourceExercise[]>();
    for (const exercise of exercises) {
        const canonicalName = canonicalizeSourceExerciseName(exercise.rawName);
        const values = byCanonical.get(canonicalName) ?? [];
        values.push(exercise);
        byCanonical.set(canonicalName, values);
    }

    return new Map(
        [...byCanonical.entries()].map(([canonicalName, values]) => {
            const catalogSlug = catalogSlugForCanonicalName(canonicalName) ?? slugify(canonicalName);
            const catalogItem = catalogs.exercises.items.find(item => item.slug === catalogSlug) ?? null;
            return [
                canonicalName,
                {
                    canonicalName,
                    catalogItem,
                    proposed: catalogItem ? null : proposeExercise(canonicalName, values, catalogs),
                },
            ];
        }),
    );
}

function proposeExercise(
    canonicalName: string,
    sources: readonly SourceExercise[],
    catalogs: EnvelopeCatalogs,
): BulkProposedExercise {
    const bodyweight = plausiblyBodyweightExercise(canonicalName);
    const duration = DURATION_EXERCISE.test(canonicalName);
    const equipmentSlug = inferEquipment(canonicalName, bodyweight);
    const movementSlug = inferMovement(canonicalName);
    const primaryMuscleSlug = inferPrimaryMuscle(canonicalName, sources);
    const unilateral = /\b(one arm|one hand|one leg|single arm|single leg|unilateral)\b/i.test(canonicalName);
    const loadModel = duration ? "none" : bodyweight ? "full_bodyweight_plus_added_minus_assistance" : "external_only";
    const supportedMeasurements: BulkProposedExercise["supportedMeasurements"] = duration
        ? ["duration"]
        : bodyweight
          ? ["repetitions", "bodyweight", "added_load", "assistance"]
          : ["repetitions", "external_load"];

    return {
        name: titleCase(canonicalName),
        slug: slugify(canonicalName),
        equipmentTypeId: taxonomyId(catalogs.equipment, equipmentSlug, "equipment"),
        movementPatternId: taxonomyId(catalogs.movementPatterns, movementSlug, "movement pattern"),
        classification: inferClassification(canonicalName),
        laterality: unilateral ? "unilateral" : "bilateral",
        bodyPosition: inferBodyPosition(canonicalName),
        repetitionSemantics: unilateral ? "per_side" : "total",
        loadModel,
        supportedMeasurements,
        muscles: [
            {
                muscleGroupId: taxonomyId(catalogs.muscles, primaryMuscleSlug, "muscle"),
                role: "primary",
            },
        ],
    };
}

function buildSessionPair(
    session: SourceSession,
    sequence: number,
    programExternalId: string,
    programStartDate: string,
    blockExternalIds: readonly string[],
    resolutions: ReadonlyMap<string, ExerciseResolution>,
    loadBySource: ReadonlyMap<string, LoadInferenceSuggestion>,
    assumedBodyweightKg: number,
): GeneratedSessionPair {
    const sourceId = session.sourceId;
    const plannedSessionExternalId = plannedSessionId(sourceId);
    const plannedActivityExternalId = `planned-activity:${sourceId}:0`;
    const actualSessionExternalId = `session:${sourceId}`;
    const actualActivityExternalId = `activity:${sourceId}:0`;
    const dayOffset = daysBetween(programStartDate, session.localDate!);

    const plannedExercises: NonNullable<
        Extract<
            NonNullable<NonNullable<BulkProgramInput["sessions"]>[number]["prescription"]>["activities"][number],
            { type: "strength" }
        >["exercises"]
    > = [];
    const occurrences: Extract<
        HistoricalCompletedSession["activities"][number],
        { type: "strength" }
    >["strength"]["occurrences"] = [];
    const occurrenceMappings: NonNullable<NonNullable<HistoricalCompletedSession["programMapping"]>["occurrences"]> =
        [];
    const setMappings: NonNullable<NonNullable<HistoricalCompletedSession["programMapping"]>["sets"]> = [];

    session.performedExercises.forEach((exercise, exerciseIndex) => {
        const canonicalName = canonicalizeSourceExerciseName(exercise.rawName);
        const resolution = resolutions.get(canonicalName);
        if (!resolution) throw new Error(`Missing exercise resolution for '${canonicalName}'`);
        const exerciseRef = `exercise-${exerciseIndex}`;
        const plannedExerciseExternalId = `planned-exercise:${sourceId}:${exerciseIndex}`;
        const occurrenceExternalId = `occurrence:${sourceId}:${exerciseIndex}`;
        const parsedSets = exercise.parsedPerformance?.sets ?? [];
        const plannedSets = parsedSets.map((set, setIndex) => {
            const externalId = `planned-set:${sourceId}:${exerciseIndex}:${setIndex}`;
            return {
                externalId,
                position: setIndex,
                setType: "working" as const,
                ...(supportsRepetitions(resolution)
                    ? { targets: { repsMin: set.repetitions, repsMax: set.repetitions } }
                    : {}),
            };
        });
        const reference = resolution.catalogItem
            ? ({ by: "id" as const, exerciseId: resolution.catalogItem.id } as const)
            : ({ by: "alias" as const, alias: canonicalName } as const);
        plannedExercises.push({
            externalId: plannedExerciseExternalId,
            ref: exerciseRef,
            reference,
            ...(resolution.proposed ? { proposed: resolution.proposed } : {}),
            position: exerciseIndex,
            purpose: `Imported from ${exercise.nameCell}: ${exercise.rawName}`,
            sets: plannedSets,
        });

        const historicalReference = resolution.catalogItem
            ? ({ by: "id" as const, exerciseId: resolution.catalogItem.id } as const)
            : ({ by: "slug" as const, slug: resolution.proposed!.slug! } as const);
        const loadSuggestion = loadBySource.get(loadKey(sourceId, exercise.performanceCell));
        const performedSets = parsedSets.map((set, setIndex) => {
            const plannedSetExternalId = `planned-set:${sourceId}:${exerciseIndex}:${setIndex}`;
            const performedSetExternalId = `performed-set:${sourceId}:${exerciseIndex}:${setIndex}`;
            setMappings.push({
                prescribedSetExternalId: plannedSetExternalId,
                performedSetRef: performedSetExternalId,
                relation: "matched",
            });
            const normalizedLoad =
                set.loadKg === 0 && loadSuggestion?.status === "suggested"
                    ? loadSuggestion.suggestedLoadKg!
                    : set.loadKg;
            return {
                externalId: performedSetExternalId,
                position: setIndex,
                setType: "working" as const,
                status: "completed" as const,
                measurements: performedMeasurements(
                    resolution,
                    set.repetitions,
                    normalizedLoad,
                    exercise.mappedRpe,
                    assumedBodyweightKg,
                ),
            };
        });
        occurrences.push({
            externalId: occurrenceExternalId,
            reference: historicalReference,
            ...(resolution.proposed ? { proposed: resolution.proposed } : {}),
            position: exerciseIndex,
            notes: `Source ${exercise.performanceCell}: ${exercise.rawName}; ${exercise.rawPerformance ?? ""}`,
            performedSets,
        });
        occurrenceMappings.push({
            prescribedExerciseExternalId: plannedExerciseExternalId,
            occurrenceRef: occurrenceExternalId,
            relation: "matched",
        });
    });

    const title = `${session.dayLabel}${session.microcycle ? ` · ${session.microcycle}` : ""}`;
    return {
        planned: {
            externalId: plannedSessionExternalId,
            title,
            sequence,
            relativeWeek: Math.floor(dayOffset / 7),
            relativeDay: dayOffset % 7,
            timeZone: "Europe/Athens",
            notes: `Source ${sourceId}; reconstructed from performed work.`,
            blockExternalIds: [...blockExternalIds],
            prescription: {
                notes: `Source workbook session ${sourceId}.`,
                activities: [
                    {
                        type: "strength",
                        externalId: plannedActivityExternalId,
                        position: 0,
                        exercises: plannedExercises,
                    },
                ],
            },
        },
        completed: {
            externalId: actualSessionExternalId,
            status: "completed",
            title,
            localDate: session.localDate!,
            timeZone: "Europe/Athens",
            notes: session.dateCorrection
                ? `Source ${sourceId}. Date corrected from ${String(session.rawDate)}: ${session.dateCorrection.reason}`
                : `Source ${sourceId}.`,
            tags: ["historical-import"],
            activities: [
                {
                    type: "strength",
                    externalId: actualActivityExternalId,
                    position: 0,
                    notes: "Imported strength performance.",
                    strength: { occurrences },
                },
            ],
            programMapping: {
                plannedLink: { programExternalId, plannedSessionExternalId },
                activities: [
                    {
                        prescribedActivityExternalId: plannedActivityExternalId,
                        actualActivityRef: actualActivityExternalId,
                        relation: "matched",
                    },
                ],
                occurrences: occurrenceMappings,
                sets: setMappings,
            },
        },
    };
}

function performedMeasurements(
    resolution: ExerciseResolution,
    repetitions: number,
    loadKg: number,
    rpe: number | null,
    assumedBodyweightKg: number,
): NonNullable<
    Extract<
        HistoricalCompletedSession["activities"][number],
        { type: "strength" }
    >["strength"]["occurrences"][number]["performedSets"][number]["measurements"]
> {
    const supported = new Set(
        resolution.catalogItem?.supportedMeasurements ?? resolution.proposed?.supportedMeasurements ?? [],
    );
    const measurements: Record<string, unknown> = {};
    if (supported.has("repetitions")) measurements.reps = repetitions;
    if (supported.has("external_load")) measurements.externalLoad = { value: loadKg, unit: "kg" };
    if (supported.has("bodyweight")) measurements.bodyweight = { value: assumedBodyweightKg, unit: "kg" };
    if (loadKg > 0 && supported.has("added_load")) measurements.addedLoad = { value: loadKg, unit: "kg" };
    if (supported.has("effective_load"))
        measurements.effectiveLoad = { value: assumedBodyweightKg + Math.max(loadKg, 0), unit: "kg" };
    if (rpe !== null) measurements.rpe = rpe;
    return measurements;
}

function supportsRepetitions(resolution: ExerciseResolution): boolean {
    return (resolution.catalogItem?.supportedMeasurements ?? resolution.proposed?.supportedMeasurements ?? []).includes(
        "repetitions",
    );
}

function buildBlocks(
    sheet: string,
    programName: string,
    sessions: readonly SourceSession[],
): {
    readonly blocks: NonNullable<BulkProgramInput["blocks"]>;
    readonly sessionBlockIds: ReadonlyMap<string, readonly string[]>;
} {
    const blocks: NonNullable<BulkProgramInput["blocks"]> = [];
    const sessionBlockIds = new Map<string, readonly string[]>();
    const macroId = `block:${sheet}:macro`;
    const macroRange = dateRange(sessions);
    blocks.push({
        externalId: macroId,
        type: "macrocycle",
        label: programName,
        position: 0,
        startDate: macroRange.start,
        endDate: macroRange.end,
    });

    const mesoGroups = groupOrdered(sessions, session => session.mesocycle ?? "Unlabelled mesocycle");
    let blockPosition = 1;
    mesoGroups.forEach((mesoSessions, mesoIndex) => {
        const mesoId = `block:${sheet}:meso:${mesoIndex}`;
        const range = dateRange(mesoSessions);
        blocks.push({
            externalId: mesoId,
            parentExternalId: macroId,
            type: "mesocycle",
            label: mesoSessions[0]!.mesocycle ?? "Unlabelled mesocycle",
            position: blockPosition++,
            startDate: range.start,
            endDate: range.end,
        });
        const microGroups = groupOrdered(mesoSessions, session => session.microcycle ?? "Unlabelled microcycle");
        microGroups.forEach((microSessions, microIndex) => {
            const microId = `block:${sheet}:meso:${mesoIndex}:micro:${microIndex}`;
            const microRange = dateRange(microSessions);
            blocks.push({
                externalId: microId,
                parentExternalId: mesoId,
                type: "microcycle",
                label: microSessions[0]!.microcycle ?? "Unlabelled microcycle",
                position: blockPosition++,
                startDate: microRange.start,
                endDate: microRange.end,
            });
            for (const session of microSessions) sessionBlockIds.set(session.sourceId, [macroId, mesoId, microId]);
        });
    });
    return { blocks, sessionBlockIds };
}

function groupOrdered<T>(values: readonly T[], key: (value: T) => string): T[][] {
    const groups = new Map<string, T[]>();
    for (const value of values) {
        const groupKey = key(value);
        const items = groups.get(groupKey) ?? [];
        items.push(value);
        groups.set(groupKey, items);
    }
    return [...groups.values()];
}

function dateRange(sessions: readonly SourceSession[]): { start: string; end: string } {
    const dates = sessions.map(session => session.localDate!).sort();
    return { start: dates[0]!, end: dates.at(-1)! };
}

function compareSessions(left: SourceSession, right: SourceSession): number {
    return left.localDate!.localeCompare(right.localDate!) || left.sourceId.localeCompare(right.sourceId);
}

function programId(sheet: string): string {
    return `program:${sheet}`;
}

function plannedSessionId(sourceId: string): string {
    return `planned:${sourceId}`;
}

function loadKey(sourceId: string, performanceCell: string): string {
    return `${sourceId}\u0000${performanceCell}`;
}

function daysBetween(from: string, through: string): number {
    const result = (Date.parse(`${through}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
    if (!Number.isInteger(result) || result < 0) throw new Error(`Invalid chronological range ${from} → ${through}`);
    return result;
}

function inferEquipment(name: string, bodyweight: boolean): string {
    if (/dumbbell|\bdb\b/i.test(name)) return "dumbbell";
    if (/barbell|wide grip barbell|incline bench|close grip bench|olympic|clean|snatch|jerk|push press/i.test(name))
        return "barbell";
    if (/kettlebell/i.test(name)) return "kettlebell";
    if (/medicine ball/i.test(name)) return "medicine-ball";
    if (/landmine|t bar/i.test(name)) return "landmine";
    if (/cable|bayesian|pullover|low to high fly/i.test(name)) return "cable";
    if (/machine|hack squat|sled push/i.test(name)) return "machine";
    if (/ring pull/i.test(name)) return "suspension-trainer";
    if (/pull up/i.test(name)) return "pull-up-bar";
    if (bodyweight) return "bodyweight";
    return "barbell";
}

function inferMovement(name: string): string {
    if (/biceps|curl/i.test(name) && !/leg curl|nordic/i.test(name)) return "elbow-flexion";
    if (/triceps|pushdown|tricep/i.test(name)) return "elbow-extension";
    if (/calf|pogo/i.test(name)) return "calf-raise";
    if (/row|rear delt|face pull|shrug/i.test(name)) return "horizontal-pull";
    if (/pull up|pulldown|pullover/i.test(name)) return "vertical-pull";
    if (/overhead|shoulder press|push press|jerk|landmine press|lu raise|lateral raise/i.test(name))
        return "vertical-push";
    if (/bench|push up|chest|fly|dip/i.test(name)) return "horizontal-push";
    if (/lunge|split squat|step up/i.test(name)) return "lunge";
    if (/deadlift|rdl|hinge|clean|snatch|swing|hyper extension|hamstring|nordic|leg curl/i.test(name)) return "hinge";
    if (/plank/i.test(name)) return "anti-extension";
    if (/squat|leg press|leg extension|jump|bounds|skips|fast legs|sled push|wall sit/i.test(name)) return "squat";
    return "isolation";
}

function inferClassification(name: string): "compound" | "isolation" {
    return /curl|extension|raise|fly|pushdown|pullover|face pull|rear delt|hamstring slide|leg curl|wall sit|plank/i.test(
        name,
    )
        ? "isolation"
        : "compound";
}

function inferBodyPosition(name: string): string {
    if (/seated/i.test(name)) return "seated";
    if (/kneeling/i.test(name)) return "kneeling";
    if (/lying|bench press|chest fly|hamstring slide|hip thrust/i.test(name)) return "supine";
    if (/plank|push up|inverted row/i.test(name)) return "prone";
    return "standing";
}

function inferPrimaryMuscle(name: string, sources: readonly SourceExercise[]): string {
    if (/leg curl|hamstring|nordic|rdl|romanian deadlift|hyper extension/i.test(name)) return "hamstrings";
    if (/biceps|curl/i.test(name)) return "biceps";
    if (/triceps|pushdown|close grip bench/i.test(name)) return "triceps";
    if (/bench|chest|fly|push up|dip/i.test(name)) return "chest";
    if (/row|pull up|pulldown|pullover|shrug|back/i.test(name)) return "back";
    if (/shoulder|lateral raise|rear delt|face pull|lu raise|overhead press|push press/i.test(name)) return "shoulders";
    if (/calf|pogo/i.test(name)) return "calves";
    if (/hip thrust|horse kick/i.test(name)) return "glutes";
    if (/plank|crunch/i.test(name)) return "core";
    if (/squat|lunge|leg press|leg extension|split squat|step up|jump|bounds|skips|sled push|wall sit/i.test(name))
        return "quadriceps";
    const tags = new Set(sources.flatMap(source => (source.muscleTags ?? "").split(/[, ]+/).filter(Boolean)));
    if (tags.has("Bi")) return "biceps";
    if (tags.has("T")) return "triceps";
    if (tags.has("C")) return "chest";
    if (tags.has("B")) return "back";
    if (tags.has("S")) return "shoulders";
    if (tags.has("L")) return "quadriceps";
    return "full-body";
}

function taxonomyId(catalog: TaxonomyCatalogSnapshot, slug: string, kind: string): string {
    const item = catalog.items.find(value => value.slug === slug);
    if (!item) throw new Error(`Missing ${kind} taxonomy '${slug}'`);
    return item.id;
}

function titleCase(value: string): string {
    return value.replace(/\b\w/g, character => character.toUpperCase());
}

function slugify(value: string): string {
    return value
        .normalize("NFKD")
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

function canonicalize(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number")
        return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    if (typeof value !== "object") throw new Error("Envelope checksum received a non-JSON value");
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
    return `{${entries.join(",")}}`;
}

function sha256(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

export function validateTaxonomySnapshot(value: TaxonomyCatalogSnapshot, label: string): void {
    if (value.schemaVersion !== 1 || !Array.isArray(value.items)) throw new Error(`Invalid ${label} catalog snapshot`);
    for (const item of value.items as readonly TaxonomyCatalogItem[])
        if (!item.id || !item.slug || !item.name) throw new Error(`Invalid ${label} catalog item`);
}
