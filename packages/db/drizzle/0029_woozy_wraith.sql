CREATE TABLE "historical_import_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dry_run_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"source_namespace" text NOT NULL,
	"source_generated_by" text,
	"mode" text NOT NULL,
	"idempotency_key" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"committed_batch_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historical_import_commits_mode_valid" CHECK ("historical_import_commits"."mode" IN ('create', 'upsert')),
	CONSTRAINT "historical_import_commits_state_valid" CHECK ("historical_import_commits"."state" IN ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "historical_import_commits_attempts_valid" CHECK ("historical_import_commits"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "historical_import_commits" ADD CONSTRAINT "historical_import_commits_dry_run_id_historical_import_dry_runs_id_fk" FOREIGN KEY ("dry_run_id") REFERENCES "public"."historical_import_dry_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_import_commits" ADD CONSTRAINT "historical_import_commits_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "historical_import_commits_dry_run_unique" ON "historical_import_commits" USING btree ("dry_run_id");--> statement-breakpoint
CREATE INDEX "historical_import_commits_profile_idx" ON "historical_import_commits" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "historical_import_commits_batch_idx" ON "historical_import_commits" USING btree ("import_batch_id");