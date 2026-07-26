import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const moduleInstanceStatus = pgEnum("module_instance_status", ["active", "disabled", "archived"]);
export const revisionSource = pgEnum("revision_source", ["user", "agent", "import", "sync", "system", "restore"]);

export const moduleInstances = pgTable(
    "module_instances",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        moduleType: text("module_type").notNull(),
        name: text("name").notNull(),
        slug: text("slug").notNull(),
        status: moduleInstanceStatus("status").notNull().default("active"),
        settings: jsonb("settings").notNull().default({}),
        version: integer("version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        uniqueIndex("module_instances_slug_unique").on(table.slug),
        index("module_instances_type_status_idx").on(table.moduleType, table.status),
    ],
);

export type ModuleInstanceRow = typeof moduleInstances.$inferSelect;
export type NewModuleInstanceRow = typeof moduleInstances.$inferInsert;

export const entityRevisions = pgTable(
    "entity_revisions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        entityType: text("entity_type").notNull(),
        entityId: uuid("entity_id").notNull(),
        version: integer("version").notNull(),
        schemaVersion: integer("schema_version").notNull(),
        snapshot: jsonb("snapshot").notNull(),
        source: revisionSource("source").notNull(),
        actorId: text("actor_id"),
        reason: text("reason"),
        summary: text("summary").notNull(),
        correlationId: text("correlation_id").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("entity_revisions_entity_type_nonempty", sql`length(btrim(${table.entityType})) > 0`),
        check("entity_revisions_version_positive", sql`${table.version} > 0`),
        check("entity_revisions_schema_version_positive", sql`${table.schemaVersion} > 0`),
        check(
            "entity_revisions_reason_valid",
            sql`${table.reason} IS NULL OR (length(btrim(${table.reason})) BETWEEN 1 AND 500)`,
        ),
        check("entity_revisions_summary_nonempty", sql`length(btrim(${table.summary})) > 0`),
        check("entity_revisions_correlation_nonempty", sql`length(btrim(${table.correlationId})) > 0`),
        uniqueIndex("entity_revisions_entity_version_unique").on(table.entityType, table.entityId, table.version),
        index("entity_revisions_history_idx").on(table.entityType, table.entityId, table.version.desc()),
        index("entity_revisions_correlation_idx").on(table.correlationId),
    ],
);

export type EntityRevisionRow = typeof entityRevisions.$inferSelect;
export type NewEntityRevisionRow = typeof entityRevisions.$inferInsert;
