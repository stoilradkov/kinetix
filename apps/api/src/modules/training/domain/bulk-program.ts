import { DomainValidationError } from "#src/platform/domain/index";

import { Distance, Duration, Mass, Speed } from "#src/modules/training/domain/measurement";
import type { RawTargetRanges } from "#src/modules/training/domain/session-prescription";

/**
 * Pure bulk-program normalization policy (design 14.1–14.2; PRD BI-1–5). The dry-run orchestration
 * (application layer) reuses the existing Program, prescription, schedule, and measurement domain
 * to validate and preview a complete program. This module holds only the bulk-specific pure pieces:
 * input-limit guards, stable-external-id → minted-UUID resolution of the block/session tree, and
 * entered-unit → canonical-measurement target normalization. Everything here is framework-, clock-,
 * and database-free.
 */

/** Bounded input limits so a single dry-run cannot expand into an unbounded tree (design 14.2). */
export const BULK_PROGRAM_LIMITS = {
    maxBlocks: 200,
    maxSessions: 500,
    maxActivitiesPerSession: 40,
    maxExercisesPerActivity: 40,
    maxSetsPerExercise: 60,
    maxRunStepsPerActivity: 60,
} as const;

interface BulkLimitCounts {
    readonly blocks: number;
    readonly sessions: number;
    readonly activitiesPerSession: readonly number[];
    readonly exercisesPerActivity: readonly number[];
    readonly setsPerExercise: readonly number[];
    readonly runStepsPerActivity: readonly number[];
}

/** Reject an over-large payload before any resolution work. Throws with the exceeded dimension. */
export function assertWithinBulkLimits(counts: BulkLimitCounts): void {
    check(counts.blocks, BULK_PROGRAM_LIMITS.maxBlocks, "blocks");
    check(counts.sessions, BULK_PROGRAM_LIMITS.maxSessions, "sessions");
    for (const value of counts.activitiesPerSession)
        check(value, BULK_PROGRAM_LIMITS.maxActivitiesPerSession, "activities in a session");
    for (const value of counts.exercisesPerActivity)
        check(value, BULK_PROGRAM_LIMITS.maxExercisesPerActivity, "exercises in an activity");
    for (const value of counts.setsPerExercise)
        check(value, BULK_PROGRAM_LIMITS.maxSetsPerExercise, "sets in an exercise");
    for (const value of counts.runStepsPerActivity)
        check(value, BULK_PROGRAM_LIMITS.maxRunStepsPerActivity, "run steps in an activity");
}

function check(value: number, limit: number, label: string): void {
    if (value > limit)
        throw new DomainValidationError(`Bulk program exceeds the limit of ${limit} ${label}`, {
            limits: [`Too many ${label}: ${value} exceeds ${limit}`],
        });
}

// ---------------------------------------------------------------------------------------------
// External-id → minted-UUID tree resolution
// ---------------------------------------------------------------------------------------------

export interface BulkBlockRef {
    readonly externalId: string;
    readonly parentExternalId: string | null;
}

export interface ResolvedBlockId {
    readonly externalId: string;
    readonly id: string;
    readonly parentBlockId: string | null;
}

export interface BulkTreeIds {
    readonly programId: string;
    readonly blockIdByExternalId: ReadonlyMap<string, string>;
    readonly blocks: readonly ResolvedBlockId[];
    readonly sessionIdByExternalId: ReadonlyMap<string, string>;
}

/**
 * Mint a stable UUID for the program and every externally-identified block and session, and resolve
 * each block's `parentExternalId` to a minted parent UUID. Duplicate external ids and dangling
 * parent references are rejected here (before the Program aggregate ever sees the tree) so the
 * caller gets a precise, source-shaped error rather than an opaque UUID mismatch downstream.
 */
export function assignBulkTreeIds(
    blocks: readonly BulkBlockRef[],
    sessionExternalIds: readonly string[],
    mintId: () => string,
): BulkTreeIds {
    const blockIdByExternalId = new Map<string, string>();
    for (const block of blocks) {
        if (blockIdByExternalId.has(block.externalId))
            throw new DomainValidationError(`Duplicate block externalId '${block.externalId}'`, {
                blocks: [`Duplicate block externalId '${block.externalId}'`],
            });
        blockIdByExternalId.set(block.externalId, mintId());
    }
    const resolvedBlocks = blocks.map(block => {
        let parentBlockId: string | null = null;
        if (block.parentExternalId != null) {
            const parent = blockIdByExternalId.get(block.parentExternalId);
            if (parent === undefined)
                throw new DomainValidationError(
                    `Block '${block.externalId}' references unknown parent '${block.parentExternalId}'`,
                    { blocks: [`Unknown parent externalId '${block.parentExternalId}'`] },
                );
            parentBlockId = parent;
        }
        return { externalId: block.externalId, id: blockIdByExternalId.get(block.externalId)!, parentBlockId };
    });

    const sessionIdByExternalId = new Map<string, string>();
    for (const externalId of sessionExternalIds) {
        if (sessionIdByExternalId.has(externalId))
            throw new DomainValidationError(`Duplicate session externalId '${externalId}'`, {
                sessions: [`Duplicate session externalId '${externalId}'`],
            });
        sessionIdByExternalId.set(externalId, mintId());
    }

    return {
        programId: mintId(),
        blockIdByExternalId,
        blocks: resolvedBlocks,
        sessionIdByExternalId,
    };
}

// ---------------------------------------------------------------------------------------------
// Entered-unit → canonical-measurement target normalization
// ---------------------------------------------------------------------------------------------

type EnteredMass = { readonly value: number; readonly unit: "kg" | "lb" };
type EnteredDistance = { readonly value: number; readonly unit: "m" | "cm" | "km" | "mi" };
type EnteredDuration = { readonly value: number; readonly unit: "ms" | "s" | "min" | "h" };
type EnteredSpeedOrPace = {
    readonly value: number;
    readonly unit: "m/s" | "km/h" | "mph" | "min/km" | "min/mi";
};

export interface EnteredStrengthTargets {
    readonly repsMin?: number | null;
    readonly repsMax?: number | null;
    readonly loadMin?: EnteredMass | null;
    readonly loadMax?: EnteredMass | null;
    readonly percent1rm?: string | null;
    readonly percentTrainingMax?: string | null;
    readonly rpeMin?: string | null;
    readonly rpeMax?: string | null;
    readonly rirMin?: number | null;
    readonly rirMax?: number | null;
    readonly restMin?: EnteredDuration | null;
    readonly restMax?: EnteredDuration | null;
    readonly tempo?: {
        readonly eccentricMs?: number | null;
        readonly bottomPauseMs?: number | null;
        readonly concentricMs?: number | null;
        readonly topPauseMs?: number | null;
    } | null;
}

export interface EnteredRunStepTargets {
    readonly durationMin?: EnteredDuration | null;
    readonly durationMax?: EnteredDuration | null;
    readonly distanceMin?: EnteredDistance | null;
    readonly distanceMax?: EnteredDistance | null;
    readonly speedMin?: EnteredSpeedOrPace | null;
    readonly speedMax?: EnteredSpeedOrPace | null;
    readonly hrMin?: number | null;
    readonly hrMax?: number | null;
}

/** Convert entered strength-set targets (kg/lb load, entered rest) to canonical kg/ms ranges. */
export function normalizeStrengthSetTargets(targets: EnteredStrengthTargets): RawTargetRanges {
    const raw: Mutable<RawTargetRanges> = {};
    setNumber(raw, "repsMin", targets.repsMin);
    setNumber(raw, "repsMax", targets.repsMax);
    setString(raw, "loadKgMin", mass(targets.loadMin));
    setString(raw, "loadKgMax", mass(targets.loadMax));
    setString(raw, "percent1rm", targets.percent1rm);
    setString(raw, "percentTrainingMax", targets.percentTrainingMax);
    setString(raw, "rpeMin", targets.rpeMin);
    setString(raw, "rpeMax", targets.rpeMax);
    setNumber(raw, "rirMin", targets.rirMin);
    setNumber(raw, "rirMax", targets.rirMax);
    setNumber(raw, "restMsMin", durationMs(targets.restMin));
    setNumber(raw, "restMsMax", durationMs(targets.restMax));
    if (targets.tempo != null) raw.tempo = { ...targets.tempo };
    raw.enteredTargets = cleanEntered(targets);
    return raw;
}

/** Convert entered run-step targets (distance, duration, pace/speed) to canonical m/ms/m·s⁻¹. */
export function normalizeRunStepTargets(targets: EnteredRunStepTargets): RawTargetRanges {
    const raw: Mutable<RawTargetRanges> = {};
    setNumber(raw, "durationMsMin", durationMs(targets.durationMin));
    setNumber(raw, "durationMsMax", durationMs(targets.durationMax));
    setString(raw, "distanceMMin", distance(targets.distanceMin));
    setString(raw, "distanceMMax", distance(targets.distanceMax));
    setString(raw, "speedMpsMin", speed(targets.speedMin));
    setString(raw, "speedMpsMax", speed(targets.speedMax));
    setNumber(raw, "hrBpmMin", targets.hrMin);
    setNumber(raw, "hrBpmMax", targets.hrMax);
    raw.enteredTargets = cleanEntered(targets);
    return raw;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function setNumber(raw: Mutable<RawTargetRanges>, key: keyof RawTargetRanges, value: number | null | undefined): void {
    if (value !== undefined) (raw as Record<string, unknown>)[key] = value;
}

function setString(raw: Mutable<RawTargetRanges>, key: keyof RawTargetRanges, value: string | null | undefined): void {
    if (value !== undefined) (raw as Record<string, unknown>)[key] = value;
}

function mass(input: EnteredMass | null | undefined): string | null | undefined {
    if (input === undefined) return undefined;
    if (input === null) return null;
    return Mass.from(input.value, input.unit).canonical.toString();
}

function distance(input: EnteredDistance | null | undefined): string | null | undefined {
    if (input === undefined) return undefined;
    if (input === null) return null;
    return Distance.from(input.value, input.unit).canonical.toString();
}

function durationMs(input: EnteredDuration | null | undefined): number | null | undefined {
    if (input === undefined) return undefined;
    if (input === null) return null;
    return Number(Duration.from(input.value, input.unit).milliseconds);
}

function speed(input: EnteredSpeedOrPace | null | undefined): string | null | undefined {
    if (input === undefined) return undefined;
    if (input === null) return null;
    if (input.unit === "min/km" || input.unit === "min/mi") {
        const distanceKmMi = Distance.from(1, input.unit === "min/km" ? "km" : "mi");
        return Speed.fromPace(Duration.from(input.value, "min"), distanceKmMi).canonical.toString();
    }
    return Speed.from(input.value, input.unit).canonical.toString();
}

/** Retain the entered units/values as provenance (design decision 6). Drops undefined fields. */
function cleanEntered(targets: object): Readonly<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(targets)) if (value !== undefined) result[key] = value;
    return result;
}
