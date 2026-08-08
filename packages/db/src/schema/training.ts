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

/**
 * Exercise training maxima as an append-only, effective-interval time series
 * (design 9.1). Changing a value closes the current open interval and inserts a
 * new record, so historical sessions keep the exact value in force at their time.
 */
export const trainingMaxes = pgTable(
    "training_maxes",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => exercises.id),
        maxType: text("max_type").notNull(),
        customLabel: text("custom_label"),
        valueKg: numeric("value_kg", { precision: 12, scale: 3 }).notNull(),
        enteredValue: numeric("entered_value", { precision: 12, scale: 3 }).notNull(),
        enteredUnit: text("entered_unit").notNull().default("kg"),
        source: text("source").notNull().default("web"),
        note: text("note"),
        effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
        effectiveTo: timestamp("effective_to", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("training_maxes_type_valid", sql`${table.maxType} IN ('estimated_1rm', 'training_max', 'custom')`),
        check(
            "training_maxes_custom_label_pair",
            sql`(${table.maxType} = 'custom') = (${table.customLabel} IS NOT NULL)`,
        ),
        check(
            "training_maxes_custom_label_len",
            sql`${table.customLabel} IS NULL OR length(btrim(${table.customLabel})) BETWEEN 1 AND 60`,
        ),
        check("training_maxes_value_positive", sql`${table.valueKg} > 0`),
        check("training_maxes_entered_value_positive", sql`${table.enteredValue} > 0`),
        check("training_maxes_entered_unit_valid", sql`${table.enteredUnit} IN ('kg', 'lb')`),
        check(
            "training_maxes_source_valid",
            sql`${table.source} IN (
                'web', 'cli', 'agent', 'bulk_import', 'progression_rule', 'manual_correction', 'provider_sync'
            )`,
        ),
        check(
            "training_maxes_interval_valid",
            sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
        ),
        uniqueIndex("training_maxes_single_open_unique")
            .on(table.profileId, table.exerciseId, table.maxType, sql`coalesce(${table.customLabel}, '')`)
            .where(isNull(table.effectiveTo)),
        index("training_maxes_series_idx").on(table.profileId, table.exerciseId, table.maxType, table.effectiveFrom),
    ],
);

export type TrainingMaxRow = typeof trainingMaxes.$inferSelect;

/**
 * Heart-rate/pace/power zone definitions as an append-only, effective-interval
 * series (design 9.1, PRD RN-5). Historical runs use the version valid at their
 * performance time. Ranges live in {@link zoneRanges}.
 */
export const zoneDefinitions = pgTable(
    "zone_definitions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        family: text("family").notNull(),
        method: text("method").notNull(),
        config: jsonb("config").$type<Record<string, number>>().notNull().default({}),
        source: text("source").notNull().default("web"),
        note: text("note"),
        effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
        effectiveTo: timestamp("effective_to", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("zone_definitions_family_valid", sql`${table.family} IN ('heart_rate', 'pace', 'power')`),
        check(
            "zone_definitions_method_valid",
            sql`${table.method} IN (
                'percent_max_hr', 'percent_hr_reserve', 'lactate_threshold',
                'percent_threshold_pace', 'percent_ftp', 'manual'
            )`,
        ),
        check(
            "zone_definitions_source_valid",
            sql`${table.source} IN (
                'web', 'cli', 'agent', 'bulk_import', 'progression_rule', 'manual_correction', 'provider_sync'
            )`,
        ),
        check(
            "zone_definitions_interval_valid",
            sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
        ),
        uniqueIndex("zone_definitions_single_open_unique")
            .on(table.profileId, table.family)
            .where(isNull(table.effectiveTo)),
        index("zone_definitions_series_idx").on(table.profileId, table.family, table.effectiveFrom),
    ],
);

export const zoneRanges = pgTable(
    "zone_ranges",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        zoneDefinitionId: uuid("zone_definition_id")
            .notNull()
            .references(() => zoneDefinitions.id, { onDelete: "cascade" }),
        position: integer("position").notNull(),
        name: text("name").notNull(),
        lowerBound: numeric("lower_bound", { precision: 14, scale: 4 }).notNull(),
        upperBound: numeric("upper_bound", { precision: 14, scale: 4 }),
        lowerInclusive: boolean("lower_inclusive").notNull().default(true),
        upperInclusive: boolean("upper_inclusive").notNull().default(false),
    },
    table => [
        check("zone_ranges_position_valid", sql`${table.position} >= 0`),
        check("zone_ranges_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("zone_ranges_lower_nonnegative", sql`${table.lowerBound} >= 0`),
        check(
            "zone_ranges_bounds_ordered",
            sql`${table.upperBound} IS NULL OR ${table.upperBound} > ${table.lowerBound}`,
        ),
        uniqueIndex("zone_ranges_position_unique").on(table.zoneDefinitionId, table.position),
        index("zone_ranges_definition_idx").on(table.zoneDefinitionId, table.position),
    ],
);

export type ZoneDefinitionRow = typeof zoneDefinitions.$inferSelect;
export type ZoneRangeRow = typeof zoneRanges.$inferSelect;

/**
 * Available load increments used for exercise-specific rounding of resolved
 * percentage loads (design 9.1, PRD PG-6). A versioned revision root; the most
 * specific scope (exercise > equipment > default) wins at resolution.
 */
export const equipmentIncrements = pgTable(
    "equipment_increments",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        scope: text("scope").notNull(),
        exerciseId: uuid("exercise_id").references(() => exercises.id),
        equipmentTypeId: uuid("equipment_type_id").references(() => equipmentTypes.id),
        incrementKg: numeric("increment_kg", { precision: 12, scale: 3 }).notNull(),
        minimumKg: numeric("minimum_kg", { precision: 12, scale: 3 }),
        label: text("label"),
        version: integer("version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("equipment_increments_scope_valid", sql`${table.scope} IN ('default', 'exercise', 'equipment')`),
        check("equipment_increments_increment_positive", sql`${table.incrementKg} > 0`),
        check("equipment_increments_minimum_nonnegative", sql`${table.minimumKg} IS NULL OR ${table.minimumKg} >= 0`),
        check(
            "equipment_increments_exercise_pair",
            sql`(${table.scope} = 'exercise') = (${table.exerciseId} IS NOT NULL)`,
        ),
        check(
            "equipment_increments_equipment_pair",
            sql`(${table.scope} = 'equipment') = (${table.equipmentTypeId} IS NOT NULL)`,
        ),
        check("equipment_increments_version_positive", sql`${table.version} > 0`),
        uniqueIndex("equipment_increments_default_unique")
            .on(table.profileId)
            .where(sql`${table.scope} = 'default'`),
        uniqueIndex("equipment_increments_exercise_unique")
            .on(table.profileId, table.exerciseId)
            .where(sql`${table.scope} = 'exercise'`),
        uniqueIndex("equipment_increments_equipment_unique")
            .on(table.profileId, table.equipmentTypeId)
            .where(sql`${table.scope} = 'equipment'`),
        index("equipment_increments_profile_idx").on(table.profileId, table.scope),
    ],
);

export type EquipmentIncrementRow = typeof equipmentIncrements.$inferSelect;

/**
 * User-owned shoes/equipment with acquisition/retirement, an optional distance
 * limit, and archive state (design 9.1, PRD RN-6). A versioned revision root.
 */
export const gearItems = pgTable(
    "gear_items",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        name: text("name").notNull(),
        gearType: text("gear_type").notNull(),
        acquiredOn: date("acquired_on"),
        retiredOn: date("retired_on"),
        distanceLimitM: numeric("distance_limit_m", { precision: 14, scale: 3 }),
        notes: text("notes"),
        status: text("status").notNull().default("active"),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        version: integer("version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("gear_items_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("gear_items_type_valid", sql`${table.gearType} IN ('shoes', 'equipment')`),
        check(
            "gear_items_distance_limit_positive",
            sql`${table.distanceLimitM} IS NULL OR ${table.distanceLimitM} > 0`,
        ),
        check(
            "gear_items_retired_after_acquired",
            sql`${table.retiredOn} IS NULL OR ${table.acquiredOn} IS NULL OR ${table.retiredOn} >= ${table.acquiredOn}`,
        ),
        check("gear_items_status_valid", sql`${table.status} IN ('active', 'archived')`),
        check(
            "gear_items_archive_state_valid",
            sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL)
                OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)`,
        ),
        check("gear_items_version_positive", sql`${table.version} > 0`),
        index("gear_items_profile_idx").on(table.profileId, table.status),
    ],
);

export type GearItemRow = typeof gearItems.$inferSelect;

/* --------------------------------------------------------------------------------------
 * Immutable prescription trees (design 10, ADR 0003).
 *
 * Templates and planned sessions each own a distinct, immutable SessionPrescription tree.
 * Published rows are never updated or deleted; an edit publishes a whole new tree. That
 * immutability is enforced at the database by per-table BEFORE UPDATE OR DELETE triggers
 * installed in the migration (0015) — Drizzle's schema DSL cannot express them, so the
 * migration hand-appends them and the persistence integration test guards them.
 *
 * `prescription_id` is denormalized onto every child so a bounded loader can fetch a
 * whole tree with one query per table. Intra-tree references travel by `logical_key` in
 * the domain and by row-ID foreign keys here.
 * ----------------------------------------------------------------------------------- */

export const sessionPrescriptions = pgTable(
    "session_prescriptions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        kind: text("kind").notNull(),
        schemaVersion: integer("schema_version").notNull().default(1),
        expectedDurationMs: bigint("expected_duration_ms", { mode: "number" }),
        notes: text("notes"),
        sourcePrescriptionId: uuid("source_prescription_id").references((): AnyPgColumn => sessionPrescriptions.id),
        sourceKind: text("source_kind"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("session_prescriptions_kind_valid", sql`${table.kind} IN ('template', 'planned', 'resolved_execution')`),
        check("session_prescriptions_schema_version_positive", sql`${table.schemaVersion} > 0`),
        check(
            "session_prescriptions_duration_nonneg",
            sql`${table.expectedDurationMs} IS NULL OR ${table.expectedDurationMs} >= 0`,
        ),
        check(
            "session_prescriptions_source_pair",
            sql`(${table.sourcePrescriptionId} IS NULL) = (${table.sourceKind} IS NULL)`,
        ),
        check(
            "session_prescriptions_source_kind_valid",
            sql`${table.sourceKind} IS NULL OR ${table.sourceKind} IN ('template', 'planned', 'resolved_execution')`,
        ),
        index("session_prescriptions_source_idx").on(table.sourcePrescriptionId),
    ],
);

/** Immutable lineage columns shared by every prescribed node. */
const prescriptionNodeColumns = () => ({
    id: uuid("id").defaultRandom().primaryKey(),
    prescriptionId: uuid("prescription_id")
        .notNull()
        .references(() => sessionPrescriptions.id),
    logicalKey: uuid("logical_key").notNull(),
    sourceLogicalKey: uuid("source_logical_key"),
    sourceRowId: uuid("source_row_id"),
});

/** Canonical structured target columns shared by sets, run steps, and run overalls (design 10.2). */
const targetColumns = () => ({
    repsMin: integer("reps_min"),
    repsMax: integer("reps_max"),
    loadKgMin: numeric("load_kg_min", { precision: 12, scale: 3 }),
    loadKgMax: numeric("load_kg_max", { precision: 12, scale: 3 }),
    durationMsMin: bigint("duration_ms_min", { mode: "number" }),
    durationMsMax: bigint("duration_ms_max", { mode: "number" }),
    distanceMMin: numeric("distance_m_min", { precision: 14, scale: 3 }),
    distanceMMax: numeric("distance_m_max", { precision: 14, scale: 3 }),
    speedMpsMin: numeric("speed_mps_min", { precision: 12, scale: 4 }),
    speedMpsMax: numeric("speed_mps_max", { precision: 12, scale: 4 }),
    powerWMin: numeric("power_w_min", { precision: 12, scale: 2 }),
    powerWMax: numeric("power_w_max", { precision: 12, scale: 2 }),
    rpeMin: numeric("rpe_min", { precision: 3, scale: 1 }),
    rpeMax: numeric("rpe_max", { precision: 3, scale: 1 }),
    rirMin: smallint("rir_min"),
    rirMax: smallint("rir_max"),
    hrBpmMin: integer("hr_bpm_min"),
    hrBpmMax: integer("hr_bpm_max"),
    percent1rm: numeric("percent_1rm", { precision: 8, scale: 5 }),
    percentTrainingMax: numeric("percent_training_max", { precision: 8, scale: 5 }),
    tempoEccentricMs: bigint("tempo_eccentric_ms", { mode: "number" }),
    tempoBottomPauseMs: bigint("tempo_bottom_pause_ms", { mode: "number" }),
    tempoConcentricMs: bigint("tempo_concentric_ms", { mode: "number" }),
    tempoTopPauseMs: bigint("tempo_top_pause_ms", { mode: "number" }),
    restMsMin: bigint("rest_ms_min", { mode: "number" }),
    restMsMax: bigint("rest_ms_max", { mode: "number" }),
    enteredTargets: jsonb("entered_targets").$type<Record<string, unknown>>().notNull().default({}),
});

/** min<=max range, non-negative, percentage bound, and single-load-mode checks (design 10.2). */
function targetRangeChecks(t: Record<string, AnyPgColumn>, prefix: string) {
    const col = (key: string): AnyPgColumn => {
        const column = t[key];
        if (!column) throw new Error(`Missing target column ${key}`);
        return column;
    };
    const pairs: Array<[string, AnyPgColumn, AnyPgColumn]> = [
        ["reps", col("repsMin"), col("repsMax")],
        ["load_kg", col("loadKgMin"), col("loadKgMax")],
        ["duration_ms", col("durationMsMin"), col("durationMsMax")],
        ["distance_m", col("distanceMMin"), col("distanceMMax")],
        ["speed_mps", col("speedMpsMin"), col("speedMpsMax")],
        ["power_w", col("powerWMin"), col("powerWMax")],
        ["rpe", col("rpeMin"), col("rpeMax")],
        ["rir", col("rirMin"), col("rirMax")],
        ["hr_bpm", col("hrBpmMin"), col("hrBpmMax")],
        ["rest_ms", col("restMsMin"), col("restMsMax")],
    ];
    const checks = pairs.flatMap(([name, min, max]) => [
        check(`${prefix}_${name}_range`, sql`${min} IS NULL OR ${max} IS NULL OR ${min} <= ${max}`),
        check(`${prefix}_${name}_min_nonneg`, sql`${min} IS NULL OR ${min} >= 0`),
        check(`${prefix}_${name}_max_nonneg`, sql`${max} IS NULL OR ${max} >= 0`),
    ]);
    const percent1rm = col("percent1rm");
    const percentTrainingMax = col("percentTrainingMax");
    const loadMin = col("loadKgMin");
    const loadMax = col("loadKgMax");
    checks.push(
        check(
            `${prefix}_percent_1rm_bound`,
            sql`${percent1rm} IS NULL OR (${percent1rm} >= 0 AND ${percent1rm} <= 100)`,
        ),
        check(
            `${prefix}_percent_tm_bound`,
            sql`${percentTrainingMax} IS NULL OR (${percentTrainingMax} >= 0 AND ${percentTrainingMax} <= 100)`,
        ),
        check(
            `${prefix}_tempo_nonneg`,
            sql`(${col("tempoEccentricMs")} IS NULL OR ${col("tempoEccentricMs")} >= 0)
                AND (${col("tempoBottomPauseMs")} IS NULL OR ${col("tempoBottomPauseMs")} >= 0)
                AND (${col("tempoConcentricMs")} IS NULL OR ${col("tempoConcentricMs")} >= 0)
                AND (${col("tempoTopPauseMs")} IS NULL OR ${col("tempoTopPauseMs")} >= 0)`,
        ),
        check(
            `${prefix}_load_mode`,
            sql`((CASE WHEN ${loadMin} IS NOT NULL OR ${loadMax} IS NOT NULL THEN 1 ELSE 0 END)
                + (CASE WHEN ${percent1rm} IS NOT NULL THEN 1 ELSE 0 END)
                + (CASE WHEN ${percentTrainingMax} IS NOT NULL THEN 1 ELSE 0 END)) <= 1`,
        ),
    );
    return checks;
}

export const prescribedActivities = pgTable(
    "prescribed_activities",
    {
        ...prescriptionNodeColumns(),
        type: text("type").notNull(),
        position: integer("position").notNull(),
        expectedDurationMs: bigint("expected_duration_ms", { mode: "number" }),
        rpeTarget: numeric("rpe_target", { precision: 3, scale: 1 }),
        notes: text("notes"),
    },
    table => [
        check("prescribed_activities_type_valid", sql`${table.type} IN ('strength', 'running')`),
        check("prescribed_activities_position_nonneg", sql`${table.position} >= 0`),
        check(
            "prescribed_activities_duration_nonneg",
            sql`${table.expectedDurationMs} IS NULL OR ${table.expectedDurationMs} >= 0`,
        ),
        uniqueIndex("prescribed_activities_position_unique").on(table.prescriptionId, table.position),
        uniqueIndex("prescribed_activities_logical_unique").on(table.prescriptionId, table.logicalKey),
        index("prescribed_activities_prescription_idx").on(table.prescriptionId),
    ],
);

export const prescribedStrengthActivities = pgTable(
    "prescribed_strength_activities",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        prescriptionId: uuid("prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        activityId: uuid("activity_id")
            .notNull()
            .references(() => prescribedActivities.id),
    },
    table => [
        uniqueIndex("prescribed_strength_activities_activity_unique").on(table.activityId),
        index("prescribed_strength_activities_prescription_idx").on(table.prescriptionId),
    ],
);

export const prescribedRunningActivities = pgTable(
    "prescribed_running_activities",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        prescriptionId: uuid("prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        activityId: uuid("activity_id")
            .notNull()
            .references(() => prescribedActivities.id),
        runTags: jsonb("run_tags").$type<string[]>().notNull().default([]),
        ...targetColumns(),
    },
    table => [
        uniqueIndex("prescribed_running_activities_activity_unique").on(table.activityId),
        index("prescribed_running_activities_prescription_idx").on(table.prescriptionId),
        ...targetRangeChecks(table, "prescribed_running_activities"),
    ],
);

export const prescribedExercises = pgTable(
    "prescribed_exercises",
    {
        ...prescriptionNodeColumns(),
        strengthActivityId: uuid("strength_activity_id")
            .notNull()
            .references(() => prescribedStrengthActivities.id),
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => exercises.id),
        exerciseSnapshot: jsonb("exercise_snapshot").notNull(),
        position: integer("position").notNull(),
        purpose: text("purpose"),
        substitutionPolicy: text("substitution_policy"),
    },
    table => [
        check("prescribed_exercises_position_nonneg", sql`${table.position} >= 0`),
        check(
            "prescribed_exercises_substitution_valid",
            sql`${table.substitutionPolicy} IS NULL OR ${table.substitutionPolicy} IN ('none', 'same_pattern', 'same_muscle', 'free')`,
        ),
        check("prescribed_exercises_snapshot_valid", sql`${table.exerciseSnapshot} ? 'schemaVersion'`),
        uniqueIndex("prescribed_exercises_position_unique").on(table.strengthActivityId, table.position),
        uniqueIndex("prescribed_exercises_logical_unique").on(table.prescriptionId, table.logicalKey),
        index("prescribed_exercises_prescription_idx").on(table.prescriptionId),
        index("prescribed_exercises_activity_idx").on(table.strengthActivityId),
    ],
);

export const prescribedSetGroups = pgTable(
    "prescribed_set_groups",
    {
        ...prescriptionNodeColumns(),
        strengthActivityId: uuid("strength_activity_id")
            .notNull()
            .references(() => prescribedStrengthActivities.id),
        parentGroupId: uuid("parent_group_id").references((): AnyPgColumn => prescribedSetGroups.id),
        type: text("type").notNull(),
        position: integer("position").notNull(),
        rounds: integer("rounds"),
        restMs: bigint("rest_ms", { mode: "number" }),
    },
    table => [
        check(
            "prescribed_set_groups_type_valid",
            sql`${table.type} IN ('straight', 'superset', 'circuit', 'drop', 'cluster', 'rest_pause')`,
        ),
        check("prescribed_set_groups_position_nonneg", sql`${table.position} >= 0`),
        check("prescribed_set_groups_rounds_positive", sql`${table.rounds} IS NULL OR ${table.rounds} >= 1`),
        check("prescribed_set_groups_rest_nonneg", sql`${table.restMs} IS NULL OR ${table.restMs} >= 0`),
        uniqueIndex("prescribed_set_groups_root_position_unique")
            .on(table.strengthActivityId, table.position)
            .where(isNull(table.parentGroupId)),
        uniqueIndex("prescribed_set_groups_child_position_unique")
            .on(table.parentGroupId, table.position)
            .where(isNotNull(table.parentGroupId)),
        uniqueIndex("prescribed_set_groups_logical_unique").on(table.prescriptionId, table.logicalKey),
        index("prescribed_set_groups_prescription_idx").on(table.prescriptionId),
        index("prescribed_set_groups_activity_idx").on(table.strengthActivityId),
    ],
);

export const prescribedSetGroupMembers = pgTable(
    "prescribed_set_group_members",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        prescriptionId: uuid("prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        setGroupId: uuid("set_group_id")
            .notNull()
            .references(() => prescribedSetGroups.id),
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => prescribedExercises.id),
        position: integer("position").notNull(),
    },
    table => [
        check("prescribed_set_group_members_position_nonneg", sql`${table.position} >= 0`),
        uniqueIndex("prescribed_set_group_members_position_unique").on(table.setGroupId, table.position),
        uniqueIndex("prescribed_set_group_members_exercise_unique").on(table.setGroupId, table.exerciseId),
        index("prescribed_set_group_members_prescription_idx").on(table.prescriptionId),
    ],
);

export const prescribedSets = pgTable(
    "prescribed_sets",
    {
        ...prescriptionNodeColumns(),
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => prescribedExercises.id),
        setGroupId: uuid("set_group_id").references(() => prescribedSetGroups.id),
        position: integer("position").notNull(),
        round: integer("round"),
        setType: text("set_type").notNull(),
        ...targetColumns(),
        notes: text("notes"),
    },
    table => [
        check(
            "prescribed_sets_type_valid",
            sql`${table.setType} IN (
                'warm_up', 'working', 'back_off', 'drop', 'failure_amrap',
                'superset_circuit', 'rest_pause', 'technique', 'cluster', 'other'
            )`,
        ),
        check("prescribed_sets_position_nonneg", sql`${table.position} >= 0`),
        check("prescribed_sets_round_positive", sql`${table.round} IS NULL OR ${table.round} >= 1`),
        uniqueIndex("prescribed_sets_position_unique").on(table.exerciseId, table.position),
        uniqueIndex("prescribed_sets_logical_unique").on(table.prescriptionId, table.logicalKey),
        index("prescribed_sets_prescription_idx").on(table.prescriptionId),
        index("prescribed_sets_group_idx").on(table.setGroupId),
        ...targetRangeChecks(table, "prescribed_sets"),
    ],
);

export const prescribedRunSteps = pgTable(
    "prescribed_run_steps",
    {
        ...prescriptionNodeColumns(),
        runningActivityId: uuid("running_activity_id")
            .notNull()
            .references(() => prescribedRunningActivities.id),
        parentStepId: uuid("parent_step_id").references((): AnyPgColumn => prescribedRunSteps.id),
        type: text("type").notNull(),
        position: integer("position").notNull(),
        repeatCount: integer("repeat_count"),
        ...targetColumns(),
        notes: text("notes"),
    },
    table => [
        check(
            "prescribed_run_steps_type_valid",
            sql`${table.type} IN ('warm_up', 'work', 'recovery', 'repeat', 'cool_down', 'open')`,
        ),
        check("prescribed_run_steps_position_nonneg", sql`${table.position} >= 0`),
        check("prescribed_run_steps_repeat_pair", sql`(${table.type} = 'repeat') = (${table.repeatCount} IS NOT NULL)`),
        check("prescribed_run_steps_repeat_positive", sql`${table.repeatCount} IS NULL OR ${table.repeatCount} >= 1`),
        uniqueIndex("prescribed_run_steps_root_position_unique")
            .on(table.runningActivityId, table.position)
            .where(isNull(table.parentStepId)),
        uniqueIndex("prescribed_run_steps_child_position_unique")
            .on(table.parentStepId, table.position)
            .where(isNotNull(table.parentStepId)),
        uniqueIndex("prescribed_run_steps_logical_unique").on(table.prescriptionId, table.logicalKey),
        index("prescribed_run_steps_prescription_idx").on(table.prescriptionId),
        index("prescribed_run_steps_activity_idx").on(table.runningActivityId),
        ...targetRangeChecks(table, "prescribed_run_steps"),
    ],
);

/* --------------------------------------------------------------------------------------
 * Workout templates (design 5.5, 10.3, PRD PR-4/TS-3).
 *
 * A WorkoutTemplate is a versioned, archivable revision root owning metadata plus a
 * pointer to its current immutable SessionPrescription tree. Editing a template publishes
 * a new prescription tree and advances the template version; the pointer swap mutates only
 * this row (never the immutable prescription rows). `workout_template_prescriptions`
 * preserves every published template prescription keyed by template version so history and
 * restore can rehydrate any past tree without dereferencing revision snapshots.
 * ----------------------------------------------------------------------------------- */

export const workoutTemplates = pgTable(
    "workout_templates",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        name: text("name").notNull(),
        description: text("description"),
        currentPrescriptionId: uuid("current_prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        status: text("status").notNull().default("active"),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        version: integer("version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("workout_templates_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("workout_templates_status_valid", sql`${table.status} IN ('active', 'archived')`),
        check(
            "workout_templates_archive_state_valid",
            sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL)
                OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)`,
        ),
        check("workout_templates_version_positive", sql`${table.version} > 0`),
        index("workout_templates_profile_idx").on(table.profileId, table.status),
    ],
);

/** Version→prescription link preserving every published template prescription. */
export const workoutTemplatePrescriptions = pgTable(
    "workout_template_prescriptions",
    {
        templateId: uuid("template_id")
            .notNull()
            .references(() => workoutTemplates.id, { onDelete: "cascade" }),
        templateVersion: integer("template_version").notNull(),
        prescriptionId: uuid("prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({
            name: "workout_template_prescriptions_pk",
            columns: [table.templateId, table.templateVersion],
        }),
        check("workout_template_prescriptions_version_positive", sql`${table.templateVersion} > 0`),
        index("workout_template_prescriptions_prescription_idx").on(table.prescriptionId),
    ],
);

/**
 * Program — editable, versioned, archivable root owning metadata and its nested block tree
 * (design 5.6, 10.3). Schedule mode selects relative/dated/ordered planning; dates and focus
 * are optional so a relative program can stay active without a calendar.
 */
export const programs = pgTable(
    "programs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        name: text("name").notNull(),
        description: text("description"),
        status: text("status").notNull().default("draft"),
        scheduleMode: text("schedule_mode").notNull().default("ordered"),
        startDate: date("start_date"),
        endDate: date("end_date"),
        focus: text("focus"),
        version: integer("version").notNull().default(1),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("programs_name_valid", sql`length(btrim(${table.name})) > 0`),
        check("programs_status_valid", sql`${table.status} IN ('draft', 'active', 'paused', 'completed', 'archived')`),
        check("programs_schedule_mode_valid", sql`${table.scheduleMode} IN ('relative', 'dated', 'ordered')`),
        check(
            "programs_date_range_valid",
            sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.startDate} <= ${table.endDate}`,
        ),
        check("programs_archive_state_valid", sql`(${table.status} = 'archived') = (${table.archivedAt} IS NOT NULL)`),
        check("programs_version_positive", sql`${table.version} > 0`),
        index("programs_profile_idx").on(table.profileId, table.status),
    ],
);

/**
 * Nested program block. Parent must belong to the same program; the tree stays acyclic and
 * sibling positions are unique. Overlapping date/relative ranges are allowed and surfaced as
 * warnings, not constraint failures (design 10.3).
 */
export const programBlocks = pgTable(
    "program_blocks",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        programId: uuid("program_id")
            .notNull()
            .references(() => programs.id, { onDelete: "cascade" }),
        parentBlockId: uuid("parent_block_id").references((): AnyPgColumn => programBlocks.id, {
            onDelete: "cascade",
        }),
        type: text("type").notNull(),
        label: text("label"),
        position: integer("position").notNull(),
        startDate: date("start_date"),
        endDate: date("end_date"),
        relativeStartWeek: integer("relative_start_week"),
        relativeEndWeek: integer("relative_end_week"),
        focus: text("focus"),
        targetMuscles: jsonb("target_muscles").$type<string[]>().notNull().default([]),
        targetVolume: text("target_volume"),
        targetIntensity: text("target_intensity"),
        deload: boolean("deload").notNull().default(false),
        expectedAdaptations: text("expected_adaptations"),
        notes: text("notes"),
        tags: jsonb("tags").$type<string[]>().notNull().default([]),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("program_blocks_type_valid", sql`${table.type} IN ('macrocycle', 'mesocycle', 'microcycle', 'custom')`),
        check("program_blocks_position_nonneg", sql`${table.position} >= 0`),
        check(
            "program_blocks_not_self_parent",
            sql`${table.parentBlockId} IS NULL OR ${table.parentBlockId} <> ${table.id}`,
        ),
        check(
            "program_blocks_date_range_valid",
            sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.startDate} <= ${table.endDate}`,
        ),
        check(
            "program_blocks_relative_range_valid",
            sql`${table.relativeStartWeek} IS NULL OR ${table.relativeEndWeek} IS NULL
                OR ${table.relativeStartWeek} <= ${table.relativeEndWeek}`,
        ),
        index("program_blocks_program_idx").on(table.programId),
        index("program_blocks_parent_idx").on(table.parentBlockId),
    ],
);

/** Program-to-training-goal link (design 10.3). */
export const programGoals = pgTable(
    "program_goals",
    {
        programId: uuid("program_id")
            .notNull()
            .references(() => programs.id, { onDelete: "cascade" }),
        goalId: uuid("goal_id")
            .notNull()
            .references(() => trainingGoals.id),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({ name: "program_goals_pk", columns: [table.programId, table.goalId] }),
        index("program_goals_goal_idx").on(table.goalId),
    ],
);

/**
 * PlannedSession — editable, versioned, archivable root owning schedule/lifecycle plus a pointer
 * to its current immutable prescription (design 5.7, 10.3). It is an independent aggregate so one
 * planned session can participate in several programs and blocks through the join tables below.
 */
export const plannedSessions = pgTable(
    "planned_sessions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        title: text("title"),
        status: text("status").notNull().default("planned"),
        localDate: date("local_date"),
        timeZone: text("time_zone"),
        preferredTime: text("preferred_time"),
        expectedDurationMinutes: integer("expected_duration_minutes"),
        notes: text("notes"),
        tags: jsonb("tags").$type<string[]>().notNull().default([]),
        skipReason: text("skip_reason"),
        skipNotes: text("skip_notes"),
        currentPrescriptionId: uuid("current_prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        sourceTemplateId: uuid("source_template_id").references(() => workoutTemplates.id),
        sourceTemplateVersion: integer("source_template_version"),
        version: integer("version").notNull().default(1),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check(
            "planned_sessions_status_valid",
            sql`${table.status} IN ('planned', 'completed', 'partially_completed', 'skipped', 'cancelled')`,
        ),
        check(
            "planned_sessions_skip_reason_valid",
            sql`${table.skipReason} IS NULL OR ${table.skipReason} IN
                ('illness', 'fatigue', 'pain', 'schedule', 'recovery', 'equipment_unavailable', 'other')`,
        ),
        check(
            "planned_sessions_duration_nonneg",
            sql`${table.expectedDurationMinutes} IS NULL OR ${table.expectedDurationMinutes} >= 0`,
        ),
        check(
            "planned_sessions_source_pair",
            sql`(${table.sourceTemplateId} IS NULL) = (${table.sourceTemplateVersion} IS NULL)`,
        ),
        check("planned_sessions_version_positive", sql`${table.version} > 0`),
        index("planned_sessions_profile_idx").on(table.profileId, table.status),
        index("planned_sessions_date_idx").on(table.localDate),
    ],
);

/** Version→prescription link preserving every published planned-session prescription (design 10.3). */
export const plannedSessionPrescriptions = pgTable(
    "planned_session_prescriptions",
    {
        plannedSessionId: uuid("planned_session_id")
            .notNull()
            .references(() => plannedSessions.id, { onDelete: "cascade" }),
        plannedSessionVersion: integer("planned_session_version").notNull(),
        prescriptionId: uuid("prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({
            name: "planned_session_prescriptions_pk",
            columns: [table.plannedSessionId, table.plannedSessionVersion],
        }),
        check("planned_session_prescriptions_version_positive", sql`${table.plannedSessionVersion} > 0`),
        index("planned_session_prescriptions_prescription_idx").on(table.prescriptionId),
    ],
);

/** Program-to-session membership with program-relative week/day/sequence (design 10.3). */
export const programPlannedSessions = pgTable(
    "program_planned_sessions",
    {
        programId: uuid("program_id")
            .notNull()
            .references(() => programs.id, { onDelete: "cascade" }),
        plannedSessionId: uuid("planned_session_id")
            .notNull()
            .references(() => plannedSessions.id, { onDelete: "cascade" }),
        relativeWeek: integer("relative_week"),
        relativeDay: integer("relative_day"),
        sequence: integer("sequence").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({ name: "program_planned_sessions_pk", columns: [table.programId, table.plannedSessionId] }),
        check("program_planned_sessions_sequence_nonneg", sql`${table.sequence} >= 0`),
        index("program_planned_sessions_session_idx").on(table.plannedSessionId),
    ],
);

/** Planned-session-to-block membership; supports overlapping/nested block scopes (design 10.3). */
export const plannedSessionBlocks = pgTable(
    "planned_session_blocks",
    {
        plannedSessionId: uuid("planned_session_id")
            .notNull()
            .references(() => plannedSessions.id, { onDelete: "cascade" }),
        blockId: uuid("block_id")
            .notNull()
            .references(() => programBlocks.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({ name: "planned_session_blocks_pk", columns: [table.plannedSessionId, table.blockId] }),
        index("planned_session_blocks_block_idx").on(table.blockId),
    ],
);

/**
 * TrainingSession — the versioned, archivable write/concurrency boundary for live and retrospective
 * workouts (design 5.8, 11.1, 11.6). It owns lifecycle state, local date + IANA time zone, optional
 * start/end instants, an explicit duration independent of activity totals, pre-workout readiness,
 * post-workout ratings, notes, and tags. Every child mutation bumps `version`. Soft deletion is a
 * separate `archived_at` flag so archiving never loses lifecycle state.
 */
export const trainingSessions = pgTable(
    "training_sessions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        status: text("status").notNull().default("draft"),
        title: text("title"),
        localDate: date("local_date").notNull(),
        timeZone: text("time_zone").notNull(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        endedAt: timestamp("ended_at", { withTimezone: true }),
        durationMinutes: integer("duration_minutes"),
        // Pre-workout readiness (1-5), missing values stay null (design 11.1, TS-5).
        readinessEnergy: smallint("readiness_energy"),
        readinessMotivation: smallint("readiness_motivation"),
        readinessFatigue: smallint("readiness_fatigue"),
        readinessSoreness: smallint("readiness_soreness"),
        readinessStress: smallint("readiness_stress"),
        readinessRecovery: smallint("readiness_recovery"),
        // Post-workout ratings (1-5) plus free-text notes (design 11.1, TS-5).
        postEnergy: smallint("post_energy"),
        postMotivation: smallint("post_motivation"),
        postEnjoyment: smallint("post_enjoyment"),
        postDifficulty: smallint("post_difficulty"),
        postFatigue: smallint("post_fatigue"),
        postNotes: text("post_notes"),
        notes: text("notes"),
        tags: jsonb("tags").$type<string[]>().notNull().default([]),
        // Nullable link to the originating planned session. The full planned/actual mapping tree
        // (design 11.4) is introduced by a later issue, so this is not a foreign key yet.
        sourcePlannedSessionId: uuid("source_planned_session_id"),
        version: integer("version").notNull().default(1),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("training_sessions_status_valid", sql`${table.status} IN ('draft', 'in_progress', 'completed')`),
        check("training_sessions_started_required", sql`${table.status} = 'draft' OR ${table.startedAt} IS NOT NULL`),
        check("training_sessions_ended_required", sql`${table.status} <> 'completed' OR ${table.endedAt} IS NOT NULL`),
        check(
            "training_sessions_end_after_start",
            sql`${table.endedAt} IS NULL OR (${table.startedAt} IS NOT NULL AND ${table.endedAt} >= ${table.startedAt})`,
        ),
        check(
            "training_sessions_duration_nonneg",
            sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} >= 0`,
        ),
        check(
            "training_sessions_readiness_range",
            sql`(${table.readinessEnergy} IS NULL OR ${table.readinessEnergy} BETWEEN 1 AND 5)
                AND (${table.readinessMotivation} IS NULL OR ${table.readinessMotivation} BETWEEN 1 AND 5)
                AND (${table.readinessFatigue} IS NULL OR ${table.readinessFatigue} BETWEEN 1 AND 5)
                AND (${table.readinessSoreness} IS NULL OR ${table.readinessSoreness} BETWEEN 1 AND 5)
                AND (${table.readinessStress} IS NULL OR ${table.readinessStress} BETWEEN 1 AND 5)
                AND (${table.readinessRecovery} IS NULL OR ${table.readinessRecovery} BETWEEN 1 AND 5)`,
        ),
        check(
            "training_sessions_post_range",
            sql`(${table.postEnergy} IS NULL OR ${table.postEnergy} BETWEEN 1 AND 5)
                AND (${table.postMotivation} IS NULL OR ${table.postMotivation} BETWEEN 1 AND 5)
                AND (${table.postEnjoyment} IS NULL OR ${table.postEnjoyment} BETWEEN 1 AND 5)
                AND (${table.postDifficulty} IS NULL OR ${table.postDifficulty} BETWEEN 1 AND 5)
                AND (${table.postFatigue} IS NULL OR ${table.postFatigue} BETWEEN 1 AND 5)`,
        ),
        check("training_sessions_version_positive", sql`${table.version} > 0`),
        index("training_sessions_profile_idx").on(table.profileId, table.status),
        index("training_sessions_date_idx").on(table.profileId, table.localDate),
        index("training_sessions_active_idx").on(table.profileId, table.archivedAt),
    ],
);

/**
 * Ordered typed activity placeholder within a session (design 11.1, TS-3). Strength/run detail is
 * layered on by later issues; this holds order, timing, effort, feeling, notes, and tags. Positions
 * are unique per session; the row cascades with its parent session.
 */
export const sessionActivities = pgTable(
    "session_activities",
    {
        id: uuid("id").primaryKey(),
        sessionId: uuid("session_id")
            .notNull()
            .references(() => trainingSessions.id, { onDelete: "cascade" }),
        type: text("type").notNull(),
        position: integer("position").notNull(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        endedAt: timestamp("ended_at", { withTimezone: true }),
        durationSeconds: integer("duration_seconds"),
        rpe: smallint("rpe"),
        feeling: text("feeling"),
        notes: text("notes"),
        tags: jsonb("tags").$type<string[]>().notNull().default([]),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("session_activities_type_valid", sql`${table.type} IN ('strength', 'running')`),
        check("session_activities_position_nonneg", sql`${table.position} >= 0`),
        check(
            "session_activities_end_after_start",
            sql`${table.endedAt} IS NULL OR (${table.startedAt} IS NOT NULL AND ${table.endedAt} >= ${table.startedAt})`,
        ),
        check(
            "session_activities_duration_nonneg",
            sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} >= 0`,
        ),
        check("session_activities_rpe_range", sql`${table.rpe} IS NULL OR ${table.rpe} BETWEEN 0 AND 10`),
        uniqueIndex("session_activities_position_unique").on(table.sessionId, table.position),
        index("session_activities_session_idx").on(table.sessionId),
    ],
);

/**
 * Pain/discomfort record for a session (design 11.1, TS-6). Optionally links to a session activity;
 * exercise/set links are plain nullable IDs because the actual occurrence/set tables arrive with
 * strength detail in a later issue.
 */
export const painRecords = pgTable(
    "pain_records",
    {
        id: uuid("id").primaryKey(),
        sessionId: uuid("session_id")
            .notNull()
            .references(() => trainingSessions.id, { onDelete: "cascade" }),
        activityId: uuid("activity_id").references(() => sessionActivities.id, { onDelete: "set null" }),
        exerciseOccurrenceId: uuid("exercise_occurrence_id"),
        performedSetId: uuid("performed_set_id"),
        bodyArea: text("body_area").notNull(),
        side: text("side").notNull(),
        severity: smallint("severity").notNull(),
        painType: text("pain_type"),
        onsetDuringSession: boolean("onset_during_session").notNull().default(false),
        stoppedActivity: boolean("stopped_activity").notNull().default(false),
        notes: text("notes"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("pain_records_body_area_valid", sql`length(btrim(${table.bodyArea})) BETWEEN 1 AND 120`),
        check("pain_records_side_valid", sql`${table.side} IN ('left', 'right', 'bilateral')`),
        check("pain_records_severity_range", sql`${table.severity} BETWEEN 0 AND 10`),
        index("pain_records_session_idx").on(table.sessionId),
        index("pain_records_activity_idx").on(table.activityId),
    ],
);

/**
 * A performed exercise instance within a strength activity (design 5.8, 11.2; PRD ST-1). It keeps an
 * immutable `exercise_snapshot` so historical analytics reproduce even after the catalog changes, plus
 * technique/discomfort/pump quality ratings. Positions are unique per activity; it cascades with its
 * parent activity/session.
 */
export const exerciseOccurrences = pgTable(
    "exercise_occurrences",
    {
        id: uuid("id").primaryKey(),
        activityId: uuid("activity_id")
            .notNull()
            .references(() => sessionActivities.id, { onDelete: "cascade" }),
        exerciseId: uuid("exercise_id")
            .notNull()
            .references(() => exercises.id),
        exerciseSnapshot: jsonb("exercise_snapshot").notNull(),
        position: integer("position").notNull(),
        purpose: text("purpose"),
        technique: smallint("technique"),
        discomfort: smallint("discomfort"),
        pump: smallint("pump"),
        notes: text("notes"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("exercise_occurrences_position_nonneg", sql`${table.position} >= 0`),
        check("exercise_occurrences_snapshot_valid", sql`${table.exerciseSnapshot} ? 'schemaVersion'`),
        check(
            "exercise_occurrences_quality_range",
            sql`(${table.technique} IS NULL OR ${table.technique} BETWEEN 1 AND 5)
                AND (${table.discomfort} IS NULL OR ${table.discomfort} BETWEEN 1 AND 5)
                AND (${table.pump} IS NULL OR ${table.pump} BETWEEN 1 AND 5)`,
        ),
        uniqueIndex("exercise_occurrences_position_unique").on(table.activityId, table.position),
        index("exercise_occurrences_activity_idx").on(table.activityId),
        index("exercise_occurrences_exercise_idx").on(table.exerciseId),
    ],
);

/**
 * Hierarchical set grouping within a strength activity (design 11.2; PRD ST-2). The optional
 * `parent_group_id` self-reference nests groups (e.g. a drop inside a superset); occurrence membership
 * is many-to-many through {@link setGroupMembers}. Positions are unique within their parent scope.
 */
export const setGroups = pgTable(
    "set_groups",
    {
        id: uuid("id").primaryKey(),
        activityId: uuid("activity_id")
            .notNull()
            .references(() => sessionActivities.id, { onDelete: "cascade" }),
        parentGroupId: uuid("parent_group_id").references((): AnyPgColumn => setGroups.id),
        type: text("type").notNull(),
        position: integer("position").notNull(),
        rounds: integer("rounds"),
        restMs: bigint("rest_ms", { mode: "number" }),
    },
    table => [
        check(
            "set_groups_type_valid",
            sql`${table.type} IN ('straight', 'superset', 'circuit', 'drop', 'cluster', 'rest_pause')`,
        ),
        check("set_groups_position_nonneg", sql`${table.position} >= 0`),
        check("set_groups_rounds_positive", sql`${table.rounds} IS NULL OR ${table.rounds} >= 1`),
        check("set_groups_rest_nonneg", sql`${table.restMs} IS NULL OR ${table.restMs} >= 0`),
        uniqueIndex("set_groups_root_position_unique")
            .on(table.activityId, table.position)
            .where(isNull(table.parentGroupId)),
        uniqueIndex("set_groups_child_position_unique")
            .on(table.parentGroupId, table.position)
            .where(isNotNull(table.parentGroupId)),
        index("set_groups_activity_idx").on(table.activityId),
    ],
);

/** Many-to-many membership of an exercise occurrence in a set group (design 11.2). */
export const setGroupMembers = pgTable(
    "set_group_members",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        setGroupId: uuid("set_group_id")
            .notNull()
            .references(() => setGroups.id, { onDelete: "cascade" }),
        occurrenceId: uuid("occurrence_id")
            .notNull()
            .references(() => exerciseOccurrences.id, { onDelete: "cascade" }),
        position: integer("position").notNull(),
    },
    table => [
        check("set_group_members_position_nonneg", sql`${table.position} >= 0`),
        uniqueIndex("set_group_members_position_unique").on(table.setGroupId, table.position),
        uniqueIndex("set_group_members_occurrence_unique").on(table.setGroupId, table.occurrenceId),
        index("set_group_members_occurrence_idx").on(table.occurrenceId),
    ],
);

/**
 * A single performed set (design 11.2; PRD ST-3–5). Canonical measurement columns support querying and
 * analytics; the original entered value/unit per field is preserved in `entered_measurements` for
 * display/provenance and never replaces the canonical columns. `null` stays distinct from a recorded
 * zero. Assistance is stored positive and only subtracted by a declared load model (design 7.4).
 */
export const performedSets = pgTable(
    "performed_sets",
    {
        id: uuid("id").primaryKey(),
        occurrenceId: uuid("occurrence_id")
            .notNull()
            .references(() => exerciseOccurrences.id, { onDelete: "cascade" }),
        setGroupId: uuid("set_group_id").references(() => setGroups.id, { onDelete: "set null" }),
        round: integer("round"),
        position: integer("position").notNull(),
        setType: text("set_type").notNull(),
        status: text("status").notNull(),
        reps: integer("reps"),
        externalLoadKg: numeric("external_load_kg", { precision: 12, scale: 3 }),
        bodyweightKg: numeric("bodyweight_kg", { precision: 12, scale: 3 }),
        addedLoadKg: numeric("added_load_kg", { precision: 12, scale: 3 }),
        assistanceLoadKg: numeric("assistance_load_kg", { precision: 12, scale: 3 }),
        effectiveLoadKg: numeric("effective_load_kg", { precision: 12, scale: 3 }),
        durationMs: bigint("duration_ms", { mode: "number" }),
        distanceM: numeric("distance_m", { precision: 14, scale: 3 }),
        powerW: numeric("power_w", { precision: 12, scale: 2 }),
        rpe: numeric("rpe", { precision: 3, scale: 1 }),
        rir: smallint("rir"),
        tempoEccentricMs: bigint("tempo_eccentric_ms", { mode: "number" }),
        tempoBottomPauseMs: bigint("tempo_bottom_pause_ms", { mode: "number" }),
        tempoConcentricMs: bigint("tempo_concentric_ms", { mode: "number" }),
        tempoTopPauseMs: bigint("tempo_top_pause_ms", { mode: "number" }),
        restBeforeMs: bigint("rest_before_ms", { mode: "number" }),
        restAfterMs: bigint("rest_after_ms", { mode: "number" }),
        failureReason: text("failure_reason"),
        technique: smallint("technique"),
        discomfort: smallint("discomfort"),
        pump: smallint("pump"),
        enteredMeasurements: jsonb("entered_measurements").$type<Record<string, unknown>>().notNull().default({}),
        notes: text("notes"),
    },
    table => [
        check(
            "performed_sets_type_valid",
            sql`${table.setType} IN (
                'warm_up', 'working', 'back_off', 'drop', 'failure_amrap',
                'superset_circuit', 'rest_pause', 'technique', 'cluster', 'other'
            )`,
        ),
        check("performed_sets_status_valid", sql`${table.status} IN ('completed', 'partial', 'skipped', 'added')`),
        check("performed_sets_position_nonneg", sql`${table.position} >= 0`),
        check("performed_sets_round_positive", sql`${table.round} IS NULL OR ${table.round} >= 1`),
        check("performed_sets_reps_nonneg", sql`${table.reps} IS NULL OR ${table.reps} >= 0`),
        check(
            "performed_sets_loads_nonneg",
            sql`(${table.externalLoadKg} IS NULL OR ${table.externalLoadKg} >= 0)
                AND (${table.bodyweightKg} IS NULL OR ${table.bodyweightKg} >= 0)
                AND (${table.addedLoadKg} IS NULL OR ${table.addedLoadKg} >= 0)
                AND (${table.assistanceLoadKg} IS NULL OR ${table.assistanceLoadKg} >= 0)
                AND (${table.effectiveLoadKg} IS NULL OR ${table.effectiveLoadKg} >= 0)
                AND (${table.distanceM} IS NULL OR ${table.distanceM} >= 0)
                AND (${table.powerW} IS NULL OR ${table.powerW} >= 0)`,
        ),
        check(
            "performed_sets_durations_nonneg",
            sql`(${table.durationMs} IS NULL OR ${table.durationMs} >= 0)
                AND (${table.tempoEccentricMs} IS NULL OR ${table.tempoEccentricMs} >= 0)
                AND (${table.tempoBottomPauseMs} IS NULL OR ${table.tempoBottomPauseMs} >= 0)
                AND (${table.tempoConcentricMs} IS NULL OR ${table.tempoConcentricMs} >= 0)
                AND (${table.tempoTopPauseMs} IS NULL OR ${table.tempoTopPauseMs} >= 0)
                AND (${table.restBeforeMs} IS NULL OR ${table.restBeforeMs} >= 0)
                AND (${table.restAfterMs} IS NULL OR ${table.restAfterMs} >= 0)`,
        ),
        check("performed_sets_rpe_range", sql`${table.rpe} IS NULL OR ${table.rpe} BETWEEN 1 AND 10`),
        check("performed_sets_rir_range", sql`${table.rir} IS NULL OR ${table.rir} BETWEEN 0 AND 10`),
        check(
            "performed_sets_quality_range",
            sql`(${table.technique} IS NULL OR ${table.technique} BETWEEN 1 AND 5)
                AND (${table.discomfort} IS NULL OR ${table.discomfort} BETWEEN 1 AND 5)
                AND (${table.pump} IS NULL OR ${table.pump} BETWEEN 1 AND 5)`,
        ),
        check(
            "performed_sets_failure_reason_valid",
            sql`${table.failureReason} IS NULL OR ${table.failureReason} IN (
                'muscular', 'technical', 'cardiovascular', 'pain', 'equipment', 'time', 'other'
            )`,
        ),
        uniqueIndex("performed_sets_position_unique").on(table.occurrenceId, table.position),
        index("performed_sets_occurrence_idx").on(table.occurrenceId),
        index("performed_sets_group_idx").on(table.setGroupId),
    ],
);

/* --------------------------------------------------------------------------------------
 * Running detail (design 11.3, PRD R1).
 *
 * One-to-one manual running summary attached to a `session_activities` row of type `running`
 * (parallel to `strength` detail living in `exercise_occurrences`/`performed_sets`). Frequently
 * queried metrics are promoted to canonical columns — distance in metres, moving/elapsed time in
 * milliseconds, heart rate/cadence, power in watts, elevation and biomechanics in metres, VO2max,
 * RPE — while the user's originally-entered `{value, unit}` per measurement is preserved in
 * `entered_measurements` so display units round-trip. Average pace is deliberately NOT a column: it
 * is derived from distance and moving time in the domain/query projection. Run-classification tags
 * and an optional versioned environment blob are stored as jsonb. Cascades with the activity.
 * ----------------------------------------------------------------------------------- */

export const runningActivities = pgTable(
    "running_activities",
    {
        activityId: uuid("activity_id")
            .primaryKey()
            .references(() => sessionActivities.id, { onDelete: "cascade" }),
        distanceM: numeric("distance_m", { precision: 14, scale: 3 }),
        movingTimeMs: bigint("moving_time_ms", { mode: "number" }),
        elapsedTimeMs: bigint("elapsed_time_ms", { mode: "number" }),
        averageHeartRateBpm: integer("average_heart_rate_bpm"),
        maxHeartRateBpm: integer("max_heart_rate_bpm"),
        averageCadenceRpm: integer("average_cadence_rpm"),
        maxCadenceRpm: integer("max_cadence_rpm"),
        averagePowerW: numeric("average_power_w", { precision: 12, scale: 2 }),
        maxPowerW: numeric("max_power_w", { precision: 12, scale: 2 }),
        elevationGainM: numeric("elevation_gain_m", { precision: 14, scale: 3 }),
        elevationLossM: numeric("elevation_loss_m", { precision: 14, scale: 3 }),
        calories: integer("calories"),
        strideLengthM: numeric("stride_length_m", { precision: 14, scale: 3 }),
        groundContactTimeMs: bigint("ground_contact_time_ms", { mode: "number" }),
        verticalOscillationM: numeric("vertical_oscillation_m", { precision: 14, scale: 3 }),
        vo2Max: numeric("vo2max", { precision: 6, scale: 2 }),
        rpe: numeric("rpe", { precision: 3, scale: 1 }),
        indoor: boolean("indoor").notNull().default(false),
        treadmill: boolean("treadmill").notNull().default(false),
        runTags: jsonb("run_tags").$type<string[]>().notNull().default([]),
        enteredMeasurements: jsonb("entered_measurements").$type<Record<string, unknown>>().notNull().default({}),
        environment: jsonb("environment").$type<Record<string, unknown>>(),
        // Optional shoes/equipment (design 11.3, PRD RN-6); resolved through the gear port at write time.
        gearItemId: uuid("gear_item_id").references(() => gearItems.id),
        // Optional route reference + bounded PostGIS-free geometry (design 11.3, PRD RN-4).
        route: jsonb("route").$type<Record<string, unknown>>(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("running_activities_route_valid", sql`${table.route} IS NULL OR ${table.route} ? 'schemaVersion'`),
        check(
            "running_activities_metrics_nonneg",
            sql`(${table.distanceM} IS NULL OR ${table.distanceM} >= 0)
                AND (${table.movingTimeMs} IS NULL OR ${table.movingTimeMs} >= 0)
                AND (${table.elapsedTimeMs} IS NULL OR ${table.elapsedTimeMs} >= 0)
                AND (${table.averagePowerW} IS NULL OR ${table.averagePowerW} >= 0)
                AND (${table.maxPowerW} IS NULL OR ${table.maxPowerW} >= 0)
                AND (${table.elevationGainM} IS NULL OR ${table.elevationGainM} >= 0)
                AND (${table.elevationLossM} IS NULL OR ${table.elevationLossM} >= 0)
                AND (${table.calories} IS NULL OR ${table.calories} >= 0)
                AND (${table.strideLengthM} IS NULL OR ${table.strideLengthM} >= 0)
                AND (${table.groundContactTimeMs} IS NULL OR ${table.groundContactTimeMs} >= 0)
                AND (${table.verticalOscillationM} IS NULL OR ${table.verticalOscillationM} >= 0)
                AND (${table.vo2Max} IS NULL OR ${table.vo2Max} >= 0)`,
        ),
        check(
            "running_activities_rates_range",
            sql`(${table.averageHeartRateBpm} IS NULL OR ${table.averageHeartRateBpm} BETWEEN 0 AND 999)
                AND (${table.maxHeartRateBpm} IS NULL OR ${table.maxHeartRateBpm} BETWEEN 0 AND 999)
                AND (${table.averageCadenceRpm} IS NULL OR ${table.averageCadenceRpm} BETWEEN 0 AND 999)
                AND (${table.maxCadenceRpm} IS NULL OR ${table.maxCadenceRpm} BETWEEN 0 AND 999)`,
        ),
        check("running_activities_rpe_range", sql`${table.rpe} IS NULL OR ${table.rpe} BETWEEN 1 AND 10`),
        // Moving time cannot exceed elapsed time — a run cannot move longer than it lasted.
        check(
            "running_activities_moving_le_elapsed",
            sql`${table.movingTimeMs} IS NULL OR ${table.elapsedTimeMs} IS NULL OR ${table.movingTimeMs} <= ${table.elapsedTimeMs}`,
        ),
        // A treadmill run is by definition indoor.
        check("running_activities_treadmill_indoor", sql`NOT ${table.treadmill} OR ${table.indoor}`),
        // Promoted columns exist to be queried: support distance-range and duration lookups.
        index("running_activities_distance_idx").on(table.distanceM),
        index("running_activities_moving_time_idx").on(table.movingTimeMs),
    ],
);

/* --------------------------------------------------------------------------------------
 * Structured running detail (design 11.3; PRD RN-3/4/5).
 *
 * Hierarchical performed run steps, arbitrary splits, and zone times hang off a running activity,
 * cascading with it. Canonical columns drive queries/analytics; the originally entered value/unit per
 * field is preserved in `entered_measurements` so display units round-trip. `performed_run_steps`
 * mirrors the prescribed run-step tree (self-referential parent, repeat/repeat-count pairing, partial
 * unique root/child positions). Zone times reference the effective versioned zone definition/range.
 * ----------------------------------------------------------------------------------- */

export const performedRunSteps = pgTable(
    "performed_run_steps",
    {
        id: uuid("id").primaryKey(),
        activityId: uuid("activity_id")
            .notNull()
            .references(() => sessionActivities.id, { onDelete: "cascade" }),
        parentStepId: uuid("parent_step_id").references((): AnyPgColumn => performedRunSteps.id),
        type: text("type").notNull(),
        position: integer("position").notNull(),
        repeatCount: integer("repeat_count"),
        distanceM: numeric("distance_m", { precision: 14, scale: 3 }),
        durationMs: bigint("duration_ms", { mode: "number" }),
        averageHeartRateBpm: integer("average_heart_rate_bpm"),
        maxHeartRateBpm: integer("max_heart_rate_bpm"),
        averageCadenceRpm: integer("average_cadence_rpm"),
        maxCadenceRpm: integer("max_cadence_rpm"),
        averagePowerW: numeric("average_power_w", { precision: 12, scale: 2 }),
        maxPowerW: numeric("max_power_w", { precision: 12, scale: 2 }),
        elevationGainM: numeric("elevation_gain_m", { precision: 14, scale: 3 }),
        elevationLossM: numeric("elevation_loss_m", { precision: 14, scale: 3 }),
        rpe: numeric("rpe", { precision: 3, scale: 1 }),
        enteredMeasurements: jsonb("entered_measurements").$type<Record<string, unknown>>().notNull().default({}),
        notes: text("notes"),
    },
    table => [
        check(
            "performed_run_steps_type_valid",
            sql`${table.type} IN ('warm_up', 'work', 'recovery', 'repeat', 'cool_down', 'open')`,
        ),
        check("performed_run_steps_position_nonneg", sql`${table.position} >= 0`),
        check("performed_run_steps_repeat_pair", sql`(${table.type} = 'repeat') = (${table.repeatCount} IS NOT NULL)`),
        check("performed_run_steps_repeat_positive", sql`${table.repeatCount} IS NULL OR ${table.repeatCount} >= 1`),
        check(
            "performed_run_steps_metrics_nonneg",
            sql`(${table.distanceM} IS NULL OR ${table.distanceM} >= 0)
                AND (${table.durationMs} IS NULL OR ${table.durationMs} >= 0)
                AND (${table.averagePowerW} IS NULL OR ${table.averagePowerW} >= 0)
                AND (${table.maxPowerW} IS NULL OR ${table.maxPowerW} >= 0)
                AND (${table.elevationGainM} IS NULL OR ${table.elevationGainM} >= 0)
                AND (${table.elevationLossM} IS NULL OR ${table.elevationLossM} >= 0)`,
        ),
        check(
            "performed_run_steps_rates_range",
            sql`(${table.averageHeartRateBpm} IS NULL OR ${table.averageHeartRateBpm} BETWEEN 0 AND 999)
                AND (${table.maxHeartRateBpm} IS NULL OR ${table.maxHeartRateBpm} BETWEEN 0 AND 999)
                AND (${table.averageCadenceRpm} IS NULL OR ${table.averageCadenceRpm} BETWEEN 0 AND 999)
                AND (${table.maxCadenceRpm} IS NULL OR ${table.maxCadenceRpm} BETWEEN 0 AND 999)`,
        ),
        check("performed_run_steps_rpe_range", sql`${table.rpe} IS NULL OR ${table.rpe} BETWEEN 1 AND 10`),
        uniqueIndex("performed_run_steps_root_position_unique")
            .on(table.activityId, table.position)
            .where(isNull(table.parentStepId)),
        uniqueIndex("performed_run_steps_child_position_unique")
            .on(table.parentStepId, table.position)
            .where(isNotNull(table.parentStepId)),
        index("performed_run_steps_activity_idx").on(table.activityId),
    ],
);

export const runSplits = pgTable(
    "run_splits",
    {
        id: uuid("id").primaryKey(),
        activityId: uuid("activity_id")
            .notNull()
            .references(() => sessionActivities.id, { onDelete: "cascade" }),
        position: integer("position").notNull(),
        distanceM: numeric("distance_m", { precision: 14, scale: 3 }),
        movingTimeMs: bigint("moving_time_ms", { mode: "number" }),
        elapsedTimeMs: bigint("elapsed_time_ms", { mode: "number" }),
        averageHeartRateBpm: integer("average_heart_rate_bpm"),
        maxHeartRateBpm: integer("max_heart_rate_bpm"),
        averageCadenceRpm: integer("average_cadence_rpm"),
        averagePowerW: numeric("average_power_w", { precision: 12, scale: 2 }),
        elevationGainM: numeric("elevation_gain_m", { precision: 14, scale: 3 }),
        elevationLossM: numeric("elevation_loss_m", { precision: 14, scale: 3 }),
        enteredMeasurements: jsonb("entered_measurements").$type<Record<string, unknown>>().notNull().default({}),
        notes: text("notes"),
    },
    table => [
        check("run_splits_position_nonneg", sql`${table.position} >= 0`),
        check(
            "run_splits_metrics_nonneg",
            sql`(${table.distanceM} IS NULL OR ${table.distanceM} >= 0)
                AND (${table.movingTimeMs} IS NULL OR ${table.movingTimeMs} >= 0)
                AND (${table.elapsedTimeMs} IS NULL OR ${table.elapsedTimeMs} >= 0)
                AND (${table.averagePowerW} IS NULL OR ${table.averagePowerW} >= 0)
                AND (${table.elevationGainM} IS NULL OR ${table.elevationGainM} >= 0)
                AND (${table.elevationLossM} IS NULL OR ${table.elevationLossM} >= 0)`,
        ),
        check(
            "run_splits_rates_range",
            sql`(${table.averageHeartRateBpm} IS NULL OR ${table.averageHeartRateBpm} BETWEEN 0 AND 999)
                AND (${table.maxHeartRateBpm} IS NULL OR ${table.maxHeartRateBpm} BETWEEN 0 AND 999)
                AND (${table.averageCadenceRpm} IS NULL OR ${table.averageCadenceRpm} BETWEEN 0 AND 999)`,
        ),
        check(
            "run_splits_moving_le_elapsed",
            sql`${table.movingTimeMs} IS NULL OR ${table.elapsedTimeMs} IS NULL OR ${table.movingTimeMs} <= ${table.elapsedTimeMs}`,
        ),
        uniqueIndex("run_splits_position_unique").on(table.activityId, table.position),
        index("run_splits_activity_idx").on(table.activityId),
    ],
);

export const runZoneTimes = pgTable(
    "run_zone_times",
    {
        id: uuid("id").primaryKey(),
        activityId: uuid("activity_id")
            .notNull()
            .references(() => sessionActivities.id, { onDelete: "cascade" }),
        position: integer("position").notNull(),
        family: text("family").notNull(),
        zoneDefinitionId: uuid("zone_definition_id").references(() => zoneDefinitions.id),
        zoneRangeId: uuid("zone_range_id").references(() => zoneRanges.id),
        zoneName: text("zone_name"),
        durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
        enteredMeasurements: jsonb("entered_measurements").$type<Record<string, unknown>>().notNull().default({}),
    },
    table => [
        check("run_zone_times_family_valid", sql`${table.family} IN ('heart_rate', 'pace', 'power')`),
        check("run_zone_times_position_nonneg", sql`${table.position} >= 0`),
        check("run_zone_times_duration_positive", sql`${table.durationMs} > 0`),
        uniqueIndex("run_zone_times_position_unique").on(table.activityId, table.position),
        index("run_zone_times_activity_idx").on(table.activityId),
        index("run_zone_times_definition_idx").on(table.zoneDefinitionId),
    ],
);

/* --------------------------------------------------------------------------------------
 * Planned/actual mappings (design 11.4, TS-4).
 *
 * FK-backed join tables connecting immutable prescribed rows to the actual rows performed in a
 * training session. `session_mappings` freezes the planned session plus the exact source and
 * resolved-execution prescription IDs used at start; the level tables connect prescribed
 * activities/exercises/sets/run-steps to their actual counterparts with an explicit relation and
 * reason. Join tables permit one-to-many (`split`) and many-to-one (`combined`); the application
 * validates that both sides belong to the mapped session/prescription trees. Everything cascades
 * with the owning training session.
 * ----------------------------------------------------------------------------------- */

const mappingRelationCheck = (column: AnyPgColumn, name: string) =>
    check(name, sql`${column} IN ('matched', 'substituted', 'added', 'partial', 'combined', 'split')`);

/** `added` performed work has no prescribed counterpart; every other relation must name one. */
const addedPrescribedPairCheck = (relation: AnyPgColumn, prescribed: AnyPgColumn, name: string) =>
    check(name, sql`(${prescribed} IS NULL) = (${relation} = 'added')`);

export const sessionMappings = pgTable(
    "session_mappings",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        sessionId: uuid("session_id")
            .notNull()
            .references(() => trainingSessions.id, { onDelete: "cascade" }),
        // Nullable: template/previous references freeze a prescription without a planned session.
        plannedSessionId: uuid("planned_session_id").references(() => plannedSessions.id, { onDelete: "cascade" }),
        sourcePrescriptionId: uuid("source_prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        resolvedPrescriptionId: uuid("resolved_prescription_id")
            .notNull()
            .references(() => sessionPrescriptions.id),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        uniqueIndex("session_mappings_session_planned_unique").on(table.sessionId, table.plannedSessionId),
        index("session_mappings_planned_idx").on(table.plannedSessionId),
        index("session_mappings_resolved_idx").on(table.resolvedPrescriptionId),
    ],
);

export const activityMappings = pgTable(
    "activity_mappings",
    {
        id: uuid("id").primaryKey(),
        sessionId: uuid("session_id")
            .notNull()
            .references(() => trainingSessions.id, { onDelete: "cascade" }),
        prescribedActivityId: uuid("prescribed_activity_id").references(() => prescribedActivities.id),
        actualActivityId: uuid("actual_activity_id")
            .notNull()
            .references(() => sessionActivities.id, { onDelete: "cascade" }),
        relation: text("relation").notNull(),
        reason: text("reason"),
        notes: text("notes"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        mappingRelationCheck(table.relation, "activity_mappings_relation_valid"),
        addedPrescribedPairCheck(table.relation, table.prescribedActivityId, "activity_mappings_added_pair"),
        index("activity_mappings_session_idx").on(table.sessionId),
        index("activity_mappings_prescribed_idx").on(table.prescribedActivityId),
        index("activity_mappings_actual_idx").on(table.actualActivityId),
    ],
);

export const exerciseOccurrenceMappings = pgTable(
    "exercise_occurrence_mappings",
    {
        id: uuid("id").primaryKey(),
        sessionId: uuid("session_id")
            .notNull()
            .references(() => trainingSessions.id, { onDelete: "cascade" }),
        prescribedExerciseId: uuid("prescribed_exercise_id").references(() => prescribedExercises.id),
        occurrenceId: uuid("occurrence_id")
            .notNull()
            .references(() => exerciseOccurrences.id, { onDelete: "cascade" }),
        relation: text("relation").notNull(),
        reason: text("reason"),
        notes: text("notes"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        mappingRelationCheck(table.relation, "exercise_occurrence_mappings_relation_valid"),
        addedPrescribedPairCheck(table.relation, table.prescribedExerciseId, "exercise_occurrence_mappings_added_pair"),
        index("exercise_occurrence_mappings_session_idx").on(table.sessionId),
        index("exercise_occurrence_mappings_prescribed_idx").on(table.prescribedExerciseId),
        index("exercise_occurrence_mappings_actual_idx").on(table.occurrenceId),
    ],
);

export const setMappings = pgTable(
    "set_mappings",
    {
        id: uuid("id").primaryKey(),
        sessionId: uuid("session_id")
            .notNull()
            .references(() => trainingSessions.id, { onDelete: "cascade" }),
        prescribedSetId: uuid("prescribed_set_id").references(() => prescribedSets.id),
        performedSetId: uuid("performed_set_id")
            .notNull()
            .references(() => performedSets.id, { onDelete: "cascade" }),
        relation: text("relation").notNull(),
        portion: numeric("portion", { precision: 5, scale: 4 }),
        reason: text("reason"),
        notes: text("notes"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        mappingRelationCheck(table.relation, "set_mappings_relation_valid"),
        addedPrescribedPairCheck(table.relation, table.prescribedSetId, "set_mappings_added_pair"),
        check(
            "set_mappings_portion_range",
            sql`${table.portion} IS NULL OR (${table.portion} > 0 AND ${table.portion} <= 1)`,
        ),
        index("set_mappings_session_idx").on(table.sessionId),
        index("set_mappings_prescribed_idx").on(table.prescribedSetId),
        index("set_mappings_actual_idx").on(table.performedSetId),
    ],
);

/**
 * Prescribed run step to performed run step. The performed side is a plain UUID (no FK) because
 * performed running detail arrives with the running slice; the prescribed side and relation rules are
 * enforced now so percentage/structure history is captured as soon as running actuals exist.
 */
export const runStepMappings = pgTable(
    "run_step_mappings",
    {
        id: uuid("id").primaryKey(),
        sessionId: uuid("session_id")
            .notNull()
            .references(() => trainingSessions.id, { onDelete: "cascade" }),
        prescribedRunStepId: uuid("prescribed_run_step_id").references(() => prescribedRunSteps.id),
        performedRunStepId: uuid("performed_run_step_id")
            .notNull()
            .references(() => performedRunSteps.id, { onDelete: "cascade" }),
        relation: text("relation").notNull(),
        reason: text("reason"),
        notes: text("notes"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        mappingRelationCheck(table.relation, "run_step_mappings_relation_valid"),
        addedPrescribedPairCheck(table.relation, table.prescribedRunStepId, "run_step_mappings_added_pair"),
        index("run_step_mappings_session_idx").on(table.sessionId),
        index("run_step_mappings_prescribed_idx").on(table.prescribedRunStepId),
    ],
);

export type TrainingSessionRow = typeof trainingSessions.$inferSelect;
export type SessionActivityRow = typeof sessionActivities.$inferSelect;
export type PainRecordRow = typeof painRecords.$inferSelect;
export type ExerciseOccurrenceRow = typeof exerciseOccurrences.$inferSelect;
export type SetGroupRow = typeof setGroups.$inferSelect;
export type SetGroupMemberRow = typeof setGroupMembers.$inferSelect;
export type PerformedSetRow = typeof performedSets.$inferSelect;
export type RunningActivityRow = typeof runningActivities.$inferSelect;
export type PerformedRunStepRow = typeof performedRunSteps.$inferSelect;
export type RunSplitRow = typeof runSplits.$inferSelect;
export type RunZoneTimeRow = typeof runZoneTimes.$inferSelect;
export type SessionMappingRow = typeof sessionMappings.$inferSelect;
export type ActivityMappingRow = typeof activityMappings.$inferSelect;
export type ExerciseOccurrenceMappingRow = typeof exerciseOccurrenceMappings.$inferSelect;
export type SetMappingRow = typeof setMappings.$inferSelect;
export type RunStepMappingRow = typeof runStepMappings.$inferSelect;

/**
 * Bulk dry-run preview artifacts (design 14.2/14.3; PRD BI-4). A dry-run stores the complete
 * normalized program tree, structured warnings/errors/mappings, the referenced-version fingerprint,
 * a short-lived approval token, source namespace, and an expiry. It is the ONLY thing a dry-run
 * writes; no program or catalog rows are touched. Commit (a later issue) locks this row, rechecks
 * the reference hash, and marks it consumed.
 */
export const bulkDryRuns = pgTable(
    "bulk_dry_runs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        schemaVersion: smallint("schema_version").notNull().default(1),
        sourceNamespace: text("source_namespace").notNull(),
        sourceGeneratedBy: text("source_generated_by"),
        mode: text("mode").notNull(),
        state: text("state").notNull(),
        referenceHash: text("reference_hash").notNull(),
        approvalToken: text("approval_token").notNull(),
        normalizedProgram: jsonb("normalized_program").$type<Record<string, unknown>>().notNull(),
        warnings: jsonb("warnings").$type<unknown[]>().notNull().default([]),
        errors: jsonb("errors").$type<unknown[]>().notNull().default([]),
        mappings: jsonb("mappings").$type<unknown[]>().notNull().default([]),
        proposedExercises: jsonb("proposed_exercises").$type<unknown[]>().notNull().default([]),
        affectedVersions: jsonb("affected_versions").$type<unknown[]>().notNull().default([]),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        // Set once, on the transaction that commits the approved tree (design 14.3 step 6). A
        // non-null value means the dry-run has been consumed and cannot be committed again.
        consumedAt: timestamp("consumed_at", { withTimezone: true }),
        committedProgramId: uuid("committed_program_id"),
    },
    table => [
        check("bulk_dry_runs_schema_version_valid", sql`${table.schemaVersion} = 1`),
        check("bulk_dry_runs_mode_valid", sql`${table.mode} IN ('create', 'upsert')`),
        check("bulk_dry_runs_state_valid", sql`${table.state} IN ('ready', 'needs_mapping')`),
        check("bulk_dry_runs_reference_hash_valid", sql`${table.referenceHash} ~ '^[0-9a-f]{64}$'`),
        check("bulk_dry_runs_namespace_valid", sql`length(btrim(${table.sourceNamespace})) BETWEEN 1 AND 120`),
        index("bulk_dry_runs_profile_idx").on(table.profileId, table.createdAt),
        index("bulk_dry_runs_expires_idx").on(table.expiresAt),
    ],
);

export type BulkDryRunRow = typeof bulkDryRuns.$inferSelect;

/**
 * Durable import-batch identity and ownership for a submitted historical archive (design §14.4–14.5;
 * issue #56, HI2). A batch pins one already-normalized payload — keyed by `(source_namespace,
 * payload_id)` and its canonical `checksum` — to a lifecycle (`pending → committed | failed`), so a
 * retried import resolves to the same batch and every committed entity (below) is traceable to it. Only
 * bounded opaque source references are stored: `payload_id`, `checksum`, `generated_by`, and free-text
 * `description`; no source workbook or parsing policy is persisted.
 */
export const importBatches = pgTable(
    "import_batches",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        sourceNamespace: text("source_namespace").notNull(),
        payloadId: text("payload_id").notNull(),
        schemaVersion: smallint("schema_version").notNull().default(1),
        checksum: text("checksum").notNull(),
        generatedBy: text("generated_by"),
        description: text("description"),
        state: text("state").notNull().default("pending"),
        resultChecksum: text("result_checksum"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        committedAt: timestamp("committed_at", { withTimezone: true }),
    },
    table => [
        check("import_batches_schema_version_valid", sql`${table.schemaVersion} = 1`),
        check("import_batches_state_valid", sql`${table.state} IN ('pending', 'committed', 'failed')`),
        check("import_batches_checksum_valid", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
        check(
            "import_batches_result_checksum_valid",
            sql`${table.resultChecksum} IS NULL OR ${table.resultChecksum} ~ '^[0-9a-f]{64}$'`,
        ),
        check("import_batches_namespace_valid", sql`length(btrim(${table.sourceNamespace})) BETWEEN 1 AND 120`),
        check("import_batches_payload_id_valid", sql`length(btrim(${table.payloadId})) BETWEEN 1 AND 200`),
        // Payload identity is unique per namespace: re-registering the same (namespace, payload_id)
        // resolves to this row; reusing it with different content is rejected as a conflict upstream.
        uniqueIndex("import_batches_namespace_payload_unique").on(table.sourceNamespace, table.payloadId),
        index("import_batches_profile_idx").on(table.profileId, table.createdAt),
    ],
);

export type ImportBatchRow = typeof importBatches.$inferSelect;

/**
 * Namespaced registry mapping a caller's stable external ID to the authoritative Training entity it
 * addresses (design 14.1/14.3, §14.4). Unique per `(source_namespace, entity_type, external_id)`, so a
 * repeated bulk/historical import cannot silently create a duplicate entity and a later upsert can
 * resolve the existing target. `entity_id` is not a foreign key: it spans several aggregate tables.
 * `import_batch_id` links an entry to the batch that created it (nullable — the single-program bulk
 * commit registers without a batch), so every imported entity is traceable to a batch and external ID.
 */
export const bulkExternalIds = pgTable(
    "bulk_external_ids",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "cascade" }),
        sourceNamespace: text("source_namespace").notNull(),
        entityType: text("entity_type").notNull(),
        externalId: text("external_id").notNull(),
        entityId: uuid("entity_id").notNull(),
        // The normalized content fingerprint recorded at import (issue #57, HI3; design §12.3). A later
        // import recomputes this over the incoming entity and compares: an equal value is a genuine
        // `skip-identical`, so a full replay of the same payload is a deterministic no-op. Nullable —
        // entries registered before fingerprints were captured are treated as "content unknown".
        contentFingerprint: text("content_fingerprint"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check(
            "bulk_external_ids_entity_type_valid",
            sql`${table.entityType} IN ('program', 'program-block', 'planned-session', 'planned-activity', 'planned-exercise', 'planned-set', 'training-session', 'session-activity', 'occurrence', 'set-group', 'performed-set', 'run-step', 'run-split', 'pain-record')`,
        ),
        check("bulk_external_ids_namespace_valid", sql`length(btrim(${table.sourceNamespace})) BETWEEN 1 AND 120`),
        check("bulk_external_ids_value_valid", sql`length(btrim(${table.externalId})) BETWEEN 1 AND 200`),
        check(
            "bulk_external_ids_content_fingerprint_valid",
            sql`${table.contentFingerprint} IS NULL OR ${table.contentFingerprint} ~ '^[0-9a-f]{64}$'`,
        ),
        uniqueIndex("bulk_external_ids_namespace_type_value_unique").on(
            table.sourceNamespace,
            table.entityType,
            table.externalId,
        ),
        index("bulk_external_ids_entity_idx").on(table.entityId),
        index("bulk_external_ids_batch_idx").on(table.importBatchId),
    ],
);

export type BulkExternalIdRow = typeof bulkExternalIds.$inferSelect;

/**
 * The expiring preview artifact for an already-normalized historical import (issue #58, HI4; design
 * §14.2). Where {@link bulkDryRuns} previews one program, this previews a whole archive: many normalized
 * program trees (`programs`) together with completed-session trees (`completed_sessions`) plus the
 * deterministic `storage_plan` (#57) a later commit will execute unchanged. Nothing authoritative is
 * written when the artifact is stored; `approval_token` + `reference_hash` guard a follow-up commit, and
 * `consumed_at` (set only on that future commit) makes double-commit impossible. Rows expire at
 * `expires_at`.
 */
export const historicalImportDryRuns = pgTable(
    "historical_import_dry_runs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        schemaVersion: smallint("schema_version").notNull().default(1),
        sourceNamespace: text("source_namespace").notNull(),
        sourceGeneratedBy: text("source_generated_by"),
        payloadId: text("payload_id").notNull(),
        checksum: text("checksum").notNull(),
        mode: text("mode").notNull(),
        state: text("state").notNull(),
        referenceHash: text("reference_hash").notNull(),
        approvalToken: text("approval_token").notNull(),
        programs: jsonb("programs").$type<unknown[]>().notNull().default([]),
        completedSessions: jsonb("completed_sessions").$type<unknown[]>().notNull().default([]),
        storagePlan: jsonb("storage_plan").$type<Record<string, unknown>>().notNull(),
        summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
        warnings: jsonb("warnings").$type<unknown[]>().notNull().default([]),
        errors: jsonb("errors").$type<unknown[]>().notNull().default([]),
        mappings: jsonb("mappings").$type<unknown[]>().notNull().default([]),
        proposedExercises: jsonb("proposed_exercises").$type<unknown[]>().notNull().default([]),
        affectedVersions: jsonb("affected_versions").$type<unknown[]>().notNull().default([]),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        // Set once, on a future commit transaction (HI5). A non-null value means the dry-run was consumed.
        consumedAt: timestamp("consumed_at", { withTimezone: true }),
    },
    table => [
        check("historical_import_dry_runs_schema_version_valid", sql`${table.schemaVersion} = 1`),
        check("historical_import_dry_runs_mode_valid", sql`${table.mode} IN ('create', 'upsert')`),
        check("historical_import_dry_runs_state_valid", sql`${table.state} IN ('ready', 'needs_mapping')`),
        check("historical_import_dry_runs_reference_hash_valid", sql`${table.referenceHash} ~ '^[0-9a-f]{64}$'`),
        check("historical_import_dry_runs_checksum_valid", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
        check(
            "historical_import_dry_runs_namespace_valid",
            sql`length(btrim(${table.sourceNamespace})) BETWEEN 1 AND 120`,
        ),
        check("historical_import_dry_runs_payload_id_valid", sql`length(btrim(${table.payloadId})) BETWEEN 1 AND 200`),
        index("historical_import_dry_runs_profile_idx").on(table.profileId, table.createdAt),
        index("historical_import_dry_runs_expires_idx").on(table.expiresAt),
    ],
);

export type HistoricalImportDryRunRow = typeof historicalImportDryRuns.$inferSelect;

/**
 * The durable historical-import commit run (issue #59, HI5; design §14.7). Keyed uniquely by
 * `dry_run_id` — a dry-run commits into exactly one run — it records identity, the resolved import
 * batch, lifecycle state, the ordered checkpoint of committed aggregate batch keys, attempts, and a
 * path-anchored failure. The checkpoint is written in the same transaction as each aggregate batch, so a
 * crashed commit resumes from exactly the batches that durably committed and never re-applies one.
 */
export const historicalImportCommits = pgTable(
    "historical_import_commits",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        dryRunId: uuid("dry_run_id")
            .notNull()
            .references(() => historicalImportDryRuns.id, { onDelete: "cascade" }),
        profileId: uuid("profile_id").notNull(),
        importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
        sourceNamespace: text("source_namespace").notNull(),
        sourceGeneratedBy: text("source_generated_by"),
        mode: text("mode").notNull(),
        idempotencyKey: text("idempotency_key"),
        state: text("state").notNull().default("pending"),
        committedBatchKeys: jsonb("committed_batch_keys").$type<string[]>().notNull().default([]),
        attempts: integer("attempts").notNull().default(0),
        failure: jsonb("failure").$type<Record<string, unknown>>(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("historical_import_commits_mode_valid", sql`${table.mode} IN ('create', 'upsert')`),
        check(
            "historical_import_commits_state_valid",
            sql`${table.state} IN ('pending', 'running', 'succeeded', 'failed')`,
        ),
        check("historical_import_commits_attempts_valid", sql`${table.attempts} >= 0`),
        uniqueIndex("historical_import_commits_dry_run_unique").on(table.dryRunId),
        index("historical_import_commits_profile_idx").on(table.profileId, table.createdAt),
        index("historical_import_commits_batch_idx").on(table.importBatchId),
    ],
);

export type HistoricalImportCommitRow = typeof historicalImportCommits.$inferSelect;

export type WorkoutTemplateRow = typeof workoutTemplates.$inferSelect;
export type WorkoutTemplatePrescriptionRow = typeof workoutTemplatePrescriptions.$inferSelect;
export type ProgramRow = typeof programs.$inferSelect;
export type ProgramBlockRow = typeof programBlocks.$inferSelect;
export type ProgramGoalRow = typeof programGoals.$inferSelect;
export type PlannedSessionRow = typeof plannedSessions.$inferSelect;
export type PlannedSessionPrescriptionRow = typeof plannedSessionPrescriptions.$inferSelect;
export type ProgramPlannedSessionRow = typeof programPlannedSessions.$inferSelect;
export type PlannedSessionBlockRow = typeof plannedSessionBlocks.$inferSelect;

export type SessionPrescriptionRow = typeof sessionPrescriptions.$inferSelect;
export type PrescribedActivityRow = typeof prescribedActivities.$inferSelect;
export type PrescribedStrengthActivityRow = typeof prescribedStrengthActivities.$inferSelect;
export type PrescribedRunningActivityRow = typeof prescribedRunningActivities.$inferSelect;
export type PrescribedExerciseRow = typeof prescribedExercises.$inferSelect;
export type PrescribedSetGroupRow = typeof prescribedSetGroups.$inferSelect;
export type PrescribedSetGroupMemberRow = typeof prescribedSetGroupMembers.$inferSelect;
export type PrescribedSetRow = typeof prescribedSets.$inferSelect;
export type PrescribedRunStepRow = typeof prescribedRunSteps.$inferSelect;
