CREATE TABLE "pain_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"activity_id" uuid,
	"exercise_occurrence_id" uuid,
	"performed_set_id" uuid,
	"body_area" text NOT NULL,
	"side" text NOT NULL,
	"severity" smallint NOT NULL,
	"pain_type" text,
	"onset_during_session" boolean DEFAULT false NOT NULL,
	"stopped_activity" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pain_records_body_area_valid" CHECK (length(btrim("pain_records"."body_area")) BETWEEN 1 AND 120),
	CONSTRAINT "pain_records_side_valid" CHECK ("pain_records"."side" IN ('left', 'right', 'bilateral')),
	CONSTRAINT "pain_records_severity_range" CHECK ("pain_records"."severity" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE "session_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"position" integer NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"rpe" smallint,
	"feeling" text,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_activities_type_valid" CHECK ("session_activities"."type" IN ('strength', 'running')),
	CONSTRAINT "session_activities_position_nonneg" CHECK ("session_activities"."position" >= 0),
	CONSTRAINT "session_activities_end_after_start" CHECK ("session_activities"."ended_at" IS NULL OR ("session_activities"."started_at" IS NOT NULL AND "session_activities"."ended_at" >= "session_activities"."started_at")),
	CONSTRAINT "session_activities_duration_nonneg" CHECK ("session_activities"."duration_seconds" IS NULL OR "session_activities"."duration_seconds" >= 0),
	CONSTRAINT "session_activities_rpe_range" CHECK ("session_activities"."rpe" IS NULL OR "session_activities"."rpe" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text,
	"local_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer,
	"readiness_energy" smallint,
	"readiness_motivation" smallint,
	"readiness_fatigue" smallint,
	"readiness_soreness" smallint,
	"readiness_stress" smallint,
	"readiness_recovery" smallint,
	"post_energy" smallint,
	"post_motivation" smallint,
	"post_enjoyment" smallint,
	"post_difficulty" smallint,
	"post_fatigue" smallint,
	"post_notes" text,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_planned_session_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_sessions_status_valid" CHECK ("training_sessions"."status" IN ('draft', 'in_progress', 'completed')),
	CONSTRAINT "training_sessions_started_required" CHECK ("training_sessions"."status" = 'draft' OR "training_sessions"."started_at" IS NOT NULL),
	CONSTRAINT "training_sessions_ended_required" CHECK ("training_sessions"."status" <> 'completed' OR "training_sessions"."ended_at" IS NOT NULL),
	CONSTRAINT "training_sessions_end_after_start" CHECK ("training_sessions"."ended_at" IS NULL OR ("training_sessions"."started_at" IS NOT NULL AND "training_sessions"."ended_at" >= "training_sessions"."started_at")),
	CONSTRAINT "training_sessions_duration_nonneg" CHECK ("training_sessions"."duration_minutes" IS NULL OR "training_sessions"."duration_minutes" >= 0),
	CONSTRAINT "training_sessions_readiness_range" CHECK (("training_sessions"."readiness_energy" IS NULL OR "training_sessions"."readiness_energy" BETWEEN 1 AND 5)
                AND ("training_sessions"."readiness_motivation" IS NULL OR "training_sessions"."readiness_motivation" BETWEEN 1 AND 5)
                AND ("training_sessions"."readiness_fatigue" IS NULL OR "training_sessions"."readiness_fatigue" BETWEEN 1 AND 5)
                AND ("training_sessions"."readiness_soreness" IS NULL OR "training_sessions"."readiness_soreness" BETWEEN 1 AND 5)
                AND ("training_sessions"."readiness_stress" IS NULL OR "training_sessions"."readiness_stress" BETWEEN 1 AND 5)
                AND ("training_sessions"."readiness_recovery" IS NULL OR "training_sessions"."readiness_recovery" BETWEEN 1 AND 5)),
	CONSTRAINT "training_sessions_post_range" CHECK (("training_sessions"."post_energy" IS NULL OR "training_sessions"."post_energy" BETWEEN 1 AND 5)
                AND ("training_sessions"."post_motivation" IS NULL OR "training_sessions"."post_motivation" BETWEEN 1 AND 5)
                AND ("training_sessions"."post_enjoyment" IS NULL OR "training_sessions"."post_enjoyment" BETWEEN 1 AND 5)
                AND ("training_sessions"."post_difficulty" IS NULL OR "training_sessions"."post_difficulty" BETWEEN 1 AND 5)
                AND ("training_sessions"."post_fatigue" IS NULL OR "training_sessions"."post_fatigue" BETWEEN 1 AND 5)),
	CONSTRAINT "training_sessions_version_positive" CHECK ("training_sessions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "pain_records" ADD CONSTRAINT "pain_records_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pain_records" ADD CONSTRAINT "pain_records_activity_id_session_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."session_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_activities" ADD CONSTRAINT "session_activities_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pain_records_session_idx" ON "pain_records" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "pain_records_activity_idx" ON "pain_records" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_activities_position_unique" ON "session_activities" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "session_activities_session_idx" ON "session_activities" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "training_sessions_profile_idx" ON "training_sessions" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "training_sessions_date_idx" ON "training_sessions" USING btree ("profile_id","local_date");--> statement-breakpoint
CREATE INDEX "training_sessions_active_idx" ON "training_sessions" USING btree ("profile_id","archived_at");