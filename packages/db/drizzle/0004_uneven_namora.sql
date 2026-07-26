CREATE TYPE "public"."durable_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outbox_event_status" AS ENUM('pending', 'processing', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"status" "durable_job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"progress" jsonb,
	"error" jsonb,
	"idempotency_key" text,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_type_valid" CHECK (length(btrim("jobs"."type")) BETWEEN 1 AND 180),
	CONSTRAINT "jobs_version_positive" CHECK ("jobs"."version" > 0),
	CONSTRAINT "jobs_payload_fingerprint_valid" CHECK ("jobs"."payload_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "jobs_attempts_valid" CHECK ("jobs"."attempts" BETWEEN 0 AND "jobs"."max_attempts"),
	CONSTRAINT "jobs_max_attempts_valid" CHECK ("jobs"."max_attempts" BETWEEN 1 AND 100),
	CONSTRAINT "jobs_priority_valid" CHECK ("jobs"."priority" BETWEEN -1000 AND 1000),
	CONSTRAINT "jobs_correlation_valid" CHECK (length(btrim("jobs"."correlation_id")) BETWEEN 1 AND 128),
	CONSTRAINT "jobs_lease_state_valid" CHECK ((
                "jobs"."status" = 'running'
                AND "jobs"."lease_owner" IS NOT NULL
                AND "jobs"."lease_expires_at" IS NOT NULL
                AND "jobs"."heartbeat_at" IS NOT NULL
            ) OR (
                "jobs"."status" <> 'running'
                AND "jobs"."lease_owner" IS NULL
                AND "jobs"."lease_expires_at" IS NULL
                AND "jobs"."heartbeat_at" IS NULL
            )),
	CONSTRAINT "jobs_completion_state_valid" CHECK ((
                "jobs"."status" IN ('succeeded', 'failed')
                AND "jobs"."completed_at" IS NOT NULL
            ) OR (
                "jobs"."status" IN ('queued', 'running')
                AND "jobs"."completed_at" IS NULL
            ))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer NOT NULL,
	"aggregate_type" text,
	"aggregate_id" text,
	"aggregate_revision" integer,
	"payload" jsonb NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"status" "outbox_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"error" jsonb,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_name_valid" CHECK (length(btrim("outbox_events"."event_name")) BETWEEN 1 AND 180),
	CONSTRAINT "outbox_events_version_positive" CHECK ("outbox_events"."event_version" > 0),
	CONSTRAINT "outbox_events_aggregate_revision_positive" CHECK ("outbox_events"."aggregate_revision" IS NULL OR "outbox_events"."aggregate_revision" > 0),
	CONSTRAINT "outbox_events_payload_fingerprint_valid" CHECK ("outbox_events"."payload_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "outbox_events_attempts_valid" CHECK ("outbox_events"."attempts" BETWEEN 0 AND "outbox_events"."max_attempts"),
	CONSTRAINT "outbox_events_max_attempts_valid" CHECK ("outbox_events"."max_attempts" BETWEEN 1 AND 100),
	CONSTRAINT "outbox_events_correlation_valid" CHECK (length(btrim("outbox_events"."correlation_id")) BETWEEN 1 AND 128),
	CONSTRAINT "outbox_events_lease_state_valid" CHECK ((
                "outbox_events"."status" = 'processing'
                AND "outbox_events"."lease_owner" IS NOT NULL
                AND "outbox_events"."lease_expires_at" IS NOT NULL
                AND "outbox_events"."heartbeat_at" IS NOT NULL
            ) OR (
                "outbox_events"."status" <> 'processing'
                AND "outbox_events"."lease_owner" IS NULL
                AND "outbox_events"."lease_expires_at" IS NULL
                AND "outbox_events"."heartbeat_at" IS NULL
            )),
	CONSTRAINT "outbox_events_publish_state_valid" CHECK ((
                "outbox_events"."status" = 'published'
                AND "outbox_events"."published_at" IS NOT NULL
            ) OR (
                "outbox_events"."status" <> 'published'
                AND "outbox_events"."published_at" IS NULL
            ))
);
--> statement-breakpoint
CREATE TABLE "work_handler_receipts" (
	"kind" text NOT NULL,
	"item_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "work_handler_receipts_pk" PRIMARY KEY("kind","item_id","handler"),
	CONSTRAINT "work_handler_receipts_kind_valid" CHECK ("work_handler_receipts"."kind" IN ('job', 'event')),
	CONSTRAINT "work_handler_receipts_handler_valid" CHECK (length(btrim("work_handler_receipts"."handler")) BETWEEN 1 AND 180)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_type_idempotency_unique" ON "jobs" USING btree ("type","version","idempotency_key") WHERE "jobs"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","next_attempt_at","priority","created_at");--> statement-breakpoint
CREATE INDEX "jobs_lease_expiry_idx" ON "jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "jobs_correlation_idx" ON "jobs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "outbox_events_due_idx" ON "outbox_events" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_lease_expiry_idx" ON "outbox_events" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_correlation_idx" ON "outbox_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id","aggregate_revision");--> statement-breakpoint
CREATE INDEX "work_handler_receipts_item_idx" ON "work_handler_receipts" USING btree ("kind","item_id");