import { DomainValidationError } from "#src/platform/domain/index";

import {
    exerciseClassifications,
    exerciseLateralities,
    exerciseLoadModels,
    exerciseMeasurementTypes,
    normalizeCatalogValue,
    repetitionSemantics,
    type ExerciseClassification,
    type ExerciseLaterality,
    type ExerciseLoadModel,
    type ExerciseMeasurementType,
    type RepetitionSemantics,
} from "#src/modules/training/domain/catalog";

export const exerciseStatuses = ["active", "archived"] as const;
export const exerciseOwnerships = ["seeded", "user"] as const;
export const exerciseAliasSources = ["seeded", "user", "redirect"] as const;
export const exerciseMuscleRoles = ["primary", "secondary"] as const;
export const exerciseRelationshipTypes = ["variation", "progression", "regression", "analytics_family"] as const;

export type ExerciseStatus = (typeof exerciseStatuses)[number];
export type ExerciseOwnership = (typeof exerciseOwnerships)[number];
export type ExerciseAliasSource = (typeof exerciseAliasSources)[number];
export type ExerciseMuscleRole = (typeof exerciseMuscleRoles)[number];
export type ExerciseRelationshipType = (typeof exerciseRelationshipTypes)[number];

export interface ExerciseAlias {
    readonly value: string;
    readonly normalizedValue: string;
    readonly source: ExerciseAliasSource;
}

export interface ExerciseMuscleAssignment {
    readonly muscleGroupId: string;
    readonly role: ExerciseMuscleRole;
}

export interface ExerciseRelationship {
    readonly targetExerciseId: string;
    readonly type: ExerciseRelationshipType;
}

export interface ExerciseDefinitionState {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly aliases: readonly ExerciseAlias[];
    readonly status: ExerciseStatus;
    readonly ownership: ExerciseOwnership;
    readonly forkedFromExerciseId: string | null;
    readonly equipmentTypeId: string;
    readonly movementPatternId: string;
    readonly classification: ExerciseClassification;
    readonly laterality: ExerciseLaterality;
    readonly bodyPosition: string;
    readonly repetitionSemantics: RepetitionSemantics;
    readonly loadModel: ExerciseLoadModel;
    readonly supportedMeasurements: readonly ExerciseMeasurementType[];
    readonly muscles: readonly ExerciseMuscleAssignment[];
    readonly tagIds: readonly string[];
    readonly relationships: readonly ExerciseRelationship[];
    readonly notes: string | null;
    readonly position: number;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateExerciseDefinitionInput {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly aliases?: readonly string[];
    readonly ownership?: ExerciseOwnership;
    readonly forkedFromExerciseId?: string | null;
    readonly equipmentTypeId: string;
    readonly movementPatternId: string;
    readonly classification: ExerciseClassification;
    readonly laterality: ExerciseLaterality;
    readonly bodyPosition: string;
    readonly repetitionSemantics: RepetitionSemantics;
    readonly loadModel: ExerciseLoadModel;
    readonly supportedMeasurements: readonly ExerciseMeasurementType[];
    readonly muscles: readonly ExerciseMuscleAssignment[];
    readonly tagIds?: readonly string[];
    readonly relationships?: readonly ExerciseRelationship[];
    readonly notes?: string | null;
    readonly position?: number;
}

export interface UpdateExerciseDefinitionInput {
    readonly slug?: string;
    readonly name?: string;
    readonly equipmentTypeId?: string;
    readonly movementPatternId?: string;
    readonly classification?: ExerciseClassification;
    readonly laterality?: ExerciseLaterality;
    readonly bodyPosition?: string;
    readonly repetitionSemantics?: RepetitionSemantics;
    readonly loadModel?: ExerciseLoadModel;
    readonly supportedMeasurements?: readonly ExerciseMeasurementType[];
    readonly notes?: string | null;
    readonly position?: number;
}

export interface ExerciseSnapshotV1 {
    readonly schemaVersion: 1;
    readonly exerciseId: string;
    readonly exerciseVersion: number;
    readonly name: string;
    readonly equipmentTypeId: string;
    readonly movementPatternId: string;
    readonly classification: ExerciseClassification;
    readonly laterality: ExerciseLaterality;
    readonly bodyPosition: string;
    readonly repetitionSemantics: RepetitionSemantics;
    readonly loadModel: ExerciseLoadModel;
    readonly supportedMeasurements: readonly ExerciseMeasurementType[];
    readonly muscles: readonly ExerciseMuscleAssignment[];
    readonly tagIds: readonly string[];
    readonly analyticsFamilyExerciseIds: readonly string[];
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOAD_MEASUREMENTS = new Set<ExerciseMeasurementType>([
    "external_load",
    "bodyweight",
    "added_load",
    "assistance",
    "effective_load",
]);

export class ExerciseDefinition {
    private constructor(private current: ExerciseDefinitionState) {}

    static create(input: CreateExerciseDefinitionInput, now: Date): ExerciseDefinition {
        const ownership = input.ownership ?? "user";
        const timestamp = isoTimestamp(now, "Exercise creation time");
        const state: ExerciseDefinitionState = {
            id: requiredUuid(input.id, "Exercise ID"),
            slug: normalizedSlug(input.slug),
            name: requiredText(input.name, "Exercise name", 160),
            aliases: aliasesFrom(input.aliases ?? [], ownership === "seeded" ? "seeded" : "user"),
            status: "active",
            ownership,
            forkedFromExerciseId:
                input.forkedFromExerciseId == null
                    ? null
                    : requiredUuid(input.forkedFromExerciseId, "Forked-from exercise ID"),
            equipmentTypeId: requiredUuid(input.equipmentTypeId, "Equipment type ID"),
            movementPatternId: requiredUuid(input.movementPatternId, "Movement pattern ID"),
            classification: input.classification,
            laterality: input.laterality,
            bodyPosition: requiredText(input.bodyPosition, "Body position", 120),
            repetitionSemantics: input.repetitionSemantics,
            loadModel: input.loadModel,
            supportedMeasurements: uniqueValues(input.supportedMeasurements),
            muscles: immutableCopy(input.muscles),
            tagIds: uniqueValues(input.tagIds ?? []),
            relationships: immutableCopy(input.relationships ?? []),
            notes: optionalText(input.notes, "Exercise notes", 4_000),
            position: nonNegativeInteger(input.position ?? 0, "Exercise position"),
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new ExerciseDefinition(immutableCopy(state));
    }

    static rehydrate(state: ExerciseDefinitionState): ExerciseDefinition {
        const copied = immutableCopy(state);
        validateState(copied);
        return new ExerciseDefinition(copied);
    }

    get state(): ExerciseDefinitionState {
        return immutableCopy(this.current);
    }

    update(input: UpdateExerciseDefinitionInput, now: Date): this {
        this.assertUserOwnedMutation();
        return this.replace({
            ...this.current,
            ...(input.slug !== undefined ? { slug: normalizedSlug(input.slug) } : {}),
            ...(input.name !== undefined ? { name: requiredText(input.name, "Exercise name", 160) } : {}),
            ...(input.equipmentTypeId !== undefined
                ? { equipmentTypeId: requiredUuid(input.equipmentTypeId, "Equipment type ID") }
                : {}),
            ...(input.movementPatternId !== undefined
                ? { movementPatternId: requiredUuid(input.movementPatternId, "Movement pattern ID") }
                : {}),
            ...(input.classification !== undefined ? { classification: input.classification } : {}),
            ...(input.laterality !== undefined ? { laterality: input.laterality } : {}),
            ...(input.bodyPosition !== undefined
                ? { bodyPosition: requiredText(input.bodyPosition, "Body position", 120) }
                : {}),
            ...(input.repetitionSemantics !== undefined ? { repetitionSemantics: input.repetitionSemantics } : {}),
            ...(input.loadModel !== undefined ? { loadModel: input.loadModel } : {}),
            ...(input.supportedMeasurements !== undefined
                ? { supportedMeasurements: uniqueValues(input.supportedMeasurements) }
                : {}),
            ...(input.notes !== undefined ? { notes: optionalText(input.notes, "Exercise notes", 4_000) } : {}),
            ...(input.position !== undefined
                ? { position: nonNegativeInteger(input.position, "Exercise position") }
                : {}),
            updatedAt: isoTimestamp(now, "Exercise update time"),
        });
    }

    renameAliases(values: readonly string[], now: Date): this {
        this.assertUserOwnedMutation();
        return this.replace({
            ...this.current,
            aliases: aliasesFrom(values, this.current.ownership === "seeded" ? "seeded" : "user"),
            updatedAt: isoTimestamp(now, "Exercise update time"),
        });
    }

    assignMuscles(assignments: readonly ExerciseMuscleAssignment[], now: Date): this {
        this.assertUserOwnedMutation();
        return this.replace({
            ...this.current,
            muscles: immutableCopy(assignments),
            updatedAt: isoTimestamp(now, "Exercise update time"),
        });
    }

    assignTags(tagIds: readonly string[], now: Date): this {
        this.assertUserOwnedMutation();
        return this.replace({
            ...this.current,
            tagIds: uniqueValues(tagIds),
            updatedAt: isoTimestamp(now, "Exercise update time"),
        });
    }

    relate(relationships: readonly ExerciseRelationship[], now: Date): this {
        this.assertUserOwnedMutation();
        return this.replace({
            ...this.current,
            relationships: immutableCopy(relationships),
            updatedAt: isoTimestamp(now, "Exercise update time"),
        });
    }

    archive(now: Date): this {
        this.assertUserOwnedMutation();
        if (this.current.status === "archived")
            throw new DomainValidationError("Exercise definition is already archived");
        const timestamp = isoTimestamp(now, "Exercise archive time");
        return this.replace({ ...this.current, status: "archived", archivedAt: timestamp, updatedAt: timestamp });
    }

    restore(now: Date): this {
        this.assertUserOwnedMutation();
        if (this.current.status === "active") throw new DomainValidationError("Exercise definition is already active");
        return this.replace({
            ...this.current,
            status: "active",
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Exercise restore time"),
        });
    }

    fork(input: { readonly id: string; readonly slug?: string }, now: Date): ExerciseDefinition {
        if (this.current.ownership !== "seeded")
            throw new DomainValidationError("Only a seeded exercise definition can be forked");
        const timestamp = isoTimestamp(now, "Exercise fork time");
        const id = requiredUuid(input.id, "Exercise ID");
        const slug = normalizedSlug(input.slug ?? `${this.current.slug}-custom-${id.slice(0, 8)}`);
        return ExerciseDefinition.rehydrate({
            ...this.current,
            id,
            slug,
            aliases: this.current.aliases.map(alias => ({ ...alias, source: "user" as const })),
            ownership: "user",
            forkedFromExerciseId: this.current.id,
            status: "active",
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
    }

    isInExplicitAnalyticsFamilyWith(exerciseId: string): boolean {
        return this.current.relationships.some(
            relationship => relationship.type === "analytics_family" && relationship.targetExerciseId === exerciseId,
        );
    }

    private replace(state: ExerciseDefinitionState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }

    private assertUserOwnedMutation(): void {
        if (this.current.ownership === "seeded")
            throw new DomainValidationError(
                "Seeded exercise definitions are immutable and must be forked before editing",
            );
    }
}

export function createExerciseSnapshot(definition: ExerciseDefinition, exerciseVersion: number): ExerciseSnapshotV1 {
    if (!Number.isSafeInteger(exerciseVersion) || exerciseVersion < 1)
        throw new DomainValidationError("Exercise version must be a positive integer");
    const state = definition.state;
    return immutableCopy({
        schemaVersion: 1,
        exerciseId: state.id,
        exerciseVersion,
        name: state.name,
        equipmentTypeId: state.equipmentTypeId,
        movementPatternId: state.movementPatternId,
        classification: state.classification,
        laterality: state.laterality,
        bodyPosition: state.bodyPosition,
        repetitionSemantics: state.repetitionSemantics,
        loadModel: state.loadModel,
        supportedMeasurements: [...state.supportedMeasurements].sort(),
        muscles: [...state.muscles].sort(
            (left, right) =>
                left.role.localeCompare(right.role) || left.muscleGroupId.localeCompare(right.muscleGroupId),
        ),
        tagIds: [...state.tagIds].sort(),
        analyticsFamilyExerciseIds: state.relationships
            .filter(relationship => relationship.type === "analytics_family")
            .map(relationship => relationship.targetExerciseId)
            .sort(),
    });
}

export function validateExerciseMeasurementModel(
    loadModel: ExerciseLoadModel,
    supportedMeasurements: readonly ExerciseMeasurementType[],
): void {
    const measurements = new Set(supportedMeasurements);
    if (measurements.size !== supportedMeasurements.length)
        throw new DomainValidationError("Supported measurements must be unique");
    const unknown = supportedMeasurements.find(measurement => !exerciseMeasurementTypes.includes(measurement));
    if (unknown) throw new DomainValidationError(`Unsupported exercise measurement '${unknown}'`);
    const loadMeasurements = supportedMeasurements.filter(measurement => LOAD_MEASUREMENTS.has(measurement));
    switch (loadModel) {
        case "external_only":
            if (
                !measurements.has("external_load") ||
                loadMeasurements.some(measurement => measurement !== "external_load")
            )
                invalidMeasurementModel("external_only requires only external_load among load measurements");
            break;
        case "full_bodyweight_plus_added_minus_assistance":
            if (
                !measurements.has("bodyweight") ||
                loadMeasurements.some(measurement => !["bodyweight", "added_load", "assistance"].includes(measurement))
            )
                invalidMeasurementModel(
                    "full_bodyweight_plus_added_minus_assistance requires bodyweight and compatible load measurements",
                );
            break;
        case "manual_effective_load":
            if (
                !measurements.has("effective_load") ||
                loadMeasurements.some(
                    measurement => !["bodyweight", "added_load", "assistance", "effective_load"].includes(measurement),
                )
            )
                invalidMeasurementModel(
                    "manual_effective_load requires effective_load and compatible load measurements",
                );
            break;
        case "none":
            if (loadMeasurements.length > 0) invalidMeasurementModel("none cannot declare load measurements");
            break;
    }
}

function validateState(state: ExerciseDefinitionState): void {
    requiredUuid(state.id, "Exercise ID");
    normalizedSlug(state.slug);
    requiredText(state.name, "Exercise name", 160);
    requiredUuid(state.equipmentTypeId, "Equipment type ID");
    requiredUuid(state.movementPatternId, "Movement pattern ID");
    if (!exerciseStatuses.includes(state.status))
        throw new DomainValidationError(`Unknown exercise status '${state.status}'`);
    if (!exerciseOwnerships.includes(state.ownership))
        throw new DomainValidationError(`Unknown exercise ownership '${state.ownership}'`);
    if (!exerciseClassifications.includes(state.classification))
        throw new DomainValidationError(`Unknown exercise classification '${state.classification}'`);
    if (!exerciseLateralities.includes(state.laterality))
        throw new DomainValidationError(`Unknown exercise laterality '${state.laterality}'`);
    if (!repetitionSemantics.includes(state.repetitionSemantics))
        throw new DomainValidationError(`Unknown repetition semantics '${state.repetitionSemantics}'`);
    if (!exerciseLoadModels.includes(state.loadModel))
        throw new DomainValidationError(`Unknown exercise load model '${state.loadModel}'`);
    requiredText(state.bodyPosition, "Body position", 120);
    nonNegativeInteger(state.position, "Exercise position");
    isoTimestamp(new Date(state.createdAt), "Exercise creation time");
    isoTimestamp(new Date(state.updatedAt), "Exercise update time");
    if ((state.status === "active") !== (state.archivedAt === null))
        throw new DomainValidationError("Exercise archive state is inconsistent");
    if (state.archivedAt !== null) isoTimestamp(new Date(state.archivedAt), "Exercise archive time");
    if (state.ownership === "seeded" && state.forkedFromExerciseId !== null)
        throw new DomainValidationError("A seeded exercise cannot fork another definition");
    if (state.forkedFromExerciseId !== null) {
        requiredUuid(state.forkedFromExerciseId, "Forked-from exercise ID");
        if (state.forkedFromExerciseId === state.id) throw new DomainValidationError("An exercise cannot fork itself");
    }
    validateAliases(state.name, state.aliases);
    validateExerciseMeasurementModel(state.loadModel, state.supportedMeasurements);
    validateMuscles(state.muscles);
    validateIds(state.tagIds, "tag");
    validateRelationships(state.id, state.relationships);
    optionalText(state.notes, "Exercise notes", 4_000);
}

function validateAliases(name: string, aliases: readonly ExerciseAlias[]): void {
    const normalizedName = normalizeCatalogValue(name);
    const seen = new Set([normalizedName]);
    for (const alias of aliases) {
        const value = requiredText(alias.value, "Exercise alias", 160);
        const normalized = normalizeCatalogValue(value);
        if (alias.normalizedValue !== normalized)
            throw new DomainValidationError(`Exercise alias '${value}' has an invalid normalized value`);
        if (!exerciseAliasSources.includes(alias.source))
            throw new DomainValidationError(`Unknown exercise alias source '${alias.source}'`);
        if (seen.has(normalized))
            throw new DomainValidationError(`Exercise alias '${value}' duplicates the exercise name or another alias`, {
                aliases: [`Normalized alias '${normalized}' must be unique`],
            });
        seen.add(normalized);
    }
}

function validateMuscles(assignments: readonly ExerciseMuscleAssignment[]): void {
    if (!assignments.some(assignment => assignment.role === "primary"))
        throw new DomainValidationError("An exercise must have at least one primary muscle", {
            muscles: ["At least one primary muscle is required"],
        });
    const seen = new Set<string>();
    for (const assignment of assignments) {
        requiredUuid(assignment.muscleGroupId, "Muscle group ID");
        if (!exerciseMuscleRoles.includes(assignment.role))
            throw new DomainValidationError(`Unknown exercise muscle role '${assignment.role}'`);
        if (seen.has(assignment.muscleGroupId))
            throw new DomainValidationError("A muscle cannot be both primary and secondary or assigned twice", {
                muscles: [`Muscle '${assignment.muscleGroupId}' is assigned more than once`],
            });
        seen.add(assignment.muscleGroupId);
    }
}

function validateRelationships(exerciseId: string, relationships: readonly ExerciseRelationship[]): void {
    const seen = new Set<string>();
    for (const relationship of relationships) {
        requiredUuid(relationship.targetExerciseId, "Relationship target exercise ID");
        if (!exerciseRelationshipTypes.includes(relationship.type))
            throw new DomainValidationError(`Unknown exercise relationship type '${relationship.type}'`);
        if (relationship.targetExerciseId === exerciseId)
            throw new DomainValidationError("An exercise cannot relate to itself", {
                relationships: ["Self relationships are not allowed"],
            });
        const key = `${relationship.type}:${relationship.targetExerciseId}`;
        if (seen.has(key))
            throw new DomainValidationError("Exercise relationships must be unique", {
                relationships: [`Duplicate relationship '${key}'`],
            });
        seen.add(key);
    }
}

function validateIds(values: readonly string[], kind: string): void {
    const seen = new Set<string>();
    for (const value of values) {
        requiredUuid(value, `${kind} ID`);
        if (seen.has(value)) throw new DomainValidationError(`Exercise ${kind} references must be unique`);
        seen.add(value);
    }
}

function aliasesFrom(values: readonly string[], source: ExerciseAliasSource): ExerciseAlias[] {
    return values.map(value => {
        const normalized = requiredText(value, "Exercise alias", 160);
        return { value: normalized, normalizedValue: normalizeCatalogValue(normalized), source };
    });
}

function requiredUuid(value: string, name: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function normalizedSlug(value: string): string {
    const normalized = value.trim();
    if (!SLUG_PATTERN.test(normalized))
        throw new DomainValidationError("Exercise slug must contain lowercase letters, digits, and single hyphens");
    if (normalized.length > 160) throw new DomainValidationError("Exercise slug cannot exceed 160 characters");
    return normalized;
}

function requiredText(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) throw new DomainValidationError(`${name} cannot be empty`);
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    return requiredText(value, name, maximumLength);
}

function nonNegativeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative integer`);
    return value;
}

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function uniqueValues<Value>(values: readonly Value[]): Value[] {
    if (new Set(values).size !== values.length)
        throw new DomainValidationError("Exercise metadata values must be unique");
    return [...values];
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}

function invalidMeasurementModel(message: string): never {
    throw new DomainValidationError(message, { supportedMeasurements: [message] });
}
