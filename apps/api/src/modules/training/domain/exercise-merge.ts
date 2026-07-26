import { DomainValidationError } from "#src/platform/domain/index";

import type { ExerciseDefinitionState } from "#src/modules/training/domain/exercise-definition";

export interface ExerciseRedirect {
    readonly mergedExerciseId: string;
    readonly canonicalExerciseId: string;
}

export interface ExerciseReferenceImpact {
    readonly referenceType: string;
    readonly count: number;
}

export interface ExerciseMergeIntent {
    readonly id: string;
    readonly canonicalExerciseId: string;
    readonly mergedExerciseId: string;
    readonly canonicalExerciseName: string;
    readonly mergedExerciseName: string;
    readonly canonicalExerciseVersion: number;
    readonly mergedExerciseVersion: number;
    readonly redirectedAliases: readonly string[];
    readonly externalIds: readonly {
        readonly provider: string;
        readonly externalId: string;
    }[];
    readonly referenceImpact: readonly ExerciseReferenceImpact[];
    readonly affectedExerciseIds: readonly string[];
    readonly affectedFamilyExerciseIds: readonly string[];
    readonly reason: string | null;
    readonly appliedAt: string;
}

export interface PlanExerciseMergeInput {
    readonly id: string;
    readonly canonical: ExerciseDefinitionState;
    readonly merged: ExerciseDefinitionState;
    readonly canonicalExerciseVersion: number;
    readonly mergedExerciseVersion: number;
    readonly activeRedirects: readonly ExerciseRedirect[];
    readonly externalIds?: readonly {
        readonly provider: string;
        readonly externalId: string;
    }[];
    readonly referenceImpact?: readonly ExerciseReferenceImpact[];
    readonly affectedFamilyExerciseIds?: readonly string[];
    readonly reason?: string | null;
}

export interface RevertExerciseMergeInput {
    readonly intent: ExerciseMergeIntent;
    readonly canonical: ExerciseDefinitionState;
    readonly merged: ExerciseDefinitionState;
    readonly activeRedirects: readonly ExerciseRedirect[];
}

/**
 * Pure merge policy. It validates the two aggregate roots and returns the
 * immutable evidence that the application layer persists with the redirect.
 */
export class ExerciseMergePolicy {
    plan(input: PlanExerciseMergeInput, now: Date): ExerciseMergeIntent {
        const id = requiredUuid(input.id, "Exercise merge ID");
        const canonicalVersion = positiveVersion(input.canonicalExerciseVersion, "Canonical exercise version");
        const mergedVersion = positiveVersion(input.mergedExerciseVersion, "Merged exercise version");
        const appliedAt = isoTimestamp(now, "Exercise merge time");

        if (input.canonical.id === input.merged.id)
            throw new DomainValidationError("An exercise cannot be merged into itself");
        if (input.canonical.status !== "active")
            throw new DomainValidationError("The canonical exercise must be active");
        if (input.merged.status !== "active") throw new DomainValidationError("The merged exercise must be active");
        if (input.merged.ownership !== "user")
            throw new DomainValidationError("A seeded exercise cannot be merged into another exercise");

        const canonicalResolution = resolveRedirect(input.canonical.id, input.activeRedirects);
        const mergedResolution = resolveRedirect(input.merged.id, input.activeRedirects);
        if (canonicalResolution !== input.canonical.id)
            throw new DomainValidationError("The canonical exercise already redirects to another exercise");
        if (mergedResolution !== input.merged.id)
            throw new DomainValidationError("The merged exercise already redirects to another exercise");
        if (canReach(input.canonical.id, input.merged.id, input.activeRedirects))
            throw new DomainValidationError("The exercise merge would create a redirect cycle");

        const affectedFamilyExerciseIds = uniqueSorted([
            input.canonical.id,
            input.merged.id,
            ...input.canonical.relationships
                .filter(relationship => relationship.type === "analytics_family")
                .map(relationship => relationship.targetExerciseId),
            ...input.merged.relationships
                .filter(relationship => relationship.type === "analytics_family")
                .map(relationship => relationship.targetExerciseId),
            ...(input.affectedFamilyExerciseIds ?? []),
        ]);

        return immutableCopy({
            id,
            canonicalExerciseId: input.canonical.id,
            mergedExerciseId: input.merged.id,
            canonicalExerciseName: input.canonical.name,
            mergedExerciseName: input.merged.name,
            canonicalExerciseVersion: canonicalVersion,
            mergedExerciseVersion: mergedVersion,
            redirectedAliases: uniqueAliases([input.merged.name, ...input.merged.aliases.map(alias => alias.value)]),
            externalIds: uniqueExternalIds(input.externalIds ?? []),
            referenceImpact: checkedImpact(input.referenceImpact ?? []),
            affectedExerciseIds: uniqueSorted([input.canonical.id, input.merged.id]),
            affectedFamilyExerciseIds,
            reason: optionalReason(input.reason),
            appliedAt,
        });
    }

    assertRevertible(input: RevertExerciseMergeInput): void {
        if (input.canonical.id !== input.intent.canonicalExerciseId)
            throw new DomainValidationError("The canonical exercise does not match the merge evidence");
        if (input.merged.id !== input.intent.mergedExerciseId)
            throw new DomainValidationError("The merged exercise does not match the merge evidence");
        if (input.canonical.status !== "active")
            throw new DomainValidationError("The canonical exercise must remain active to revert the merge");
        if (input.merged.status !== "archived")
            throw new DomainValidationError("The merged exercise must remain archived to revert the merge");
        const activeTarget = input.activeRedirects.find(
            redirect => redirect.mergedExerciseId === input.intent.mergedExerciseId,
        );
        if (!activeTarget || activeTarget.canonicalExerciseId !== input.intent.canonicalExerciseId)
            throw new DomainValidationError("The exercise merge redirect is no longer active");
    }
}

export function resolveRedirect(exerciseId: string, redirects: readonly ExerciseRedirect[]): string {
    let current = exerciseId;
    const visited = new Set<string>();
    while (true) {
        if (visited.has(current)) throw new DomainValidationError("Exercise redirects contain a cycle");
        visited.add(current);
        const redirect = redirects.find(candidate => candidate.mergedExerciseId === current);
        if (!redirect) return current;
        current = redirect.canonicalExerciseId;
    }
}

function canReach(source: string, target: string, redirects: readonly ExerciseRedirect[]): boolean {
    let current = source;
    const visited = new Set<string>();
    while (!visited.has(current)) {
        if (current === target) return true;
        visited.add(current);
        const redirect = redirects.find(candidate => candidate.mergedExerciseId === current);
        if (!redirect) return false;
        current = redirect.canonicalExerciseId;
    }
    return true;
}

function checkedImpact(values: readonly ExerciseReferenceImpact[]): readonly ExerciseReferenceImpact[] {
    const result = values.map(value => {
        const referenceType = value.referenceType.trim();
        if (!referenceType || referenceType.length > 120)
            throw new DomainValidationError("Exercise reference type must contain 1 to 120 characters");
        if (!Number.isSafeInteger(value.count) || value.count < 0)
            throw new DomainValidationError("Exercise reference count must be a non-negative integer");
        return { referenceType, count: value.count };
    });
    if (new Set(result.map(value => value.referenceType)).size !== result.length)
        throw new DomainValidationError("Exercise reference impact types must be unique");
    return result.sort((left, right) => left.referenceType.localeCompare(right.referenceType));
}

function uniqueAliases(values: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const aliases: string[] = [];
    for (const value of values) {
        const alias = value.trim().normalize("NFKC").replace(/\s+/g, " ");
        const normalized = alias.toLocaleLowerCase("en-US");
        if (!seen.has(normalized)) {
            aliases.push(alias);
            seen.add(normalized);
        }
    }
    return aliases;
}

function uniqueExternalIds(
    values: readonly { readonly provider: string; readonly externalId: string }[],
): readonly { readonly provider: string; readonly externalId: string }[] {
    const result = values.map(value => ({
        provider: requiredText(value.provider, "External ID provider", 120),
        externalId: requiredText(value.externalId, "External ID", 500),
    }));
    const keys = result.map(value => `${value.provider}\u0000${value.externalId}`);
    if (new Set(keys).size !== keys.length)
        throw new DomainValidationError("Exercise external IDs in merge evidence must be unique");
    return result.sort(
        (left, right) => left.provider.localeCompare(right.provider) || left.externalId.localeCompare(right.externalId),
    );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
    return [...new Set(values.map(value => requiredUuid(value, "Affected exercise ID")))].sort();
}

function optionalReason(value: string | null | undefined): string | null {
    if (value == null) return null;
    return requiredText(value, "Exercise merge reason", 500);
}

function positiveVersion(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) throw new DomainValidationError(`${name} must be positive`);
    return value;
}

function requiredUuid(value: string, name: string): string {
    const normalized = value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized))
        throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function requiredText(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim();
    if (!normalized) throw new DomainValidationError(`${name} cannot be empty`);
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be valid`);
    return value.toISOString();
}

function immutableCopy<Value>(value: Value): Value {
    return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
    if (typeof value !== "object" || value === null) return value;
    for (const item of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(item);
    return Object.freeze(value);
}
