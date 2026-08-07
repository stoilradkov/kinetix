import { DomainValidationError } from "#src/platform/domain/index";

import { DecimalValue, Distance, Duration, Speed } from "#src/modules/training/domain/measurement";
import { zoneFamilies, type ZoneFamily } from "#src/modules/training/domain/zone-definition";
import type {
    DistanceValue,
    DistanceValueInput,
    DurationValue,
    DurationValueInput,
} from "#src/modules/training/domain/session-strength";

/**
 * Manual running summary owned by a {@link ./training-session} activity (design 11.3; PRD R1–R6). A
 * running activity promotes the frequently queried summary facts of a run — distance, moving/elapsed
 * time, heart rate, cadence, power, elevation, calories, biomechanics, a VO₂max estimate, perceived
 * effort — plus indoor/treadmill state, case-insensitive run-classification tags, and an optional
 * versioned environment placeholder. Structured running (design 11.3; PRD R2) layers hierarchical
 * performed run {@link PerformedRunStepState steps} (warm-up/work/recovery/repeat/cool-down/open with
 * nested repeats), arbitrary ordered {@link RunSplitState splits}, heart-rate/pace/power
 * {@link RunZoneTimeState zone times} referencing the effective versioned zone definition, an optional
 * bounded {@link RunRoute route} (reference and PostGIS-free geometry), and an optional gear reference.
 *
 * Every metric is optional and nullable so a partial summary is valid and a recorded `0` stays distinct
 * from an absent value (design 7.4). Average pace is never stored: {@link deriveAveragePace} derives it
 * deterministically from canonical distance and moving time, reporting why it could not be computed.
 * Zone definitions and gear are referenced by ID only; the application resolves the effective versioned
 * definition/gear through public ports and stamps the exact IDs — this module validates structure alone.
 */

export const runStepTypes = ["warm_up", "work", "recovery", "repeat", "cool_down", "open"] as const;
export type RunStepType = (typeof runStepTypes)[number];

/** Hard cap on a bounded route line (design 11.3: "without requiring PostGIS"); keeps payloads small. */
const MAX_ROUTE_POINTS = 5_000;
const MAX_ROUTE_BYTES = 128 * 1024;

export interface RunEnvironment {
    readonly schemaVersion: 1;
    readonly surface: string | null;
    readonly terrain: string | null;
    readonly weather: string | null;
    readonly temperatureCelsius: number | null;
}

/** Summary measurements optionally attached to a performed run step or split; `null` ≠ recorded `0`. */
export interface RunStepMeasurements {
    readonly distance: DistanceValue | null;
    readonly duration: DurationValue | null;
    readonly averageHeartRate: number | null;
    readonly maxHeartRate: number | null;
    readonly averageCadence: number | null;
    readonly maxCadence: number | null;
    readonly averagePower: number | null;
    readonly maxPower: number | null;
    readonly elevationGain: DistanceValue | null;
    readonly elevationLoss: DistanceValue | null;
    readonly rpe: number | null;
}

/**
 * A performed run step in the hierarchical warm-up/work/recovery/repeat/cool-down/open tree (design
 * 11.3; PRD RN-3). `parentStepId` nests children under a `repeat` block; `repeatCount` is set iff the
 * step is a `repeat`. Sibling positions are contiguous from zero within each parent (mirrors the
 * prescribed run-step tree).
 */
export interface PerformedRunStepState {
    readonly id: string;
    readonly parentStepId: string | null;
    readonly type: RunStepType;
    readonly position: number;
    readonly repeatCount: number | null;
    readonly measurements: RunStepMeasurements;
    readonly notes: string | null;
}

/** An arbitrary ordered split/lap with promoted summary metrics (design 11.3; PRD RN-4). */
export interface RunSplitState {
    readonly id: string;
    readonly position: number;
    readonly distance: DistanceValue | null;
    readonly movingTime: DurationValue | null;
    readonly elapsedTime: DurationValue | null;
    readonly averageHeartRate: number | null;
    readonly maxHeartRate: number | null;
    readonly averageCadence: number | null;
    readonly averagePower: number | null;
    readonly elevationGain: DistanceValue | null;
    readonly elevationLoss: DistanceValue | null;
    readonly notes: string | null;
}

/**
 * Time spent in a heart-rate/pace/power zone (design 11.3; PRD RN-5). References the effective
 * versioned {@link RunZoneTimeState.zoneDefinitionId zone definition} and optional range; the
 * application resolves the effective definition and stamps `zoneDefinitionId`/`zoneName` so historical
 * runs retain the exact version valid at performance time.
 */
export interface RunZoneTimeState {
    readonly id: string;
    readonly position: number;
    readonly family: ZoneFamily;
    readonly zoneDefinitionId: string | null;
    readonly zoneRangeId: string | null;
    readonly zoneName: string | null;
    readonly duration: DurationValue;
}

/** Bounded PostGIS-free route line: `[longitude, latitude]` pairs capped by {@link MAX_ROUTE_POINTS}. */
export interface RunRouteGeometry {
    readonly type: "line_string";
    readonly coordinates: ReadonlyArray<readonly [number, number]>;
}

/** Optional route reference plus optional validated geometry (design 11.3; PRD RN-4). */
export interface RunRoute {
    readonly schemaVersion: 1;
    readonly ref: string | null;
    readonly geometry: RunRouteGeometry | null;
}

export interface RunningActivityState {
    readonly distance: DistanceValue | null;
    readonly movingTime: DurationValue | null;
    readonly elapsedTime: DurationValue | null;
    readonly averageHeartRate: number | null;
    readonly maxHeartRate: number | null;
    readonly averageCadence: number | null;
    readonly maxCadence: number | null;
    readonly averagePower: number | null;
    readonly maxPower: number | null;
    readonly elevationGain: DistanceValue | null;
    readonly elevationLoss: DistanceValue | null;
    readonly calories: number | null;
    readonly strideLength: DistanceValue | null;
    readonly groundContactTime: DurationValue | null;
    readonly verticalOscillation: DistanceValue | null;
    readonly vo2Max: number | null;
    readonly rpe: number | null;
    readonly indoor: boolean;
    readonly treadmill: boolean;
    /** Case-insensitive run-classification tags (e.g. "easy", "tempo", "long"); custom values allowed. */
    readonly runTags: readonly string[];
    readonly environment: RunEnvironment | null;
    /** Hierarchical performed run steps (design 11.3; PRD RN-3); empty when the run has no structure. */
    readonly steps: readonly PerformedRunStepState[];
    /** Arbitrary ordered splits/laps (design 11.3; PRD RN-4). */
    readonly splits: readonly RunSplitState[];
    /** Time spent in heart-rate/pace/power zones (design 11.3; PRD RN-5). */
    readonly zoneTimes: readonly RunZoneTimeState[];
    /** Optional route reference and bounded geometry (design 11.3; PRD RN-4). */
    readonly route: RunRoute | null;
    /** Optional shoes/equipment reference (design 11.3; PRD RN-6); resolved through a public port. */
    readonly gearItemId: string | null;
}

export interface RunEnvironmentInput {
    readonly surface?: string | null;
    readonly terrain?: string | null;
    readonly weather?: string | null;
    readonly temperatureCelsius?: number | null;
}

export interface RunStepMeasurementsInput {
    readonly distance?: DistanceValueInput | null;
    readonly duration?: DurationValueInput | null;
    readonly averageHeartRate?: number | null;
    readonly maxHeartRate?: number | null;
    readonly averageCadence?: number | null;
    readonly maxCadence?: number | null;
    readonly averagePower?: number | null;
    readonly maxPower?: number | null;
    readonly elevationGain?: DistanceValueInput | null;
    readonly elevationLoss?: DistanceValueInput | null;
    readonly rpe?: number | null;
}

export interface PerformedRunStepInput {
    readonly id: string;
    readonly parentStepId?: string | null;
    readonly type: RunStepType;
    readonly position: number;
    readonly repeatCount?: number | null;
    readonly measurements?: RunStepMeasurementsInput;
    readonly notes?: string | null;
}

export interface RunSplitInput {
    readonly id: string;
    readonly position: number;
    readonly distance?: DistanceValueInput | null;
    readonly movingTime?: DurationValueInput | null;
    readonly elapsedTime?: DurationValueInput | null;
    readonly averageHeartRate?: number | null;
    readonly maxHeartRate?: number | null;
    readonly averageCadence?: number | null;
    readonly averagePower?: number | null;
    readonly elevationGain?: DistanceValueInput | null;
    readonly elevationLoss?: DistanceValueInput | null;
    readonly notes?: string | null;
}

export interface RunZoneTimeInput {
    readonly id: string;
    readonly position: number;
    readonly family: ZoneFamily;
    readonly zoneDefinitionId?: string | null;
    readonly zoneRangeId?: string | null;
    readonly zoneName?: string | null;
    readonly duration: DurationValueInput;
}

export interface RunRouteGeometryInput {
    readonly type: "line_string";
    readonly coordinates: ReadonlyArray<readonly [number, number]>;
}

export interface RunRouteInput {
    readonly ref?: string | null;
    readonly geometry?: RunRouteGeometryInput | null;
}

export interface RunningActivityInput {
    readonly distance?: DistanceValueInput | null;
    readonly movingTime?: DurationValueInput | null;
    readonly elapsedTime?: DurationValueInput | null;
    readonly averageHeartRate?: number | null;
    readonly maxHeartRate?: number | null;
    readonly averageCadence?: number | null;
    readonly maxCadence?: number | null;
    readonly averagePower?: number | null;
    readonly maxPower?: number | null;
    readonly elevationGain?: DistanceValueInput | null;
    readonly elevationLoss?: DistanceValueInput | null;
    readonly calories?: number | null;
    readonly strideLength?: DistanceValueInput | null;
    readonly groundContactTime?: DurationValueInput | null;
    readonly verticalOscillation?: DistanceValueInput | null;
    readonly vo2Max?: number | null;
    readonly rpe?: number | null;
    readonly indoor?: boolean | null;
    readonly treadmill?: boolean | null;
    readonly runTags?: readonly string[];
    readonly environment?: RunEnvironmentInput | null;
    readonly steps?: readonly PerformedRunStepInput[];
    readonly splits?: readonly RunSplitInput[];
    readonly zoneTimes?: readonly RunZoneTimeInput[];
    readonly route?: RunRouteInput | null;
    readonly gearItemId?: string | null;
}

export const EMPTY_RUNNING_ACTIVITY: RunningActivityState = {
    distance: null,
    movingTime: null,
    elapsedTime: null,
    averageHeartRate: null,
    maxHeartRate: null,
    averageCadence: null,
    maxCadence: null,
    averagePower: null,
    maxPower: null,
    elevationGain: null,
    elevationLoss: null,
    calories: null,
    strideLength: null,
    groundContactTime: null,
    verticalOscillation: null,
    vo2Max: null,
    rpe: null,
    indoor: false,
    treadmill: false,
    runTags: [],
    environment: null,
    steps: [],
    splits: [],
    zoneTimes: [],
    route: null,
    gearItemId: null,
};

// ---------------------------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------------------------

export function normalizeRunningActivity(input: RunningActivityInput): RunningActivityState {
    const indoor = input.indoor ?? false;
    const treadmill = input.treadmill ?? false;
    const state: RunningActivityState = {
        distance: normalizeDistance(input.distance, "Run distance"),
        movingTime: normalizeDuration(input.movingTime, "Run moving time"),
        elapsedTime: normalizeDuration(input.elapsedTime, "Run elapsed time"),
        averageHeartRate: normalizeCount(input.averageHeartRate, "Average heart rate", 0, 999),
        maxHeartRate: normalizeCount(input.maxHeartRate, "Max heart rate", 0, 999),
        averageCadence: normalizeCount(input.averageCadence, "Average cadence", 0, 999),
        maxCadence: normalizeCount(input.maxCadence, "Max cadence", 0, 999),
        averagePower: normalizeNonNegativeNumber(input.averagePower, "Average power"),
        maxPower: normalizeNonNegativeNumber(input.maxPower, "Max power"),
        elevationGain: normalizeDistance(input.elevationGain, "Elevation gain"),
        elevationLoss: normalizeDistance(input.elevationLoss, "Elevation loss"),
        calories: normalizeCount(input.calories, "Calories", 0, 100_000),
        strideLength: normalizeDistance(input.strideLength, "Stride length"),
        groundContactTime: normalizeDuration(input.groundContactTime, "Ground contact time"),
        verticalOscillation: normalizeDistance(input.verticalOscillation, "Vertical oscillation"),
        vo2Max: normalizeNonNegativeNumber(input.vo2Max, "VO2max estimate"),
        rpe: input.rpe == null ? null : rpeValue(input.rpe),
        indoor,
        treadmill,
        runTags: normalizeRunTags(input.runTags ?? []),
        environment: normalizeEnvironment(input.environment),
        steps: (input.steps ?? []).map(normalizeRunStep),
        splits: (input.splits ?? []).map(normalizeRunSplit),
        zoneTimes: (input.zoneTimes ?? []).map(normalizeZoneTime),
        route: normalizeRoute(input.route),
        gearItemId: input.gearItemId == null ? null : requiredUuid(input.gearItemId, "Gear item ID"),
    };
    validateRunningActivity(state);
    return state;
}

function normalizeRunStep(input: PerformedRunStepInput): PerformedRunStepState {
    const type = normalizeRunStepType(input.type);
    return {
        id: requiredUuid(input.id, "Run step ID"),
        parentStepId: input.parentStepId == null ? null : requiredUuid(input.parentStepId, "Parent run step ID"),
        type,
        position: integerInRange(input.position, 0, Number.MAX_SAFE_INTEGER, "Run step position"),
        // A `repeat` step carries a positive repeat count; every other type must not (design 11.3).
        repeatCount:
            type === "repeat"
                ? integerInRange(input.repeatCount ?? 0, 1, 10_000, "Run step repeat count")
                : rejectRepeatCount(input.repeatCount),
        measurements: normalizeStepMeasurements(input.measurements ?? {}),
        notes: optionalText(input.notes, "Run step notes", 500),
    };
}

function rejectRepeatCount(value: number | null | undefined): null {
    if (value != null)
        throw new DomainValidationError("Only a repeat run step can carry a repeat count", {
            running: ["Only a repeat run step can carry a repeat count"],
        });
    return null;
}

function normalizeStepMeasurements(input: RunStepMeasurementsInput): RunStepMeasurements {
    return {
        distance: normalizeDistance(input.distance, "Run step distance"),
        duration: normalizeDuration(input.duration, "Run step duration"),
        averageHeartRate: normalizeCount(input.averageHeartRate, "Run step average heart rate", 0, 999),
        maxHeartRate: normalizeCount(input.maxHeartRate, "Run step max heart rate", 0, 999),
        averageCadence: normalizeCount(input.averageCadence, "Run step average cadence", 0, 999),
        maxCadence: normalizeCount(input.maxCadence, "Run step max cadence", 0, 999),
        averagePower: normalizeNonNegativeNumber(input.averagePower, "Run step average power"),
        maxPower: normalizeNonNegativeNumber(input.maxPower, "Run step max power"),
        elevationGain: normalizeDistance(input.elevationGain, "Run step elevation gain"),
        elevationLoss: normalizeDistance(input.elevationLoss, "Run step elevation loss"),
        rpe: input.rpe == null ? null : rpeValue(input.rpe),
    };
}

function normalizeRunSplit(input: RunSplitInput): RunSplitState {
    return {
        id: requiredUuid(input.id, "Run split ID"),
        position: integerInRange(input.position, 0, Number.MAX_SAFE_INTEGER, "Run split position"),
        distance: normalizeDistance(input.distance, "Run split distance"),
        movingTime: normalizeDuration(input.movingTime, "Run split moving time"),
        elapsedTime: normalizeDuration(input.elapsedTime, "Run split elapsed time"),
        averageHeartRate: normalizeCount(input.averageHeartRate, "Run split average heart rate", 0, 999),
        maxHeartRate: normalizeCount(input.maxHeartRate, "Run split max heart rate", 0, 999),
        averageCadence: normalizeCount(input.averageCadence, "Run split average cadence", 0, 999),
        averagePower: normalizeNonNegativeNumber(input.averagePower, "Run split average power"),
        elevationGain: normalizeDistance(input.elevationGain, "Run split elevation gain"),
        elevationLoss: normalizeDistance(input.elevationLoss, "Run split elevation loss"),
        notes: optionalText(input.notes, "Run split notes", 500),
    };
}

function normalizeZoneTime(input: RunZoneTimeInput): RunZoneTimeState {
    const duration = normalizeDuration(input.duration, "Zone time duration");
    if (duration === null)
        throw new DomainValidationError("Zone time requires a duration", {
            running: ["Zone time requires a duration"],
        });
    return {
        id: requiredUuid(input.id, "Zone time ID"),
        position: integerInRange(input.position, 0, Number.MAX_SAFE_INTEGER, "Zone time position"),
        family: normalizeZoneFamily(input.family),
        // Zone references are resolved and stamped by the application through the zone port.
        zoneDefinitionId:
            input.zoneDefinitionId == null ? null : requiredUuid(input.zoneDefinitionId, "Zone definition ID"),
        zoneRangeId: input.zoneRangeId == null ? null : requiredUuid(input.zoneRangeId, "Zone range ID"),
        zoneName: optionalText(input.zoneName, "Zone name", 120),
        duration,
    };
}

function normalizeRoute(input: RunRouteInput | null | undefined): RunRoute | null {
    if (input == null) return null;
    const ref = optionalText(input.ref, "Route reference", 200);
    const geometry = normalizeRouteGeometry(input.geometry);
    if (ref === null && geometry === null) return null;
    return { schemaVersion: 1, ref, geometry };
}

function normalizeRouteGeometry(input: RunRouteGeometryInput | null | undefined): RunRouteGeometry | null {
    if (input == null) return null;
    if (input.type !== "line_string")
        throw new DomainValidationError("Route geometry must be a line_string", {
            running: ["Route geometry must be a line_string"],
        });
    const coordinates = input.coordinates ?? [];
    if (coordinates.length < 2 || coordinates.length > MAX_ROUTE_POINTS)
        throw new DomainValidationError(`Route geometry must have between 2 and ${MAX_ROUTE_POINTS} points`, {
            running: [`Route geometry must have between 2 and ${MAX_ROUTE_POINTS} points`],
        });
    const normalized = coordinates.map(point => normalizeCoordinate(point));
    const geometry: RunRouteGeometry = { type: "line_string", coordinates: normalized };
    if (JSON.stringify(geometry).length > MAX_ROUTE_BYTES)
        throw new DomainValidationError("Route geometry payload is too large", {
            running: ["Route geometry payload is too large"],
        });
    return geometry;
}

function normalizeCoordinate(point: readonly [number, number]): readonly [number, number] {
    const [longitude, latitude] = point ?? [];
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
        throw new DomainValidationError("Route longitude must be between -180 and 180", {
            running: ["Route longitude must be between -180 and 180"],
        });
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
        throw new DomainValidationError("Route latitude must be between -90 and 90", {
            running: ["Route latitude must be between -90 and 90"],
        });
    return [longitude, latitude];
}

function normalizeEnvironment(input: RunEnvironmentInput | null | undefined): RunEnvironment | null {
    if (input == null) return null;
    const environment: RunEnvironment = {
        schemaVersion: 1,
        surface: optionalText(input.surface, "Run surface", 80),
        terrain: optionalText(input.terrain, "Run terrain", 80),
        weather: optionalText(input.weather, "Run weather", 200),
        temperatureCelsius:
            input.temperatureCelsius == null
                ? null
                : finiteNumber(input.temperatureCelsius, "Run temperature", -100, 100),
    };
    const anyField =
        environment.surface !== null ||
        environment.terrain !== null ||
        environment.weather !== null ||
        environment.temperatureCelsius !== null;
    return anyField ? environment : null;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export function validateRunningActivity(activity: RunningActivityState): void {
    validateDistance(activity.distance, "Run distance");
    validateDuration(activity.movingTime, "Run moving time");
    validateDuration(activity.elapsedTime, "Run elapsed time");
    validateCount(activity.averageHeartRate, "Average heart rate", 0, 999);
    validateCount(activity.maxHeartRate, "Max heart rate", 0, 999);
    validateCount(activity.averageCadence, "Average cadence", 0, 999);
    validateCount(activity.maxCadence, "Max cadence", 0, 999);
    validateNonNegativeNumber(activity.averagePower, "Average power");
    validateNonNegativeNumber(activity.maxPower, "Max power");
    validateDistance(activity.elevationGain, "Elevation gain");
    validateDistance(activity.elevationLoss, "Elevation loss");
    validateCount(activity.calories, "Calories", 0, 100_000);
    validateDistance(activity.strideLength, "Stride length");
    validateDuration(activity.groundContactTime, "Ground contact time");
    validateDistance(activity.verticalOscillation, "Vertical oscillation");
    validateNonNegativeNumber(activity.vo2Max, "VO2max estimate");
    if (activity.rpe !== null) rpeValue(activity.rpe);
    normalizeRunTags(activity.runTags);

    // Moving time can never exceed elapsed time — a run cannot move for longer than it lasted.
    if (activity.movingTime !== null && activity.elapsedTime !== null) {
        const moving = Duration.from(activity.movingTime.value, activity.movingTime.unit).milliseconds;
        const elapsed = Duration.from(activity.elapsedTime.value, activity.elapsedTime.unit).milliseconds;
        if (moving > elapsed)
            throw new DomainValidationError("Run moving time cannot exceed elapsed time", {
                running: ["Run moving time cannot exceed elapsed time"],
            });
    }
    // A treadmill run is by definition indoor; reject the contradictory outdoor-treadmill state.
    if (activity.treadmill && !activity.indoor)
        throw new DomainValidationError("A treadmill run must be marked indoor", {
            running: ["A treadmill run must be marked indoor"],
        });
    if (
        activity.maxHeartRate !== null &&
        activity.averageHeartRate !== null &&
        activity.maxHeartRate < activity.averageHeartRate
    )
        throw new DomainValidationError("Max heart rate cannot be below average heart rate", {
            running: ["Max heart rate cannot be below average heart rate"],
        });
    if (activity.maxPower !== null && activity.averagePower !== null && activity.maxPower < activity.averagePower)
        throw new DomainValidationError("Max power cannot be below average power", {
            running: ["Max power cannot be below average power"],
        });
    if (
        activity.maxCadence !== null &&
        activity.averageCadence !== null &&
        activity.maxCadence < activity.averageCadence
    )
        throw new DomainValidationError("Max cadence cannot be below average cadence", {
            running: ["Max cadence cannot be below average cadence"],
        });
    if (activity.environment !== null && activity.environment.schemaVersion !== 1)
        throw new DomainValidationError("Run environment requires schema version 1", {
            running: ["Run environment requires schema version 1"],
        });

    validateRunSteps(activity.steps);
    validateRunSplits(activity.splits);
    validateZoneTimes(activity.zoneTimes);
    if (activity.route !== null && activity.route.schemaVersion !== 1)
        throw new DomainValidationError("Run route requires schema version 1", {
            running: ["Run route requires schema version 1"],
        });
    if (activity.gearItemId !== null) requiredUuid(activity.gearItemId, "Gear item ID");
    assertUniqueRunningIds(activity);
}

/**
 * Structural invariants for the performed run-step tree: unique IDs, known parents in the same
 * activity, `repeat`⇔`repeatCount` pairing, contiguous sibling positions per parent (from zero), and
 * an acyclic parent chain — mirroring the prescribed run-step tree.
 */
function validateRunSteps(steps: readonly PerformedRunStepState[]): void {
    const byId = new Map<string, PerformedRunStepState>();
    for (const step of steps) {
        if (byId.has(step.id))
            throw new DomainValidationError(`Duplicate run step ID '${step.id}'`, {
                running: ["Run step IDs must be unique"],
            });
        byId.set(step.id, step);
        normalizeRunStepType(step.type);
        if ((step.type === "repeat") !== (step.repeatCount !== null))
            throw new DomainValidationError(
                "A repeat run step requires a repeat count and no other type may carry one",
                {
                    running: ["A repeat run step requires a repeat count and no other type may carry one"],
                },
            );
    }
    for (const step of steps)
        if (step.parentStepId !== null && !byId.has(step.parentStepId))
            throw new DomainValidationError("Run step references an unknown parent step", {
                running: ["Run step references an unknown parent step"],
            });
    // Only a `repeat` step may contain children.
    for (const step of steps)
        if (step.parentStepId !== null) {
            const parent = byId.get(step.parentStepId);
            if (parent && parent.type !== "repeat")
                throw new DomainValidationError("Only a repeat run step can contain child steps", {
                    running: ["Only a repeat run step can contain child steps"],
                });
        }
    assertContiguousStepPositions(steps);
    assertRunStepsAcyclic(steps, byId);
}

/** Sibling positions must be the contiguous set 0..n-1 within each parent scope (roots share one). */
function assertContiguousStepPositions(steps: readonly PerformedRunStepState[]): void {
    const scopes = new Map<string | null, number[]>();
    for (const step of steps) {
        const scope = scopes.get(step.parentStepId) ?? [];
        scope.push(step.position);
        scopes.set(step.parentStepId, scope);
    }
    for (const positions of scopes.values()) {
        const sorted = [...positions].sort((a, b) => a - b);
        for (let index = 0; index < sorted.length; index += 1)
            if (sorted[index] !== index)
                throw new DomainValidationError("Run step positions must be contiguous from zero within a parent", {
                    running: ["Run step positions must be contiguous from zero within a parent"],
                });
    }
}

function assertRunStepsAcyclic(
    steps: readonly PerformedRunStepState[],
    byId: ReadonlyMap<string, PerformedRunStepState>,
): void {
    for (const start of steps) {
        const seen = new Set<string>();
        let current: PerformedRunStepState | undefined = start;
        while (current && current.parentStepId !== null) {
            if (seen.has(current.id))
                throw new DomainValidationError("Run step hierarchy must be acyclic", {
                    running: ["Run step hierarchy must be acyclic"],
                });
            seen.add(current.id);
            current = byId.get(current.parentStepId);
        }
    }
}

function validateRunSplits(splits: readonly RunSplitState[]): void {
    const ids = new Set<string>();
    const positions = new Set<number>();
    for (const split of splits) {
        if (ids.has(split.id))
            throw new DomainValidationError(`Duplicate run split ID '${split.id}'`, {
                running: ["Run split IDs must be unique"],
            });
        ids.add(split.id);
        if (positions.has(split.position))
            throw new DomainValidationError(`Duplicate run split position ${split.position}`, {
                running: ["Run split positions must be unique"],
            });
        positions.add(split.position);
        // A split cannot move for longer than it lasted (mirrors the summary invariant).
        if (split.movingTime !== null && split.elapsedTime !== null) {
            const moving = Duration.from(split.movingTime.value, split.movingTime.unit).milliseconds;
            const elapsed = Duration.from(split.elapsedTime.value, split.elapsedTime.unit).milliseconds;
            if (moving > elapsed)
                throw new DomainValidationError("Run split moving time cannot exceed elapsed time", {
                    running: ["Run split moving time cannot exceed elapsed time"],
                });
        }
    }
}

function validateZoneTimes(zoneTimes: readonly RunZoneTimeState[]): void {
    const ids = new Set<string>();
    const positions = new Set<number>();
    for (const zoneTime of zoneTimes) {
        if (ids.has(zoneTime.id))
            throw new DomainValidationError(`Duplicate zone time ID '${zoneTime.id}'`, {
                running: ["Zone time IDs must be unique"],
            });
        ids.add(zoneTime.id);
        if (positions.has(zoneTime.position))
            throw new DomainValidationError(`Duplicate zone time position ${zoneTime.position}`, {
                running: ["Zone time positions must be unique"],
            });
        positions.add(zoneTime.position);
        normalizeZoneFamily(zoneTime.family);
        const duration = Duration.from(zoneTime.duration.value, zoneTime.duration.unit).milliseconds;
        if (duration <= 0n)
            throw new DomainValidationError("Zone time duration must be greater than zero", {
                running: ["Zone time duration must be greater than zero"],
            });
    }
}

/** IDs must be unique across every running child collection so mappings/persistence stay unambiguous. */
function assertUniqueRunningIds(activity: RunningActivityState): void {
    const seen = new Set<string>();
    for (const id of [
        ...activity.steps.map(step => step.id),
        ...activity.splits.map(split => split.id),
        ...activity.zoneTimes.map(zoneTime => zoneTime.id),
    ]) {
        if (seen.has(id))
            throw new DomainValidationError(`Duplicate running child ID '${id}'`, {
                running: ["Running child IDs must be unique across steps, splits, and zone times"],
            });
        seen.add(id);
    }
}

// ---------------------------------------------------------------------------------------------
// Canonical average-pace derivation (design 11.3, 16.6). Pure query behaviour — never stored.
// ---------------------------------------------------------------------------------------------

export const paceExclusionReasons = [
    "missing_distance",
    "zero_distance",
    "missing_moving_time",
    "zero_moving_time",
] as const;
export type PaceExclusionReason = (typeof paceExclusionReasons)[number];

/**
 * Deterministic average-pace derivation from canonical distance and moving time (design 16.6). Returns
 * canonical metres/second plus seconds-per-kilometre and seconds-per-mile projections, or `null`
 * projections with the reasons the pace could not be derived (missing/zero distance or moving time).
 */
export interface DerivedRunPace {
    readonly source: "distance_and_moving_time";
    readonly speedMetresPerSecond: string | null;
    readonly secondsPerKilometre: number | null;
    readonly secondsPerMile: number | null;
    readonly exclusions: readonly PaceExclusionReason[];
}

const METRES_PER_MILE = "1609.344";

export function deriveAveragePace(activity: RunningActivityState): DerivedRunPace {
    const exclusions: PaceExclusionReason[] = [];
    let distanceMetres: DecimalValue | null = null;
    let movingMs: bigint | null = null;

    if (activity.distance === null) exclusions.push("missing_distance");
    else {
        distanceMetres = Distance.from(activity.distance.value, activity.distance.unit).canonical;
        if (distanceMetres.compare(0) === 0) exclusions.push("zero_distance");
    }

    if (activity.movingTime === null) exclusions.push("missing_moving_time");
    else {
        movingMs = Duration.from(activity.movingTime.value, activity.movingTime.unit).milliseconds;
        if (movingMs === 0n) exclusions.push("zero_moving_time");
    }

    if (exclusions.length > 0 || distanceMetres === null || movingMs === null)
        return {
            source: "distance_and_moving_time",
            speedMetresPerSecond: null,
            secondsPerKilometre: null,
            secondsPerMile: null,
            exclusions,
        };

    const speed = Speed.fromPace(Duration.fromCanonical(movingMs), Distance.fromCanonical(distanceMetres));
    // seconds per kilometre = movingMs / distanceMetres (ms per metre is numerically seconds per km).
    const secondsPerKilometre = DecimalValue.from(movingMs).divide(distanceMetres, 3);
    return {
        source: "distance_and_moving_time",
        speedMetresPerSecond: speed.canonical.toString(),
        secondsPerKilometre: secondsPerKilometre.toNumber(),
        secondsPerMile: secondsPerKilometre.multiply(METRES_PER_MILE).divide(1000, 3).toNumber(),
        exclusions,
    };
}

// ---------------------------------------------------------------------------------------------
// Primitive helpers (mirrors ./session-strength conventions)
// ---------------------------------------------------------------------------------------------

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

function validateDistance(value: DistanceValue | null, name: string): void {
    if (value === null) return;
    validateMeasurement(name, () => Distance.from(value.value, value.unit));
}

function validateDuration(value: DurationValue | null, name: string): void {
    if (value === null) return;
    validateMeasurement(name, () => Duration.from(value.value, value.unit));
}

/** Run a measurement value-object constructor for validation, re-labelling any failure with the field. */
function validateMeasurement(name: string, build: () => unknown): void {
    try {
        build();
    } catch (error) {
        throw new DomainValidationError(`${name} is invalid: ${(error as Error).message}`, {
            running: [`${name} is invalid`],
        });
    }
}

function normalizeCount(value: number | null | undefined, name: string, min: number, max: number): number | null {
    if (value == null) return null;
    return integerInRange(value, min, max, name);
}

function validateCount(value: number | null, name: string, min: number, max: number): void {
    if (value === null) return;
    integerInRange(value, min, max, name);
}

function normalizeNonNegativeNumber(value: number | null | undefined, name: string): number | null {
    if (value == null) return null;
    return nonNegativeNumber(value, name);
}

function validateNonNegativeNumber(value: number | null, name: string): void {
    if (value === null) return;
    nonNegativeNumber(value, name);
}

function integerInRange(value: number, min: number, max: number, name: string): number {
    if (!Number.isInteger(value) || value < min || value > max)
        throw new DomainValidationError(`${name} must be an integer between ${min} and ${max}`, {
            running: [`${name} must be an integer between ${min} and ${max}`],
        });
    return value;
}

function nonNegativeNumber(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative number`, {
            running: [`${name} must be a non-negative number`],
        });
    return value;
}

function finiteNumber(value: number, name: string, min: number, max: number): number {
    if (!Number.isFinite(value) || value < min || value > max)
        throw new DomainValidationError(`${name} must be a number between ${min} and ${max}`, {
            running: [`${name} must be a number between ${min} and ${max}`],
        });
    return value;
}

/** RPE 1–10 in 0.5 increments (design 7.3). */
function rpeValue(value: number): number {
    if (!Number.isFinite(value) || value < 1 || value > 10 || Math.round(value * 2) !== value * 2)
        throw new DomainValidationError("Run RPE must be from 1 to 10 in 0.5 increments", {
            running: ["Run RPE must be from 1 to 10 in 0.5 increments"],
        });
    return value;
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) return null;
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`, {
            running: [`${name} cannot exceed ${maximumLength} characters`],
        });
    return normalized;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value: string, name: string): string {
    const normalized = (value ?? "").trim();
    if (!UUID_PATTERN.test(normalized))
        throw new DomainValidationError(`${name} must be a UUID`, { running: [`${name} must be a UUID`] });
    return normalized;
}

function normalizeRunStepType(value: RunStepType): RunStepType {
    if (!runStepTypes.includes(value))
        throw new DomainValidationError(`Unknown run step type '${value}'`, {
            running: ["Unknown run step type"],
        });
    return value;
}

function normalizeZoneFamily(value: ZoneFamily): ZoneFamily {
    if (!zoneFamilies.includes(value))
        throw new DomainValidationError(`Unknown zone family '${value}'`, {
            running: ["Unknown zone family"],
        });
    return value;
}

/** Case-insensitive tag normalization: trim + NFKC, dedup by folded value, keep first-seen display (TS-7). */
function normalizeRunTags(values: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = value.trim().normalize("NFKC");
        if (normalized.length === 0 || normalized.length > 80)
            throw new DomainValidationError("Run tag must be 1 to 80 characters", {
                running: ["Run tag must be 1 to 80 characters"],
            });
        const folded = normalized.toLocaleLowerCase();
        if (!seen.has(folded)) {
            seen.add(folded);
            result.push(normalized);
        }
    }
    return result;
}
