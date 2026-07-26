import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import {
    equipmentTypes,
    exerciseAliases,
    exerciseMuscles,
    exercises,
    exerciseTags,
    movementPatterns,
    muscleGroups,
    trainingTags,
    type Database,
    type EquipmentTypeRow,
    type ExerciseRow,
    type MovementPatternRow,
    type MuscleGroupRow,
    type TrainingTagRow,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    CatalogSeedWriteResult,
    ExerciseCatalogItem,
    ExtensibleCatalogItem,
    MuscleCatalogItem,
    TagCatalogItem,
    TrainingCatalogReader,
    TrainingCatalogSeedRepository,
} from "#src/modules/training/application/index";
import type {
    EquipmentTypeSeed,
    ExerciseMeasurementType,
    ExerciseSeed,
    MuscleGroupSeed,
    MovementPatternSeed,
    TagSeed,
} from "#src/modules/training/domain/index";
import { normalizeCatalogValue } from "#src/modules/training/domain/index";

@Injectable()
export class DrizzleTrainingCatalogRepository implements TrainingCatalogSeedRepository, TrainingCatalogReader {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async upsertMuscle(seed: MuscleGroupSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult> {
        const executor = this.executor(transaction);
        const existing = await this.muscleBySlug(seed.slug, executor);
        if (!existing) {
            const inserted = await executor
                .insert(muscleGroups)
                .values({ ...seed, isSeeded: true, createdAt: now, updatedAt: now })
                .onConflictDoNothing()
                .returning({ id: muscleGroups.id });
            if (inserted.length === 1) return result("created", seed.slug);
            return (await this.muscleBySlug(seed.slug, executor))
                ? this.upsertMuscle(seed, now, transaction)
                : result("user_conflict", seed.slug);
        }
        if (!existing.isSeeded) return result("user_conflict", seed.slug);
        if (existing.name === seed.name && existing.position === seed.position && existing.archivedAt === null)
            return result("unchanged", seed.slug);
        await executor
            .update(muscleGroups)
            .set({ name: seed.name, position: seed.position, archivedAt: null, updatedAt: now })
            .where(eq(muscleGroups.id, existing.id));
        return result("updated", seed.slug);
    }

    async upsertEquipment(seed: EquipmentTypeSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult> {
        const executor = this.executor(transaction);
        const existing = await this.equipmentBySlug(seed.slug, executor);
        if (!existing) {
            const inserted = await executor
                .insert(equipmentTypes)
                .values({
                    ...seed,
                    isSeeded: true,
                    analyticsMappingStatus: "standard",
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoNothing()
                .returning({ id: equipmentTypes.id });
            if (inserted.length === 1) return result("created", seed.slug);
            return (await this.equipmentBySlug(seed.slug, executor))
                ? this.upsertEquipment(seed, now, transaction)
                : result("user_conflict", seed.slug);
        }
        if (!existing.isSeeded) return result("user_conflict", seed.slug);
        if (
            existing.name === seed.name &&
            existing.position === seed.position &&
            existing.analyticsMappingStatus === "standard" &&
            existing.archivedAt === null
        )
            return result("unchanged", seed.slug);
        await executor
            .update(equipmentTypes)
            .set({
                name: seed.name,
                position: seed.position,
                analyticsMappingStatus: "standard",
                archivedAt: null,
                updatedAt: now,
            })
            .where(eq(equipmentTypes.id, existing.id));
        return result("updated", seed.slug);
    }

    async upsertMovementPattern(
        seed: MovementPatternSeed,
        now: Date,
        transaction: unknown,
    ): Promise<CatalogSeedWriteResult> {
        const executor = this.executor(transaction);
        const existing = await this.movementBySlug(seed.slug, executor);
        if (!existing) {
            const inserted = await executor
                .insert(movementPatterns)
                .values({
                    ...seed,
                    isSeeded: true,
                    analyticsMappingStatus: "standard",
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoNothing()
                .returning({ id: movementPatterns.id });
            if (inserted.length === 1) return result("created", seed.slug);
            return (await this.movementBySlug(seed.slug, executor))
                ? this.upsertMovementPattern(seed, now, transaction)
                : result("user_conflict", seed.slug);
        }
        if (!existing.isSeeded) return result("user_conflict", seed.slug);
        if (
            existing.name === seed.name &&
            existing.position === seed.position &&
            existing.analyticsMappingStatus === "standard" &&
            existing.archivedAt === null
        )
            return result("unchanged", seed.slug);
        await executor
            .update(movementPatterns)
            .set({
                name: seed.name,
                position: seed.position,
                analyticsMappingStatus: "standard",
                archivedAt: null,
                updatedAt: now,
            })
            .where(eq(movementPatterns.id, existing.id));
        return result("updated", seed.slug);
    }

    async upsertTag(seed: TagSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult> {
        const executor = this.executor(transaction);
        const existing = await this.tagBySlug(seed.slug, executor);
        const normalizedName = normalizeCatalogValue(seed.name);
        if (!existing) {
            const inserted = await executor
                .insert(trainingTags)
                .values({
                    ...seed,
                    normalizedName,
                    isSeeded: true,
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoNothing()
                .returning({ id: trainingTags.id });
            if (inserted.length === 1) return result("created", seed.slug);
            return (await this.tagBySlug(seed.slug, executor))
                ? this.upsertTag(seed, now, transaction)
                : result("user_conflict", seed.slug);
        }
        if (!existing.isSeeded) return result("user_conflict", seed.slug);
        if (
            existing.name === seed.name &&
            existing.normalizedName === normalizedName &&
            existing.category === seed.category &&
            existing.position === seed.position &&
            existing.archivedAt === null
        )
            return result("unchanged", seed.slug);
        await executor
            .update(trainingTags)
            .set({
                name: seed.name,
                normalizedName,
                category: seed.category,
                position: seed.position,
                archivedAt: null,
                updatedAt: now,
            })
            .where(eq(trainingTags.id, existing.id));
        return result("updated", seed.slug);
    }

    async upsertExercise(seed: ExerciseSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult> {
        const executor = this.executor(transaction);
        const existing = await this.exerciseBySlug(seed.slug, executor);
        if (existing && !existing.isSeeded) return result("user_conflict", seed.slug);

        const references = await this.exerciseReferences(seed, executor);
        if (!references) return result("user_conflict", seed.slug);

        const normalizedAliases = [seed.name, ...seed.aliases].map(normalizeCatalogValue);
        const aliasConflicts = await executor
            .select({ exerciseId: exerciseAliases.exerciseId })
            .from(exerciseAliases)
            .where(inArray(exerciseAliases.normalizedAlias, normalizedAliases));
        if (aliasConflicts.some(alias => alias.exerciseId !== existing?.id)) return result("user_conflict", seed.slug);

        if (!existing) {
            const rows = await executor
                .insert(exercises)
                .values({
                    slug: seed.slug,
                    name: seed.name,
                    status: "active",
                    isSeeded: true,
                    equipmentTypeId: references.equipmentId,
                    movementPatternId: references.movementPatternId,
                    classification: seed.classification,
                    laterality: seed.laterality,
                    bodyPosition: seed.bodyPosition,
                    repetitionSemantics: seed.repetitionSemantics,
                    loadModel: seed.loadModel,
                    supportedMeasurements: [...seed.supportedMeasurements],
                    notes: seed.notes,
                    position: seed.position,
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoNothing()
                .returning({ id: exercises.id });
            if (rows.length === 0) return this.upsertExercise(seed, now, transaction);
            await this.replaceExerciseDetails(rows[0]!.id, seed, references, now, executor);
            return result("created", seed.slug);
        }

        if (await this.exerciseMatches(existing, seed, references, executor)) return result("unchanged", seed.slug);

        await executor
            .update(exercises)
            .set({
                name: seed.name,
                status: "active",
                equipmentTypeId: references.equipmentId,
                movementPatternId: references.movementPatternId,
                classification: seed.classification,
                laterality: seed.laterality,
                bodyPosition: seed.bodyPosition,
                repetitionSemantics: seed.repetitionSemantics,
                loadModel: seed.loadModel,
                supportedMeasurements: [...seed.supportedMeasurements],
                notes: seed.notes,
                position: seed.position,
                version: sql`${exercises.version} + 1`,
                archivedAt: null,
                updatedAt: now,
            })
            .where(eq(exercises.id, existing.id));
        await this.replaceExerciseDetails(existing.id, seed, references, now, executor);
        return result("updated", seed.slug);
    }

    archiveRemovedMuscles(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number> {
        return this.archiveTaxonomy(muscleGroups, activeSlugs, now, transaction);
    }

    archiveRemovedEquipment(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number> {
        return this.archiveTaxonomy(equipmentTypes, activeSlugs, now, transaction);
    }

    archiveRemovedMovementPatterns(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number> {
        return this.archiveTaxonomy(movementPatterns, activeSlugs, now, transaction);
    }

    archiveRemovedTags(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number> {
        return this.archiveTaxonomy(trainingTags, activeSlugs, now, transaction);
    }

    async archiveRemovedExercises(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number> {
        const rows = await this.executor(transaction)
            .update(exercises)
            .set({
                status: "archived",
                archivedAt: now,
                version: sql`${exercises.version} + 1`,
                updatedAt: now,
            })
            .where(
                and(
                    eq(exercises.isSeeded, true),
                    isNull(exercises.archivedAt),
                    notInArray(exercises.slug, [...activeSlugs]),
                ),
            )
            .returning({ id: exercises.id });
        return rows.length;
    }

    async listMuscles(): Promise<readonly MuscleCatalogItem[]> {
        const rows = await this.database.db
            .select()
            .from(muscleGroups)
            .where(isNull(muscleGroups.archivedAt))
            .orderBy(asc(muscleGroups.position), asc(muscleGroups.slug));
        return rows.map(muscleItem);
    }

    async listEquipment(): Promise<readonly ExtensibleCatalogItem[]> {
        const rows = await this.database.db
            .select()
            .from(equipmentTypes)
            .where(isNull(equipmentTypes.archivedAt))
            .orderBy(asc(equipmentTypes.position), asc(equipmentTypes.slug));
        return rows.map(extensibleItem);
    }

    async listMovementPatterns(): Promise<readonly ExtensibleCatalogItem[]> {
        const rows = await this.database.db
            .select()
            .from(movementPatterns)
            .where(isNull(movementPatterns.archivedAt))
            .orderBy(asc(movementPatterns.position), asc(movementPatterns.slug));
        return rows.map(extensibleItem);
    }

    async listTags(): Promise<readonly TagCatalogItem[]> {
        const rows = await this.database.db
            .select()
            .from(trainingTags)
            .where(isNull(trainingTags.archivedAt))
            .orderBy(asc(trainingTags.position), asc(trainingTags.slug));
        return rows.map(tagItem);
    }

    async listExercises(): Promise<readonly ExerciseCatalogItem[]> {
        const rows = await this.database.db
            .select({
                exercise: exercises,
                equipment: equipmentTypes,
                movementPattern: movementPatterns,
            })
            .from(exercises)
            .innerJoin(equipmentTypes, eq(exercises.equipmentTypeId, equipmentTypes.id))
            .innerJoin(movementPatterns, eq(exercises.movementPatternId, movementPatterns.id))
            .where(eq(exercises.status, "active"))
            .orderBy(asc(exercises.position), asc(exercises.slug));
        if (rows.length === 0) return [];

        const ids = rows.map(row => row.exercise.id);
        const [aliases, muscles, tags] = await Promise.all([
            this.database.db
                .select()
                .from(exerciseAliases)
                .where(inArray(exerciseAliases.exerciseId, ids))
                .orderBy(asc(exerciseAliases.normalizedAlias)),
            this.database.db
                .select({
                    exerciseId: exerciseMuscles.exerciseId,
                    role: exerciseMuscles.role,
                    muscle: muscleGroups,
                })
                .from(exerciseMuscles)
                .innerJoin(muscleGroups, eq(exerciseMuscles.muscleGroupId, muscleGroups.id))
                .where(inArray(exerciseMuscles.exerciseId, ids))
                .orderBy(asc(exerciseMuscles.role), asc(muscleGroups.position), asc(muscleGroups.slug)),
            this.database.db
                .select({
                    exerciseId: exerciseTags.exerciseId,
                    tag: trainingTags,
                })
                .from(exerciseTags)
                .innerJoin(trainingTags, eq(exerciseTags.tagId, trainingTags.id))
                .where(inArray(exerciseTags.exerciseId, ids))
                .orderBy(asc(trainingTags.position), asc(trainingTags.slug)),
        ]);

        return rows.map(row => ({
            id: row.exercise.id,
            slug: row.exercise.slug,
            name: row.exercise.name,
            aliases: aliases
                .filter(
                    alias =>
                        alias.exerciseId === row.exercise.id &&
                        alias.normalizedAlias !== normalizeCatalogValue(row.exercise.name),
                )
                .map(alias => alias.alias),
            status: checkedStatus(row.exercise.status),
            ownership: ownership(row.exercise.isSeeded),
            equipment: extensibleItem(row.equipment),
            movementPattern: extensibleItem(row.movementPattern),
            classification: checkedClassification(row.exercise.classification),
            laterality: checkedLaterality(row.exercise.laterality),
            bodyPosition: row.exercise.bodyPosition,
            repetitionSemantics: checkedRepetitionSemantics(row.exercise.repetitionSemantics),
            loadModel: checkedLoadModel(row.exercise.loadModel),
            supportedMeasurements: checkedMeasurements(row.exercise.supportedMeasurements),
            muscles: muscles
                .filter(item => item.exerciseId === row.exercise.id)
                .map(item => ({ muscle: muscleItem(item.muscle), role: checkedMuscleRole(item.role) })),
            tags: tags.filter(item => item.exerciseId === row.exercise.id).map(item => tagItem(item.tag)),
            notes: row.exercise.notes,
            version: row.exercise.version,
            position: row.exercise.position,
        }));
    }

    private async exerciseMatches(
        row: ExerciseRow,
        seed: ExerciseSeed,
        references: ExerciseReferences,
        executor: Database,
    ): Promise<boolean> {
        if (
            row.name !== seed.name ||
            row.status !== "active" ||
            row.archivedAt !== null ||
            row.equipmentTypeId !== references.equipmentId ||
            row.movementPatternId !== references.movementPatternId ||
            row.classification !== seed.classification ||
            row.laterality !== seed.laterality ||
            row.bodyPosition !== seed.bodyPosition ||
            row.repetitionSemantics !== seed.repetitionSemantics ||
            row.loadModel !== seed.loadModel ||
            row.notes !== seed.notes ||
            row.position !== seed.position ||
            !sameValues(row.supportedMeasurements, seed.supportedMeasurements)
        )
            return false;

        const [aliases, muscles, tags] = await Promise.all([
            executor
                .select({ value: exerciseAliases.normalizedAlias })
                .from(exerciseAliases)
                .where(eq(exerciseAliases.exerciseId, row.id)),
            executor
                .select({ muscleGroupId: exerciseMuscles.muscleGroupId, role: exerciseMuscles.role })
                .from(exerciseMuscles)
                .where(eq(exerciseMuscles.exerciseId, row.id)),
            executor
                .select({ tagId: exerciseTags.tagId })
                .from(exerciseTags)
                .where(eq(exerciseTags.exerciseId, row.id)),
        ]);
        return (
            sameValues(
                aliases.map(item => item.value),
                [seed.name, ...seed.aliases].map(normalizeCatalogValue),
            ) &&
            sameValues(
                muscles.map(item => `${item.role}:${item.muscleGroupId}`),
                [
                    ...references.primaryMuscleIds.map(id => `primary:${id}`),
                    ...references.secondaryMuscleIds.map(id => `secondary:${id}`),
                ],
            ) &&
            sameValues(
                tags.map(item => item.tagId),
                references.tagIds,
            )
        );
    }

    private async replaceExerciseDetails(
        exerciseId: string,
        seed: ExerciseSeed,
        references: ExerciseReferences,
        now: Date,
        executor: Database,
    ): Promise<void> {
        await executor.delete(exerciseAliases).where(eq(exerciseAliases.exerciseId, exerciseId));
        await executor.delete(exerciseMuscles).where(eq(exerciseMuscles.exerciseId, exerciseId));
        await executor.delete(exerciseTags).where(eq(exerciseTags.exerciseId, exerciseId));

        await executor.insert(exerciseAliases).values(
            [seed.name, ...seed.aliases].map(alias => ({
                exerciseId,
                alias,
                normalizedAlias: normalizeCatalogValue(alias),
                source: "seeded",
                createdAt: now,
            })),
        );
        await executor.insert(exerciseMuscles).values([
            ...references.primaryMuscleIds.map(muscleGroupId => ({
                exerciseId,
                muscleGroupId,
                role: "primary",
            })),
            ...references.secondaryMuscleIds.map(muscleGroupId => ({
                exerciseId,
                muscleGroupId,
                role: "secondary",
            })),
        ]);
        if (references.tagIds.length > 0)
            await executor.insert(exerciseTags).values(references.tagIds.map(tagId => ({ exerciseId, tagId })));
    }

    private async exerciseReferences(seed: ExerciseSeed, executor: Database): Promise<ExerciseReferences | null> {
        const [equipment, movementPattern, muscles, tags] = await Promise.all([
            this.equipmentBySlug(seed.equipmentSlug, executor),
            this.movementBySlug(seed.movementPatternSlug, executor),
            executor
                .select({ id: muscleGroups.id, slug: muscleGroups.slug })
                .from(muscleGroups)
                .where(inArray(muscleGroups.slug, [...seed.primaryMuscleSlugs, ...seed.secondaryMuscleSlugs])),
            seed.tagSlugs.length === 0
                ? Promise.resolve([])
                : executor
                      .select({ id: trainingTags.id, slug: trainingTags.slug, isSeeded: trainingTags.isSeeded })
                      .from(trainingTags)
                      .where(inArray(trainingTags.slug, [...seed.tagSlugs])),
        ]);
        if (
            !equipment?.isSeeded ||
            !movementPattern?.isSeeded ||
            muscles.length !== seed.primaryMuscleSlugs.length + seed.secondaryMuscleSlugs.length ||
            tags.length !== seed.tagSlugs.length ||
            tags.some(tag => !tag.isSeeded)
        )
            return null;
        const muscleIds = new Map(muscles.map(item => [item.slug, item.id]));
        const tagIds = new Map(tags.map(item => [item.slug, item.id]));
        return {
            equipmentId: equipment.id,
            movementPatternId: movementPattern.id,
            primaryMuscleIds: seed.primaryMuscleSlugs.map(slug => muscleIds.get(slug)!),
            secondaryMuscleIds: seed.secondaryMuscleSlugs.map(slug => muscleIds.get(slug)!),
            tagIds: seed.tagSlugs.map(slug => tagIds.get(slug)!),
        };
    }

    private async archiveTaxonomy(
        table: typeof muscleGroups | typeof equipmentTypes | typeof movementPatterns | typeof trainingTags,
        activeSlugs: readonly string[],
        now: Date,
        transaction: unknown,
    ): Promise<number> {
        const rows = await this.executor(transaction)
            .update(table)
            .set({ archivedAt: now, updatedAt: now })
            .where(and(eq(table.isSeeded, true), isNull(table.archivedAt), notInArray(table.slug, [...activeSlugs])))
            .returning({ id: table.id });
        return rows.length;
    }

    private async muscleBySlug(slug: string, executor: Database): Promise<MuscleGroupRow | undefined> {
        return (await executor.select().from(muscleGroups).where(eq(muscleGroups.slug, slug)).limit(1))[0];
    }

    private async equipmentBySlug(slug: string, executor: Database): Promise<EquipmentTypeRow | undefined> {
        return (await executor.select().from(equipmentTypes).where(eq(equipmentTypes.slug, slug)).limit(1))[0];
    }

    private async movementBySlug(slug: string, executor: Database): Promise<MovementPatternRow | undefined> {
        return (await executor.select().from(movementPatterns).where(eq(movementPatterns.slug, slug)).limit(1))[0];
    }

    private async tagBySlug(slug: string, executor: Database): Promise<TrainingTagRow | undefined> {
        return (await executor.select().from(trainingTags).where(eq(trainingTags.slug, slug)).limit(1))[0];
    }

    private async exerciseBySlug(slug: string, executor: Database): Promise<ExerciseRow | undefined> {
        return (await executor.select().from(exercises).where(eq(exercises.slug, slug)).limit(1))[0];
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

interface ExerciseReferences {
    readonly equipmentId: string;
    readonly movementPatternId: string;
    readonly primaryMuscleIds: readonly string[];
    readonly secondaryMuscleIds: readonly string[];
    readonly tagIds: readonly string[];
}

function result(outcome: CatalogSeedWriteResult["outcome"], slug: string): CatalogSeedWriteResult {
    return { outcome, slug };
}

function muscleItem(row: MuscleGroupRow): MuscleCatalogItem {
    return { id: row.id, slug: row.slug, name: row.name, position: row.position };
}

function extensibleItem(row: EquipmentTypeRow | MovementPatternRow): ExtensibleCatalogItem {
    return {
        ...muscleItem(row),
        ownership: ownership(row.isSeeded),
        analyticsMappingStatus:
            row.analyticsMappingStatus === "standard" || row.analyticsMappingStatus === "unmapped"
                ? row.analyticsMappingStatus
                : invalidPersisted("analytics mapping status", row.analyticsMappingStatus),
    };
}

function tagItem(row: TrainingTagRow): TagCatalogItem {
    return {
        ...muscleItem(row),
        ownership: ownership(row.isSeeded),
        category:
            row.category === "run_classification" || row.category === "custom"
                ? row.category
                : invalidPersisted("tag category", row.category),
    };
}

function ownership(isSeeded: boolean): "seeded" | "user" {
    return isSeeded ? "seeded" : "user";
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function checkedStatus(value: string): "active" | "archived" {
    return value === "active" || value === "archived" ? value : invalidPersisted("exercise status", value);
}

function checkedClassification(value: string): "compound" | "isolation" {
    return value === "compound" || value === "isolation" ? value : invalidPersisted("exercise classification", value);
}

function checkedLaterality(value: string): "bilateral" | "unilateral" {
    return value === "bilateral" || value === "unilateral" ? value : invalidPersisted("exercise laterality", value);
}

function checkedRepetitionSemantics(value: string): "total" | "per_side" | "alternating" {
    return value === "total" || value === "per_side" || value === "alternating"
        ? value
        : invalidPersisted("repetition semantics", value);
}

function checkedLoadModel(
    value: string,
): "external_only" | "full_bodyweight_plus_added_minus_assistance" | "manual_effective_load" | "none" {
    return ["external_only", "full_bodyweight_plus_added_minus_assistance", "manual_effective_load", "none"].includes(
        value,
    )
        ? (value as "external_only" | "full_bodyweight_plus_added_minus_assistance" | "manual_effective_load" | "none")
        : invalidPersisted("load model", value);
}

function checkedMeasurements(values: readonly string[]): readonly ExerciseMeasurementType[] {
    const valid = new Set<ExerciseMeasurementType>([
        "repetitions",
        "external_load",
        "bodyweight",
        "added_load",
        "assistance",
        "effective_load",
        "duration",
        "distance",
        "power",
    ]);
    if (values.some(value => !valid.has(value as ExerciseMeasurementType)))
        return invalidPersisted("supported measurements", values.join(","));
    return values as readonly ExerciseMeasurementType[];
}

function checkedMuscleRole(value: string): "primary" | "secondary" {
    return value === "primary" || value === "secondary" ? value : invalidPersisted("muscle role", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
