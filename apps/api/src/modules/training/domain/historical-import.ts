import { DomainValidationError } from "#src/platform/domain/index";

/**
 * Pure identity and aggregate-boundary validation for the historical-import contract (issue #55;
 * design §14; ADR 0003). The Zod wire contract (`@kinetix/types` `historicalImportEnvelopeSchema`)
 * validates the *shape* of one payload node at a time; it cannot see across nodes. This module adds
 * the cross-node invariants that make an already-normalized archive deterministically addressable:
 *
 *  1. **Bounded size** for multi-year archives, so one payload cannot expand without limit.
 *  2. **External-ID uniqueness per entity type**, mirroring the `(namespace, entityType, externalId)`
 *     uniqueness the persistence registry enforces (`bulk_external_ids`) — a duplicate here would
 *     otherwise surface only as a database conflict at commit.
 *  3. **Mapping / structural reference resolution**: every planned/actual mapping and every intra-session
 *     structural reference (set-group parents, group members, performed-set → set-group, run-step
 *     parents, pain-record targets) must resolve to an `externalId` that exists in the payload.
 *
 * Everything here is framework-, clock-, and database-free. It throws {@link DomainValidationError}
 * with path-anchored field errors so the presentation layer can surface the exact offending node.
 */

/** Bounded limits suitable for a multi-year archive committed as one payload. */
export const HISTORICAL_IMPORT_LIMITS = {
    maxPrograms: 200,
    maxCompletedSessions: 20_000,
    maxActivitiesPerSession: 40,
    maxOccurrencesPerActivity: 60,
    maxSetsPerOccurrence: 60,
    maxSetGroupsPerActivity: 60,
    maxRunStepsPerActivity: 200,
    maxPainRecordsPerSession: 200,
} as const;

/** The import-addressable aggregate kinds; each is a distinct external-ID uniqueness namespace. */
export type HistoricalEntityType =
    | "program"
    | "program-block"
    | "planned-session"
    | "planned-activity"
    | "planned-exercise"
    | "planned-set"
    | "training-session"
    | "session-activity"
    | "occurrence"
    | "set-group"
    | "performed-set"
    | "run-step"
    | "run-split"
    | "pain-record";

type Path = readonly (string | number)[];

// ---------------------------------------------------------------------------------------------
// Minimal structural input (subset of the parsed wire contract this module traverses)
// ---------------------------------------------------------------------------------------------

interface ProgramSetInput {
    readonly externalId?: string;
}
interface ProgramExerciseInput {
    readonly externalId?: string;
    readonly sets?: readonly ProgramSetInput[];
}
interface ProgramActivityInput {
    readonly externalId?: string;
    readonly exercises?: readonly ProgramExerciseInput[];
}
interface ProgramSessionInput {
    readonly externalId: string;
    readonly prescription?: { readonly activities?: readonly ProgramActivityInput[] };
}
interface ProgramInput {
    readonly externalId?: string;
    readonly blocks?: readonly { readonly externalId: string }[];
    readonly sessions?: readonly ProgramSessionInput[];
}

interface PerformedSetInput {
    readonly externalId: string;
    readonly setGroupRef?: string | null;
}
interface OccurrenceInput {
    readonly externalId: string;
    readonly performedSets?: readonly PerformedSetInput[];
}
interface SetGroupInput {
    readonly externalId: string;
    readonly parentGroupRef?: string | null;
    readonly members?: readonly { readonly occurrenceRef: string }[];
}
interface RunStepInput {
    readonly externalId: string;
    readonly parentStepRef?: string | null;
}
interface RunSplitInput {
    readonly externalId: string;
}
interface SessionActivityInput {
    readonly externalId: string;
    readonly strength?: {
        readonly occurrences?: readonly OccurrenceInput[];
        readonly setGroups?: readonly SetGroupInput[];
    };
    readonly running?: { readonly steps?: readonly RunStepInput[]; readonly splits?: readonly RunSplitInput[] };
}
interface PainRecordInput {
    readonly externalId: string;
    readonly activityRef?: string | null;
    readonly occurrenceRef?: string | null;
    readonly performedSetRef?: string | null;
}
interface MappingRefInput {
    readonly prescribedActivityExternalId?: string | null;
    readonly prescribedExerciseExternalId?: string | null;
    readonly prescribedSetExternalId?: string | null;
    readonly actualActivityRef?: string;
    readonly occurrenceRef?: string;
    readonly performedSetRef?: string;
}
interface ProgramMappingInput {
    readonly plannedLink?: { readonly programExternalId: string; readonly plannedSessionExternalId: string } | null;
    readonly activities?: readonly MappingRefInput[];
    readonly occurrences?: readonly MappingRefInput[];
    readonly sets?: readonly MappingRefInput[];
}
interface CompletedSessionInput {
    readonly externalId: string;
    readonly activities?: readonly SessionActivityInput[];
    readonly painRecords?: readonly PainRecordInput[];
    readonly programMapping?: ProgramMappingInput | null;
}
export interface HistoricalImportInput {
    readonly programs?: readonly ProgramInput[];
    readonly completedSessions?: readonly CompletedSessionInput[];
}

// ---------------------------------------------------------------------------------------------
// Size limits
// ---------------------------------------------------------------------------------------------

/** Reject an over-large archive before any cross-reference work. Throws with the exceeded dimension. */
export function assertWithinHistoricalImportLimits(payload: HistoricalImportInput): void {
    const errors: string[] = [];
    over(payload.programs?.length ?? 0, HISTORICAL_IMPORT_LIMITS.maxPrograms, "programs", errors);
    over(
        payload.completedSessions?.length ?? 0,
        HISTORICAL_IMPORT_LIMITS.maxCompletedSessions,
        "completed sessions",
        errors,
    );
    for (const session of payload.completedSessions ?? []) {
        const activities = session.activities ?? [];
        over(activities.length, HISTORICAL_IMPORT_LIMITS.maxActivitiesPerSession, "activities in a session", errors);
        over(
            session.painRecords?.length ?? 0,
            HISTORICAL_IMPORT_LIMITS.maxPainRecordsPerSession,
            "pain records in a session",
            errors,
        );
        for (const activity of activities) {
            const occurrences = activity.strength?.occurrences ?? [];
            over(
                occurrences.length,
                HISTORICAL_IMPORT_LIMITS.maxOccurrencesPerActivity,
                "occurrences in an activity",
                errors,
            );
            over(
                activity.strength?.setGroups?.length ?? 0,
                HISTORICAL_IMPORT_LIMITS.maxSetGroupsPerActivity,
                "set groups in an activity",
                errors,
            );
            over(
                activity.running?.steps?.length ?? 0,
                HISTORICAL_IMPORT_LIMITS.maxRunStepsPerActivity,
                "run steps in an activity",
                errors,
            );
            for (const occurrence of occurrences)
                over(
                    occurrence.performedSets?.length ?? 0,
                    HISTORICAL_IMPORT_LIMITS.maxSetsPerOccurrence,
                    "sets in an occurrence",
                    errors,
                );
        }
    }
    if (errors.length > 0)
        throw new DomainValidationError("Historical import exceeds bounded payload limits", { limits: errors });
}

function over(value: number, limit: number, label: string, errors: string[]): void {
    if (value > limit) errors.push(`Too many ${label}: ${value} exceeds ${limit}`);
}

// ---------------------------------------------------------------------------------------------
// External-ID uniqueness
// ---------------------------------------------------------------------------------------------

/**
 * Reject duplicate external IDs within any single entity-type namespace. Mirrors the
 * `(namespace, entityType, externalId)` uniqueness the persistence registry enforces so a colliding
 * ID fails deterministically here rather than as a late database conflict.
 */
export function assertUniqueExternalIds(payload: HistoricalImportInput): void {
    const seen = new Map<HistoricalEntityType, Set<string>>();
    const duplicates: Record<string, string[]> = {};
    const record = (type: HistoricalEntityType, id: string | undefined, path: Path): void => {
        if (id === undefined) return;
        const bucket = seen.get(type) ?? new Set<string>();
        if (bucket.has(id)) push(duplicates, path, `Duplicate ${type} external id "${id}"`);
        bucket.add(id);
        seen.set(type, bucket);
    };

    payload.programs?.forEach((program, p) => {
        record("program", program.externalId, ["programs", p, "externalId"]);
        program.blocks?.forEach((block, b) =>
            record("program-block", block.externalId, ["programs", p, "blocks", b, "externalId"]),
        );
        program.sessions?.forEach((session, s) => {
            const base = ["programs", p, "sessions", s] as const;
            record("planned-session", session.externalId, [...base, "externalId"]);
            session.prescription?.activities?.forEach((activity, a) => {
                record("planned-activity", activity.externalId, [
                    ...base,
                    "prescription",
                    "activities",
                    a,
                    "externalId",
                ]);
                activity.exercises?.forEach((exercise, e) => {
                    const exBase = [...base, "prescription", "activities", a, "exercises", e] as const;
                    record("planned-exercise", exercise.externalId, [...exBase, "externalId"]);
                    exercise.sets?.forEach((set, t) =>
                        record("planned-set", set.externalId, [...exBase, "sets", t, "externalId"]),
                    );
                });
            });
        });
    });

    payload.completedSessions?.forEach((session, s) => {
        const base = ["completedSessions", s] as const;
        record("training-session", session.externalId, [...base, "externalId"]);
        session.activities?.forEach((activity, a) => {
            const actBase = [...base, "activities", a] as const;
            record("session-activity", activity.externalId, [...actBase, "externalId"]);
            activity.strength?.occurrences?.forEach((occurrence, o) => {
                const occBase = [...actBase, "strength", "occurrences", o] as const;
                record("occurrence", occurrence.externalId, [...occBase, "externalId"]);
                occurrence.performedSets?.forEach((set, t) =>
                    record("performed-set", set.externalId, [...occBase, "performedSets", t, "externalId"]),
                );
            });
            activity.strength?.setGroups?.forEach((group, g) =>
                record("set-group", group.externalId, [...actBase, "strength", "setGroups", g, "externalId"]),
            );
            activity.running?.steps?.forEach((step, r) =>
                record("run-step", step.externalId, [...actBase, "running", "steps", r, "externalId"]),
            );
            activity.running?.splits?.forEach((split, r) =>
                record("run-split", split.externalId, [...actBase, "running", "splits", r, "externalId"]),
            );
        });
        session.painRecords?.forEach((pain, r) =>
            record("pain-record", pain.externalId, [...base, "painRecords", r, "externalId"]),
        );
    });

    if (Object.keys(duplicates).length > 0)
        throw new DomainValidationError("Historical import contains duplicate external ids", duplicates);
}

// ---------------------------------------------------------------------------------------------
// Reference resolution (mappings + intra-session structure)
// ---------------------------------------------------------------------------------------------

/**
 * Reject any planned/actual mapping or intra-session structural reference that does not resolve to an
 * `externalId` present in the payload. Planned references (`prescribed*`, `plannedLink`) resolve against
 * the imported program trees; actual references resolve within the completed session that carries them.
 */
export function assertReferencesResolve(payload: HistoricalImportInput): void {
    const programIds = new Set<string>();
    const plannedSessionIds = new Set<string>();
    const plannedActivityIds = new Set<string>();
    const plannedExerciseIds = new Set<string>();
    const plannedSetIds = new Set<string>();
    for (const program of payload.programs ?? []) {
        if (program.externalId !== undefined) programIds.add(program.externalId);
        for (const session of program.sessions ?? []) {
            plannedSessionIds.add(session.externalId);
            for (const activity of session.prescription?.activities ?? []) {
                if (activity.externalId !== undefined) plannedActivityIds.add(activity.externalId);
                for (const exercise of activity.exercises ?? []) {
                    if (exercise.externalId !== undefined) plannedExerciseIds.add(exercise.externalId);
                    for (const set of exercise.sets ?? [])
                        if (set.externalId !== undefined) plannedSetIds.add(set.externalId);
                }
            }
        }
    }

    const errors: Record<string, string[]> = {};

    payload.completedSessions?.forEach((session, s) => {
        const base = ["completedSessions", s] as const;
        const activityIds = new Set<string>();
        const occurrenceIds = new Set<string>();
        const setGroupIds = new Set<string>();
        const performedSetIds = new Set<string>();
        const runStepIds = new Set<string>();
        for (const activity of session.activities ?? []) {
            activityIds.add(activity.externalId);
            for (const occurrence of activity.strength?.occurrences ?? []) {
                occurrenceIds.add(occurrence.externalId);
                for (const set of occurrence.performedSets ?? []) performedSetIds.add(set.externalId);
            }
            for (const group of activity.strength?.setGroups ?? []) setGroupIds.add(group.externalId);
            for (const step of activity.running?.steps ?? []) runStepIds.add(step.externalId);
        }

        // Intra-session structural references.
        session.activities?.forEach((activity, a) => {
            const actBase = [...base, "activities", a] as const;
            activity.strength?.occurrences?.forEach((occurrence, o) => {
                occurrence.performedSets?.forEach((set, t) => {
                    if (set.setGroupRef != null && !setGroupIds.has(set.setGroupRef))
                        push(
                            errors,
                            [...actBase, "strength", "occurrences", o, "performedSets", t, "setGroupRef"],
                            `Unknown set-group ref "${set.setGroupRef}"`,
                        );
                });
            });
            activity.strength?.setGroups?.forEach((group, g) => {
                const gBase = [...actBase, "strength", "setGroups", g] as const;
                if (group.parentGroupRef != null && !setGroupIds.has(group.parentGroupRef))
                    push(
                        errors,
                        [...gBase, "parentGroupRef"],
                        `Unknown parent set-group ref "${group.parentGroupRef}"`,
                    );
                group.members?.forEach((member, m) => {
                    if (!occurrenceIds.has(member.occurrenceRef))
                        push(
                            errors,
                            [...gBase, "members", m, "occurrenceRef"],
                            `Unknown occurrence ref "${member.occurrenceRef}"`,
                        );
                });
            });
            activity.running?.steps?.forEach((step, r) => {
                if (step.parentStepRef != null && !runStepIds.has(step.parentStepRef))
                    push(
                        errors,
                        [...actBase, "running", "steps", r, "parentStepRef"],
                        `Unknown parent run-step ref "${step.parentStepRef}"`,
                    );
            });
        });

        session.painRecords?.forEach((pain, r) => {
            const pBase = [...base, "painRecords", r] as const;
            if (pain.activityRef != null && !activityIds.has(pain.activityRef))
                push(errors, [...pBase, "activityRef"], `Unknown activity ref "${pain.activityRef}"`);
            if (pain.occurrenceRef != null && !occurrenceIds.has(pain.occurrenceRef))
                push(errors, [...pBase, "occurrenceRef"], `Unknown occurrence ref "${pain.occurrenceRef}"`);
            if (pain.performedSetRef != null && !performedSetIds.has(pain.performedSetRef))
                push(errors, [...pBase, "performedSetRef"], `Unknown performed-set ref "${pain.performedSetRef}"`);
        });

        // Planned/actual program mapping.
        const mapping = session.programMapping;
        if (mapping) {
            const mBase = [...base, "programMapping"] as const;
            const link = mapping.plannedLink;
            if (link) {
                if (!programIds.has(link.programExternalId))
                    push(
                        errors,
                        [...mBase, "plannedLink", "programExternalId"],
                        `Unknown program external id "${link.programExternalId}"`,
                    );
                if (!plannedSessionIds.has(link.plannedSessionExternalId))
                    push(
                        errors,
                        [...mBase, "plannedLink", "plannedSessionExternalId"],
                        `Unknown planned-session external id "${link.plannedSessionExternalId}"`,
                    );
            }
            mapping.activities?.forEach((entry, i) => {
                resolveActual(
                    errors,
                    [...mBase, "activities", i, "actualActivityRef"],
                    entry.actualActivityRef,
                    activityIds,
                    "activity",
                );
                resolvePlanned(
                    errors,
                    [...mBase, "activities", i, "prescribedActivityExternalId"],
                    entry.prescribedActivityExternalId,
                    plannedActivityIds,
                    "planned activity",
                );
            });
            mapping.occurrences?.forEach((entry, i) => {
                resolveActual(
                    errors,
                    [...mBase, "occurrences", i, "occurrenceRef"],
                    entry.occurrenceRef,
                    occurrenceIds,
                    "occurrence",
                );
                resolvePlanned(
                    errors,
                    [...mBase, "occurrences", i, "prescribedExerciseExternalId"],
                    entry.prescribedExerciseExternalId,
                    plannedExerciseIds,
                    "planned exercise",
                );
            });
            mapping.sets?.forEach((entry, i) => {
                resolveActual(
                    errors,
                    [...mBase, "sets", i, "performedSetRef"],
                    entry.performedSetRef,
                    performedSetIds,
                    "performed set",
                );
                resolvePlanned(
                    errors,
                    [...mBase, "sets", i, "prescribedSetExternalId"],
                    entry.prescribedSetExternalId,
                    plannedSetIds,
                    "planned set",
                );
            });
        }
    });

    if (Object.keys(errors).length > 0)
        throw new DomainValidationError("Historical import contains unresolved references", errors);
}

function resolveActual(
    errors: Record<string, string[]>,
    path: Path,
    ref: string | undefined,
    within: ReadonlySet<string>,
    label: string,
): void {
    if (ref !== undefined && !within.has(ref)) push(errors, path, `Unknown ${label} ref "${ref}"`);
}

function resolvePlanned(
    errors: Record<string, string[]>,
    path: Path,
    ref: string | null | undefined,
    within: ReadonlySet<string>,
    label: string,
): void {
    if (ref != null && !within.has(ref)) push(errors, path, `Unknown ${label} external id "${ref}"`);
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Run every cross-node identity and aggregate-boundary invariant for one historical-import payload.
 * Ordered cheapest-first: bounded size, then per-type external-ID uniqueness, then reference
 * resolution. Throws {@link DomainValidationError} with path-anchored field errors on the first failing
 * stage so callers surface a precise, deterministic rejection.
 */
export function validateHistoricalImportIdentities(payload: HistoricalImportInput): void {
    assertWithinHistoricalImportLimits(payload);
    assertUniqueExternalIds(payload);
    assertReferencesResolve(payload);
}

function push(errors: Record<string, string[]>, path: Path, message: string): void {
    const key = path.join(".");
    (errors[key] ??= []).push(message);
}
