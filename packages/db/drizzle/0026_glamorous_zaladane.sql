CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"source_namespace" text NOT NULL,
	"payload_id" text NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"checksum" text NOT NULL,
	"generated_by" text,
	"description" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"result_checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "import_batches_schema_version_valid" CHECK ("import_batches"."schema_version" = 1),
	CONSTRAINT "import_batches_state_valid" CHECK ("import_batches"."state" IN ('pending', 'committed', 'failed')),
	CONSTRAINT "import_batches_checksum_valid" CHECK ("import_batches"."checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batches_result_checksum_valid" CHECK ("import_batches"."result_checksum" IS NULL OR "import_batches"."result_checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batches_namespace_valid" CHECK (length(btrim("import_batches"."source_namespace")) BETWEEN 1 AND 120),
	CONSTRAINT "import_batches_payload_id_valid" CHECK (length(btrim("import_batches"."payload_id")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "bulk_external_ids" DROP CONSTRAINT "bulk_external_ids_entity_type_valid";--> statement-breakpoint
ALTER TABLE "bulk_external_ids" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_namespace_payload_unique" ON "import_batches" USING btree ("source_namespace","payload_id");--> statement-breakpoint
CREATE INDEX "import_batches_profile_idx" ON "import_batches" USING btree ("profile_id","created_at");--> statement-breakpoint
ALTER TABLE "bulk_external_ids" ADD CONSTRAINT "bulk_external_ids_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_external_ids_batch_idx" ON "bulk_external_ids" USING btree ("import_batch_id");--> statement-breakpoint
ALTER TABLE "bulk_external_ids" ADD CONSTRAINT "bulk_external_ids_entity_type_valid" CHECK ("bulk_external_ids"."entity_type" IN ('program', 'program-block', 'planned-session', 'planned-activity', 'planned-exercise', 'planned-set', 'training-session', 'session-activity', 'occurrence', 'set-group', 'performed-set', 'run-step', 'run-split', 'pain-record'));