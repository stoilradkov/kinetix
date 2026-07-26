CREATE TABLE "equipment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analytics_mapping_status" text DEFAULT 'unmapped' NOT NULL,
	CONSTRAINT "equipment_types_slug_valid" CHECK ("equipment_types"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "equipment_types_name_valid" CHECK (length(btrim("equipment_types"."name")) > 0),
	CONSTRAINT "equipment_types_position_valid" CHECK ("equipment_types"."position" >= 0),
	CONSTRAINT "equipment_types_mapping_status_valid" CHECK ("equipment_types"."analytics_mapping_status" IN ('standard', 'unmapped'))
);
--> statement-breakpoint
CREATE TABLE "exercise_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_aliases_alias_valid" CHECK (length(btrim("exercise_aliases"."alias")) > 0),
	CONSTRAINT "exercise_aliases_normalized_valid" CHECK (length(btrim("exercise_aliases"."normalized_alias")) > 0),
	CONSTRAINT "exercise_aliases_source_valid" CHECK ("exercise_aliases"."source" IN ('seeded', 'user', 'redirect'))
);
--> statement-breakpoint
CREATE TABLE "exercise_muscles" (
	"exercise_id" uuid NOT NULL,
	"muscle_group_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "exercise_muscles_pk" PRIMARY KEY("exercise_id","muscle_group_id"),
	CONSTRAINT "exercise_muscles_role_valid" CHECK ("exercise_muscles"."role" IN ('primary', 'secondary'))
);
--> statement-breakpoint
CREATE TABLE "exercise_tags" (
	"exercise_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "exercise_tags_pk" PRIMARY KEY("exercise_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"equipment_type_id" uuid NOT NULL,
	"movement_pattern_id" uuid NOT NULL,
	"classification" text NOT NULL,
	"laterality" text NOT NULL,
	"body_position" text NOT NULL,
	"repetition_semantics" text NOT NULL,
	"load_model" text NOT NULL,
	"supported_measurements" jsonb NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_slug_valid" CHECK ("exercises"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "exercises_name_valid" CHECK (length(btrim("exercises"."name")) > 0),
	CONSTRAINT "exercises_status_valid" CHECK ("exercises"."status" IN ('active', 'archived')),
	CONSTRAINT "exercises_classification_valid" CHECK ("exercises"."classification" IN ('compound', 'isolation')),
	CONSTRAINT "exercises_laterality_valid" CHECK ("exercises"."laterality" IN ('bilateral', 'unilateral')),
	CONSTRAINT "exercises_body_position_valid" CHECK (length(btrim("exercises"."body_position")) > 0),
	CONSTRAINT "exercises_repetition_semantics_valid" CHECK ("exercises"."repetition_semantics" IN ('total', 'per_side', 'alternating')),
	CONSTRAINT "exercises_load_model_valid" CHECK ("exercises"."load_model" IN (
                'external_only',
                'full_bodyweight_plus_added_minus_assistance',
                'manual_effective_load',
                'none'
            )),
	CONSTRAINT "exercises_version_positive" CHECK ("exercises"."version" > 0),
	CONSTRAINT "exercises_position_valid" CHECK ("exercises"."position" >= 0),
	CONSTRAINT "exercises_archive_state_valid" CHECK (("exercises"."status" = 'active' AND "exercises"."archived_at" IS NULL)
                OR ("exercises"."status" = 'archived' AND "exercises"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "movement_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analytics_mapping_status" text DEFAULT 'unmapped' NOT NULL,
	CONSTRAINT "movement_patterns_slug_valid" CHECK ("movement_patterns"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "movement_patterns_name_valid" CHECK (length(btrim("movement_patterns"."name")) > 0),
	CONSTRAINT "movement_patterns_position_valid" CHECK ("movement_patterns"."position" >= 0),
	CONSTRAINT "movement_patterns_mapping_status_valid" CHECK ("movement_patterns"."analytics_mapping_status" IN ('standard', 'unmapped'))
);
--> statement-breakpoint
CREATE TABLE "muscle_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "muscle_groups_slug_valid" CHECK ("muscle_groups"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "muscle_groups_name_valid" CHECK (length(btrim("muscle_groups"."name")) > 0),
	CONSTRAINT "muscle_groups_position_valid" CHECK ("muscle_groups"."position" >= 0),
	CONSTRAINT "muscle_groups_system_controlled" CHECK ("muscle_groups"."is_seeded")
);
--> statement-breakpoint
CREATE TABLE "training_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	CONSTRAINT "training_tags_slug_valid" CHECK ("training_tags"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "training_tags_name_valid" CHECK (length(btrim("training_tags"."name")) > 0),
	CONSTRAINT "training_tags_normalized_name_valid" CHECK ("training_tags"."normalized_name" = lower(btrim("training_tags"."name"))),
	CONSTRAINT "training_tags_position_valid" CHECK ("training_tags"."position" >= 0),
	CONSTRAINT "training_tags_category_valid" CHECK ("training_tags"."category" IN ('run_classification', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "exercise_aliases" ADD CONSTRAINT "exercise_aliases_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_muscle_group_id_muscle_groups_id_fk" FOREIGN KEY ("muscle_group_id") REFERENCES "public"."muscle_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_tags" ADD CONSTRAINT "exercise_tags_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_tags" ADD CONSTRAINT "exercise_tags_tag_id_training_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."training_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_movement_pattern_id_movement_patterns_id_fk" FOREIGN KEY ("movement_pattern_id") REFERENCES "public"."movement_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_types_slug_unique" ON "equipment_types" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_types_normalized_name_unique" ON "equipment_types" USING btree (lower(btrim("name"))) WHERE "equipment_types"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "equipment_types_active_order_idx" ON "equipment_types" USING btree ("archived_at","position","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_aliases_normalized_unique" ON "exercise_aliases" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "exercise_aliases_exercise_idx" ON "exercise_aliases" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercise_muscles_muscle_role_idx" ON "exercise_muscles" USING btree ("muscle_group_id","role");--> statement-breakpoint
CREATE INDEX "exercise_tags_tag_idx" ON "exercise_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_slug_unique" ON "exercises" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "exercises_active_order_idx" ON "exercises" USING btree ("status","position","slug");--> statement-breakpoint
CREATE INDEX "exercises_equipment_idx" ON "exercises" USING btree ("equipment_type_id","status");--> statement-breakpoint
CREATE INDEX "exercises_movement_idx" ON "exercises" USING btree ("movement_pattern_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "movement_patterns_slug_unique" ON "movement_patterns" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "movement_patterns_normalized_name_unique" ON "movement_patterns" USING btree (lower(btrim("name"))) WHERE "movement_patterns"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "movement_patterns_active_order_idx" ON "movement_patterns" USING btree ("archived_at","position","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "muscle_groups_slug_unique" ON "muscle_groups" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "muscle_groups_normalized_name_unique" ON "muscle_groups" USING btree (lower(btrim("name"))) WHERE "muscle_groups"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "muscle_groups_active_order_idx" ON "muscle_groups" USING btree ("archived_at","position","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "training_tags_slug_unique" ON "training_tags" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "training_tags_normalized_name_unique" ON "training_tags" USING btree ("normalized_name") WHERE "training_tags"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "training_tags_active_order_idx" ON "training_tags" USING btree ("archived_at","position","slug");
