CREATE TABLE "planned_session_blocks" (
	"planned_session_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_session_blocks_pk" PRIMARY KEY("planned_session_id","block_id")
);
--> statement-breakpoint
CREATE TABLE "planned_session_prescriptions" (
	"planned_session_id" uuid NOT NULL,
	"planned_session_version" integer NOT NULL,
	"prescription_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_session_prescriptions_pk" PRIMARY KEY("planned_session_id","planned_session_version"),
	CONSTRAINT "planned_session_prescriptions_version_positive" CHECK ("planned_session_prescriptions"."planned_session_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "planned_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"title" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"local_date" date,
	"time_zone" text,
	"preferred_time" text,
	"expected_duration_minutes" integer,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skip_reason" text,
	"skip_notes" text,
	"current_prescription_id" uuid NOT NULL,
	"source_template_id" uuid,
	"source_template_version" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_sessions_status_valid" CHECK ("planned_sessions"."status" IN ('planned', 'completed', 'partially_completed', 'skipped', 'cancelled')),
	CONSTRAINT "planned_sessions_skip_reason_valid" CHECK ("planned_sessions"."skip_reason" IS NULL OR "planned_sessions"."skip_reason" IN
                ('illness', 'fatigue', 'pain', 'schedule', 'recovery', 'equipment_unavailable', 'other')),
	CONSTRAINT "planned_sessions_duration_nonneg" CHECK ("planned_sessions"."expected_duration_minutes" IS NULL OR "planned_sessions"."expected_duration_minutes" >= 0),
	CONSTRAINT "planned_sessions_source_pair" CHECK (("planned_sessions"."source_template_id" IS NULL) = ("planned_sessions"."source_template_version" IS NULL)),
	CONSTRAINT "planned_sessions_version_positive" CHECK ("planned_sessions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "program_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"parent_block_id" uuid,
	"type" text NOT NULL,
	"label" text,
	"position" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"relative_start_week" integer,
	"relative_end_week" integer,
	"focus" text,
	"target_muscles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_volume" text,
	"target_intensity" text,
	"deload" boolean DEFAULT false NOT NULL,
	"expected_adaptations" text,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_blocks_type_valid" CHECK ("program_blocks"."type" IN ('macrocycle', 'mesocycle', 'microcycle', 'custom')),
	CONSTRAINT "program_blocks_position_nonneg" CHECK ("program_blocks"."position" >= 0),
	CONSTRAINT "program_blocks_not_self_parent" CHECK ("program_blocks"."parent_block_id" IS NULL OR "program_blocks"."parent_block_id" <> "program_blocks"."id"),
	CONSTRAINT "program_blocks_date_range_valid" CHECK ("program_blocks"."start_date" IS NULL OR "program_blocks"."end_date" IS NULL OR "program_blocks"."start_date" <= "program_blocks"."end_date"),
	CONSTRAINT "program_blocks_relative_range_valid" CHECK ("program_blocks"."relative_start_week" IS NULL OR "program_blocks"."relative_end_week" IS NULL
                OR "program_blocks"."relative_start_week" <= "program_blocks"."relative_end_week")
);
--> statement-breakpoint
CREATE TABLE "program_goals" (
	"program_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_goals_pk" PRIMARY KEY("program_id","goal_id")
);
--> statement-breakpoint
CREATE TABLE "program_planned_sessions" (
	"program_id" uuid NOT NULL,
	"planned_session_id" uuid NOT NULL,
	"relative_week" integer,
	"relative_day" integer,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_planned_sessions_pk" PRIMARY KEY("program_id","planned_session_id"),
	CONSTRAINT "program_planned_sessions_sequence_nonneg" CHECK ("program_planned_sessions"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"schedule_mode" text DEFAULT 'ordered' NOT NULL,
	"start_date" date,
	"end_date" date,
	"focus" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_name_valid" CHECK (length(btrim("programs"."name")) > 0),
	CONSTRAINT "programs_status_valid" CHECK ("programs"."status" IN ('draft', 'active', 'paused', 'completed', 'archived')),
	CONSTRAINT "programs_schedule_mode_valid" CHECK ("programs"."schedule_mode" IN ('relative', 'dated', 'ordered')),
	CONSTRAINT "programs_date_range_valid" CHECK ("programs"."start_date" IS NULL OR "programs"."end_date" IS NULL OR "programs"."start_date" <= "programs"."end_date"),
	CONSTRAINT "programs_archive_state_valid" CHECK (("programs"."status" = 'archived') = ("programs"."archived_at" IS NOT NULL)),
	CONSTRAINT "programs_version_positive" CHECK ("programs"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "planned_session_blocks" ADD CONSTRAINT "planned_session_blocks_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_session_blocks" ADD CONSTRAINT "planned_session_blocks_block_id_program_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."program_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_session_prescriptions" ADD CONSTRAINT "planned_session_prescriptions_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_session_prescriptions" ADD CONSTRAINT "planned_session_prescriptions_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_current_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("current_prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_source_template_id_workout_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."workout_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_blocks" ADD CONSTRAINT "program_blocks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_blocks" ADD CONSTRAINT "program_blocks_parent_block_id_program_blocks_id_fk" FOREIGN KEY ("parent_block_id") REFERENCES "public"."program_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_goals" ADD CONSTRAINT "program_goals_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_goals" ADD CONSTRAINT "program_goals_goal_id_training_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."training_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_planned_sessions" ADD CONSTRAINT "program_planned_sessions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_planned_sessions" ADD CONSTRAINT "program_planned_sessions_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_session_blocks_block_idx" ON "planned_session_blocks" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "planned_session_prescriptions_prescription_idx" ON "planned_session_prescriptions" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "planned_sessions_profile_idx" ON "planned_sessions" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "planned_sessions_date_idx" ON "planned_sessions" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "program_blocks_program_idx" ON "program_blocks" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "program_blocks_parent_idx" ON "program_blocks" USING btree ("parent_block_id");--> statement-breakpoint
CREATE INDEX "program_goals_goal_idx" ON "program_goals" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "program_planned_sessions_session_idx" ON "program_planned_sessions" USING btree ("planned_session_id");--> statement-breakpoint
CREATE INDEX "programs_profile_idx" ON "programs" USING btree ("profile_id","status");