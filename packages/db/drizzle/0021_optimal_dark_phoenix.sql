CREATE TABLE "exercise_occurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"activity_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"exercise_snapshot" jsonb NOT NULL,
	"position" integer NOT NULL,
	"purpose" text,
	"technique" smallint,
	"discomfort" smallint,
	"pump" smallint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_occurrences_position_nonneg" CHECK ("exercise_occurrences"."position" >= 0),
	CONSTRAINT "exercise_occurrences_snapshot_valid" CHECK ("exercise_occurrences"."exercise_snapshot" ? 'schemaVersion'),
	CONSTRAINT "exercise_occurrences_quality_range" CHECK (("exercise_occurrences"."technique" IS NULL OR "exercise_occurrences"."technique" BETWEEN 1 AND 5)
                AND ("exercise_occurrences"."discomfort" IS NULL OR "exercise_occurrences"."discomfort" BETWEEN 1 AND 5)
                AND ("exercise_occurrences"."pump" IS NULL OR "exercise_occurrences"."pump" BETWEEN 1 AND 5))
);
--> statement-breakpoint
CREATE TABLE "performed_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"set_group_id" uuid,
	"round" integer,
	"position" integer NOT NULL,
	"set_type" text NOT NULL,
	"status" text NOT NULL,
	"reps" integer,
	"external_load_kg" numeric(12, 3),
	"bodyweight_kg" numeric(12, 3),
	"added_load_kg" numeric(12, 3),
	"assistance_load_kg" numeric(12, 3),
	"effective_load_kg" numeric(12, 3),
	"duration_ms" bigint,
	"distance_m" numeric(14, 3),
	"power_w" numeric(12, 2),
	"rpe" numeric(3, 1),
	"rir" smallint,
	"tempo_eccentric_ms" bigint,
	"tempo_bottom_pause_ms" bigint,
	"tempo_concentric_ms" bigint,
	"tempo_top_pause_ms" bigint,
	"rest_before_ms" bigint,
	"rest_after_ms" bigint,
	"failure_reason" text,
	"technique" smallint,
	"discomfort" smallint,
	"pump" smallint,
	"entered_measurements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	CONSTRAINT "performed_sets_type_valid" CHECK ("performed_sets"."set_type" IN (
                'warm_up', 'working', 'back_off', 'drop', 'failure_amrap',
                'superset_circuit', 'rest_pause', 'technique', 'cluster', 'other'
            )),
	CONSTRAINT "performed_sets_status_valid" CHECK ("performed_sets"."status" IN ('completed', 'partial', 'skipped', 'added')),
	CONSTRAINT "performed_sets_position_nonneg" CHECK ("performed_sets"."position" >= 0),
	CONSTRAINT "performed_sets_round_positive" CHECK ("performed_sets"."round" IS NULL OR "performed_sets"."round" >= 1),
	CONSTRAINT "performed_sets_reps_nonneg" CHECK ("performed_sets"."reps" IS NULL OR "performed_sets"."reps" >= 0),
	CONSTRAINT "performed_sets_loads_nonneg" CHECK (("performed_sets"."external_load_kg" IS NULL OR "performed_sets"."external_load_kg" >= 0)
                AND ("performed_sets"."bodyweight_kg" IS NULL OR "performed_sets"."bodyweight_kg" >= 0)
                AND ("performed_sets"."added_load_kg" IS NULL OR "performed_sets"."added_load_kg" >= 0)
                AND ("performed_sets"."assistance_load_kg" IS NULL OR "performed_sets"."assistance_load_kg" >= 0)
                AND ("performed_sets"."effective_load_kg" IS NULL OR "performed_sets"."effective_load_kg" >= 0)
                AND ("performed_sets"."distance_m" IS NULL OR "performed_sets"."distance_m" >= 0)
                AND ("performed_sets"."power_w" IS NULL OR "performed_sets"."power_w" >= 0)),
	CONSTRAINT "performed_sets_durations_nonneg" CHECK (("performed_sets"."duration_ms" IS NULL OR "performed_sets"."duration_ms" >= 0)
                AND ("performed_sets"."tempo_eccentric_ms" IS NULL OR "performed_sets"."tempo_eccentric_ms" >= 0)
                AND ("performed_sets"."tempo_bottom_pause_ms" IS NULL OR "performed_sets"."tempo_bottom_pause_ms" >= 0)
                AND ("performed_sets"."tempo_concentric_ms" IS NULL OR "performed_sets"."tempo_concentric_ms" >= 0)
                AND ("performed_sets"."tempo_top_pause_ms" IS NULL OR "performed_sets"."tempo_top_pause_ms" >= 0)
                AND ("performed_sets"."rest_before_ms" IS NULL OR "performed_sets"."rest_before_ms" >= 0)
                AND ("performed_sets"."rest_after_ms" IS NULL OR "performed_sets"."rest_after_ms" >= 0)),
	CONSTRAINT "performed_sets_rpe_range" CHECK ("performed_sets"."rpe" IS NULL OR "performed_sets"."rpe" BETWEEN 1 AND 10),
	CONSTRAINT "performed_sets_rir_range" CHECK ("performed_sets"."rir" IS NULL OR "performed_sets"."rir" BETWEEN 0 AND 10),
	CONSTRAINT "performed_sets_quality_range" CHECK (("performed_sets"."technique" IS NULL OR "performed_sets"."technique" BETWEEN 1 AND 5)
                AND ("performed_sets"."discomfort" IS NULL OR "performed_sets"."discomfort" BETWEEN 1 AND 5)
                AND ("performed_sets"."pump" IS NULL OR "performed_sets"."pump" BETWEEN 1 AND 5)),
	CONSTRAINT "performed_sets_failure_reason_valid" CHECK ("performed_sets"."failure_reason" IS NULL OR "performed_sets"."failure_reason" IN (
                'muscular', 'technical', 'cardiovascular', 'pain', 'equipment', 'time', 'other'
            ))
);
--> statement-breakpoint
CREATE TABLE "set_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_group_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "set_group_members_position_nonneg" CHECK ("set_group_members"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "set_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"activity_id" uuid NOT NULL,
	"parent_group_id" uuid,
	"type" text NOT NULL,
	"position" integer NOT NULL,
	"rounds" integer,
	"rest_ms" bigint,
	CONSTRAINT "set_groups_type_valid" CHECK ("set_groups"."type" IN ('straight', 'superset', 'circuit', 'drop', 'cluster', 'rest_pause')),
	CONSTRAINT "set_groups_position_nonneg" CHECK ("set_groups"."position" >= 0),
	CONSTRAINT "set_groups_rounds_positive" CHECK ("set_groups"."rounds" IS NULL OR "set_groups"."rounds" >= 1),
	CONSTRAINT "set_groups_rest_nonneg" CHECK ("set_groups"."rest_ms" IS NULL OR "set_groups"."rest_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "exercise_occurrences" ADD CONSTRAINT "exercise_occurrences_activity_id_session_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."session_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_occurrences" ADD CONSTRAINT "exercise_occurrences_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_sets" ADD CONSTRAINT "performed_sets_occurrence_id_exercise_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."exercise_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_sets" ADD CONSTRAINT "performed_sets_set_group_id_set_groups_id_fk" FOREIGN KEY ("set_group_id") REFERENCES "public"."set_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_group_members" ADD CONSTRAINT "set_group_members_set_group_id_set_groups_id_fk" FOREIGN KEY ("set_group_id") REFERENCES "public"."set_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_group_members" ADD CONSTRAINT "set_group_members_occurrence_id_exercise_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."exercise_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_groups" ADD CONSTRAINT "set_groups_activity_id_session_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."session_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_groups" ADD CONSTRAINT "set_groups_parent_group_id_set_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "public"."set_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_occurrences_position_unique" ON "exercise_occurrences" USING btree ("activity_id","position");--> statement-breakpoint
CREATE INDEX "exercise_occurrences_activity_idx" ON "exercise_occurrences" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "exercise_occurrences_exercise_idx" ON "exercise_occurrences" USING btree ("exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "performed_sets_position_unique" ON "performed_sets" USING btree ("occurrence_id","position");--> statement-breakpoint
CREATE INDEX "performed_sets_occurrence_idx" ON "performed_sets" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "performed_sets_group_idx" ON "performed_sets" USING btree ("set_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "set_group_members_position_unique" ON "set_group_members" USING btree ("set_group_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "set_group_members_occurrence_unique" ON "set_group_members" USING btree ("set_group_id","occurrence_id");--> statement-breakpoint
CREATE INDEX "set_group_members_occurrence_idx" ON "set_group_members" USING btree ("occurrence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "set_groups_root_position_unique" ON "set_groups" USING btree ("activity_id","position") WHERE "set_groups"."parent_group_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "set_groups_child_position_unique" ON "set_groups" USING btree ("parent_group_id","position") WHERE "set_groups"."parent_group_id" is not null;--> statement-breakpoint
CREATE INDEX "set_groups_activity_idx" ON "set_groups" USING btree ("activity_id");