CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"response_status" integer,
	"response_snapshot" jsonb,
	"response_hash" text,
	"correlation_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_operation_valid" CHECK (length(btrim("idempotency_records"."operation")) BETWEEN 1 AND 120),
	CONSTRAINT "idempotency_records_key_valid" CHECK (length(btrim("idempotency_records"."idempotency_key")) BETWEEN 1 AND 255),
	CONSTRAINT "idempotency_records_request_hash_valid" CHECK ("idempotency_records"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_records_response_hash_valid" CHECK ("idempotency_records"."response_hash" IS NULL OR "idempotency_records"."response_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_records_correlation_valid" CHECK (length(btrim("idempotency_records"."correlation_id")) BETWEEN 1 AND 128),
	CONSTRAINT "idempotency_records_response_status_valid" CHECK ("idempotency_records"."response_status" IS NULL OR "idempotency_records"."response_status" BETWEEN 100 AND 599),
	CONSTRAINT "idempotency_records_state_valid" CHECK ((
                "idempotency_records"."status" = 'in_progress'
                AND "idempotency_records"."response_status" IS NULL
                AND "idempotency_records"."response_snapshot" IS NULL
                AND "idempotency_records"."response_hash" IS NULL
                AND "idempotency_records"."completed_at" IS NULL
            ) OR (
                "idempotency_records"."status" = 'completed'
                AND "idempotency_records"."response_status" IS NOT NULL
                AND "idempotency_records"."response_snapshot" IS NOT NULL
                AND "idempotency_records"."response_hash" IS NOT NULL
                AND "idempotency_records"."completed_at" IS NOT NULL
            ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_operation_key_unique" ON "idempotency_records" USING btree ("operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_records_correlation_idx" ON "idempotency_records" USING btree ("correlation_id");