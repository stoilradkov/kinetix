CREATE TABLE "performed_run_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"activity_id" uuid NOT NULL,
	"parent_step_id" uuid,
	"type" text NOT NULL,
	"position" integer NOT NULL,
	"repeat_count" integer,
	"distance_m" numeric(14, 3),
	"duration_ms" bigint,
	"average_heart_rate_bpm" integer,
	"max_heart_rate_bpm" integer,
	"average_cadence_rpm" integer,
	"max_cadence_rpm" integer,
	"average_power_w" numeric(12, 2),
	"max_power_w" numeric(12, 2),
	"elevation_gain_m" numeric(14, 3),
	"elevation_loss_m" numeric(14, 3),
	"rpe" numeric(3, 1),
	"entered_measurements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	CONSTRAINT "performed_run_steps_type_valid" CHECK ("performed_run_steps"."type" IN ('warm_up', 'work', 'recovery', 'repeat', 'cool_down', 'open')),
	CONSTRAINT "performed_run_steps_position_nonneg" CHECK ("performed_run_steps"."position" >= 0),
	CONSTRAINT "performed_run_steps_repeat_pair" CHECK (("performed_run_steps"."type" = 'repeat') = ("performed_run_steps"."repeat_count" IS NOT NULL)),
	CONSTRAINT "performed_run_steps_repeat_positive" CHECK ("performed_run_steps"."repeat_count" IS NULL OR "performed_run_steps"."repeat_count" >= 1),
	CONSTRAINT "performed_run_steps_metrics_nonneg" CHECK (("performed_run_steps"."distance_m" IS NULL OR "performed_run_steps"."distance_m" >= 0)
                AND ("performed_run_steps"."duration_ms" IS NULL OR "performed_run_steps"."duration_ms" >= 0)
                AND ("performed_run_steps"."average_power_w" IS NULL OR "performed_run_steps"."average_power_w" >= 0)
                AND ("performed_run_steps"."max_power_w" IS NULL OR "performed_run_steps"."max_power_w" >= 0)
                AND ("performed_run_steps"."elevation_gain_m" IS NULL OR "performed_run_steps"."elevation_gain_m" >= 0)
                AND ("performed_run_steps"."elevation_loss_m" IS NULL OR "performed_run_steps"."elevation_loss_m" >= 0)),
	CONSTRAINT "performed_run_steps_rates_range" CHECK (("performed_run_steps"."average_heart_rate_bpm" IS NULL OR "performed_run_steps"."average_heart_rate_bpm" BETWEEN 0 AND 999)
                AND ("performed_run_steps"."max_heart_rate_bpm" IS NULL OR "performed_run_steps"."max_heart_rate_bpm" BETWEEN 0 AND 999)
                AND ("performed_run_steps"."average_cadence_rpm" IS NULL OR "performed_run_steps"."average_cadence_rpm" BETWEEN 0 AND 999)
                AND ("performed_run_steps"."max_cadence_rpm" IS NULL OR "performed_run_steps"."max_cadence_rpm" BETWEEN 0 AND 999)),
	CONSTRAINT "performed_run_steps_rpe_range" CHECK ("performed_run_steps"."rpe" IS NULL OR "performed_run_steps"."rpe" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "run_splits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"activity_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"distance_m" numeric(14, 3),
	"moving_time_ms" bigint,
	"elapsed_time_ms" bigint,
	"average_heart_rate_bpm" integer,
	"max_heart_rate_bpm" integer,
	"average_cadence_rpm" integer,
	"average_power_w" numeric(12, 2),
	"elevation_gain_m" numeric(14, 3),
	"elevation_loss_m" numeric(14, 3),
	"entered_measurements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	CONSTRAINT "run_splits_position_nonneg" CHECK ("run_splits"."position" >= 0),
	CONSTRAINT "run_splits_metrics_nonneg" CHECK (("run_splits"."distance_m" IS NULL OR "run_splits"."distance_m" >= 0)
                AND ("run_splits"."moving_time_ms" IS NULL OR "run_splits"."moving_time_ms" >= 0)
                AND ("run_splits"."elapsed_time_ms" IS NULL OR "run_splits"."elapsed_time_ms" >= 0)
                AND ("run_splits"."average_power_w" IS NULL OR "run_splits"."average_power_w" >= 0)
                AND ("run_splits"."elevation_gain_m" IS NULL OR "run_splits"."elevation_gain_m" >= 0)
                AND ("run_splits"."elevation_loss_m" IS NULL OR "run_splits"."elevation_loss_m" >= 0)),
	CONSTRAINT "run_splits_rates_range" CHECK (("run_splits"."average_heart_rate_bpm" IS NULL OR "run_splits"."average_heart_rate_bpm" BETWEEN 0 AND 999)
                AND ("run_splits"."max_heart_rate_bpm" IS NULL OR "run_splits"."max_heart_rate_bpm" BETWEEN 0 AND 999)
                AND ("run_splits"."average_cadence_rpm" IS NULL OR "run_splits"."average_cadence_rpm" BETWEEN 0 AND 999)),
	CONSTRAINT "run_splits_moving_le_elapsed" CHECK ("run_splits"."moving_time_ms" IS NULL OR "run_splits"."elapsed_time_ms" IS NULL OR "run_splits"."moving_time_ms" <= "run_splits"."elapsed_time_ms")
);
--> statement-breakpoint
CREATE TABLE "run_zone_times" (
	"id" uuid PRIMARY KEY NOT NULL,
	"activity_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"family" text NOT NULL,
	"zone_definition_id" uuid,
	"zone_range_id" uuid,
	"zone_name" text,
	"duration_ms" bigint NOT NULL,
	"entered_measurements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "run_zone_times_family_valid" CHECK ("run_zone_times"."family" IN ('heart_rate', 'pace', 'power')),
	CONSTRAINT "run_zone_times_position_nonneg" CHECK ("run_zone_times"."position" >= 0),
	CONSTRAINT "run_zone_times_duration_positive" CHECK ("run_zone_times"."duration_ms" > 0)
);
--> statement-breakpoint
ALTER TABLE "running_activities" ADD COLUMN "gear_item_id" uuid;--> statement-breakpoint
ALTER TABLE "running_activities" ADD COLUMN "route" jsonb;--> statement-breakpoint
ALTER TABLE "performed_run_steps" ADD CONSTRAINT "performed_run_steps_activity_id_session_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."session_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_run_steps" ADD CONSTRAINT "performed_run_steps_parent_step_id_performed_run_steps_id_fk" FOREIGN KEY ("parent_step_id") REFERENCES "public"."performed_run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_splits" ADD CONSTRAINT "run_splits_activity_id_session_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."session_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_zone_times" ADD CONSTRAINT "run_zone_times_activity_id_session_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."session_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_zone_times" ADD CONSTRAINT "run_zone_times_zone_definition_id_zone_definitions_id_fk" FOREIGN KEY ("zone_definition_id") REFERENCES "public"."zone_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_zone_times" ADD CONSTRAINT "run_zone_times_zone_range_id_zone_ranges_id_fk" FOREIGN KEY ("zone_range_id") REFERENCES "public"."zone_ranges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "performed_run_steps_root_position_unique" ON "performed_run_steps" USING btree ("activity_id","position") WHERE "performed_run_steps"."parent_step_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "performed_run_steps_child_position_unique" ON "performed_run_steps" USING btree ("parent_step_id","position") WHERE "performed_run_steps"."parent_step_id" is not null;--> statement-breakpoint
CREATE INDEX "performed_run_steps_activity_idx" ON "performed_run_steps" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_splits_position_unique" ON "run_splits" USING btree ("activity_id","position");--> statement-breakpoint
CREATE INDEX "run_splits_activity_idx" ON "run_splits" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_zone_times_position_unique" ON "run_zone_times" USING btree ("activity_id","position");--> statement-breakpoint
CREATE INDEX "run_zone_times_activity_idx" ON "run_zone_times" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "run_zone_times_definition_idx" ON "run_zone_times" USING btree ("zone_definition_id");--> statement-breakpoint
ALTER TABLE "run_step_mappings" ADD CONSTRAINT "run_step_mappings_performed_run_step_id_performed_run_steps_id_fk" FOREIGN KEY ("performed_run_step_id") REFERENCES "public"."performed_run_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "running_activities" ADD CONSTRAINT "running_activities_gear_item_id_gear_items_id_fk" FOREIGN KEY ("gear_item_id") REFERENCES "public"."gear_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "running_activities" ADD CONSTRAINT "running_activities_route_valid" CHECK ("running_activities"."route" IS NULL OR "running_activities"."route" ? 'schemaVersion');