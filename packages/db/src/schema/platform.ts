import { sql } from "drizzle-orm";
import {
    check,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

export const moduleInstanceStatus = pgEnum("module_instance_status", ["active", "disabled", "archived"]);
export const revisionSource = pgEnum("revision_source", ["user", "agent", "import", "sync", "system", "restore"]);
export const idempotencyStatus = pgEnum("idempotency_status", ["in_progress", "completed"]);
export const durableJobStatus = pgEnum("durable_job_status", ["queued", "running", "succeeded", "failed"]);
export const outboxEventStatus = pgEnum("outbox_event_status", ["pending", "processing", "published", "failed"]);

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

export interface StoredWorkError {
    code: string;
    message: string;
    retryable: boolean;
    failedAt: string;
}

export interface StoredJobProgress {
    completed: number;
    total?: number;
    message?: string;
}

export const jobs = pgTable(
    "jobs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        type: text("type").notNull(),
        version: integer("version").notNull(),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
        payloadFingerprint: text("payload_fingerprint").notNull(),
        status: durableJobStatus("status").notNull().default("queued"),
        priority: integer("priority").notNull().default(0),
        attempts: integer("attempts").notNull().default(0),
        maxAttempts: integer("max_attempts").notNull().default(5),
        nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
        leaseOwner: text("lease_owner"),
        leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
        heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
        progress: jsonb("progress").$type<StoredJobProgress>(),
        error: jsonb("error").$type<StoredWorkError>(),
        idempotencyKey: text("idempotency_key"),
        correlationId: text("correlation_id").notNull(),
        causationId: text("causation_id"),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("jobs_type_valid", sql`length(btrim(${table.type})) BETWEEN 1 AND 180`),
        check("jobs_version_positive", sql`${table.version} > 0`),
        check("jobs_payload_fingerprint_valid", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`),
        check("jobs_attempts_valid", sql`${table.attempts} BETWEEN 0 AND ${table.maxAttempts}`),
        check("jobs_max_attempts_valid", sql`${table.maxAttempts} BETWEEN 1 AND 100`),
        check("jobs_priority_valid", sql`${table.priority} BETWEEN -1000 AND 1000`),
        check("jobs_correlation_valid", sql`length(btrim(${table.correlationId})) BETWEEN 1 AND 128`),
        check(
            "jobs_lease_state_valid",
            sql`(
                ${table.status} = 'running'
                AND ${table.leaseOwner} IS NOT NULL
                AND ${table.leaseExpiresAt} IS NOT NULL
                AND ${table.heartbeatAt} IS NOT NULL
            ) OR (
                ${table.status} <> 'running'
                AND ${table.leaseOwner} IS NULL
                AND ${table.leaseExpiresAt} IS NULL
                AND ${table.heartbeatAt} IS NULL
            )`,
        ),
        check(
            "jobs_completion_state_valid",
            sql`(
                ${table.status} IN ('succeeded', 'failed')
                AND ${table.completedAt} IS NOT NULL
            ) OR (
                ${table.status} IN ('queued', 'running')
                AND ${table.completedAt} IS NULL
            )`,
        ),
        uniqueIndex("jobs_type_idempotency_unique")
            .on(table.type, table.version, table.idempotencyKey)
            .where(sql`${table.idempotencyKey} IS NOT NULL`),
        index("jobs_due_idx").on(table.status, table.nextAttemptAt, table.priority, table.createdAt),
        index("jobs_lease_expiry_idx").on(table.status, table.leaseExpiresAt),
        index("jobs_correlation_idx").on(table.correlationId),
    ],
);

export type DurableJobRow = typeof jobs.$inferSelect;
export type NewDurableJobRow = typeof jobs.$inferInsert;

export const outboxEvents = pgTable(
    "outbox_events",
    {
        id: uuid("id").primaryKey(),
        eventName: text("event_name").notNull(),
        eventVersion: integer("event_version").notNull(),
        aggregateType: text("aggregate_type"),
        aggregateId: text("aggregate_id"),
        aggregateRevision: integer("aggregate_revision"),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
        payloadFingerprint: text("payload_fingerprint").notNull(),
        status: outboxEventStatus("status").notNull().default("pending"),
        attempts: integer("attempts").notNull().default(0),
        maxAttempts: integer("max_attempts").notNull().default(10),
        nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
        leaseOwner: text("lease_owner"),
        leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
        heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
        error: jsonb("error").$type<StoredWorkError>(),
        correlationId: text("correlation_id").notNull(),
        causationId: text("causation_id"),
        occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("outbox_events_name_valid", sql`length(btrim(${table.eventName})) BETWEEN 1 AND 180`),
        check("outbox_events_version_positive", sql`${table.eventVersion} > 0`),
        check(
            "outbox_events_aggregate_revision_positive",
            sql`${table.aggregateRevision} IS NULL OR ${table.aggregateRevision} > 0`,
        ),
        check("outbox_events_payload_fingerprint_valid", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`),
        check("outbox_events_attempts_valid", sql`${table.attempts} BETWEEN 0 AND ${table.maxAttempts}`),
        check("outbox_events_max_attempts_valid", sql`${table.maxAttempts} BETWEEN 1 AND 100`),
        check("outbox_events_correlation_valid", sql`length(btrim(${table.correlationId})) BETWEEN 1 AND 128`),
        check(
            "outbox_events_lease_state_valid",
            sql`(
                ${table.status} = 'processing'
                AND ${table.leaseOwner} IS NOT NULL
                AND ${table.leaseExpiresAt} IS NOT NULL
                AND ${table.heartbeatAt} IS NOT NULL
            ) OR (
                ${table.status} <> 'processing'
                AND ${table.leaseOwner} IS NULL
                AND ${table.leaseExpiresAt} IS NULL
                AND ${table.heartbeatAt} IS NULL
            )`,
        ),
        check(
            "outbox_events_publish_state_valid",
            sql`(
                ${table.status} = 'published'
                AND ${table.publishedAt} IS NOT NULL
            ) OR (
                ${table.status} <> 'published'
                AND ${table.publishedAt} IS NULL
            )`,
        ),
        index("outbox_events_due_idx").on(table.status, table.nextAttemptAt, table.createdAt),
        index("outbox_events_lease_expiry_idx").on(table.status, table.leaseExpiresAt),
        index("outbox_events_correlation_idx").on(table.correlationId),
        index("outbox_events_aggregate_idx").on(table.aggregateType, table.aggregateId, table.aggregateRevision),
    ],
);

export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type NewOutboxEventRow = typeof outboxEvents.$inferInsert;

export const workHandlerReceipts = pgTable(
    "work_handler_receipts",
    {
        kind: text("kind").notNull(),
        itemId: uuid("item_id").notNull(),
        handler: text("handler").notNull(),
        handledAt: timestamp("handled_at", { withTimezone: true }).notNull(),
    },
    table => [
        check("work_handler_receipts_kind_valid", sql`${table.kind} IN ('job', 'event')`),
        check("work_handler_receipts_handler_valid", sql`length(btrim(${table.handler})) BETWEEN 1 AND 180`),
        primaryKey({
            name: "work_handler_receipts_pk",
            columns: [table.kind, table.itemId, table.handler],
        }),
        index("work_handler_receipts_item_idx").on(table.kind, table.itemId),
    ],
);

export type WorkHandlerReceiptRow = typeof workHandlerReceipts.$inferSelect;
export type NewWorkHandlerReceiptRow = typeof workHandlerReceipts.$inferInsert;
