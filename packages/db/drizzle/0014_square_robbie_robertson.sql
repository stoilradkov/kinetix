CREATE TABLE "equipment_increments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"exercise_id" uuid,
	"equipment_type_id" uuid,
	"increment_kg" numeric(12, 3) NOT NULL,
	"minimum_kg" numeric(12, 3),
	"label" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_increments_scope_valid" CHECK ("equipment_increments"."scope" IN ('default', 'exercise', 'equipment')),
	CONSTRAINT "equipment_increments_increment_positive" CHECK ("equipment_increments"."increment_kg" > 0),
	CONSTRAINT "equipment_increments_minimum_nonnegative" CHECK ("equipment_increments"."minimum_kg" IS NULL OR "equipment_increments"."minimum_kg" >= 0),
	CONSTRAINT "equipment_increments_exercise_pair" CHECK (("equipment_increments"."scope" = 'exercise') = ("equipment_increments"."exercise_id" IS NOT NULL)),
	CONSTRAINT "equipment_increments_equipment_pair" CHECK (("equipment_increments"."scope" = 'equipment') = ("equipment_increments"."equipment_type_id" IS NOT NULL)),
	CONSTRAINT "equipment_increments_version_positive" CHECK ("equipment_increments"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "gear_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"gear_type" text NOT NULL,
	"acquired_on" date,
	"retired_on" date,
	"distance_limit_m" numeric(14, 3),
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gear_items_name_valid" CHECK (length(btrim("gear_items"."name")) > 0),
	CONSTRAINT "gear_items_type_valid" CHECK ("gear_items"."gear_type" IN ('shoes', 'equipment')),
	CONSTRAINT "gear_items_distance_limit_positive" CHECK ("gear_items"."distance_limit_m" IS NULL OR "gear_items"."distance_limit_m" > 0),
	CONSTRAINT "gear_items_retired_after_acquired" CHECK ("gear_items"."retired_on" IS NULL OR "gear_items"."acquired_on" IS NULL OR "gear_items"."retired_on" >= "gear_items"."acquired_on"),
	CONSTRAINT "gear_items_status_valid" CHECK ("gear_items"."status" IN ('active', 'archived')),
	CONSTRAINT "gear_items_archive_state_valid" CHECK (("gear_items"."status" = 'active' AND "gear_items"."archived_at" IS NULL)
                OR ("gear_items"."status" = 'archived' AND "gear_items"."archived_at" IS NOT NULL)),
	CONSTRAINT "gear_items_version_positive" CHECK ("gear_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "zone_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"family" text NOT NULL,
	"method" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"note" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zone_definitions_family_valid" CHECK ("zone_definitions"."family" IN ('heart_rate', 'pace', 'power')),
	CONSTRAINT "zone_definitions_method_valid" CHECK ("zone_definitions"."method" IN (
                'percent_max_hr', 'percent_hr_reserve', 'lactate_threshold',
                'percent_threshold_pace', 'percent_ftp', 'manual'
            )),
	CONSTRAINT "zone_definitions_source_valid" CHECK ("zone_definitions"."source" IN (
                'web', 'cli', 'agent', 'bulk_import', 'progression_rule', 'manual_correction', 'provider_sync'
            )),
	CONSTRAINT "zone_definitions_interval_valid" CHECK ("zone_definitions"."effective_to" IS NULL OR "zone_definitions"."effective_to" > "zone_definitions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "zone_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_definition_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"lower_bound" numeric(14, 4) NOT NULL,
	"upper_bound" numeric(14, 4),
	"lower_inclusive" boolean DEFAULT true NOT NULL,
	"upper_inclusive" boolean DEFAULT false NOT NULL,
	CONSTRAINT "zone_ranges_position_valid" CHECK ("zone_ranges"."position" >= 0),
	CONSTRAINT "zone_ranges_name_valid" CHECK (length(btrim("zone_ranges"."name")) > 0),
	CONSTRAINT "zone_ranges_lower_nonnegative" CHECK ("zone_ranges"."lower_bound" >= 0),
	CONSTRAINT "zone_ranges_bounds_ordered" CHECK ("zone_ranges"."upper_bound" IS NULL OR "zone_ranges"."upper_bound" > "zone_ranges"."lower_bound")
);
--> statement-breakpoint
ALTER TABLE "equipment_increments" ADD CONSTRAINT "equipment_increments_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_increments" ADD CONSTRAINT "equipment_increments_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_ranges" ADD CONSTRAINT "zone_ranges_zone_definition_id_zone_definitions_id_fk" FOREIGN KEY ("zone_definition_id") REFERENCES "public"."zone_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_increments_default_unique" ON "equipment_increments" USING btree ("profile_id") WHERE "equipment_increments"."scope" = 'default';--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_increments_exercise_unique" ON "equipment_increments" USING btree ("profile_id","exercise_id") WHERE "equipment_increments"."scope" = 'exercise';--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_increments_equipment_unique" ON "equipment_increments" USING btree ("profile_id","equipment_type_id") WHERE "equipment_increments"."scope" = 'equipment';--> statement-breakpoint
CREATE INDEX "equipment_increments_profile_idx" ON "equipment_increments" USING btree ("profile_id","scope");--> statement-breakpoint
CREATE INDEX "gear_items_profile_idx" ON "gear_items" USING btree ("profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "zone_definitions_single_open_unique" ON "zone_definitions" USING btree ("profile_id","family") WHERE "zone_definitions"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "zone_definitions_series_idx" ON "zone_definitions" USING btree ("profile_id","family","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "zone_ranges_position_unique" ON "zone_ranges" USING btree ("zone_definition_id","position");--> statement-breakpoint
CREATE INDEX "zone_ranges_definition_idx" ON "zone_ranges" USING btree ("zone_definition_id","position");