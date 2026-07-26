import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const moduleInstanceStatus = pgEnum("module_instance_status", ["active", "disabled", "archived"]);
export const revisionSource = pgEnum("revision_source", ["user", "agent", "import", "sync", "system", "restore"]);
export const idempotencyStatus = pgEnum("idempotency_status", ["in_progress", "completed"]);

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

export const idempotencyRecords = pgTable(
    "idempotency_records",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        operation: text("operation").notNull(),
        key: text("idempotency_key").notNull(),
        requestHash: text("request_hash").notNull(),
        status: idempotencyStatus("status").notNull().default("in_progress"),
        responseStatus: integer("response_status"),
        responseSnapshot: jsonb("response_snapshot"),
        responseHash: text("response_hash"),
        correlationId: text("correlation_id").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("idempotency_records_operation_valid", sql`length(btrim(${table.operation})) BETWEEN 1 AND 120`),
        check("idempotency_records_key_valid", sql`length(btrim(${table.key})) BETWEEN 1 AND 255`),
        check("idempotency_records_request_hash_valid", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
        check(
            "idempotency_records_response_hash_valid",
            sql`${table.responseHash} IS NULL OR ${table.responseHash} ~ '^[0-9a-f]{64}$'`,
        ),
        check("idempotency_records_correlation_valid", sql`length(btrim(${table.correlationId})) BETWEEN 1 AND 128`),
        check(
            "idempotency_records_response_status_valid",
            sql`${table.responseStatus} IS NULL OR ${table.responseStatus} BETWEEN 100 AND 599`,
        ),
        check(
            "idempotency_records_state_valid",
            sql`(
                ${table.status} = 'in_progress'
                AND ${table.responseStatus} IS NULL
                AND ${table.responseSnapshot} IS NULL
                AND ${table.responseHash} IS NULL
                AND ${table.completedAt} IS NULL
            ) OR (
                ${table.status} = 'completed'
                AND ${table.responseStatus} IS NOT NULL
                AND ${table.responseSnapshot} IS NOT NULL
                AND ${table.responseHash} IS NOT NULL
                AND ${table.completedAt} IS NOT NULL
            )`,
        ),
        uniqueIndex("idempotency_records_operation_key_unique").on(table.operation, table.key),
        index("idempotency_records_expiry_idx").on(table.expiresAt),
        index("idempotency_records_correlation_idx").on(table.correlationId),
    ],
);

export type IdempotencyRecordRow = typeof idempotencyRecords.$inferSelect;
export type NewIdempotencyRecordRow = typeof idempotencyRecords.$inferInsert;
