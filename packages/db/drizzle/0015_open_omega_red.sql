CREATE TABLE "prescribed_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"logical_key" uuid NOT NULL,
	"source_logical_key" uuid,
	"source_row_id" uuid,
	"type" text NOT NULL,
	"position" integer NOT NULL,
	"expected_duration_ms" bigint,
	"rpe_target" numeric(3, 1),
	"notes" text,
	CONSTRAINT "prescribed_activities_type_valid" CHECK ("prescribed_activities"."type" IN ('strength', 'running')),
	CONSTRAINT "prescribed_activities_position_nonneg" CHECK ("prescribed_activities"."position" >= 0),
	CONSTRAINT "prescribed_activities_duration_nonneg" CHECK ("prescribed_activities"."expected_duration_ms" IS NULL OR "prescribed_activities"."expected_duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prescribed_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"logical_key" uuid NOT NULL,
	"source_logical_key" uuid,
	"source_row_id" uuid,
	"strength_activity_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"exercise_snapshot" jsonb NOT NULL,
	"position" integer NOT NULL,
	"purpose" text,
	"substitution_policy" text,
	CONSTRAINT "prescribed_exercises_position_nonneg" CHECK ("prescribed_exercises"."position" >= 0),
	CONSTRAINT "prescribed_exercises_substitution_valid" CHECK ("prescribed_exercises"."substitution_policy" IS NULL OR "prescribed_exercises"."substitution_policy" IN ('none', 'same_pattern', 'same_muscle', 'free')),
	CONSTRAINT "prescribed_exercises_snapshot_valid" CHECK ("prescribed_exercises"."exercise_snapshot" ? 'schemaVersion')
);
--> statement-breakpoint
CREATE TABLE "prescribed_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"logical_key" uuid NOT NULL,
	"source_logical_key" uuid,
	"source_row_id" uuid,
	"running_activity_id" uuid NOT NULL,
	"parent_step_id" uuid,
	"type" text NOT NULL,
	"position" integer NOT NULL,
	"repeat_count" integer,
	"reps_min" integer,
	"reps_max" integer,
	"load_kg_min" numeric(12, 3),
	"load_kg_max" numeric(12, 3),
	"duration_ms_min" bigint,
	"duration_ms_max" bigint,
	"distance_m_min" numeric(14, 3),
	"distance_m_max" numeric(14, 3),
	"speed_mps_min" numeric(12, 4),
	"speed_mps_max" numeric(12, 4),
	"power_w_min" numeric(12, 2),
	"power_w_max" numeric(12, 2),
	"rpe_min" numeric(3, 1),
	"rpe_max" numeric(3, 1),
	"rir_min" smallint,
	"rir_max" smallint,
	"hr_bpm_min" integer,
	"hr_bpm_max" integer,
	"percent_1rm" numeric(8, 5),
	"percent_training_max" numeric(8, 5),
	"tempo_eccentric_ms" bigint,
	"tempo_bottom_pause_ms" bigint,
	"tempo_concentric_ms" bigint,
	"tempo_top_pause_ms" bigint,
	"rest_ms_min" bigint,
	"rest_ms_max" bigint,
	"entered_targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	CONSTRAINT "prescribed_run_steps_type_valid" CHECK ("prescribed_run_steps"."type" IN ('warm_up', 'work', 'recovery', 'repeat', 'cool_down', 'open')),
	CONSTRAINT "prescribed_run_steps_position_nonneg" CHECK ("prescribed_run_steps"."position" >= 0),
	CONSTRAINT "prescribed_run_steps_repeat_pair" CHECK (("prescribed_run_steps"."type" = 'repeat') = ("prescribed_run_steps"."repeat_count" IS NOT NULL)),
	CONSTRAINT "prescribed_run_steps_repeat_positive" CHECK ("prescribed_run_steps"."repeat_count" IS NULL OR "prescribed_run_steps"."repeat_count" >= 1),
	CONSTRAINT "prescribed_run_steps_reps_range" CHECK ("prescribed_run_steps"."reps_min" IS NULL OR "prescribed_run_steps"."reps_max" IS NULL OR "prescribed_run_steps"."reps_min" <= "prescribed_run_steps"."reps_max"),
	CONSTRAINT "prescribed_run_steps_reps_min_nonneg" CHECK ("prescribed_run_steps"."reps_min" IS NULL OR "prescribed_run_steps"."reps_min" >= 0),
	CONSTRAINT "prescribed_run_steps_reps_max_nonneg" CHECK ("prescribed_run_steps"."reps_max" IS NULL OR "prescribed_run_steps"."reps_max" >= 0),
	CONSTRAINT "prescribed_run_steps_load_kg_range" CHECK ("prescribed_run_steps"."load_kg_min" IS NULL OR "prescribed_run_steps"."load_kg_max" IS NULL OR "prescribed_run_steps"."load_kg_min" <= "prescribed_run_steps"."load_kg_max"),
	CONSTRAINT "prescribed_run_steps_load_kg_min_nonneg" CHECK ("prescribed_run_steps"."load_kg_min" IS NULL OR "prescribed_run_steps"."load_kg_min" >= 0),
	CONSTRAINT "prescribed_run_steps_load_kg_max_nonneg" CHECK ("prescribed_run_steps"."load_kg_max" IS NULL OR "prescribed_run_steps"."load_kg_max" >= 0),
	CONSTRAINT "prescribed_run_steps_duration_ms_range" CHECK ("prescribed_run_steps"."duration_ms_min" IS NULL OR "prescribed_run_steps"."duration_ms_max" IS NULL OR "prescribed_run_steps"."duration_ms_min" <= "prescribed_run_steps"."duration_ms_max"),
	CONSTRAINT "prescribed_run_steps_duration_ms_min_nonneg" CHECK ("prescribed_run_steps"."duration_ms_min" IS NULL OR "prescribed_run_steps"."duration_ms_min" >= 0),
	CONSTRAINT "prescribed_run_steps_duration_ms_max_nonneg" CHECK ("prescribed_run_steps"."duration_ms_max" IS NULL OR "prescribed_run_steps"."duration_ms_max" >= 0),
	CONSTRAINT "prescribed_run_steps_distance_m_range" CHECK ("prescribed_run_steps"."distance_m_min" IS NULL OR "prescribed_run_steps"."distance_m_max" IS NULL OR "prescribed_run_steps"."distance_m_min" <= "prescribed_run_steps"."distance_m_max"),
	CONSTRAINT "prescribed_run_steps_distance_m_min_nonneg" CHECK ("prescribed_run_steps"."distance_m_min" IS NULL OR "prescribed_run_steps"."distance_m_min" >= 0),
	CONSTRAINT "prescribed_run_steps_distance_m_max_nonneg" CHECK ("prescribed_run_steps"."distance_m_max" IS NULL OR "prescribed_run_steps"."distance_m_max" >= 0),
	CONSTRAINT "prescribed_run_steps_speed_mps_range" CHECK ("prescribed_run_steps"."speed_mps_min" IS NULL OR "prescribed_run_steps"."speed_mps_max" IS NULL OR "prescribed_run_steps"."speed_mps_min" <= "prescribed_run_steps"."speed_mps_max"),
	CONSTRAINT "prescribed_run_steps_speed_mps_min_nonneg" CHECK ("prescribed_run_steps"."speed_mps_min" IS NULL OR "prescribed_run_steps"."speed_mps_min" >= 0),
	CONSTRAINT "prescribed_run_steps_speed_mps_max_nonneg" CHECK ("prescribed_run_steps"."speed_mps_max" IS NULL OR "prescribed_run_steps"."speed_mps_max" >= 0),
	CONSTRAINT "prescribed_run_steps_power_w_range" CHECK ("prescribed_run_steps"."power_w_min" IS NULL OR "prescribed_run_steps"."power_w_max" IS NULL OR "prescribed_run_steps"."power_w_min" <= "prescribed_run_steps"."power_w_max"),
	CONSTRAINT "prescribed_run_steps_power_w_min_nonneg" CHECK ("prescribed_run_steps"."power_w_min" IS NULL OR "prescribed_run_steps"."power_w_min" >= 0),
	CONSTRAINT "prescribed_run_steps_power_w_max_nonneg" CHECK ("prescribed_run_steps"."power_w_max" IS NULL OR "prescribed_run_steps"."power_w_max" >= 0),
	CONSTRAINT "prescribed_run_steps_rpe_range" CHECK ("prescribed_run_steps"."rpe_min" IS NULL OR "prescribed_run_steps"."rpe_max" IS NULL OR "prescribed_run_steps"."rpe_min" <= "prescribed_run_steps"."rpe_max"),
	CONSTRAINT "prescribed_run_steps_rpe_min_nonneg" CHECK ("prescribed_run_steps"."rpe_min" IS NULL OR "prescribed_run_steps"."rpe_min" >= 0),
	CONSTRAINT "prescribed_run_steps_rpe_max_nonneg" CHECK ("prescribed_run_steps"."rpe_max" IS NULL OR "prescribed_run_steps"."rpe_max" >= 0),
	CONSTRAINT "prescribed_run_steps_rir_range" CHECK ("prescribed_run_steps"."rir_min" IS NULL OR "prescribed_run_steps"."rir_max" IS NULL OR "prescribed_run_steps"."rir_min" <= "prescribed_run_steps"."rir_max"),
	CONSTRAINT "prescribed_run_steps_rir_min_nonneg" CHECK ("prescribed_run_steps"."rir_min" IS NULL OR "prescribed_run_steps"."rir_min" >= 0),
	CONSTRAINT "prescribed_run_steps_rir_max_nonneg" CHECK ("prescribed_run_steps"."rir_max" IS NULL OR "prescribed_run_steps"."rir_max" >= 0),
	CONSTRAINT "prescribed_run_steps_hr_bpm_range" CHECK ("prescribed_run_steps"."hr_bpm_min" IS NULL OR "prescribed_run_steps"."hr_bpm_max" IS NULL OR "prescribed_run_steps"."hr_bpm_min" <= "prescribed_run_steps"."hr_bpm_max"),
	CONSTRAINT "prescribed_run_steps_hr_bpm_min_nonneg" CHECK ("prescribed_run_steps"."hr_bpm_min" IS NULL OR "prescribed_run_steps"."hr_bpm_min" >= 0),
	CONSTRAINT "prescribed_run_steps_hr_bpm_max_nonneg" CHECK ("prescribed_run_steps"."hr_bpm_max" IS NULL OR "prescribed_run_steps"."hr_bpm_max" >= 0),
	CONSTRAINT "prescribed_run_steps_rest_ms_range" CHECK ("prescribed_run_steps"."rest_ms_min" IS NULL OR "prescribed_run_steps"."rest_ms_max" IS NULL OR "prescribed_run_steps"."rest_ms_min" <= "prescribed_run_steps"."rest_ms_max"),
	CONSTRAINT "prescribed_run_steps_rest_ms_min_nonneg" CHECK ("prescribed_run_steps"."rest_ms_min" IS NULL OR "prescribed_run_steps"."rest_ms_min" >= 0),
	CONSTRAINT "prescribed_run_steps_rest_ms_max_nonneg" CHECK ("prescribed_run_steps"."rest_ms_max" IS NULL OR "prescribed_run_steps"."rest_ms_max" >= 0),
	CONSTRAINT "prescribed_run_steps_percent_1rm_bound" CHECK ("prescribed_run_steps"."percent_1rm" IS NULL OR ("prescribed_run_steps"."percent_1rm" >= 0 AND "prescribed_run_steps"."percent_1rm" <= 100)),
	CONSTRAINT "prescribed_run_steps_percent_tm_bound" CHECK ("prescribed_run_steps"."percent_training_max" IS NULL OR ("prescribed_run_steps"."percent_training_max" >= 0 AND "prescribed_run_steps"."percent_training_max" <= 100)),
	CONSTRAINT "prescribed_run_steps_tempo_nonneg" CHECK (("prescribed_run_steps"."tempo_eccentric_ms" IS NULL OR "prescribed_run_steps"."tempo_eccentric_ms" >= 0)
                AND ("prescribed_run_steps"."tempo_bottom_pause_ms" IS NULL OR "prescribed_run_steps"."tempo_bottom_pause_ms" >= 0)
                AND ("prescribed_run_steps"."tempo_concentric_ms" IS NULL OR "prescribed_run_steps"."tempo_concentric_ms" >= 0)
                AND ("prescribed_run_steps"."tempo_top_pause_ms" IS NULL OR "prescribed_run_steps"."tempo_top_pause_ms" >= 0)),
	CONSTRAINT "prescribed_run_steps_load_mode" CHECK (((CASE WHEN "prescribed_run_steps"."load_kg_min" IS NOT NULL OR "prescribed_run_steps"."load_kg_max" IS NOT NULL THEN 1 ELSE 0 END)
                + (CASE WHEN "prescribed_run_steps"."percent_1rm" IS NOT NULL THEN 1 ELSE 0 END)
                + (CASE WHEN "prescribed_run_steps"."percent_training_max" IS NOT NULL THEN 1 ELSE 0 END)) <= 1)
);
--> statement-breakpoint
CREATE TABLE "prescribed_running_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"run_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reps_min" integer,
	"reps_max" integer,
	"load_kg_min" numeric(12, 3),
	"load_kg_max" numeric(12, 3),
	"duration_ms_min" bigint,
	"duration_ms_max" bigint,
	"distance_m_min" numeric(14, 3),
	"distance_m_max" numeric(14, 3),
	"speed_mps_min" numeric(12, 4),
	"speed_mps_max" numeric(12, 4),
	"power_w_min" numeric(12, 2),
	"power_w_max" numeric(12, 2),
	"rpe_min" numeric(3, 1),
	"rpe_max" numeric(3, 1),
	"rir_min" smallint,
	"rir_max" smallint,
	"hr_bpm_min" integer,
	"hr_bpm_max" integer,
	"percent_1rm" numeric(8, 5),
	"percent_training_max" numeric(8, 5),
	"tempo_eccentric_ms" bigint,
	"tempo_bottom_pause_ms" bigint,
	"tempo_concentric_ms" bigint,
	"tempo_top_pause_ms" bigint,
	"rest_ms_min" bigint,
	"rest_ms_max" bigint,
	"entered_targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "prescribed_running_activities_reps_range" CHECK ("prescribed_running_activities"."reps_min" IS NULL OR "prescribed_running_activities"."reps_max" IS NULL OR "prescribed_running_activities"."reps_min" <= "prescribed_running_activities"."reps_max"),
	CONSTRAINT "prescribed_running_activities_reps_min_nonneg" CHECK ("prescribed_running_activities"."reps_min" IS NULL OR "prescribed_running_activities"."reps_min" >= 0),
	CONSTRAINT "prescribed_running_activities_reps_max_nonneg" CHECK ("prescribed_running_activities"."reps_max" IS NULL OR "prescribed_running_activities"."reps_max" >= 0),
	CONSTRAINT "prescribed_running_activities_load_kg_range" CHECK ("prescribed_running_activities"."load_kg_min" IS NULL OR "prescribed_running_activities"."load_kg_max" IS NULL OR "prescribed_running_activities"."load_kg_min" <= "prescribed_running_activities"."load_kg_max"),
	CONSTRAINT "prescribed_running_activities_load_kg_min_nonneg" CHECK ("prescribed_running_activities"."load_kg_min" IS NULL OR "prescribed_running_activities"."load_kg_min" >= 0),
	CONSTRAINT "prescribed_running_activities_load_kg_max_nonneg" CHECK ("prescribed_running_activities"."load_kg_max" IS NULL OR "prescribed_running_activities"."load_kg_max" >= 0),
	CONSTRAINT "prescribed_running_activities_duration_ms_range" CHECK ("prescribed_running_activities"."duration_ms_min" IS NULL OR "prescribed_running_activities"."duration_ms_max" IS NULL OR "prescribed_running_activities"."duration_ms_min" <= "prescribed_running_activities"."duration_ms_max"),
	CONSTRAINT "prescribed_running_activities_duration_ms_min_nonneg" CHECK ("prescribed_running_activities"."duration_ms_min" IS NULL OR "prescribed_running_activities"."duration_ms_min" >= 0),
	CONSTRAINT "prescribed_running_activities_duration_ms_max_nonneg" CHECK ("prescribed_running_activities"."duration_ms_max" IS NULL OR "prescribed_running_activities"."duration_ms_max" >= 0),
	CONSTRAINT "prescribed_running_activities_distance_m_range" CHECK ("prescribed_running_activities"."distance_m_min" IS NULL OR "prescribed_running_activities"."distance_m_max" IS NULL OR "prescribed_running_activities"."distance_m_min" <= "prescribed_running_activities"."distance_m_max"),
	CONSTRAINT "prescribed_running_activities_distance_m_min_nonneg" CHECK ("prescribed_running_activities"."distance_m_min" IS NULL OR "prescribed_running_activities"."distance_m_min" >= 0),
	CONSTRAINT "prescribed_running_activities_distance_m_max_nonneg" CHECK ("prescribed_running_activities"."distance_m_max" IS NULL OR "prescribed_running_activities"."distance_m_max" >= 0),
	CONSTRAINT "prescribed_running_activities_speed_mps_range" CHECK ("prescribed_running_activities"."speed_mps_min" IS NULL OR "prescribed_running_activities"."speed_mps_max" IS NULL OR "prescribed_running_activities"."speed_mps_min" <= "prescribed_running_activities"."speed_mps_max"),
	CONSTRAINT "prescribed_running_activities_speed_mps_min_nonneg" CHECK ("prescribed_running_activities"."speed_mps_min" IS NULL OR "prescribed_running_activities"."speed_mps_min" >= 0),
	CONSTRAINT "prescribed_running_activities_speed_mps_max_nonneg" CHECK ("prescribed_running_activities"."speed_mps_max" IS NULL OR "prescribed_running_activities"."speed_mps_max" >= 0),
	CONSTRAINT "prescribed_running_activities_power_w_range" CHECK ("prescribed_running_activities"."power_w_min" IS NULL OR "prescribed_running_activities"."power_w_max" IS NULL OR "prescribed_running_activities"."power_w_min" <= "prescribed_running_activities"."power_w_max"),
	CONSTRAINT "prescribed_running_activities_power_w_min_nonneg" CHECK ("prescribed_running_activities"."power_w_min" IS NULL OR "prescribed_running_activities"."power_w_min" >= 0),
	CONSTRAINT "prescribed_running_activities_power_w_max_nonneg" CHECK ("prescribed_running_activities"."power_w_max" IS NULL OR "prescribed_running_activities"."power_w_max" >= 0),
	CONSTRAINT "prescribed_running_activities_rpe_range" CHECK ("prescribed_running_activities"."rpe_min" IS NULL OR "prescribed_running_activities"."rpe_max" IS NULL OR "prescribed_running_activities"."rpe_min" <= "prescribed_running_activities"."rpe_max"),
	CONSTRAINT "prescribed_running_activities_rpe_min_nonneg" CHECK ("prescribed_running_activities"."rpe_min" IS NULL OR "prescribed_running_activities"."rpe_min" >= 0),
	CONSTRAINT "prescribed_running_activities_rpe_max_nonneg" CHECK ("prescribed_running_activities"."rpe_max" IS NULL OR "prescribed_running_activities"."rpe_max" >= 0),
	CONSTRAINT "prescribed_running_activities_rir_range" CHECK ("prescribed_running_activities"."rir_min" IS NULL OR "prescribed_running_activities"."rir_max" IS NULL OR "prescribed_running_activities"."rir_min" <= "prescribed_running_activities"."rir_max"),
	CONSTRAINT "prescribed_running_activities_rir_min_nonneg" CHECK ("prescribed_running_activities"."rir_min" IS NULL OR "prescribed_running_activities"."rir_min" >= 0),
	CONSTRAINT "prescribed_running_activities_rir_max_nonneg" CHECK ("prescribed_running_activities"."rir_max" IS NULL OR "prescribed_running_activities"."rir_max" >= 0),
	CONSTRAINT "prescribed_running_activities_hr_bpm_range" CHECK ("prescribed_running_activities"."hr_bpm_min" IS NULL OR "prescribed_running_activities"."hr_bpm_max" IS NULL OR "prescribed_running_activities"."hr_bpm_min" <= "prescribed_running_activities"."hr_bpm_max"),
	CONSTRAINT "prescribed_running_activities_hr_bpm_min_nonneg" CHECK ("prescribed_running_activities"."hr_bpm_min" IS NULL OR "prescribed_running_activities"."hr_bpm_min" >= 0),
	CONSTRAINT "prescribed_running_activities_hr_bpm_max_nonneg" CHECK ("prescribed_running_activities"."hr_bpm_max" IS NULL OR "prescribed_running_activities"."hr_bpm_max" >= 0),
	CONSTRAINT "prescribed_running_activities_rest_ms_range" CHECK ("prescribed_running_activities"."rest_ms_min" IS NULL OR "prescribed_running_activities"."rest_ms_max" IS NULL OR "prescribed_running_activities"."rest_ms_min" <= "prescribed_running_activities"."rest_ms_max"),
	CONSTRAINT "prescribed_running_activities_rest_ms_min_nonneg" CHECK ("prescribed_running_activities"."rest_ms_min" IS NULL OR "prescribed_running_activities"."rest_ms_min" >= 0),
	CONSTRAINT "prescribed_running_activities_rest_ms_max_nonneg" CHECK ("prescribed_running_activities"."rest_ms_max" IS NULL OR "prescribed_running_activities"."rest_ms_max" >= 0),
	CONSTRAINT "prescribed_running_activities_percent_1rm_bound" CHECK ("prescribed_running_activities"."percent_1rm" IS NULL OR ("prescribed_running_activities"."percent_1rm" >= 0 AND "prescribed_running_activities"."percent_1rm" <= 100)),
	CONSTRAINT "prescribed_running_activities_percent_tm_bound" CHECK ("prescribed_running_activities"."percent_training_max" IS NULL OR ("prescribed_running_activities"."percent_training_max" >= 0 AND "prescribed_running_activities"."percent_training_max" <= 100)),
	CONSTRAINT "prescribed_running_activities_tempo_nonneg" CHECK (("prescribed_running_activities"."tempo_eccentric_ms" IS NULL OR "prescribed_running_activities"."tempo_eccentric_ms" >= 0)
                AND ("prescribed_running_activities"."tempo_bottom_pause_ms" IS NULL OR "prescribed_running_activities"."tempo_bottom_pause_ms" >= 0)
                AND ("prescribed_running_activities"."tempo_concentric_ms" IS NULL OR "prescribed_running_activities"."tempo_concentric_ms" >= 0)
                AND ("prescribed_running_activities"."tempo_top_pause_ms" IS NULL OR "prescribed_running_activities"."tempo_top_pause_ms" >= 0)),
	CONSTRAINT "prescribed_running_activities_load_mode" CHECK (((CASE WHEN "prescribed_running_activities"."load_kg_min" IS NOT NULL OR "prescribed_running_activities"."load_kg_max" IS NOT NULL THEN 1 ELSE 0 END)
                + (CASE WHEN "prescribed_running_activities"."percent_1rm" IS NOT NULL THEN 1 ELSE 0 END)
                + (CASE WHEN "prescribed_running_activities"."percent_training_max" IS NOT NULL THEN 1 ELSE 0 END)) <= 1)
);
--> statement-breakpoint
CREATE TABLE "prescribed_set_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"set_group_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "prescribed_set_group_members_position_nonneg" CHECK ("prescribed_set_group_members"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prescribed_set_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"logical_key" uuid NOT NULL,
	"source_logical_key" uuid,
	"source_row_id" uuid,
	"strength_activity_id" uuid NOT NULL,
	"parent_group_id" uuid,
	"type" text NOT NULL,
	"position" integer NOT NULL,
	"rounds" integer,
	"rest_ms" bigint,
	CONSTRAINT "prescribed_set_groups_type_valid" CHECK ("prescribed_set_groups"."type" IN ('straight', 'superset', 'circuit', 'drop', 'cluster', 'rest_pause')),
	CONSTRAINT "prescribed_set_groups_position_nonneg" CHECK ("prescribed_set_groups"."position" >= 0),
	CONSTRAINT "prescribed_set_groups_rounds_positive" CHECK ("prescribed_set_groups"."rounds" IS NULL OR "prescribed_set_groups"."rounds" >= 1),
	CONSTRAINT "prescribed_set_groups_rest_nonneg" CHECK ("prescribed_set_groups"."rest_ms" IS NULL OR "prescribed_set_groups"."rest_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prescribed_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"logical_key" uuid NOT NULL,
	"source_logical_key" uuid,
	"source_row_id" uuid,
	"exercise_id" uuid NOT NULL,
	"set_group_id" uuid,
	"position" integer NOT NULL,
	"round" integer,
	"set_type" text NOT NULL,
	"reps_min" integer,
	"reps_max" integer,
	"load_kg_min" numeric(12, 3),
	"load_kg_max" numeric(12, 3),
	"duration_ms_min" bigint,
	"duration_ms_max" bigint,
	"distance_m_min" numeric(14, 3),
	"distance_m_max" numeric(14, 3),
	"speed_mps_min" numeric(12, 4),
	"speed_mps_max" numeric(12, 4),
	"power_w_min" numeric(12, 2),
	"power_w_max" numeric(12, 2),
	"rpe_min" numeric(3, 1),
	"rpe_max" numeric(3, 1),
	"rir_min" smallint,
	"rir_max" smallint,
	"hr_bpm_min" integer,
	"hr_bpm_max" integer,
	"percent_1rm" numeric(8, 5),
	"percent_training_max" numeric(8, 5),
	"tempo_eccentric_ms" bigint,
	"tempo_bottom_pause_ms" bigint,
	"tempo_concentric_ms" bigint,
	"tempo_top_pause_ms" bigint,
	"rest_ms_min" bigint,
	"rest_ms_max" bigint,
	"entered_targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	CONSTRAINT "prescribed_sets_type_valid" CHECK ("prescribed_sets"."set_type" IN (
                'warm_up', 'working', 'back_off', 'drop', 'failure_amrap',
                'superset_circuit', 'rest_pause', 'technique', 'cluster', 'other'
            )),
	CONSTRAINT "prescribed_sets_position_nonneg" CHECK ("prescribed_sets"."position" >= 0),
	CONSTRAINT "prescribed_sets_round_positive" CHECK ("prescribed_sets"."round" IS NULL OR "prescribed_sets"."round" >= 1),
	CONSTRAINT "prescribed_sets_reps_range" CHECK ("prescribed_sets"."reps_min" IS NULL OR "prescribed_sets"."reps_max" IS NULL OR "prescribed_sets"."reps_min" <= "prescribed_sets"."reps_max"),
	CONSTRAINT "prescribed_sets_reps_min_nonneg" CHECK ("prescribed_sets"."reps_min" IS NULL OR "prescribed_sets"."reps_min" >= 0),
	CONSTRAINT "prescribed_sets_reps_max_nonneg" CHECK ("prescribed_sets"."reps_max" IS NULL OR "prescribed_sets"."reps_max" >= 0),
	CONSTRAINT "prescribed_sets_load_kg_range" CHECK ("prescribed_sets"."load_kg_min" IS NULL OR "prescribed_sets"."load_kg_max" IS NULL OR "prescribed_sets"."load_kg_min" <= "prescribed_sets"."load_kg_max"),
	CONSTRAINT "prescribed_sets_load_kg_min_nonneg" CHECK ("prescribed_sets"."load_kg_min" IS NULL OR "prescribed_sets"."load_kg_min" >= 0),
	CONSTRAINT "prescribed_sets_load_kg_max_nonneg" CHECK ("prescribed_sets"."load_kg_max" IS NULL OR "prescribed_sets"."load_kg_max" >= 0),
	CONSTRAINT "prescribed_sets_duration_ms_range" CHECK ("prescribed_sets"."duration_ms_min" IS NULL OR "prescribed_sets"."duration_ms_max" IS NULL OR "prescribed_sets"."duration_ms_min" <= "prescribed_sets"."duration_ms_max"),
	CONSTRAINT "prescribed_sets_duration_ms_min_nonneg" CHECK ("prescribed_sets"."duration_ms_min" IS NULL OR "prescribed_sets"."duration_ms_min" >= 0),
	CONSTRAINT "prescribed_sets_duration_ms_max_nonneg" CHECK ("prescribed_sets"."duration_ms_max" IS NULL OR "prescribed_sets"."duration_ms_max" >= 0),
	CONSTRAINT "prescribed_sets_distance_m_range" CHECK ("prescribed_sets"."distance_m_min" IS NULL OR "prescribed_sets"."distance_m_max" IS NULL OR "prescribed_sets"."distance_m_min" <= "prescribed_sets"."distance_m_max"),
	CONSTRAINT "prescribed_sets_distance_m_min_nonneg" CHECK ("prescribed_sets"."distance_m_min" IS NULL OR "prescribed_sets"."distance_m_min" >= 0),
	CONSTRAINT "prescribed_sets_distance_m_max_nonneg" CHECK ("prescribed_sets"."distance_m_max" IS NULL OR "prescribed_sets"."distance_m_max" >= 0),
	CONSTRAINT "prescribed_sets_speed_mps_range" CHECK ("prescribed_sets"."speed_mps_min" IS NULL OR "prescribed_sets"."speed_mps_max" IS NULL OR "prescribed_sets"."speed_mps_min" <= "prescribed_sets"."speed_mps_max"),
	CONSTRAINT "prescribed_sets_speed_mps_min_nonneg" CHECK ("prescribed_sets"."speed_mps_min" IS NULL OR "prescribed_sets"."speed_mps_min" >= 0),
	CONSTRAINT "prescribed_sets_speed_mps_max_nonneg" CHECK ("prescribed_sets"."speed_mps_max" IS NULL OR "prescribed_sets"."speed_mps_max" >= 0),
	CONSTRAINT "prescribed_sets_power_w_range" CHECK ("prescribed_sets"."power_w_min" IS NULL OR "prescribed_sets"."power_w_max" IS NULL OR "prescribed_sets"."power_w_min" <= "prescribed_sets"."power_w_max"),
	CONSTRAINT "prescribed_sets_power_w_min_nonneg" CHECK ("prescribed_sets"."power_w_min" IS NULL OR "prescribed_sets"."power_w_min" >= 0),
	CONSTRAINT "prescribed_sets_power_w_max_nonneg" CHECK ("prescribed_sets"."power_w_max" IS NULL OR "prescribed_sets"."power_w_max" >= 0),
	CONSTRAINT "prescribed_sets_rpe_range" CHECK ("prescribed_sets"."rpe_min" IS NULL OR "prescribed_sets"."rpe_max" IS NULL OR "prescribed_sets"."rpe_min" <= "prescribed_sets"."rpe_max"),
	CONSTRAINT "prescribed_sets_rpe_min_nonneg" CHECK ("prescribed_sets"."rpe_min" IS NULL OR "prescribed_sets"."rpe_min" >= 0),
	CONSTRAINT "prescribed_sets_rpe_max_nonneg" CHECK ("prescribed_sets"."rpe_max" IS NULL OR "prescribed_sets"."rpe_max" >= 0),
	CONSTRAINT "prescribed_sets_rir_range" CHECK ("prescribed_sets"."rir_min" IS NULL OR "prescribed_sets"."rir_max" IS NULL OR "prescribed_sets"."rir_min" <= "prescribed_sets"."rir_max"),
	CONSTRAINT "prescribed_sets_rir_min_nonneg" CHECK ("prescribed_sets"."rir_min" IS NULL OR "prescribed_sets"."rir_min" >= 0),
	CONSTRAINT "prescribed_sets_rir_max_nonneg" CHECK ("prescribed_sets"."rir_max" IS NULL OR "prescribed_sets"."rir_max" >= 0),
	CONSTRAINT "prescribed_sets_hr_bpm_range" CHECK ("prescribed_sets"."hr_bpm_min" IS NULL OR "prescribed_sets"."hr_bpm_max" IS NULL OR "prescribed_sets"."hr_bpm_min" <= "prescribed_sets"."hr_bpm_max"),
	CONSTRAINT "prescribed_sets_hr_bpm_min_nonneg" CHECK ("prescribed_sets"."hr_bpm_min" IS NULL OR "prescribed_sets"."hr_bpm_min" >= 0),
	CONSTRAINT "prescribed_sets_hr_bpm_max_nonneg" CHECK ("prescribed_sets"."hr_bpm_max" IS NULL OR "prescribed_sets"."hr_bpm_max" >= 0),
	CONSTRAINT "prescribed_sets_rest_ms_range" CHECK ("prescribed_sets"."rest_ms_min" IS NULL OR "prescribed_sets"."rest_ms_max" IS NULL OR "prescribed_sets"."rest_ms_min" <= "prescribed_sets"."rest_ms_max"),
	CONSTRAINT "prescribed_sets_rest_ms_min_nonneg" CHECK ("prescribed_sets"."rest_ms_min" IS NULL OR "prescribed_sets"."rest_ms_min" >= 0),
	CONSTRAINT "prescribed_sets_rest_ms_max_nonneg" CHECK ("prescribed_sets"."rest_ms_max" IS NULL OR "prescribed_sets"."rest_ms_max" >= 0),
	CONSTRAINT "prescribed_sets_percent_1rm_bound" CHECK ("prescribed_sets"."percent_1rm" IS NULL OR ("prescribed_sets"."percent_1rm" >= 0 AND "prescribed_sets"."percent_1rm" <= 100)),
	CONSTRAINT "prescribed_sets_percent_tm_bound" CHECK ("prescribed_sets"."percent_training_max" IS NULL OR ("prescribed_sets"."percent_training_max" >= 0 AND "prescribed_sets"."percent_training_max" <= 100)),
	CONSTRAINT "prescribed_sets_tempo_nonneg" CHECK (("prescribed_sets"."tempo_eccentric_ms" IS NULL OR "prescribed_sets"."tempo_eccentric_ms" >= 0)
                AND ("prescribed_sets"."tempo_bottom_pause_ms" IS NULL OR "prescribed_sets"."tempo_bottom_pause_ms" >= 0)
                AND ("prescribed_sets"."tempo_concentric_ms" IS NULL OR "prescribed_sets"."tempo_concentric_ms" >= 0)
                AND ("prescribed_sets"."tempo_top_pause_ms" IS NULL OR "prescribed_sets"."tempo_top_pause_ms" >= 0)),
	CONSTRAINT "prescribed_sets_load_mode" CHECK (((CASE WHEN "prescribed_sets"."load_kg_min" IS NOT NULL OR "prescribed_sets"."load_kg_max" IS NOT NULL THEN 1 ELSE 0 END)
                + (CASE WHEN "prescribed_sets"."percent_1rm" IS NOT NULL THEN 1 ELSE 0 END)
                + (CASE WHEN "prescribed_sets"."percent_training_max" IS NOT NULL THEN 1 ELSE 0 END)) <= 1)
);
--> statement-breakpoint
CREATE TABLE "prescribed_strength_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"expected_duration_ms" bigint,
	"notes" text,
	"source_prescription_id" uuid,
	"source_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_prescriptions_kind_valid" CHECK ("session_prescriptions"."kind" IN ('template', 'planned', 'resolved_execution')),
	CONSTRAINT "session_prescriptions_schema_version_positive" CHECK ("session_prescriptions"."schema_version" > 0),
	CONSTRAINT "session_prescriptions_duration_nonneg" CHECK ("session_prescriptions"."expected_duration_ms" IS NULL OR "session_prescriptions"."expected_duration_ms" >= 0),
	CONSTRAINT "session_prescriptions_source_pair" CHECK (("session_prescriptions"."source_prescription_id" IS NULL) = ("session_prescriptions"."source_kind" IS NULL)),
	CONSTRAINT "session_prescriptions_source_kind_valid" CHECK ("session_prescriptions"."source_kind" IS NULL OR "session_prescriptions"."source_kind" IN ('template', 'planned', 'resolved_execution'))
);
--> statement-breakpoint
ALTER TABLE "prescribed_activities" ADD CONSTRAINT "prescribed_activities_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_exercises" ADD CONSTRAINT "prescribed_exercises_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_exercises" ADD CONSTRAINT "prescribed_exercises_strength_activity_id_prescribed_strength_activities_id_fk" FOREIGN KEY ("strength_activity_id") REFERENCES "public"."prescribed_strength_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_exercises" ADD CONSTRAINT "prescribed_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_run_steps" ADD CONSTRAINT "prescribed_run_steps_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_run_steps" ADD CONSTRAINT "prescribed_run_steps_running_activity_id_prescribed_running_activities_id_fk" FOREIGN KEY ("running_activity_id") REFERENCES "public"."prescribed_running_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_run_steps" ADD CONSTRAINT "prescribed_run_steps_parent_step_id_prescribed_run_steps_id_fk" FOREIGN KEY ("parent_step_id") REFERENCES "public"."prescribed_run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_running_activities" ADD CONSTRAINT "prescribed_running_activities_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_running_activities" ADD CONSTRAINT "prescribed_running_activities_activity_id_prescribed_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."prescribed_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_set_group_members" ADD CONSTRAINT "prescribed_set_group_members_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_set_group_members" ADD CONSTRAINT "prescribed_set_group_members_set_group_id_prescribed_set_groups_id_fk" FOREIGN KEY ("set_group_id") REFERENCES "public"."prescribed_set_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_set_group_members" ADD CONSTRAINT "prescribed_set_group_members_exercise_id_prescribed_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."prescribed_exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_set_groups" ADD CONSTRAINT "prescribed_set_groups_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_set_groups" ADD CONSTRAINT "prescribed_set_groups_strength_activity_id_prescribed_strength_activities_id_fk" FOREIGN KEY ("strength_activity_id") REFERENCES "public"."prescribed_strength_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_set_groups" ADD CONSTRAINT "prescribed_set_groups_parent_group_id_prescribed_set_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "public"."prescribed_set_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_sets" ADD CONSTRAINT "prescribed_sets_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_sets" ADD CONSTRAINT "prescribed_sets_exercise_id_prescribed_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."prescribed_exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_sets" ADD CONSTRAINT "prescribed_sets_set_group_id_prescribed_set_groups_id_fk" FOREIGN KEY ("set_group_id") REFERENCES "public"."prescribed_set_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_strength_activities" ADD CONSTRAINT "prescribed_strength_activities_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_strength_activities" ADD CONSTRAINT "prescribed_strength_activities_activity_id_prescribed_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."prescribed_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_prescriptions" ADD CONSTRAINT "session_prescriptions_source_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("source_prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_activities_position_unique" ON "prescribed_activities" USING btree ("prescription_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_activities_logical_unique" ON "prescribed_activities" USING btree ("prescription_id","logical_key");--> statement-breakpoint
CREATE INDEX "prescribed_activities_prescription_idx" ON "prescribed_activities" USING btree ("prescription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_exercises_position_unique" ON "prescribed_exercises" USING btree ("strength_activity_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_exercises_logical_unique" ON "prescribed_exercises" USING btree ("prescription_id","logical_key");--> statement-breakpoint
CREATE INDEX "prescribed_exercises_prescription_idx" ON "prescribed_exercises" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "prescribed_exercises_activity_idx" ON "prescribed_exercises" USING btree ("strength_activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_run_steps_root_position_unique" ON "prescribed_run_steps" USING btree ("running_activity_id","position") WHERE "prescribed_run_steps"."parent_step_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_run_steps_child_position_unique" ON "prescribed_run_steps" USING btree ("parent_step_id","position") WHERE "prescribed_run_steps"."parent_step_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_run_steps_logical_unique" ON "prescribed_run_steps" USING btree ("prescription_id","logical_key");--> statement-breakpoint
CREATE INDEX "prescribed_run_steps_prescription_idx" ON "prescribed_run_steps" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "prescribed_run_steps_activity_idx" ON "prescribed_run_steps" USING btree ("running_activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_running_activities_activity_unique" ON "prescribed_running_activities" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "prescribed_running_activities_prescription_idx" ON "prescribed_running_activities" USING btree ("prescription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_set_group_members_position_unique" ON "prescribed_set_group_members" USING btree ("set_group_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_set_group_members_exercise_unique" ON "prescribed_set_group_members" USING btree ("set_group_id","exercise_id");--> statement-breakpoint
CREATE INDEX "prescribed_set_group_members_prescription_idx" ON "prescribed_set_group_members" USING btree ("prescription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_set_groups_root_position_unique" ON "prescribed_set_groups" USING btree ("strength_activity_id","position") WHERE "prescribed_set_groups"."parent_group_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_set_groups_child_position_unique" ON "prescribed_set_groups" USING btree ("parent_group_id","position") WHERE "prescribed_set_groups"."parent_group_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_set_groups_logical_unique" ON "prescribed_set_groups" USING btree ("prescription_id","logical_key");--> statement-breakpoint
CREATE INDEX "prescribed_set_groups_prescription_idx" ON "prescribed_set_groups" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "prescribed_set_groups_activity_idx" ON "prescribed_set_groups" USING btree ("strength_activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_sets_position_unique" ON "prescribed_sets" USING btree ("exercise_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_sets_logical_unique" ON "prescribed_sets" USING btree ("prescription_id","logical_key");--> statement-breakpoint
CREATE INDEX "prescribed_sets_prescription_idx" ON "prescribed_sets" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "prescribed_sets_group_idx" ON "prescribed_sets" USING btree ("set_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_strength_activities_activity_unique" ON "prescribed_strength_activities" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "prescribed_strength_activities_prescription_idx" ON "prescribed_strength_activities" USING btree ("prescription_id");--> statement-breakpoint
-- Published prescription rows are immutable (ADR 0003): reject any UPDATE or DELETE at
-- the database, not only in the application. Edits publish a whole new tree instead.
CREATE OR REPLACE FUNCTION "prescription_rows_are_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Prescription rows are immutable (table %, operation %)', TG_TABLE_NAME, TG_OP USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "session_prescriptions_immutable" BEFORE UPDATE OR DELETE ON "session_prescriptions" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE TRIGGER "prescribed_activities_immutable" BEFORE UPDATE OR DELETE ON "prescribed_activities" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE TRIGGER "prescribed_strength_activities_immutable" BEFORE UPDATE OR DELETE ON "prescribed_strength_activities" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE TRIGGER "prescribed_running_activities_immutable" BEFORE UPDATE OR DELETE ON "prescribed_running_activities" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE TRIGGER "prescribed_exercises_immutable" BEFORE UPDATE OR DELETE ON "prescribed_exercises" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE TRIGGER "prescribed_set_groups_immutable" BEFORE UPDATE OR DELETE ON "prescribed_set_groups" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE TRIGGER "prescribed_set_group_members_immutable" BEFORE UPDATE OR DELETE ON "prescribed_set_group_members" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE TRIGGER "prescribed_sets_immutable" BEFORE UPDATE OR DELETE ON "prescribed_sets" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE TRIGGER "prescribed_run_steps_immutable" BEFORE UPDATE OR DELETE ON "prescribed_run_steps" FOR EACH ROW EXECUTE FUNCTION "prescription_rows_are_immutable"();--> statement-breakpoint
CREATE INDEX "session_prescriptions_source_idx" ON "session_prescriptions" USING btree ("source_prescription_id");