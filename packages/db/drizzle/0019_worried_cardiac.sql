CREATE TABLE "bulk_external_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"source_namespace" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_external_ids_entity_type_valid" CHECK ("bulk_external_ids"."entity_type" IN ('program', 'planned-session', 'program-block')),
	CONSTRAINT "bulk_external_ids_namespace_valid" CHECK (length(btrim("bulk_external_ids"."source_namespace")) BETWEEN 1 AND 120),
	CONSTRAINT "bulk_external_ids_value_valid" CHECK (length(btrim("bulk_external_ids"."external_id")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "bulk_dry_runs" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_dry_runs" ADD COLUMN "committed_program_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_external_ids_namespace_type_value_unique" ON "bulk_external_ids" USING btree ("source_namespace","entity_type","external_id");--> statement-breakpoint
CREATE INDEX "bulk_external_ids_entity_idx" ON "bulk_external_ids" USING btree ("entity_id");