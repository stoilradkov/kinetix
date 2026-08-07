CREATE TABLE "running_activities" (
	"activity_id" uuid PRIMARY KEY NOT NULL,
	"distance_m" numeric(14, 3),
	"moving_time_ms" bigint,
	"elapsed_time_ms" bigint,
	"average_heart_rate_bpm" integer,
	"max_heart_rate_bpm" integer,
	"average_cadence_rpm" integer,
	"max_cadence_rpm" integer,
	"average_power_w" numeric(12, 2),
	"max_power_w" numeric(12, 2),
	"elevation_gain_m" numeric(14, 3),
	"elevation_loss_m" numeric(14, 3),
	"calories" integer,
	"stride_length_m" numeric(14, 3),
	"ground_contact_time_ms" bigint,
	"vertical_oscillation_m" numeric(14, 3),
	"vo2max" numeric(6, 2),
	"rpe" numeric(3, 1),
	"indoor" boolean DEFAULT false NOT NULL,
	"treadmill" boolean DEFAULT false NOT NULL,
	"run_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entered_measurements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"environment" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "running_activities_metrics_nonneg" CHECK (("running_activities"."distance_m" IS NULL OR "running_activities"."distance_m" >= 0)
                AND ("running_activities"."moving_time_ms" IS NULL OR "running_activities"."moving_time_ms" >= 0)
                AND ("running_activities"."elapsed_time_ms" IS NULL OR "running_activities"."elapsed_time_ms" >= 0)
                AND ("running_activities"."average_power_w" IS NULL OR "running_activities"."average_power_w" >= 0)
                AND ("running_activities"."max_power_w" IS NULL OR "running_activities"."max_power_w" >= 0)
                AND ("running_activities"."elevation_gain_m" IS NULL OR "running_activities"."elevation_gain_m" >= 0)
                AND ("running_activities"."elevation_loss_m" IS NULL OR "running_activities"."elevation_loss_m" >= 0)
                AND ("running_activities"."calories" IS NULL OR "running_activities"."calories" >= 0)
                AND ("running_activities"."stride_length_m" IS NULL OR "running_activities"."stride_length_m" >= 0)
                AND ("running_activities"."ground_contact_time_ms" IS NULL OR "running_activities"."ground_contact_time_ms" >= 0)
                AND ("running_activities"."vertical_oscillation_m" IS NULL OR "running_activities"."vertical_oscillation_m" >= 0)
                AND ("running_activities"."vo2max" IS NULL OR "running_activities"."vo2max" >= 0)),
	CONSTRAINT "running_activities_rates_range" CHECK (("running_activities"."average_heart_rate_bpm" IS NULL OR "running_activities"."average_heart_rate_bpm" BETWEEN 0 AND 999)
                AND ("running_activities"."max_heart_rate_bpm" IS NULL OR "running_activities"."max_heart_rate_bpm" BETWEEN 0 AND 999)
                AND ("running_activities"."average_cadence_rpm" IS NULL OR "running_activities"."average_cadence_rpm" BETWEEN 0 AND 999)
                AND ("running_activities"."max_cadence_rpm" IS NULL OR "running_activities"."max_cadence_rpm" BETWEEN 0 AND 999)),
	CONSTRAINT "running_activities_rpe_range" CHECK ("running_activities"."rpe" IS NULL OR "running_activities"."rpe" BETWEEN 1 AND 10),
	CONSTRAINT "running_activities_moving_le_elapsed" CHECK ("running_activities"."moving_time_ms" IS NULL OR "running_activities"."elapsed_time_ms" IS NULL OR "running_activities"."moving_time_ms" <= "running_activities"."elapsed_time_ms"),
	CONSTRAINT "running_activities_treadmill_indoor" CHECK (NOT "running_activities"."treadmill" OR "running_activities"."indoor")
);
--> statement-breakpoint
ALTER TABLE "running_activities" ADD CONSTRAINT "running_activities_activity_id_session_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."session_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "running_activities_distance_idx" ON "running_activities" USING btree ("distance_m");--> statement-breakpoint
CREATE INDEX "running_activities_moving_time_idx" ON "running_activities" USING btree ("moving_time_ms");