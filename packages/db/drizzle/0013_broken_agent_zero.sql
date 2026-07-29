CREATE TABLE "training_maxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"max_type" text NOT NULL,
	"custom_label" text,
	"value_kg" numeric(12, 3) NOT NULL,
	"entered_value" numeric(12, 3) NOT NULL,
	"entered_unit" text DEFAULT 'kg' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"note" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_maxes_type_valid" CHECK ("training_maxes"."max_type" IN ('estimated_1rm', 'training_max', 'custom')),
	CONSTRAINT "training_maxes_custom_label_pair" CHECK (("training_maxes"."max_type" = 'custom') = ("training_maxes"."custom_label" IS NOT NULL)),
	CONSTRAINT "training_maxes_custom_label_len" CHECK ("training_maxes"."custom_label" IS NULL OR length(btrim("training_maxes"."custom_label")) BETWEEN 1 AND 60),
	CONSTRAINT "training_maxes_value_positive" CHECK ("training_maxes"."value_kg" > 0),
	CONSTRAINT "training_maxes_entered_value_positive" CHECK ("training_maxes"."entered_value" > 0),
	CONSTRAINT "training_maxes_entered_unit_valid" CHECK ("training_maxes"."entered_unit" IN ('kg', 'lb')),
	CONSTRAINT "training_maxes_source_valid" CHECK ("training_maxes"."source" IN (
                'web', 'cli', 'agent', 'bulk_import', 'progression_rule', 'manual_correction', 'provider_sync'
            )),
	CONSTRAINT "training_maxes_interval_valid" CHECK ("training_maxes"."effective_to" IS NULL OR "training_maxes"."effective_to" > "training_maxes"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "training_maxes" ADD CONSTRAINT "training_maxes_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_maxes_single_open_unique" ON "training_maxes" USING btree ("profile_id","exercise_id","max_type",coalesce("custom_label", '')) WHERE "training_maxes"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "training_maxes_series_idx" ON "training_maxes" USING btree ("profile_id","exercise_id","max_type","effective_from");