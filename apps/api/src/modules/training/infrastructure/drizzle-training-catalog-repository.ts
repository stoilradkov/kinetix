import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";

import {
    equipmentTypes,
    exerciseAliases,
    exerciseMuscles,
    exerciseRelationships,
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
import { ExerciseAliasConflictError, ExerciseRelationshipCycleError } from "#src/modules/training/application/index";
import type {
    CatalogSeedWriteResult,
    ExerciseCatalogItem,
    ExerciseCatalogPage,
    ExerciseListFilter,
    ExerciseRepository,
    ExtensibleCatalogItem,
    MuscleCatalogItem,
    TagCatalogItem,
    TrainingCatalogReader,
    TrainingCatalogSeedRepository,
} from "#src/modules/training/application/index";
import {
    ExerciseDefinition,
    type ExerciseDefinitionState,
    type EquipmentTypeSeed,
    type ExerciseMeasurementType,
    type ExerciseSeed,
    type MuscleGroupSeed,
    type MovementPatternSeed,
    type TagSeed,
} from "#src/modules/training/domain/index";
import { normalizeCatalogValue } from "#src/modules/training/domain/index";
import { ApplicationValidationError, VersionConflictError } from "#src/platform/application/index";
import { entityId, type EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleTrainingCatalogRepository
    implements TrainingCatalogSeedRepository, TrainingCatalogReader, ExerciseRepository
{
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
        const executor = this.executor(transaction);
        const rows = await executor
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
        if (rows.length > 0)
            await executor
                .update(exerciseAliases)
                .set({ isActive: false })
                .where(
                    inArray(
                        exerciseAliases.exerciseId,
                        rows.map(row => row.id),
                    ),
                );
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
        return (await this.pageExercises({ status: "active", limit: 1_000 })).items;
    }

    async pageExercises(filter: ExerciseListFilter): Promise<ExerciseCatalogPage> {
        const limit = checkedPageLimit(filter.limit);
        const offset = checkedCursor(filter.cursor);
        const status = filter.status ?? "active";
        const search = filter.search?.trim();
        const conditions = [
            status === "all" ? undefined : eq(exercises.status, status),
            filter.ownership === undefined ? undefined : eq(exercises.isSeeded, filter.ownership === "seeded"),
            filter.equipmentTypeId === undefined ? undefined : eq(exercises.equipmentTypeId, filter.equipmentTypeId),
            filter.movementPatternId === undefined
                ? undefined
                : eq(exercises.movementPatternId, filter.movementPatternId),
            filter.muscleGroupId === undefined
                ? undefined
                : sql<boolean>`exists (
                    select 1 from exercise_muscles em
                    where em.exercise_id = ${exercises.id}
                    and em.muscle_group_id = ${filter.muscleGroupId}
                )`,
            filter.tagId === undefined
                ? undefined
                : sql<boolean>`exists (
                    select 1 from exercise_tags et
                    where et.exercise_id = ${exercises.id}
                    and et.tag_id = ${filter.tagId}
                )`,
            filter.relationshipType === undefined
                ? undefined
                : sql<boolean>`exists (
                    select 1 from exercise_relationships er
                    where er.source_exercise_id = ${exercises.id}
                    and er.type = ${filter.relationshipType}
                    and er.archived_at is null
                )`,
            search === undefined || search.length === 0
                ? undefined
                : sql<boolean>`(
                    ${exercises.name} ilike ${`%${escapeLike(search)}%`}
                    or exists (
                        select 1 from exercise_aliases ea
                        where ea.exercise_id = ${exercises.id}
                        and ea.is_active
                        and ea.alias ilike ${`%${escapeLike(search)}%`}
                    )
                )`,
            sql<boolean>`(
                not ${exercises.isSeeded}
                or not exists (
                    select 1 from exercises user_override
                    where user_override.forked_from_exercise_id = ${exercises.id}
                )
            )`,
        ];
        const rows = await this.database.db
            .select({
                exercise: exercises,
                equipment: equipmentTypes,
                movementPattern: movementPatterns,
            })
            .from(exercises)
            .innerJoin(equipmentTypes, eq(exercises.equipmentTypeId, equipmentTypes.id))
            .innerJoin(movementPatterns, eq(exercises.movementPatternId, movementPatterns.id))
            .where(and(...conditions))
            .orderBy(asc(exercises.position), asc(exercises.slug), asc(exercises.id))
            .limit(limit + 1)
            .offset(offset);
        const hasMore = rows.length > limit;
        const pageRows = rows.slice(0, limit);
        return {
            items: await this.hydrateExerciseItems(pageRows, this.database.db),
            nextCursor: hasMore ? offset + limit : null,
        };
    }

    async readExercise(id: EntityId, transaction?: unknown): Promise<ExerciseCatalogItem | null> {
        const executor = this.executor(transaction);
        const rows = await executor
            .select({
                exercise: exercises,
                equipment: equipmentTypes,
                movementPattern: movementPatterns,
            })
            .from(exercises)
            .innerJoin(equipmentTypes, eq(exercises.equipmentTypeId, equipmentTypes.id))
            .innerJoin(movementPatterns, eq(exercises.movementPatternId, movementPatterns.id))
            .where(eq(exercises.id, id))
            .limit(1);
        return (await this.hydrateExerciseItems(rows, executor))[0] ?? null;
    }

    async resolveAlias(normalizedAlias: string): Promise<ExerciseCatalogItem | null> {
        const row = (
            await this.database.db
                .select({ exerciseId: exerciseAliases.exerciseId })
                .from(exerciseAliases)
                .where(and(eq(exerciseAliases.normalizedAlias, normalizedAlias), eq(exerciseAliases.isActive, true)))
                .limit(1)
        )[0];
        return row ? this.readExercise(entityId(row.exerciseId)) : null;
    }

    async areInAnalyticsFamily(leftId: EntityId, rightId: EntityId): Promise<boolean> {
        const rows = await this.database.db
            .select({ sourceExerciseId: exerciseRelationships.sourceExerciseId })
            .from(exerciseRelationships)
            .where(
                and(
                    eq(exerciseRelationships.type, "analytics_family"),
                    isNull(exerciseRelationships.archivedAt),
                    or(
                        and(
                            eq(exerciseRelationships.sourceExerciseId, leftId),
                            eq(exerciseRelationships.targetExerciseId, rightId),
                        ),
                        and(
                            eq(exerciseRelationships.sourceExerciseId, rightId),
                            eq(exerciseRelationships.targetExerciseId, leftId),
                        ),
                    ),
                ),
            )
            .limit(1);
        return rows.length === 1;
    }

    async findDefinition(id: EntityId, transaction?: unknown): Promise<StoredDefinition | null> {
        const executor = this.executor(transaction);
        const row = (await executor.select().from(exercises).where(eq(exercises.id, id)).limit(1))[0];
        return row ? this.hydrateDefinition(row, executor) : null;
    }

    async findUserOverride(seedExerciseId: EntityId, transaction: unknown): Promise<StoredDefinition | null> {
        const executor = this.executor(transaction);
        const row = (
            await executor.select().from(exercises).where(eq(exercises.forkedFromExerciseId, seedExerciseId)).limit(1)
        )[0];
        return row ? this.hydrateDefinition(row, executor) : null;
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: ExerciseDefinitionState; version: number } | null> {
        assertExerciseEntityType(entityType);
        const executor = this.executor(transaction);
        const row = (await executor.select().from(exercises).where(eq(exercises.id, id)).limit(1).for("update"))[0];
        if (!row) return null;
        const stored = await this.hydrateDefinition(row, executor);
        return { state: stored.definition.state, version: stored.version };
    }

    async create(
        entityType: string,
        id: EntityId,
        state: ExerciseDefinitionState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertExerciseEntityType(entityType);
        if (id !== state.id) throw new Error("Exercise state ID does not match its aggregate ID");
        const executor = this.executor(transaction);
        ExerciseDefinition.rehydrate(state);
        await this.validateDefinitionReferences(state, executor);
        await this.validateDefinitionUniqueness(state, executor);
        await this.validateRelationshipCycles(state, executor);
        try {
            await executor.insert(exercises).values(rootValues(state, version));
            if (state.forkedFromExerciseId !== null)
                await executor
                    .update(exerciseAliases)
                    .set({ isActive: false })
                    .where(eq(exerciseAliases.exerciseId, state.forkedFromExerciseId));
            await this.insertDefinitionDetails(state, executor);
        } catch (error) {
            throw mapCatalogWriteError(error);
        }
    }

    async save(
        entityType: string,
        id: EntityId,
        state: ExerciseDefinitionState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertExerciseEntityType(entityType);
        if (id !== state.id) throw new Error("Exercise state ID does not match its aggregate ID");
        const executor = this.executor(transaction);
        ExerciseDefinition.rehydrate(state);
        await this.validateDefinitionReferences(state, executor);
        await this.validateDefinitionUniqueness(state, executor, id);
        await this.validateRelationshipCycles(state, executor);
        try {
            const updated = await executor
                .update(exercises)
                .set(rootUpdateValues(state, nextVersion))
                .where(and(eq(exercises.id, id), eq(exercises.version, expectedVersion)))
                .returning({ id: exercises.id });
            if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
            await this.deleteDefinitionDetails(id, executor);
            await this.insertDefinitionDetails(state, executor);
        } catch (error) {
            throw mapCatalogWriteError(error);
        }
    }

    private async hydrateExerciseItems(
        rows: readonly ExerciseJoinedRow[],
        executor: Database,
    ): Promise<ExerciseCatalogItem[]> {
        if (rows.length === 0) return [];
        const ids = rows.map(row => row.exercise.id);
        const [aliases, muscles, tags, relationships] = await Promise.all([
            executor
                .select()
                .from(exerciseAliases)
                .where(inArray(exerciseAliases.exerciseId, ids))
                .orderBy(asc(exerciseAliases.normalizedAlias)),
            executor
                .select({
                    exerciseId: exerciseMuscles.exerciseId,
                    role: exerciseMuscles.role,
                    muscle: muscleGroups,
                })
                .from(exerciseMuscles)
                .innerJoin(muscleGroups, eq(exerciseMuscles.muscleGroupId, muscleGroups.id))
                .where(inArray(exerciseMuscles.exerciseId, ids))
                .orderBy(asc(exerciseMuscles.role), asc(muscleGroups.position), asc(muscleGroups.slug)),
            executor
                .select({
                    exerciseId: exerciseTags.exerciseId,
                    tag: trainingTags,
                })
                .from(exerciseTags)
                .innerJoin(trainingTags, eq(exerciseTags.tagId, trainingTags.id))
                .where(inArray(exerciseTags.exerciseId, ids))
                .orderBy(asc(trainingTags.position), asc(trainingTags.slug)),
            executor
                .select()
                .from(exerciseRelationships)
                .where(
                    and(inArray(exerciseRelationships.sourceExerciseId, ids), isNull(exerciseRelationships.archivedAt)),
                )
                .orderBy(asc(exerciseRelationships.type), asc(exerciseRelationships.targetExerciseId)),
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
            forkedFromExerciseId: row.exercise.forkedFromExerciseId,
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
            relationships: relationships
                .filter(item => item.sourceExerciseId === row.exercise.id)
                .map(item => ({
                    targetExerciseId: item.targetExerciseId,
                    type: checkedRelationshipType(item.type),
                })),
            notes: row.exercise.notes,
            version: row.exercise.version,
            position: row.exercise.position,
            archivedAt: row.exercise.archivedAt?.toISOString() ?? null,
            createdAt: row.exercise.createdAt.toISOString(),
            updatedAt: row.exercise.updatedAt.toISOString(),
        }));
    }

    private async hydrateDefinition(row: ExerciseRow, executor: Database): Promise<StoredDefinition> {
        const [aliases, muscles, tags, relationships] = await Promise.all([
            executor
                .select()
                .from(exerciseAliases)
                .where(eq(exerciseAliases.exerciseId, row.id))
                .orderBy(asc(exerciseAliases.normalizedAlias)),
            executor
                .select()
                .from(exerciseMuscles)
                .where(eq(exerciseMuscles.exerciseId, row.id))
                .orderBy(asc(exerciseMuscles.role), asc(exerciseMuscles.muscleGroupId)),
            executor
                .select()
                .from(exerciseTags)
                .where(eq(exerciseTags.exerciseId, row.id))
                .orderBy(asc(exerciseTags.tagId)),
            executor
                .select()
                .from(exerciseRelationships)
                .where(
                    and(eq(exerciseRelationships.sourceExerciseId, row.id), isNull(exerciseRelationships.archivedAt)),
                )
                .orderBy(asc(exerciseRelationships.type), asc(exerciseRelationships.targetExerciseId)),
        ]);
        const definition = ExerciseDefinition.rehydrate({
            id: row.id,
            slug: row.slug,
            name: row.name,
            aliases: aliases
                .filter(alias => alias.normalizedAlias !== normalizeCatalogValue(row.name))
                .map(alias => ({
                    value: alias.alias,
                    normalizedValue: alias.normalizedAlias,
                    source: checkedAliasSource(alias.source),
                })),
            status: checkedStatus(row.status),
            ownership: ownership(row.isSeeded),
            forkedFromExerciseId: row.forkedFromExerciseId,
            equipmentTypeId: row.equipmentTypeId,
            movementPatternId: row.movementPatternId,
            classification: checkedClassification(row.classification),
            laterality: checkedLaterality(row.laterality),
            bodyPosition: row.bodyPosition,
            repetitionSemantics: checkedRepetitionSemantics(row.repetitionSemantics),
            loadModel: checkedLoadModel(row.loadModel),
            supportedMeasurements: checkedMeasurements(row.supportedMeasurements),
            muscles: muscles.map(item => ({
                muscleGroupId: item.muscleGroupId,
                role: checkedMuscleRole(item.role),
            })),
            tagIds: tags.map(item => item.tagId),
            relationships: relationships.map(item => ({
                targetExerciseId: item.targetExerciseId,
                type: checkedRelationshipType(item.type),
            })),
            notes: row.notes,
            position: row.position,
            archivedAt: row.archivedAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        });
        return { definition, version: row.version };
    }

    private async validateDefinitionReferences(state: ExerciseDefinitionState, executor: Database): Promise<void> {
        const [equipment, movement, muscles, tags, targets] = await Promise.all([
            executor
                .select({ id: equipmentTypes.id })
                .from(equipmentTypes)
                .where(and(eq(equipmentTypes.id, state.equipmentTypeId), isNull(equipmentTypes.archivedAt)))
                .limit(1),
            executor
                .select({ id: movementPatterns.id })
                .from(movementPatterns)
                .where(and(eq(movementPatterns.id, state.movementPatternId), isNull(movementPatterns.archivedAt)))
                .limit(1),
            executor
                .select({ id: muscleGroups.id })
                .from(muscleGroups)
                .where(
                    and(
                        inArray(
                            muscleGroups.id,
                            state.muscles.map(item => item.muscleGroupId),
                        ),
                        isNull(muscleGroups.archivedAt),
                    ),
                ),
            state.tagIds.length === 0
                ? Promise.resolve([])
                : executor
                      .select({ id: trainingTags.id })
                      .from(trainingTags)
                      .where(and(inArray(trainingTags.id, [...state.tagIds]), isNull(trainingTags.archivedAt))),
            state.relationships.length === 0
                ? Promise.resolve([])
                : executor
                      .select({ id: exercises.id })
                      .from(exercises)
                      .where(
                          inArray(exercises.id, [...new Set(state.relationships.map(item => item.targetExerciseId))]),
                      ),
        ]);
        const fieldErrors: Record<string, string[]> = {};
        if (equipment.length !== 1) fieldErrors.equipmentTypeId = ["Equipment type was not found or is archived"];
        if (movement.length !== 1) fieldErrors.movementPatternId = ["Movement pattern was not found or is archived"];
        if (muscles.length !== state.muscles.length)
            fieldErrors.muscles = ["One or more muscle groups were not found or are archived"];
        if (tags.length !== state.tagIds.length)
            fieldErrors.tagIds = ["One or more tags were not found or are archived"];
        if (targets.length !== new Set(state.relationships.map(item => item.targetExerciseId)).size)
            fieldErrors.relationships = ["One or more relationship targets were not found"];
        if (Object.keys(fieldErrors).length > 0)
            throw new ApplicationValidationError("Exercise catalog references are invalid", fieldErrors);
    }

    private async validateDefinitionUniqueness(
        state: ExerciseDefinitionState,
        executor: Database,
        currentId?: EntityId,
    ): Promise<void> {
        const slugOwner = (
            await executor.select({ id: exercises.id }).from(exercises).where(eq(exercises.slug, state.slug)).limit(1)
        )[0];
        if (slugOwner && slugOwner.id !== currentId)
            throw new ApplicationValidationError(`Exercise slug '${state.slug}' is already in use`, {
                slug: ["Exercise slug must be unique"],
            });

        const normalizedAliases = [
            normalizeCatalogValue(state.name),
            ...state.aliases.map(alias => alias.normalizedValue),
        ];
        const aliasOwners = await executor
            .select({
                exerciseId: exerciseAliases.exerciseId,
                normalizedAlias: exerciseAliases.normalizedAlias,
            })
            .from(exerciseAliases)
            .where(
                and(inArray(exerciseAliases.normalizedAlias, normalizedAliases), eq(exerciseAliases.isActive, true)),
            );
        const conflict = aliasOwners.find(
            alias => alias.exerciseId !== currentId && alias.exerciseId !== state.forkedFromExerciseId,
        );
        if (conflict) throw new ExerciseAliasConflictError(conflict.normalizedAlias);
    }

    private async validateRelationshipCycles(state: ExerciseDefinitionState, executor: Database): Promise<void> {
        const existing = await executor
            .select({
                sourceExerciseId: exerciseRelationships.sourceExerciseId,
                targetExerciseId: exerciseRelationships.targetExerciseId,
                type: exerciseRelationships.type,
            })
            .from(exerciseRelationships)
            .where(isNull(exerciseRelationships.archivedAt));
        for (const type of ["variation", "progression", "regression"] as const) {
            const edges = existing
                .filter(item => item.type === type && item.sourceExerciseId !== state.id)
                .map(item => [item.sourceExerciseId, item.targetExerciseId] as const);
            edges.push(
                ...state.relationships
                    .filter(relationship => relationship.type === type)
                    .map(relationship => [state.id, relationship.targetExerciseId] as const),
            );
            if (containsDirectedCycleFrom(state.id, edges)) throw new ExerciseRelationshipCycleError(type);
        }
    }

    private async deleteDefinitionDetails(id: EntityId, executor: Database): Promise<void> {
        await executor.delete(exerciseAliases).where(eq(exerciseAliases.exerciseId, id));
        await executor.delete(exerciseMuscles).where(eq(exerciseMuscles.exerciseId, id));
        await executor.delete(exerciseTags).where(eq(exerciseTags.exerciseId, id));
        await executor.delete(exerciseRelationships).where(eq(exerciseRelationships.sourceExerciseId, id));
    }

    private async insertDefinitionDetails(state: ExerciseDefinitionState, executor: Database): Promise<void> {
        const active = state.status === "active";
        await executor.insert(exerciseAliases).values([
            {
                exerciseId: state.id,
                alias: state.name,
                normalizedAlias: normalizeCatalogValue(state.name),
                source: state.ownership === "seeded" ? "seeded" : "user",
                isActive: active,
                createdAt: new Date(state.updatedAt),
            },
            ...state.aliases.map(alias => ({
                exerciseId: state.id,
                alias: alias.value,
                normalizedAlias: alias.normalizedValue,
                source: alias.source,
                isActive: active,
                createdAt: new Date(state.updatedAt),
            })),
        ]);
        await executor.insert(exerciseMuscles).values(
            state.muscles.map(assignment => ({
                exerciseId: state.id,
                muscleGroupId: assignment.muscleGroupId,
                role: assignment.role,
            })),
        );
        if (state.tagIds.length > 0)
            await executor.insert(exerciseTags).values(state.tagIds.map(tagId => ({ exerciseId: state.id, tagId })));
        if (state.relationships.length > 0)
            await executor.insert(exerciseRelationships).values(
                state.relationships.map(relationship => ({
                    sourceExerciseId: state.id,
                    targetExerciseId: relationship.targetExerciseId,
                    type: relationship.type,
                    createdAt: new Date(state.updatedAt),
                })),
            );
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

interface StoredDefinition {
    readonly definition: ExerciseDefinition;
    readonly version: number;
}

interface ExerciseJoinedRow {
    readonly exercise: ExerciseRow;
    readonly equipment: EquipmentTypeRow;
    readonly movementPattern: MovementPatternRow;
}

function rootValues(state: ExerciseDefinitionState, version: number) {
    return {
        id: state.id,
        slug: state.slug,
        name: state.name,
        status: state.status,
        isSeeded: state.ownership === "seeded",
        forkedFromExerciseId: state.forkedFromExerciseId,
        equipmentTypeId: state.equipmentTypeId,
        movementPatternId: state.movementPatternId,
        classification: state.classification,
        laterality: state.laterality,
        bodyPosition: state.bodyPosition,
        repetitionSemantics: state.repetitionSemantics,
        loadModel: state.loadModel,
        supportedMeasurements: [...state.supportedMeasurements],
        notes: state.notes,
        version,
        position: state.position,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: ExerciseDefinitionState, version: number) {
    return {
        slug: state.slug,
        name: state.name,
        status: state.status,
        isSeeded: state.ownership === "seeded",
        forkedFromExerciseId: state.forkedFromExerciseId,
        equipmentTypeId: state.equipmentTypeId,
        movementPatternId: state.movementPatternId,
        classification: state.classification,
        laterality: state.laterality,
        bodyPosition: state.bodyPosition,
        repetitionSemantics: state.repetitionSemantics,
        loadModel: state.loadModel,
        supportedMeasurements: [...state.supportedMeasurements],
        notes: state.notes,
        version,
        position: state.position,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function assertExerciseEntityType(entityType: string): void {
    if (entityType !== "training.exercise") throw new Error(`Unsupported exercise entity type '${entityType}'`);
}

function checkedPageLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000)
        throw new ApplicationValidationError("Exercise page limit must be between 1 and 1000");
    return value;
}

function checkedCursor(value: number | undefined): number {
    if (value === undefined) return 0;
    if (!Number.isSafeInteger(value) || value < 0)
        throw new ApplicationValidationError("Exercise page cursor is invalid");
    return value;
}

function escapeLike(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function containsDirectedCycleFrom(sourceExerciseId: string, edges: readonly (readonly [string, string])[]): boolean {
    const graph = new Map<string, string[]>();
    for (const [source, target] of edges) {
        const targets = graph.get(source) ?? [];
        targets.push(target);
        graph.set(source, targets);
    }
    const visit = (node: string, visited: Set<string>): boolean => {
        if (node === sourceExerciseId && visited.size > 0) return true;
        if (visited.has(node)) return false;
        const nextVisited = new Set(visited).add(node);
        return (graph.get(node) ?? []).some(target => visit(target, nextVisited));
    };
    return (graph.get(sourceExerciseId) ?? []).some(target => visit(target, new Set([sourceExerciseId])));
}

function mapCatalogWriteError(error: unknown): unknown {
    if (error instanceof ApplicationValidationError || error instanceof VersionConflictError) return error;
    const databaseError = postgresError(error);
    if (databaseError) {
        const constraint =
            typeof databaseError.constraint_name === "string"
                ? databaseError.constraint_name
                : typeof databaseError.constraint === "string"
                  ? databaseError.constraint
                  : "";
        if (databaseError.code === "23505" && constraint.includes("exercise_aliases_normalized_unique"))
            return new ExerciseAliasConflictError("conflicting alias");
        if (databaseError.code === "23505")
            return new ApplicationValidationError("Exercise slug or fork lineage is already in use");
        if (databaseError.code === "23503")
            return new ApplicationValidationError("Exercise catalog references are invalid");
    }
    return error;
}

function postgresError(error: unknown): { code?: unknown; constraint_name?: unknown; constraint?: unknown } | null {
    if (typeof error !== "object" || error === null) return null;
    const candidate = error as {
        code?: unknown;
        constraint_name?: unknown;
        constraint?: unknown;
        cause?: unknown;
    };
    if (typeof candidate.code === "string" && candidate.code.startsWith("23")) return candidate;
    return postgresError(candidate.cause);
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

function checkedAliasSource(value: string): "seeded" | "user" | "redirect" {
    return value === "seeded" || value === "user" || value === "redirect"
        ? value
        : invalidPersisted("exercise alias source", value);
}

function checkedRelationshipType(value: string): "variation" | "progression" | "regression" | "analytics_family" {
    return value === "variation" || value === "progression" || value === "regression" || value === "analytics_family"
        ? value
        : invalidPersisted("exercise relationship type", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
