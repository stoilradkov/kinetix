CREATE TABLE "bulk_dry_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"source_namespace" text NOT NULL,
	"source_generated_by" text,
	"mode" text NOT NULL,
	"state" text NOT NULL,
	"reference_hash" text NOT NULL,
	"approval_token" text NOT NULL,
	"normalized_program" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_exercises" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bulk_dry_runs_schema_version_valid" CHECK ("bulk_dry_runs"."schema_version" = 1),
	CONSTRAINT "bulk_dry_runs_mode_valid" CHECK ("bulk_dry_runs"."mode" IN ('create', 'upsert')),
	CONSTRAINT "bulk_dry_runs_state_valid" CHECK ("bulk_dry_runs"."state" IN ('ready', 'needs_mapping')),
	CONSTRAINT "bulk_dry_runs_reference_hash_valid" CHECK ("bulk_dry_runs"."reference_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "bulk_dry_runs_namespace_valid" CHECK (length(btrim("bulk_dry_runs"."source_namespace")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX "bulk_dry_runs_profile_idx" ON "bulk_dry_runs" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "bulk_dry_runs_expires_idx" ON "bulk_dry_runs" USING btree ("expires_at");