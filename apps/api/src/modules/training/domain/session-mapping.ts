import { DomainValidationError } from "#src/platform/domain/index";

/**
 * Planned/actual mapping value objects owned by a {@link ./training-session} (design 11.4, TS-4).
 *
 * Expected-versus-actual insight requires exact references to immutable prescription rows rather than
 * matching names or positions after the fact. A {@link SessionPlannedLink} binds the session to a
 * planned session plus the exact immutable source and resolved-execution prescription IDs used at
 * start. Level mappings ({@link ActivityMappingState}, {@link OccurrenceMappingState},
 * {@link SetMappingState}, {@link RunStepMappingState}) each connect one prescribed row to one actual
 * row with an explicit {@link MappingRelation} and reason, so substitution/addition/partial/combined/
 * split semantics stay first-class instead of inferred.
 *
 * The aggregate can only validate the *actual* side of a mapping (the activity/occurrence/set tree it
 * owns) and the relational cardinalities; *prescribed*-side ownership is validated in the application
 * layer, which loads the linked immutable prescription trees.
 */

export const mappingRelations = ["matched", "substituted", "added", "partial", "combined", "split"] as const;
export type MappingRelation = (typeof mappingRelations)[number];

/** A relation whose prescribed side is optional: `added` performed work has no prescribed counterpart. */
const PRESCRIBED_OPTIONAL_RELATIONS: ReadonlySet<MappingRelation> = new Set(["added"]);
/** Relations that must be the sole mapping for a given actual row (exclusive one-to-one links). */
const EXCLUSIVE_ACTUAL_RELATIONS: ReadonlySet<MappingRelation> = new Set([
    "matched",
    "substituted",
    "added",
    "partial",
]);

export interface SessionPlannedLink {
    /**
     * The planned session this training session fulfils (design 11.6 step 1), or `null` when the frozen
     * prescription came from a template or a previous workout and no planned session exists to recompute.
     */
    readonly plannedSessionId: string | null;
    /** Immutable planned prescription frozen at start. */
    readonly sourcePrescriptionId: string;
    /** Immutable resolved-execution prescription; equals {@link sourcePrescriptionId} when nothing resolved. */
    readonly resolvedPrescriptionId: string;
}

interface LevelMappingState {
    readonly id: string;
    readonly relation: MappingRelation;
    readonly reason: string | null;
    readonly notes: string | null;
}

export interface ActivityMappingState extends LevelMappingState {
    readonly prescribedActivityId: string | null;
    readonly actualActivityId: string;
}

export interface OccurrenceMappingState extends LevelMappingState {
    readonly prescribedExerciseId: string | null;
    readonly occurrenceId: string;
}

export interface SetMappingState extends LevelMappingState {
    readonly prescribedSetId: string | null;
    readonly performedSetId: string;
    /** Optional portion (0–1] describing how much of the prescribed set the actual work represents. */
    readonly portion: string | null;
}

export interface RunStepMappingState extends LevelMappingState {
    readonly prescribedRunStepId: string | null;
    /** Performed run step owned by this session's running tree (design 11.3–11.4). */
    readonly performedRunStepId: string;
}

export interface SessionMappingsState {
    readonly plannedLinks: readonly SessionPlannedLink[];
    readonly activityMappings: readonly ActivityMappingState[];
    readonly occurrenceMappings: readonly OccurrenceMappingState[];
    readonly setMappings: readonly SetMappingState[];
    readonly runStepMappings: readonly RunStepMappingState[];
}

export const EMPTY_SESSION_MAPPINGS: SessionMappingsState = {
    plannedLinks: [],
    activityMappings: [],
    occurrenceMappings: [],
    setMappings: [],
    runStepMappings: [],
};

// --- inputs --------------------------------------------------------------------------------------

export interface SessionPlannedLinkInput {
    readonly plannedSessionId?: string | null;
    readonly sourcePrescriptionId: string;
    readonly resolvedPrescriptionId: string;
}

interface LevelMappingInput {
    readonly id: string;
    readonly relation: MappingRelation;
    readonly reason?: string | null;
    readonly notes?: string | null;
}

export interface ActivityMappingInput extends LevelMappingInput {
    readonly prescribedActivityId?: string | null;
    readonly actualActivityId: string;
}

export interface OccurrenceMappingInput extends LevelMappingInput {
    readonly prescribedExerciseId?: string | null;
    readonly occurrenceId: string;
}

export interface SetMappingInput extends LevelMappingInput {
    readonly prescribedSetId?: string | null;
    readonly performedSetId: string;
    readonly portion?: string | null;
}

export interface RunStepMappingInput extends LevelMappingInput {
    readonly prescribedRunStepId?: string | null;
    readonly performedRunStepId: string;
}

export interface SessionMappingsInput {
    readonly plannedLinks?: readonly SessionPlannedLinkInput[];
    readonly activityMappings?: readonly ActivityMappingInput[];
    readonly occurrenceMappings?: readonly OccurrenceMappingInput[];
    readonly setMappings?: readonly SetMappingInput[];
    readonly runStepMappings?: readonly RunStepMappingInput[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- normalization -------------------------------------------------------------------------------

export function normalizeSessionMappings(input: SessionMappingsInput): SessionMappingsState {
    return {
        plannedLinks: (input.plannedLinks ?? []).map(normalizePlannedLink),
        activityMappings: (input.activityMappings ?? []).map(normalizeActivityMapping),
        occurrenceMappings: (input.occurrenceMappings ?? []).map(normalizeOccurrenceMapping),
        setMappings: (input.setMappings ?? []).map(normalizeSetMapping),
        runStepMappings: (input.runStepMappings ?? []).map(normalizeRunStepMapping),
    };
}

function normalizePlannedLink(input: SessionPlannedLinkInput): SessionPlannedLink {
    return {
        plannedSessionId: optionalUuid(input.plannedSessionId, "Planned session ID"),
        sourcePrescriptionId: requiredUuid(input.sourcePrescriptionId, "Source prescription ID"),
        resolvedPrescriptionId: requiredUuid(input.resolvedPrescriptionId, "Resolved prescription ID"),
    };
}

function normalizeLevel(input: LevelMappingInput): LevelMappingState {
    return {
        id: requiredUuid(input.id, "Mapping ID"),
        relation: normalizeRelation(input.relation),
        reason: optionalText(input.reason, "Mapping reason", 500),
        notes: optionalText(input.notes, "Mapping notes", 4_000),
    };
}

function normalizeActivityMapping(input: ActivityMappingInput): ActivityMappingState {
    const level = normalizeLevel(input);
    return {
        ...level,
        prescribedActivityId: optionalPrescribedId(
            input.prescribedActivityId,
            level.relation,
            "Prescribed activity ID",
        ),
        actualActivityId: requiredUuid(input.actualActivityId, "Actual activity ID"),
    };
}

function normalizeOccurrenceMapping(input: OccurrenceMappingInput): OccurrenceMappingState {
    const level = normalizeLevel(input);
    return {
        ...level,
        prescribedExerciseId: optionalPrescribedId(
            input.prescribedExerciseId,
            level.relation,
            "Prescribed exercise ID",
        ),
        occurrenceId: requiredUuid(input.occurrenceId, "Exercise occurrence ID"),
    };
}

function normalizeSetMapping(input: SetMappingInput): SetMappingState {
    const level = normalizeLevel(input);
    return {
        ...level,
        prescribedSetId: optionalPrescribedId(input.prescribedSetId, level.relation, "Prescribed set ID"),
        performedSetId: requiredUuid(input.performedSetId, "Performed set ID"),
        portion: normalizePortion(input.portion),
    };
}

function normalizeRunStepMapping(input: RunStepMappingInput): RunStepMappingState {
    const level = normalizeLevel(input);
    return {
        ...level,
        prescribedRunStepId: optionalPrescribedId(input.prescribedRunStepId, level.relation, "Prescribed run step ID"),
        performedRunStepId: requiredUuid(input.performedRunStepId, "Performed run step ID"),
    };
}

// --- validation ----------------------------------------------------------------------------------

export interface SessionActualIds {
    readonly activityIds: ReadonlySet<string>;
    readonly occurrenceIds: ReadonlySet<string>;
    readonly performedSetIds: ReadonlySet<string>;
    readonly runStepIds: ReadonlySet<string>;
}

/**
 * Drop level mappings whose actual row an edit removed, keeping the tree consistent (like pain-record
 * reconciliation). Planned links are frozen and preserved as-is.
 */
export function reconcileSessionMappings(
    mappings: SessionMappingsState,
    actual: SessionActualIds,
): SessionMappingsState {
    return {
        plannedLinks: mappings.plannedLinks,
        activityMappings: mappings.activityMappings.filter(m => actual.activityIds.has(m.actualActivityId)),
        occurrenceMappings: mappings.occurrenceMappings.filter(m => actual.occurrenceIds.has(m.occurrenceId)),
        setMappings: mappings.setMappings.filter(m => actual.performedSetIds.has(m.performedSetId)),
        runStepMappings: mappings.runStepMappings.filter(m => actual.runStepIds.has(m.performedRunStepId)),
    };
}

/**
 * Validate every mapping against the actual tree it points into plus the relational cardinality rules.
 * The prescribed side is intentionally not checked here; the application validates it against the
 * loaded immutable prescription trees so this pure aggregate never needs to hold them.
 */
export function validateSessionMappings(mappings: SessionMappingsState, actual: SessionActualIds): void {
    validatePlannedLinks(mappings.plannedLinks);
    assertUniqueIds([
        ...mappings.activityMappings,
        ...mappings.occurrenceMappings,
        ...mappings.setMappings,
        ...mappings.runStepMappings,
    ]);

    validateLevel(mappings.activityMappings, "activityMappings", mapping => ({
        prescribedId: mapping.prescribedActivityId,
        actualId: mapping.actualActivityId,
        actualOwned: actual.activityIds.has(mapping.actualActivityId),
        actualLabel: "activity",
    }));
    validateLevel(mappings.occurrenceMappings, "occurrenceMappings", mapping => ({
        prescribedId: mapping.prescribedExerciseId,
        actualId: mapping.occurrenceId,
        actualOwned: actual.occurrenceIds.has(mapping.occurrenceId),
        actualLabel: "exercise occurrence",
    }));
    validateLevel(mappings.setMappings, "setMappings", mapping => ({
        prescribedId: mapping.prescribedSetId,
        actualId: mapping.performedSetId,
        actualOwned: actual.performedSetIds.has(mapping.performedSetId),
        actualLabel: "performed set",
    }));
    validateLevel(mappings.runStepMappings, "runStepMappings", mapping => ({
        prescribedId: mapping.prescribedRunStepId,
        actualId: mapping.performedRunStepId,
        actualOwned: actual.runStepIds.has(mapping.performedRunStepId),
        actualLabel: "performed run step",
    }));
}

function validatePlannedLinks(links: readonly SessionPlannedLink[]): void {
    const seen = new Set<string>();
    for (const link of links) {
        // Template/previous references carry no planned session, so only planned-session links are deduped.
        if (link.plannedSessionId === null) continue;
        if (seen.has(link.plannedSessionId))
            throw new DomainValidationError(`Duplicate planned session link '${link.plannedSessionId}'`, {
                plannedLinks: ["A training session can link a planned session only once"],
            });
        seen.add(link.plannedSessionId);
    }
}

interface LevelView {
    readonly prescribedId: string | null;
    readonly actualId: string;
    readonly actualOwned: boolean;
    readonly actualLabel: string;
}

function validateLevel<T extends LevelMappingState>(
    mappings: readonly T[],
    field: string,
    view: (mapping: T) => LevelView,
): void {
    const byActual = new Map<string, MappingRelation[]>();
    const byPrescribed = new Map<string, MappingRelation[]>();
    for (const mapping of mappings) {
        const { prescribedId, actualId, actualOwned, actualLabel } = view(mapping);
        if (!actualOwned)
            throw new DomainValidationError(`A mapping references an unknown ${actualLabel} in this session`, {
                [field]: [`A mapping references an unknown ${actualLabel} in this session`],
            });
        byActual.set(actualId, [...(byActual.get(actualId) ?? []), mapping.relation]);
        if (prescribedId !== null)
            byPrescribed.set(prescribedId, [...(byPrescribed.get(prescribedId) ?? []), mapping.relation]);
    }
    // An actual row may carry many prescribed mappings only when every one of them is `combined`.
    for (const [actualId, relations] of byActual)
        if (relations.length > 1 && relations.some(relation => EXCLUSIVE_ACTUAL_RELATIONS.has(relation)))
            throw new DomainValidationError(
                `Actual row '${actualId}' has conflicting mappings; only 'combined' rows may share one actual`,
                { [field]: ["Only 'combined' relations may map several prescribed rows to one actual"] },
            );
    // A prescribed row may map to many actuals only when every one of them is `split`.
    for (const [prescribedId, relations] of byPrescribed)
        if (relations.length > 1 && relations.some(relation => relation !== "split"))
            throw new DomainValidationError(
                `Prescribed row '${prescribedId}' maps to several actuals but is not marked 'split'`,
                { [field]: ["Only 'split' relations may map one prescribed row to several actuals"] },
            );
}

function assertUniqueIds(mappings: readonly LevelMappingState[]): void {
    const seen = new Set<string>();
    for (const mapping of mappings) {
        if (seen.has(mapping.id))
            throw new DomainValidationError(`Duplicate mapping ID '${mapping.id}'`, {
                mappings: ["Mapping IDs must be unique"],
            });
        seen.add(mapping.id);
    }
}

// --- primitives ----------------------------------------------------------------------------------

function normalizeRelation(value: MappingRelation): MappingRelation {
    if (!mappingRelations.includes(value))
        throw new DomainValidationError(`Unknown mapping relation '${value}'`, {
            mappings: ["Unknown mapping relation"],
        });
    return value;
}

function optionalPrescribedId(
    value: string | null | undefined,
    relation: MappingRelation,
    name: string,
): string | null {
    if (value == null) {
        if (!PRESCRIBED_OPTIONAL_RELATIONS.has(relation))
            throw new DomainValidationError(`${name} is required unless the relation is 'added'`, {
                mappings: [`${name} is required unless the relation is 'added'`],
            });
        return null;
    }
    if (PRESCRIBED_OPTIONAL_RELATIONS.has(relation))
        throw new DomainValidationError("An 'added' mapping must not reference a prescribed row", {
            mappings: ["An 'added' mapping must not reference a prescribed row"],
        });
    return requiredUuid(value, name);
}

function normalizePortion(value: string | null | undefined): string | null {
    if (value == null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1)
        throw new DomainValidationError("Mapping portion must be a number in (0, 1]", {
            mappings: ["Mapping portion must be a number in (0, 1]"],
        });
    return value.trim();
}

function requiredUuid(value: string, name: string): string {
    const normalized = (value ?? "").trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function optionalUuid(value: string | null | undefined, name: string): string | null {
    if (value == null) return null;
    return requiredUuid(value, name);
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) return null;
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}
