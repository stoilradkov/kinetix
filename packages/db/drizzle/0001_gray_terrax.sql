CREATE TYPE "public"."revision_source" AS ENUM('user', 'agent', 'import', 'sync', 'system', 'restore');--> statement-breakpoint
CREATE TABLE "entity_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"source" "revision_source" NOT NULL,
	"actor_id" text,
	"reason" text,
	"summary" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "entity_revisions_entity_version_unique" ON "entity_revisions" USING btree ("entity_type","entity_id","version");--> statement-breakpoint
CREATE INDEX "entity_revisions_history_idx" ON "entity_revisions" USING btree ("entity_type","entity_id","version");--> statement-breakpoint
CREATE INDEX "entity_revisions_correlation_idx" ON "entity_revisions" USING btree ("correlation_id");