import { isNull, sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    check,
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
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("exercise_aliases_alias_valid", sql`length(btrim(${table.alias})) > 0`),
        check("exercise_aliases_normalized_valid", sql`length(btrim(${table.normalizedAlias})) > 0`),
        check("exercise_aliases_source_valid", sql`${table.source} IN ('seeded', 'user', 'redirect')`),
        uniqueIndex("exercise_aliases_normalized_unique").on(table.normalizedAlias),
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

export type MuscleGroupRow = typeof muscleGroups.$inferSelect;
export type EquipmentTypeRow = typeof equipmentTypes.$inferSelect;
export type MovementPatternRow = typeof movementPatterns.$inferSelect;
export type TrainingTagRow = typeof trainingTags.$inferSelect;
export type ExerciseRow = typeof exercises.$inferSelect;
export type ExerciseAliasRow = typeof exerciseAliases.$inferSelect;
export type ExerciseMuscleRow = typeof exerciseMuscles.$inferSelect;

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
