CREATE TABLE "historical_import_reverts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commit_id" uuid NOT NULL,
	"dry_run_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"archived_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historical_import_reverts_state_valid" CHECK ("historical_import_reverts"."state" IN ('pending', 'running', 'succeeded', 'failed', 'blocked')),
	CONSTRAINT "historical_import_reverts_attempts_valid" CHECK ("historical_import_reverts"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "historical_import_reverts" ADD CONSTRAINT "historical_import_reverts_commit_id_historical_import_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."historical_import_commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_import_reverts" ADD CONSTRAINT "historical_import_reverts_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "historical_import_reverts_commit_unique" ON "historical_import_reverts" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "historical_import_reverts_profile_idx" ON "historical_import_reverts" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "historical_import_reverts_batch_idx" ON "historical_import_reverts" USING btree ("import_batch_id");