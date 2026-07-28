import { isNotNull, isNull, sql } from "drizzle-orm";
import {
    type AnyPgColumn,
    bigint,
    boolean,
    check,
    date,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    primaryKey,
    smallint,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

const catalogRootColumns = () => ({
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    isSeeded: boolean("is_seeded").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const muscleGroups = pgTable(
    "muscle_groups",
    {
        ...catalogRootColumns(),
    },
    table => [
        check("muscle_groups_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
        check("muscle_groups_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("muscle_groups_position_valid", sql`${table.position} >= 0`),
        check("muscle_groups_system_controlled", sql`${table.isSeeded}`),
        uniqueIndex("muscle_groups_slug_unique").on(table.slug),
        uniqueIndex("muscle_groups_normalized_name_unique")
            .on(sql`lower(btrim(${table.name}))`)
            .where(isNull(table.archivedAt)),
        index("muscle_groups_active_order_idx").on(table.archivedAt, table.position, table.slug),
    ],
);

export const equipmentTypes = pgTable(
    "equipment_types",
    {
        ...catalogRootColumns(),
        analyticsMappingStatus: text("analytics_mapping_status").notNull().default("unmapped"),
    },
    table => [
        check("equipment_types_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
        check("equipment_types_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("equipment_types_position_valid", sql`${table.position} >= 0`),
        check("equipment_types_mapping_status_valid", sql`${table.analyticsMappingStatus} IN ('standard', 'unmapped')`),
        uniqueIndex("equipment_types_slug_unique").on(table.slug),
        uniqueIndex("equipment_types_normalized_name_unique")
            .on(sql`lower(btrim(${table.name}))`)
            .where(isNull(table.archivedAt)),
        index("equipment_types_active_order_idx").on(table.archivedAt, table.position, table.slug),
    ],
);

export const movementPatterns = pgTable(
    "movement_patterns",
    {
        ...catalogRootColumns(),
        analyticsMappingStatus: text("analytics_mapping_status").notNull().default("unmapped"),
    },
    table => [
        check("movement_patterns_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
        check("movement_patterns_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("movement_patterns_position_valid", sql`${table.position} >= 0`),
        check(
            "movement_patterns_mapping_status_valid",
            sql`${table.analyticsMappingStatus} IN ('standard', 'unmapped')`,
        ),
        uniqueIndex("movement_patterns_slug_unique").on(table.slug),
        uniqueIndex("movement_patterns_normalized_name_unique")
            .on(sql`lower(btrim(${table.name}))`)
            .where(isNull(table.archivedAt)),
        index("movement_patterns_active_order_idx").on(table.archivedAt, table.position, table.slug),
    ],
);

export const trainingTags = pgTable(
    "training_tags",
    {
        ...catalogRootColumns(),
        normalizedName: text("normalized_name").notNull(),
        category: text("category").notNull().default("custom"),
    },
    table => [
        check("training_tags_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
        check("training_tags_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("training_tags_normalized_name_valid", sql`${table.normalizedName} = lower(btrim(${table.name}))`),
        check("training_tags_position_valid", sql`${table.position} >= 0`),
        check("training_tags_category_valid", sql`${table.category} IN ('run_classification', 'custom')`),
        uniqueIndex("training_tags_slug_unique").on(table.slug),
        uniqueIndex("training_tags_normalized_name_unique").on(table.normalizedName).where(isNull(table.archivedAt)),
        index("training_tags_active_order_idx").on(table.archivedAt, table.position, table.slug),
    ],
);

export const exercises = pgTable(
    "exercises",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        slug: text("slug").notNull(),
        name: text("name").notNull(),
        status: text("status").notNull().default("active"),
        isSeeded: boolean("is_seeded").notNull().default(false),
        forkedFromExerciseId: uuid("forked_from_exercise_id").references((): AnyPgColumn => exercises.id),
        equipmentTypeId: uuid("equipment_type_id")
            .notNull()
            .references(() => equipmentTypes.id),
        movementPatternId: uuid("movement_pattern_id")
            .notNull()
            .references(() => movementPatterns.id),
        classification: text("classification").notNull(),
        laterality: text("laterality").notNull(),
        bodyPosition: text("body_position").notNull(),
        repetitionSemantics: text("repetition_semantics").notNull(),
        loadModel: text("load_model").notNull(),
        supportedMeasurements: jsonb("supported_measurements").$type<string[]>().notNull(),
        notes: text("notes"),
        version: integer("version").notNull().default(1),
        position: integer("position").notNull(),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("exercises_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
        check("exercises_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("exercises_status_valid", sql`${table.status} IN ('active', 'archived')`),
        check("exercises_classification_valid", sql`${table.classification} IN ('compound', 'isolation')`),
        check("exercises_laterality_valid", sql`${table.laterality} IN ('bilateral', 'unilateral')`),
        check("exercises_body_position_valid", sql`length(btrim(${table.bodyPosition})) > 0`),
        check(
            "exercises_repetition_semantics_valid",
            sql`${table.repetitionSemantics} IN ('total', 'per_side', 'alternating')`,
        ),
        check(
            "exercises_load_model_valid",
            sql`${table.loadModel} IN (
                'external_only',
                'full_bodyweight_plus_added_minus_assistance',
                'manual_effective_load',
                'none'
            )`,
        ),
        check("exercises_version_positive", sql`${table.version} > 0`),
        check("exercises_position_valid", sql`${table.position} >= 0`),
        check(
            "exercises_archive_state_valid",
            sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL)
                OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)`,
        ),
        uniqueIndex("exercises_slug_unique").on(table.slug),
        uniqueIndex("exercises_forked_from_unique")
            .on(table.forkedFromExerciseId)
            .where(isNotNull(table.forkedFromExerciseId)),
        index("exercises_active_order_idx").on(table.status, table.position, table.slug),
        index("exercises_equipment_idx").on(table.equipmentTypeId, table.status),
        index("exercises_movement_idx").on(table.movementPatternId, table.status),
    ],
);

export const exerciseAliases = pgTable(
    "exercise_aliases",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => exercises.id, { onDelete: "cascade" }),
        alias: text("alias").notNull(),
        normalizedAlias: text("normalized_alias").notNull(),
        source: text("source").notNull(),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("exercise_aliases_alias_valid", sql`length(btrim(${table.alias})) > 0`),
        check("exercise_aliases_normalized_valid", sql`length(btrim(${table.normalizedAlias})) > 0`),
        check(
            "exercise_aliases_normalized_matches",
            sql`${table.normalizedAlias} = lower(regexp_replace(btrim(${table.alias}), '\\s+', ' ', 'g'))`,
        ),
        check("exercise_aliases_source_valid", sql`${table.source} IN ('seeded', 'user', 'redirect')`),
        uniqueIndex("exercise_aliases_normalized_unique")
            .on(table.normalizedAlias)
            .where(sql`${table.isActive}`),
        index("exercise_aliases_exercise_idx").on(table.exerciseId),
    ],
);

export const exerciseMuscles = pgTable(
    "exercise_muscles",
    {
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => exercises.id, { onDelete: "cascade" }),
        muscleGroupId: uuid("muscle_group_id")
            .notNull()
            .references(() => muscleGroups.id),
        role: text("role").notNull(),
    },
    table => [
        primaryKey({ name: "exercise_muscles_pk", columns: [table.exerciseId, table.muscleGroupId] }),
        check("exercise_muscles_role_valid", sql`${table.role} IN ('primary', 'secondary')`),
        index("exercise_muscles_muscle_role_idx").on(table.muscleGroupId, table.role),
    ],
);

export const exerciseTags = pgTable(
    "exercise_tags",
    {
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => exercises.id, { onDelete: "cascade" }),
        tagId: uuid("tag_id")
            .notNull()
            .references(() => trainingTags.id),
    },
    table => [
        primaryKey({ name: "exercise_tags_pk", columns: [table.exerciseId, table.tagId] }),
        index("exercise_tags_tag_idx").on(table.tagId),
    ],
);

export const exerciseRelationships = pgTable(
    "exercise_relationships",
    {
        sourceExerciseId: uuid("source_exercise_id")
            .notNull()
            .references(() => exercises.id, { onDelete: "cascade" }),
        targetExerciseId: uuid("target_exercise_id")
            .notNull()
            .references(() => exercises.id),
        type: text("type").notNull(),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({
            name: "exercise_relationships_pk",
            columns: [table.sourceExerciseId, table.targetExerciseId, table.type],
        }),
        check(
            "exercise_relationships_type_valid",
            sql`${table.type} IN ('variation', 'progression', 'regression', 'analytics_family')`,
        ),
        check("exercise_relationships_not_self", sql`${table.sourceExerciseId} <> ${table.targetExerciseId}`),
        index("exercise_relationships_target_type_idx").on(table.targetExerciseId, table.type, table.archivedAt),
    ],
);

export const exerciseExternalIds = pgTable(
    "exercise_external_ids",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => exercises.id),
        provider: text("provider").notNull(),
        externalId: text("external_id").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("exercise_external_ids_provider_valid", sql`length(btrim(${table.provider})) BETWEEN 1 AND 120`),
        check("exercise_external_ids_value_valid", sql`length(btrim(${table.externalId})) BETWEEN 1 AND 500`),
        uniqueIndex("exercise_external_ids_provider_value_unique").on(table.provider, table.externalId),
        index("exercise_external_ids_exercise_idx").on(table.exerciseId),
    ],
);

export interface StoredExerciseReferenceImpact {
    referenceType: string;
    count: number;
}

export interface StoredExerciseExternalId {
    provider: string;
    externalId: string;
}

export const exerciseMerges = pgTable(
    "exercise_merges",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        canonicalExerciseId: uuid("canonical_exercise_id")
            .notNull()
            .references(() => exercises.id),
        mergedExerciseId: uuid("merged_exercise_id")
            .notNull()
            .references(() => exercises.id),
        canonicalExerciseName: text("canonical_exercise_name").notNull(),
        mergedExerciseName: text("merged_exercise_name").notNull(),
        canonicalExerciseVersion: integer("canonical_exercise_version").notNull(),
        mergedExerciseVersion: integer("merged_exercise_version").notNull(),
        mergedExerciseVersionAfterApply: integer("merged_exercise_version_after_apply").notNull(),
        revertedCanonicalExerciseVersion: integer("reverted_canonical_exercise_version"),
        revertedMergedExerciseVersion: integer("reverted_merged_exercise_version"),
        referenceImpact: jsonb("reference_impact").$type<StoredExerciseReferenceImpact[]>().notNull().default([]),
        affectedExerciseIds: jsonb("affected_exercise_ids").$type<string[]>().notNull(),
        affectedFamilyExerciseIds: jsonb("affected_family_exercise_ids").$type<string[]>().notNull(),
        externalIds: jsonb("external_ids").$type<StoredExerciseExternalId[]>().notNull().default([]),
        reason: text("reason"),
        revertReason: text("revert_reason"),
        version: integer("version").notNull().default(1),
        appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
        revertedAt: timestamp("reverted_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("exercise_merges_not_self", sql`${table.canonicalExerciseId} <> ${table.mergedExerciseId}`),
        check(
            "exercise_merges_names_valid",
            sql`length(btrim(${table.canonicalExerciseName})) > 0 AND length(btrim(${table.mergedExerciseName})) > 0`,
        ),
        check(
            "exercise_merges_apply_versions_positive",
            sql`${table.canonicalExerciseVersion} > 0
                AND ${table.mergedExerciseVersion} > 0
                AND ${table.mergedExerciseVersionAfterApply} > 0`,
        ),
        check(
            "exercise_merges_revert_versions_positive",
            sql`(${table.revertedCanonicalExerciseVersion} IS NULL
                    OR ${table.revertedCanonicalExerciseVersion} > 0)
                AND (${table.revertedMergedExerciseVersion} IS NULL
                    OR ${table.revertedMergedExerciseVersion} > 0)`,
        ),
        check(
            "exercise_merges_reason_valid",
            sql`${table.reason} IS NULL OR length(btrim(${table.reason})) BETWEEN 1 AND 500`,
        ),
        check(
            "exercise_merges_revert_reason_valid",
            sql`${table.revertReason} IS NULL OR length(btrim(${table.revertReason})) BETWEEN 1 AND 500`,
        ),
        check(
            "exercise_merges_state_valid",
            sql`(
                ${table.version} = 1
                AND ${table.revertedAt} IS NULL
                AND ${table.revertReason} IS NULL
                AND ${table.revertedCanonicalExerciseVersion} IS NULL
                AND ${table.revertedMergedExerciseVersion} IS NULL
            ) OR (
                ${table.version} = 2
                AND ${table.revertedAt} IS NOT NULL
                AND ${table.revertedCanonicalExerciseVersion} IS NOT NULL
                AND ${table.revertedMergedExerciseVersion} IS NOT NULL
            )`,
        ),
        uniqueIndex("exercise_merges_active_merged_unique").on(table.mergedExerciseId).where(isNull(table.revertedAt)),
        index("exercise_merges_canonical_history_idx").on(table.canonicalExerciseId, table.appliedAt),
        index("exercise_merges_merged_history_idx").on(table.mergedExerciseId, table.appliedAt),
    ],
);

export const exerciseMergeAliases = pgTable(
    "exercise_merge_aliases",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        mergeId: uuid("merge_id")
            .notNull()
            .references(() => exerciseMerges.id),
        canonicalExerciseId: uuid("canonical_exercise_id")
            .notNull()
            .references(() => exercises.id),
        originalExerciseId: uuid("original_exercise_id")
            .notNull()
            .references(() => exercises.id),
        alias: text("alias").notNull(),
        normalizedAlias: text("normalized_alias").notNull(),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    },
    table => [
        check("exercise_merge_aliases_alias_valid", sql`length(btrim(${table.alias})) > 0`),
        check(
            "exercise_merge_aliases_normalized_matches",
            sql`${table.normalizedAlias} = lower(regexp_replace(btrim(${table.alias}), '\\s+', ' ', 'g'))`,
        ),
        check(
            "exercise_merge_aliases_state_valid",
            sql`(${table.isActive} AND ${table.deactivatedAt} IS NULL)
                OR (NOT ${table.isActive} AND ${table.deactivatedAt} IS NOT NULL)`,
        ),
        uniqueIndex("exercise_merge_aliases_merge_value_unique").on(table.mergeId, table.normalizedAlias),
        uniqueIndex("exercise_merge_aliases_active_value_unique")
            .on(table.normalizedAlias)
            .where(sql`${table.isActive}`),
        index("exercise_merge_aliases_canonical_idx").on(table.canonicalExerciseId, table.isActive),
        index("exercise_merge_aliases_original_idx").on(table.originalExerciseId, table.isActive),
    ],
);

export type MuscleGroupRow = typeof muscleGroups.$inferSelect;
export type EquipmentTypeRow = typeof equipmentTypes.$inferSelect;
export type MovementPatternRow = typeof movementPatterns.$inferSelect;
export type TrainingTagRow = typeof trainingTags.$inferSelect;
export type ExerciseRow = typeof exercises.$inferSelect;
export type ExerciseAliasRow = typeof exerciseAliases.$inferSelect;
export type ExerciseMuscleRow = typeof exerciseMuscles.$inferSelect;
export type ExerciseRelationshipRow = typeof exerciseRelationships.$inferSelect;
export type ExerciseExternalIdRow = typeof exerciseExternalIds.$inferSelect;
export type ExerciseMergeRow = typeof exerciseMerges.$inferSelect;
export type ExerciseMergeAliasRow = typeof exerciseMergeAliases.$inferSelect;

/** Promoted measurement columns for Training-owned tables. Call per table. */
export const trainingMeasurementColumns = () => ({
    massKg: numeric("mass_kg", { precision: 12, scale: 3 }),
    distanceM: numeric("distance_m", { precision: 14, scale: 3 }),
    durationMs: bigint("duration_ms", { mode: "bigint" }),
    speedMps: numeric("speed_mps", { precision: 12, scale: 4 }),
    powerW: numeric("power_w", { precision: 12, scale: 2 }),
    heartRateBpm: integer("heart_rate_bpm"),
    cadenceRpm: integer("cadence_rpm"),
    rpe: numeric("rpe", { precision: 3, scale: 1 }),
    rir: smallint("rir"),
    subjectiveRating: smallint("subjective_rating"),
    painRating: smallint("pain_rating"),
    percentage: numeric("percentage", { precision: 8, scale: 5 }),
    enteredMeasurements: jsonb("entered_measurements")
        .$type<Record<string, { value: number | string; unit: string }>>()
        .notNull()
        .default({}),
});

/** Critical checks mirrored from domain factories. Attach these to each owning table. */
export const trainingMeasurementChecks = (table: ReturnType<typeof trainingMeasurementColumns>) => [
    check("mass_nonnegative", sql`${table.massKg} is null or ${table.massKg} >= 0`),
    check("distance_nonnegative", sql`${table.distanceM} is null or ${table.distanceM} >= 0`),
    check("duration_nonnegative", sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
    check("speed_nonnegative", sql`${table.speedMps} is null or ${table.speedMps} >= 0`),
    check("power_nonnegative", sql`${table.powerW} is null or ${table.powerW} >= 0`),
    check(
        "rpe_range_step",
        sql`${table.rpe} is null or (${table.rpe} between 1 and 10 and mod(${table.rpe}, 0.5) = 0)`,
    ),
    check("rir_range", sql`${table.rir} is null or ${table.rir} between 0 and 10`),
    check(
        "subjective_rating_range",
        sql`${table.subjectiveRating} is null or ${table.subjectiveRating} between 1 and 5`,
    ),
    check("pain_rating_range", sql`${table.painRating} is null or ${table.painRating} between 0 and 10`),
    check("percentage_range", sql`${table.percentage} is null or ${table.percentage} between 0 and 100`),
];

/** The single active training profile: experience + versioned analytics defaults (design 9). */
export const trainingProfiles = pgTable(
    "training_profiles",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        status: text("status").notNull().default("active"),
        experience: text("experience").notNull().default("beginner"),
        oneRepMaxRepCutoff: smallint("one_rep_max_rep_cutoff").notNull().default(12),
        hardSetRpeThreshold: numeric("hard_set_rpe_threshold", { precision: 3, scale: 1 }).notNull().default("7"),
        hardSetRirThreshold: smallint("hard_set_rir_threshold").notNull().default(3),
        calculatorVersion: integer("calculator_version").notNull().default(1),
        ruleVersion: integer("rule_version").notNull().default(1),
        version: integer("version").notNull().default(1),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("training_profiles_status_valid", sql`${table.status} IN ('active', 'archived')`),
        check(
            "training_profiles_experience_valid",
            sql`${table.experience} IN ('beginner', 'intermediate', 'advanced')`,
        ),
        check("training_profiles_rep_cutoff_range", sql`${table.oneRepMaxRepCutoff} BETWEEN 1 AND 20`),
        check(
            "training_profiles_rpe_range_step",
            sql`${table.hardSetRpeThreshold} BETWEEN 0 AND 10 AND mod(${table.hardSetRpeThreshold}, 0.5) = 0`,
        ),
        check("training_profiles_rir_range", sql`${table.hardSetRirThreshold} BETWEEN 0 AND 10`),
        check("training_profiles_calculator_version_positive", sql`${table.calculatorVersion} > 0`),
        check("training_profiles_rule_version_positive", sql`${table.ruleVersion} > 0`),
        check("training_profiles_version_positive", sql`${table.version} > 0`),
        check(
            "training_profiles_archive_state_valid",
            sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL)
                OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)`,
        ),
        uniqueIndex("training_profiles_single_active_unique")
            .on(table.status)
            .where(sql`${table.status} = 'active'`),
        index("training_profiles_profile_idx").on(table.profileId),
    ],
);

export type TrainingProfileRow = typeof trainingProfiles.$inferSelect;

/** Training goals: many per profile, with an optional measurable target (design 9). */
export const trainingGoals = pgTable(
    "training_goals",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        type: text("type").notNull(),
        targetValue: numeric("target_value", { precision: 12, scale: 3 }),
        targetUnit: text("target_unit"),
        startDate: date("start_date").notNull(),
        targetDate: date("target_date"),
        priority: integer("priority").notNull().default(1),
        status: text("status").notNull().default("active"),
        notes: text("notes"),
        programId: uuid("program_id"),
        version: integer("version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check(
            "training_goals_type_valid",
            sql`${table.type} IN ('strength', 'endurance', 'body_composition', 'skill', 'other')`,
        ),
        check("training_goals_status_valid", sql`${table.status} IN ('active', 'achieved', 'abandoned')`),
        check(
            "training_goals_target_value_nonnegative",
            sql`${table.targetValue} IS NULL OR ${table.targetValue} >= 0`,
        ),
        check("training_goals_target_pair", sql`(${table.targetValue} IS NULL) = (${table.targetUnit} IS NULL)`),
        check(
            "training_goals_target_after_start",
            sql`${table.targetDate} IS NULL OR ${table.targetDate} >= ${table.startDate}`,
        ),
        check("training_goals_priority_range", sql`${table.priority} BETWEEN 1 AND 1000`),
        check("training_goals_version_positive", sql`${table.version} > 0`),
        index("training_goals_profile_idx").on(table.profileId, table.status, table.priority),
    ],
);

export type TrainingGoalRow = typeof trainingGoals.$inferSelect;

export const trainingInjuries = pgTable(
    "training_injuries",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        name: text("name").notNull(),
        bodyArea: text("body_area").notNull(),
        side: text("side"),
        severity: text("severity").notNull().default("moderate"),
        status: text("status").notNull().default("active"),
        onsetDate: date("onset_date").notNull(),
        resolvedDate: date("resolved_date"),
        notes: text("notes"),
        version: integer("version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check(
            "training_injuries_side_valid",
            sql`${table.side} IS NULL OR ${table.side} IN ('left', 'right', 'bilateral')`,
        ),
        check("training_injuries_severity_valid", sql`${table.severity} IN ('mild', 'moderate', 'severe')`),
        check("training_injuries_status_valid", sql`${table.status} IN ('active', 'recovering', 'resolved')`),
        check(
            "training_injuries_resolved_after_onset",
            sql`${table.resolvedDate} IS NULL OR ${table.resolvedDate} >= ${table.onsetDate}`,
        ),
        check(
            "training_injuries_resolved_pair",
            sql`(${table.status} = 'resolved') = (${table.resolvedDate} IS NOT NULL)`,
        ),
        check("training_injuries_version_positive", sql`${table.version} > 0`),
        index("training_injuries_profile_idx").on(table.profileId, table.status),
    ],
);

export const trainingInjuryMuscles = pgTable(
    "training_injury_muscles",
    {
        injuryId: uuid("injury_id")
            .notNull()
            .references(() => trainingInjuries.id, { onDelete: "cascade" }),
        muscleGroupId: uuid("muscle_group_id").notNull(),
    },
    table => [primaryKey({ columns: [table.injuryId, table.muscleGroupId] })],
);

export const trainingInjuryExercises = pgTable(
    "training_injury_exercises",
    {
        injuryId: uuid("injury_id")
            .notNull()
            .references(() => trainingInjuries.id, { onDelete: "cascade" }),
        exerciseId: uuid("exercise_id").notNull(),
    },
    table => [primaryKey({ columns: [table.injuryId, table.exerciseId] })],
);

export type TrainingInjuryRow = typeof trainingInjuries.$inferSelect;
export type TrainingInjuryMuscleRow = typeof trainingInjuryMuscles.$inferSelect;
export type TrainingInjuryExerciseRow = typeof trainingInjuryExercises.$inferSelect;
