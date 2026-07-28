import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Manual Health Data records: the canonical envelope for body weight, sleep,
 * resting heart rate, and daily readiness entered before provider sync exists.
 *
 * Simple values are promoted into queryable numeric columns while the full
 * discriminated body is kept as schema-versioned structured JSON (design 8.3).
 */
export const healthRecords = pgTable(
    "health_records",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        profileId: uuid("profile_id").notNull(),
        type: text("type").notNull(),
        source: text("source").notNull().default("manual"),
        effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
        timeZone: text("time_zone"),
        notes: text("notes"),
        // Promoted numeric fields: exactly the column matching `type` is non-null.
        massKg: numeric("mass_kg", { precision: 7, scale: 3 }),
        restingHeartRateBpm: integer("resting_heart_rate_bpm"),
        sleepStartAt: timestamp("sleep_start_at", { withTimezone: true }),
        sleepEndAt: timestamp("sleep_end_at", { withTimezone: true }),
        sleepDurationMinutes: integer("sleep_duration_minutes"),
        readinessScore: integer("readiness_score"),
        // Schema-versioned structured JSON body.
        dataSchemaVersion: integer("data_schema_version").notNull().default(1),
        data: jsonb("data").$type<Record<string, unknown>>().notNull(),
        version: integer("version").notNull().default(1),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check(
            "health_records_type_valid",
            sql`${table.type} IN ('body_weight', 'sleep', 'resting_heart_rate', 'daily_readiness')`,
        ),
        check("health_records_source_valid", sql`${table.source} IN ('manual')`),
        check("health_records_data_schema_version_positive", sql`${table.dataSchemaVersion} > 0`),
        check("health_records_version_positive", sql`${table.version} > 0`),
        check(
            "health_records_mass_valid",
            sql`${table.massKg} IS NULL OR (${table.massKg} > 0 AND ${table.massKg} <= 1000)`,
        ),
        check(
            "health_records_resting_heart_rate_valid",
            sql`${table.restingHeartRateBpm} IS NULL OR ${table.restingHeartRateBpm} BETWEEN 20 AND 250`,
        ),
        check(
            "health_records_sleep_duration_valid",
            sql`${table.sleepDurationMinutes} IS NULL OR (${table.sleepDurationMinutes} > 0 AND ${table.sleepDurationMinutes} <= 1440)`,
        ),
        check(
            "health_records_sleep_interval_valid",
            sql`(${table.sleepStartAt} IS NULL) = (${table.sleepEndAt} IS NULL)
                AND (${table.sleepEndAt} IS NULL OR ${table.sleepEndAt} > ${table.sleepStartAt})`,
        ),
        check("health_records_readiness_valid", sql`${table.readinessScore} IS NULL OR ${table.readinessScore} >= 0`),
        // Each type promotes exactly its own numeric field(s).
        check(
            "health_records_body_weight_promoted",
            sql`(${table.type} = 'body_weight') = (${table.massKg} IS NOT NULL)`,
        ),
        check(
            "health_records_resting_heart_rate_promoted",
            sql`(${table.type} = 'resting_heart_rate') = (${table.restingHeartRateBpm} IS NOT NULL)`,
        ),
        check("health_records_sleep_promoted", sql`(${table.type} = 'sleep') = (${table.sleepStartAt} IS NOT NULL)`),
        check(
            "health_records_daily_readiness_promoted",
            sql`(${table.type} = 'daily_readiness') = (${table.readinessScore} IS NOT NULL)`,
        ),
        // Time-window/type reads for the active profile, newest first.
        index("health_records_profile_type_effective_idx").on(
            table.profileId,
            table.type,
            table.effectiveAt,
            table.archivedAt,
        ),
    ],
);

export type HealthRecordRow = typeof healthRecords.$inferSelect;
