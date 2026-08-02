import { DomainValidationError } from "#src/platform/domain/index";

import type {
    ExerciseLoadModel,
    ExerciseMeasurementType,
    RepetitionSemantics,
} from "#src/modules/training/domain/catalog";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/exercise-definition";
import {
    DecimalValue,
    Distance,
    Duration,
    Mass,
    type DistanceUnit,
    type DurationUnit,
    type MassUnit,
} from "#src/modules/training/domain/measurement";

/**
 * Structured strength performance owned by a {@link ./training-session} activity (design 5.8, 11.2;
 * PRD ST-1–7). A strength activity holds ordered {@link ExerciseOccurrenceState}s (each an immutable
 * exercise snapshot plus its performed sets) and a hierarchical set-group tree with many-to-many
 * occurrence membership so straight work, supersets, circuits, drops, clusters, and rest-pause are all
 * modelled structurally without EAV or free-text parsing.
 *
 * Measurements are captured as validated entered `{ value, unit }` pairs; canonical conversion for
 * querying/analytics happens at the persistence and calculator boundaries. Analytics formulas stay
 * outside the aggregate — only the {@link workReps}/{@link effectiveLoadKg} policies, which depend on
 * the snapshotted repetition/load model, live here.
 */

export const setGroupTypes = ["straight", "superset", "circuit", "drop", "cluster", "rest_pause"] as const;
export type SetGroupType = (typeof setGroupTypes)[number];

export const performedSetTypes = [
    "warm_up",
    "working",
    "back_off",
    "drop",
    "failure_amrap",
    "superset_circuit",
    "rest_pause",
    "technique",
    "cluster",
    "other",
] as const;
export type PerformedSetType = (typeof performedSetTypes)[number];

/** Design's "performed set state" (completed/partial/skipped/added), named `status` here to avoid clashing with the entity state. */
export const performedSetStatuses = ["completed", "partial", "skipped", "added"] as const;
export type PerformedSetStatus = (typeof performedSetStatuses)[number];

export const setFailureReasons = [
    "muscular",
    "technical",
    "cardiovascular",
    "pain",
    "equipment",
    "time",
    "other",
] as const;
export type SetFailureReason = (typeof setFailureReasons)[number];

const measurementUnitMap: Record<ExerciseMeasurementType, ReadonlyArray<keyof PerformedSetMeasurements>> = {
    repetitions: ["reps"],
    external_load: ["externalLoad"],
    bodyweight: ["bodyweight"],
    added_load: ["addedLoad"],
    assistance: ["assistanceLoad"],
    effective_load: ["effectiveLoad"],
    duration: ["duration"],
    distance: ["distance"],
    power: ["powerWatts"],
};

export interface MassValue {
    readonly value: number;
    readonly unit: MassUnit;
}
export interface DistanceValue {
    readonly value: number;
    readonly unit: DistanceUnit;
}
export interface DurationValue {
    readonly value: number;
    readonly unit: DurationUnit;
}

export interface PerformedTempoPhases {
    readonly eccentric: DurationValue | null;
    readonly bottomPause: DurationValue | null;
    readonly concentric: DurationValue | null;
    readonly topPause: DurationValue | null;
}

/** Every measurement is optional and nullable so `null` stays distinct from a recorded zero (design 7.4). */
export interface PerformedSetMeasurements {
    readonly reps: number | null;
    readonly externalLoad: MassValue | null;
    readonly bodyweight: MassValue | null;
    readonly addedLoad: MassValue | null;
    readonly assistanceLoad: MassValue | null;
    readonly effectiveLoad: MassValue | null;
    readonly duration: DurationValue | null;
    readonly distance: DistanceValue | null;
    readonly powerWatts: number | null;
    readonly rpe: number | null;
    readonly rir: number | null;
    readonly tempo: PerformedTempoPhases | null;
    readonly restBefore: DurationValue | null;
    readonly restAfter: DurationValue | null;
}

export interface PerformedSetState {
    readonly id: string;
    readonly setGroupId: string | null;
    readonly round: number | null;
    readonly position: number;
    readonly setType: PerformedSetType;
    readonly status: PerformedSetStatus;
    readonly measurements: PerformedSetMeasurements;
    readonly failureReason: SetFailureReason | null;
    readonly technique: number | null;
    readonly discomfort: number | null;
    readonly pump: number | null;
    readonly notes: string | null;
}

export interface ExerciseOccurrenceState {
    readonly id: string;
    readonly exerciseId: string;
    readonly snapshot: ExerciseSnapshotV1;
    readonly position: number;
    readonly purpose: string | null;
    readonly technique: number | null;
    readonly discomfort: number | null;
    readonly pump: number | null;
    readonly notes: string | null;
    readonly performedSets: readonly PerformedSetState[];
}

export interface SetGroupMember {
    readonly occurrenceId: string;
    readonly position: number;
}

export interface SetGroupState {
    readonly id: string;
    readonly parentGroupId: string | null;
    readonly type: SetGroupType;
    readonly position: number;
    readonly rounds: number | null;
    readonly restMs: number | null;
    readonly members: readonly SetGroupMember[];
}

export interface StrengthActivityState {
    readonly occurrences: readonly ExerciseOccurrenceState[];
    readonly setGroups: readonly SetGroupState[];
}

// ---------------------------------------------------------------------------------------------
// Inputs (snapshot is resolved by the application; measurements arrive as entered value/unit pairs)
// ---------------------------------------------------------------------------------------------

export interface MassValueInput {
    readonly value: number;
    readonly unit: MassUnit;
}
export interface DistanceValueInput {
    readonly value: number;
    readonly unit: DistanceUnit;
}
export interface DurationValueInput {
    readonly value: number;
    readonly unit: DurationUnit;
}

export interface PerformedTempoPhasesInput {
    readonly eccentric?: DurationValueInput | null;
    readonly bottomPause?: DurationValueInput | null;
    readonly concentric?: DurationValueInput | null;
    readonly topPause?: DurationValueInput | null;
}

export interface PerformedSetMeasurementsInput {
    readonly reps?: number | null;
    readonly externalLoad?: MassValueInput | null;
    readonly bodyweight?: MassValueInput | null;
    readonly addedLoad?: MassValueInput | null;
    readonly assistanceLoad?: MassValueInput | null;
    readonly effectiveLoad?: MassValueInput | null;
    readonly duration?: DurationValueInput | null;
    readonly distance?: DistanceValueInput | null;
    readonly powerWatts?: number | null;
    readonly rpe?: number | null;
    readonly rir?: number | null;
    readonly tempo?: PerformedTempoPhasesInput | null;
    readonly restBefore?: DurationValueInput | null;
    readonly restAfter?: DurationValueInput | null;
}

export interface PerformedSetInput {
    readonly id: string;
    readonly setGroupId?: string | null;
    readonly round?: number | null;
    readonly position: number;
    readonly setType: PerformedSetType;
    readonly status: PerformedSetStatus;
    readonly measurements?: PerformedSetMeasurementsInput;
    readonly failureReason?: SetFailureReason | null;
    readonly technique?: number | null;
    readonly discomfort?: number | null;
    readonly pump?: number | null;
    readonly notes?: string | null;
}

export interface ExerciseOccurrenceInput {
    readonly id: string;
    readonly exerciseId: string;
    readonly snapshot: ExerciseSnapshotV1;
    readonly position: number;
    readonly purpose?: string | null;
    readonly technique?: number | null;
    readonly discomfort?: number | null;
    readonly pump?: number | null;
    readonly notes?: string | null;
    readonly performedSets?: readonly PerformedSetInput[];
}

export interface SetGroupMemberInput {
    readonly occurrenceId: string;
    readonly position: number;
}

export interface SetGroupInput {
    readonly id: string;
    readonly parentGroupId?: string | null;
    readonly type: SetGroupType;
    readonly position: number;
    readonly rounds?: number | null;
    readonly restMs?: number | null;
    readonly members?: readonly SetGroupMemberInput[];
}

export interface StrengthActivityInput {
    readonly occurrences?: readonly ExerciseOccurrenceInput[];
    readonly setGroups?: readonly SetGroupInput[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const EMPTY_STRENGTH_ACTIVITY: StrengthActivityState = { occurrences: [], setGroups: [] };

// ---------------------------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------------------------

export function normalizeStrengthActivity(input: StrengthActivityInput): StrengthActivityState {
    return {
        occurrences: (input.occurrences ?? []).map(normalizeOccurrence),
        setGroups: (input.setGroups ?? []).map(normalizeSetGroup),
    };
}

function normalizeOccurrence(input: ExerciseOccurrenceInput): ExerciseOccurrenceState {
    return {
        id: requiredUuid(input.id, "Exercise occurrence ID"),
        exerciseId: requiredUuid(input.exerciseId, "Exercise ID"),
        snapshot: normalizeSnapshot(input.snapshot, input.exerciseId),
        position: nonNegativeInteger(input.position, "Exercise occurrence position"),
        purpose: optionalText(input.purpose, "Exercise occurrence purpose", 200),
        technique: optionalScale(input.technique, "Occurrence technique", 1, 5),
        discomfort: optionalScale(input.discomfort, "Occurrence discomfort", 1, 5),
        pump: optionalScale(input.pump, "Occurrence pump", 1, 5),
        notes: optionalText(input.notes, "Exercise occurrence notes", 4_000),
        performedSets: (input.performedSets ?? []).map(set => normalizePerformedSet(set, input.snapshot)),
    };
}

function normalizePerformedSet(input: PerformedSetInput, snapshot: ExerciseSnapshotV1): PerformedSetState {
    const measurements = normalizeMeasurements(input.measurements ?? {}, snapshot);
    return {
        id: requiredUuid(input.id, "Performed set ID"),
        setGroupId: input.setGroupId == null ? null : requiredUuid(input.setGroupId, "Performed set group ID"),
        round: input.round == null ? null : positiveInteger(input.round, "Performed set round"),
        position: nonNegativeInteger(input.position, "Performed set position"),
        setType: normalizeSetType(input.setType),
        status: normalizeSetStatus(input.status),
        measurements,
        failureReason: input.failureReason == null ? null : normalizeFailureReason(input.failureReason),
        technique: optionalScale(input.technique, "Set technique", 1, 5),
        discomfort: optionalScale(input.discomfort, "Set discomfort", 1, 5),
        pump: optionalScale(input.pump, "Set pump", 1, 5),
        notes: optionalText(input.notes, "Set notes", 4_000),
    };
}

function normalizeMeasurements(
    input: PerformedSetMeasurementsInput,
    snapshot: ExerciseSnapshotV1,
): PerformedSetMeasurements {
    const measurements: PerformedSetMeasurements = {
        reps: input.reps == null ? null : nonNegativeInteger(input.reps, "Reps"),
        externalLoad: normalizeMass(input.externalLoad, "External load"),
        bodyweight: normalizeMass(input.bodyweight, "Bodyweight"),
        addedLoad: normalizeMass(input.addedLoad, "Added load"),
        assistanceLoad: normalizeMass(input.assistanceLoad, "Assistance load"),
        effectiveLoad: normalizeMass(input.effectiveLoad, "Effective load"),
        duration: normalizeDuration(input.duration, "Set duration"),
        distance: normalizeDistance(input.distance, "Set distance"),
        powerWatts: input.powerWatts == null ? null : nonNegativeNumber(input.powerWatts, "Power"),
        rpe: input.rpe == null ? null : rpeValue(input.rpe),
        rir: input.rir == null ? null : integerInRange(input.rir, 0, 10, "RIR"),
        tempo: normalizeTempo(input.tempo),
        restBefore: normalizeDuration(input.restBefore, "Rest before"),
        restAfter: normalizeDuration(input.restAfter, "Rest after"),
    };
    assertMeasurementsSupported(measurements, snapshot);
    return measurements;
}

/** Reject a recorded measurement the snapshotted exercise does not support (design §5, ST-3). */
function assertMeasurementsSupported(measurements: PerformedSetMeasurements, snapshot: ExerciseSnapshotV1): void {
    const supported = new Set(snapshot.supportedMeasurements);
    for (const type of Object.keys(measurementUnitMap) as ExerciseMeasurementType[]) {
        if (supported.has(type)) continue;
        for (const field of measurementUnitMap[type]) {
            if (measurements[field] !== null)
                throw new DomainValidationError(`Exercise '${snapshot.name}' does not support ${type} measurements`, {
                    measurements: [`Unsupported measurement '${type}' for this exercise`],
                });
        }
    }
}

function normalizeSetGroup(input: SetGroupInput): SetGroupState {
    return {
        id: requiredUuid(input.id, "Set group ID"),
        parentGroupId: input.parentGroupId == null ? null : requiredUuid(input.parentGroupId, "Parent set group ID"),
        type: normalizeSetGroupType(input.type),
        position: nonNegativeInteger(input.position, "Set group position"),
        rounds: input.rounds == null ? null : positiveInteger(input.rounds, "Set group rounds"),
        restMs: input.restMs == null ? null : nonNegativeInteger(input.restMs, "Set group rest"),
        members: (input.members ?? []).map(member => ({
            occurrenceId: requiredUuid(member.occurrenceId, "Set group member occurrence ID"),
            position: nonNegativeInteger(member.position, "Set group member position"),
        })),
    };
}

function normalizeMass(value: MassValueInput | null | undefined, name: string): MassValue | null {
    if (value == null) return null;
    validateMeasurement(name, () => Mass.from(value.value, value.unit)); // finite / non-negative / known unit
    return { value: value.value, unit: value.unit };
}

function normalizeDistance(value: DistanceValueInput | null | undefined, name: string): DistanceValue | null {
    if (value == null) return null;
    validateMeasurement(name, () => Distance.from(value.value, value.unit));
    return { value: value.value, unit: value.unit };
}

function normalizeDuration(value: DurationValueInput | null | undefined, name: string): DurationValue | null {
    if (value == null) return null;
    validateMeasurement(name, () => Duration.from(value.value, value.unit));
    return { value: value.value, unit: value.unit };
}

/** Run a measurement value-object constructor for validation, re-labelling any failure with the field. */
function validateMeasurement(name: string, build: () => unknown): void {
    try {
        build();
    } catch (error) {
        throw new DomainValidationError(`${name} is invalid: ${(error as Error).message}`, {
            measurements: [`${name} is invalid`],
        });
    }
}

function normalizeTempo(input: PerformedTempoPhasesInput | null | undefined): PerformedTempoPhases | null {
    if (input == null) return null;
    const tempo: PerformedTempoPhases = {
        eccentric: normalizeDuration(input.eccentric, "Tempo eccentric"),
        bottomPause: normalizeDuration(input.bottomPause, "Tempo bottom pause"),
        concentric: normalizeDuration(input.concentric, "Tempo concentric"),
        topPause: normalizeDuration(input.topPause, "Tempo top pause"),
    };
    const anyPhase =
        tempo.eccentric !== null || tempo.bottomPause !== null || tempo.concentric !== null || tempo.topPause !== null;
    return anyPhase ? tempo : null;
}

function normalizeSnapshot(snapshot: ExerciseSnapshotV1, exerciseId: string): ExerciseSnapshotV1 {
    if (!snapshot || snapshot.schemaVersion !== 1)
        throw new DomainValidationError("Exercise occurrence requires a v1 exercise snapshot", {
            snapshot: ["A v1 exercise snapshot is required"],
        });
    if (snapshot.exerciseId !== requiredUuid(exerciseId, "Exercise ID"))
        throw new DomainValidationError("Exercise occurrence snapshot does not match its exercise", {
            snapshot: ["Snapshot exercise ID must match the occurrence exercise ID"],
        });
    return structuredClone(snapshot);
}

// ---------------------------------------------------------------------------------------------
// Validation (structural invariants across the whole strength tree)
// ---------------------------------------------------------------------------------------------

export function validateStrengthActivity(activity: StrengthActivityState): void {
    const occurrenceIds = new Set<string>();
    const occurrencePositions = new Set<number>();
    for (const occurrence of activity.occurrences) {
        if (occurrenceIds.has(occurrence.id))
            throw new DomainValidationError(`Duplicate exercise occurrence ID '${occurrence.id}'`, {
                occurrences: ["Exercise occurrence IDs must be unique"],
            });
        occurrenceIds.add(occurrence.id);
        if (occurrencePositions.has(occurrence.position))
            throw new DomainValidationError(`Duplicate exercise occurrence position ${occurrence.position}`, {
                occurrences: ["Exercise occurrence positions must be unique"],
            });
        occurrencePositions.add(occurrence.position);
        validatePerformedSets(occurrence);
    }

    validateSetGroups(activity, occurrenceIds);
}

function validatePerformedSets(occurrence: ExerciseOccurrenceState): void {
    const setIds = new Set<string>();
    const positions = new Set<number>();
    for (const set of occurrence.performedSets) {
        if (setIds.has(set.id))
            throw new DomainValidationError(`Duplicate performed set ID '${set.id}'`, {
                performedSets: ["Performed set IDs must be unique"],
            });
        setIds.add(set.id);
        if (positions.has(set.position))
            throw new DomainValidationError(`Duplicate performed set position ${set.position}`, {
                performedSets: ["Performed set positions must be unique within an occurrence"],
            });
        positions.add(set.position);
    }
}

function validateSetGroups(activity: StrengthActivityState, occurrenceIds: ReadonlySet<string>): void {
    const groupsById = new Map(activity.setGroups.map(group => [group.id, group]));
    const rootPositions = new Set<number>();
    const childPositions = new Map<string, Set<number>>();
    const groupIds = new Set<string>();

    for (const group of activity.setGroups) {
        if (groupIds.has(group.id))
            throw new DomainValidationError(`Duplicate set group ID '${group.id}'`, {
                setGroups: ["Set group IDs must be unique"],
            });
        groupIds.add(group.id);

        if (group.parentGroupId !== null && !groupsById.has(group.parentGroupId))
            throw new DomainValidationError("Set group references an unknown parent group", {
                setGroups: ["Set group references an unknown parent group"],
            });

        // Position uniqueness is scoped to the parent (root groups share one scope).
        if (group.parentGroupId === null) {
            if (rootPositions.has(group.position))
                throw new DomainValidationError(`Duplicate root set group position ${group.position}`, {
                    setGroups: ["Root set group positions must be unique"],
                });
            rootPositions.add(group.position);
        } else {
            const scope = childPositions.get(group.parentGroupId) ?? new Set<number>();
            if (scope.has(group.position))
                throw new DomainValidationError(`Duplicate child set group position ${group.position}`, {
                    setGroups: ["Child set group positions must be unique within their parent"],
                });
            scope.add(group.position);
            childPositions.set(group.parentGroupId, scope);
        }

        const memberPositions = new Set<number>();
        const memberOccurrences = new Set<string>();
        for (const member of group.members) {
            if (!occurrenceIds.has(member.occurrenceId))
                throw new DomainValidationError("Set group member references an unknown exercise occurrence", {
                    setGroups: ["Set group member references an unknown exercise occurrence"],
                });
            if (memberOccurrences.has(member.occurrenceId))
                throw new DomainValidationError("An exercise occurrence appears twice in one set group", {
                    setGroups: ["An exercise occurrence can only belong to a set group once"],
                });
            memberOccurrences.add(member.occurrenceId);
            if (memberPositions.has(member.position))
                throw new DomainValidationError(`Duplicate set group member position ${member.position}`, {
                    setGroups: ["Set group member positions must be unique"],
                });
            memberPositions.add(member.position);
        }
    }

    assertAcyclic(activity.setGroups, groupsById);

    // Performed sets that name a group must reference a group in this activity.
    for (const occurrence of activity.occurrences)
        for (const set of occurrence.performedSets)
            if (set.setGroupId !== null && !groupsById.has(set.setGroupId))
                throw new DomainValidationError("Performed set references an unknown set group", {
                    performedSets: ["Performed set references an unknown set group"],
                });
}

function assertAcyclic(groups: readonly SetGroupState[], groupsById: ReadonlyMap<string, SetGroupState>): void {
    for (const start of groups) {
        const seen = new Set<string>();
        let current: SetGroupState | undefined = start;
        while (current && current.parentGroupId !== null) {
            if (seen.has(current.id))
                throw new DomainValidationError("Set group hierarchy must be acyclic", {
                    setGroups: ["Set group hierarchy must be acyclic"],
                });
            seen.add(current.id);
            current = groupsById.get(current.parentGroupId);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Objective calculation policies (snapshotted repetition/load model; ST-4, design 16.4)
// ---------------------------------------------------------------------------------------------

/**
 * Work repetitions for total-volume formulas: stored reps for `total`/`alternating` semantics, and
 * `reps × 2` for `per_side` because a per-side rep count represents each side independently (ST-4,
 * design 16.4). Returns null when reps were not recorded.
 */
export function workReps(set: PerformedSetState, semantics: RepetitionSemantics): number | null {
    if (set.measurements.reps === null) return null;
    return semantics === "per_side" ? set.measurements.reps * 2 : set.measurements.reps;
}

/**
 * Objective effective load in canonical kilograms, derived only through the snapshotted load model
 * (design 9.2, 16.4). Kinetix never invents bodyweight fractions: `external_only` uses external load,
 * the bodyweight model uses `bodyweight + added − assistance` (floored at zero), `manual_effective_load`
 * trusts the caller-supplied effective load, and `none` yields null. Returns null when the required
 * inputs are absent.
 */
export function effectiveLoadKg(set: PerformedSetState, loadModel: ExerciseLoadModel): DecimalValue | null {
    const measurements = set.measurements;
    switch (loadModel) {
        case "external_only":
            return measurements.externalLoad === null ? null : massKg(measurements.externalLoad);
        case "manual_effective_load":
            return measurements.effectiveLoad === null ? null : massKg(measurements.effectiveLoad);
        case "full_bodyweight_plus_added_minus_assistance": {
            if (measurements.bodyweight === null) return null;
            let load = massKg(measurements.bodyweight);
            if (measurements.addedLoad !== null) load = add(load, massKg(measurements.addedLoad));
            if (measurements.assistanceLoad !== null) load = subtract(load, massKg(measurements.assistanceLoad));
            return load.compare(0) < 0 ? DecimalValue.from(0) : load;
        }
        case "none":
        default:
            return null;
    }
}

function massKg(value: MassValue): DecimalValue {
    return Mass.from(value.value, value.unit).canonical;
}

function add(left: DecimalValue, right: DecimalValue): DecimalValue {
    return combine(left, right, (l, r) => l + r);
}

function subtract(left: DecimalValue, right: DecimalValue): DecimalValue {
    return combine(left, right, (l, r) => l - r);
}

/** Exact decimal add/subtract by aligning the two coefficients to a common scale (no float drift). */
function combine(left: DecimalValue, right: DecimalValue, op: (l: bigint, r: bigint) => bigint): DecimalValue {
    const scale = Math.max(left.scale, right.scale);
    const l = left.coefficient * 10n ** BigInt(scale - left.scale);
    const r = right.coefficient * 10n ** BigInt(scale - right.scale);
    const result = op(l, r);
    if (scale === 0) return DecimalValue.from(result);
    const negative = result < 0n;
    const digits = (negative ? -result : result).toString().padStart(scale + 1, "0");
    return DecimalValue.from(`${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

// ---------------------------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------------------------

function requiredUuid(value: string, name: string): string {
    const normalized = (value ?? "").trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) return null;
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function nonNegativeInteger(value: number, name: string): number {
    if (!Number.isInteger(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative integer`);
    return value;
}

function positiveInteger(value: number, name: string): number {
    if (!Number.isInteger(value) || value < 1) throw new DomainValidationError(`${name} must be a positive integer`);
    return value;
}

function nonNegativeNumber(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0) throw new DomainValidationError(`${name} must be a non-negative number`);
    return value;
}

function integerInRange(value: number, min: number, max: number, name: string): number {
    if (!Number.isInteger(value) || value < min || value > max)
        throw new DomainValidationError(`${name} must be an integer between ${min} and ${max}`);
    return value;
}

function optionalScale(value: number | null | undefined, name: string, min: number, max: number): number | null {
    if (value == null) return null;
    return integerInRange(value, min, max, name);
}

/** RPE 1–10 in 0.5 increments (design 7.3). */
function rpeValue(value: number): number {
    if (!Number.isFinite(value) || value < 1 || value > 10 || Math.round(value * 2) !== value * 2)
        throw new DomainValidationError("RPE must be from 1 to 10 in 0.5 increments");
    return value;
}

function normalizeSetType(value: PerformedSetType): PerformedSetType {
    if (!performedSetTypes.includes(value))
        throw new DomainValidationError(`Unknown performed set type '${value}'`, {
            performedSets: ["Unknown performed set type"],
        });
    return value;
}

function normalizeSetStatus(value: PerformedSetStatus): PerformedSetStatus {
    if (!performedSetStatuses.includes(value))
        throw new DomainValidationError(`Unknown performed set state '${value}'`, {
            performedSets: ["Unknown performed set state"],
        });
    return value;
}

function normalizeFailureReason(value: SetFailureReason): SetFailureReason {
    if (!setFailureReasons.includes(value))
        throw new DomainValidationError(`Unknown set failure reason '${value}'`, {
            performedSets: ["Unknown set failure reason"],
        });
    return value;
}

function normalizeSetGroupType(value: SetGroupType): SetGroupType {
    if (!setGroupTypes.includes(value))
        throw new DomainValidationError(`Unknown set group type '${value}'`, {
            setGroups: ["Unknown set group type"],
        });
    return value;
}
