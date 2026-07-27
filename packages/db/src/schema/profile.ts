import { sql } from "drizzle-orm";
import { check, date, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export interface ProfileUnitPreferences {
    readonly mass: string;
    readonly distance: string;
    readonly length: string;
}

/** The single active core profile used by the MVP (see design section 8.2). */
export const profiles = pgTable(
    "profiles",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        status: text("status").notNull().default("active"),
        birthDate: date("birth_date"),
        sex: text("sex"),
        heightM: numeric("height_m", { precision: 6, scale: 3 }),
        timeZone: text("time_zone").notNull(),
        unitPreferences: jsonb("unit_preferences").$type<ProfileUnitPreferences>().notNull(),
        version: integer("version").notNull().default(1),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("profiles_status_valid", sql`${table.status} IN ('active', 'archived')`),
        check(
            "profiles_sex_valid",
            sql`${table.sex} IS NULL OR ${table.sex} IN ('female', 'male', 'intersex', 'other')`,
        ),
        check(
            "profiles_height_valid",
            sql`${table.heightM} IS NULL OR (${table.heightM} > 0 AND ${table.heightM} <= 3)`,
        ),
        check("profiles_time_zone_valid", sql`length(btrim(${table.timeZone})) > 0`),
        check("profiles_version_positive", sql`${table.version} > 0`),
        check(
            "profiles_archive_state_valid",
            sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL)
                OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)`,
        ),
        // At most one active profile: all active rows collide on the same status key.
        uniqueIndex("profiles_single_active_unique")
            .on(table.status)
            .where(sql`${table.status} = 'active'`),
    ],
);

export type ProfileRow = typeof profiles.$inferSelect;
