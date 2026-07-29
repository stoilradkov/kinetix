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

export type SessionPrescriptionRow = typeof sessionPrescriptions.$inferSelect;
export type PrescribedActivityRow = typeof prescribedActivities.$inferSelect;
export type PrescribedStrengthActivityRow = typeof prescribedStrengthActivities.$inferSelect;
export type PrescribedRunningActivityRow = typeof prescribedRunningActivities.$inferSelect;
export type PrescribedExerciseRow = typeof prescribedExercises.$inferSelect;
export type PrescribedSetGroupRow = typeof prescribedSetGroups.$inferSelect;
export type PrescribedSetGroupMemberRow = typeof prescribedSetGroupMembers.$inferSelect;
export type PrescribedSetRow = typeof prescribedSets.$inferSelect;
export type PrescribedRunStepRow = typeof prescribedRunSteps.$inferSelect;
