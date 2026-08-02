CREATE TABLE "activity_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"prescribed_activity_id" uuid,
	"actual_activity_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_mappings_relation_valid" CHECK ("activity_mappings"."relation" IN ('matched', 'substituted', 'added', 'partial', 'combined', 'split')),
	CONSTRAINT "activity_mappings_added_pair" CHECK (("activity_mappings"."prescribed_activity_id" IS NULL) = ("activity_mappings"."relation" = 'added'))
);
--> statement-breakpoint
CREATE TABLE "exercise_occurrence_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"prescribed_exercise_id" uuid,
	"occurrence_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_occurrence_mappings_relation_valid" CHECK ("exercise_occurrence_mappings"."relation" IN ('matched', 'substituted', 'added', 'partial', 'combined', 'split')),
	CONSTRAINT "exercise_occurrence_mappings_added_pair" CHECK (("exercise_occurrence_mappings"."prescribed_exercise_id" IS NULL) = ("exercise_occurrence_mappings"."relation" = 'added'))
);
--> statement-breakpoint
CREATE TABLE "run_step_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"prescribed_run_step_id" uuid,
	"performed_run_step_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_step_mappings_relation_valid" CHECK ("run_step_mappings"."relation" IN ('matched', 'substituted', 'added', 'partial', 'combined', 'split')),
	CONSTRAINT "run_step_mappings_added_pair" CHECK (("run_step_mappings"."prescribed_run_step_id" IS NULL) = ("run_step_mappings"."relation" = 'added'))
);
--> statement-breakpoint
CREATE TABLE "session_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"planned_session_id" uuid NOT NULL,
	"source_prescription_id" uuid NOT NULL,
	"resolved_prescription_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "set_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"prescribed_set_id" uuid,
	"performed_set_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"portion" numeric(5, 4),
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "set_mappings_relation_valid" CHECK ("set_mappings"."relation" IN ('matched', 'substituted', 'added', 'partial', 'combined', 'split')),
	CONSTRAINT "set_mappings_added_pair" CHECK (("set_mappings"."prescribed_set_id" IS NULL) = ("set_mappings"."relation" = 'added')),
	CONSTRAINT "set_mappings_portion_range" CHECK ("set_mappings"."portion" IS NULL OR ("set_mappings"."portion" > 0 AND "set_mappings"."portion" <= 1))
);
--> statement-breakpoint
ALTER TABLE "activity_mappings" ADD CONSTRAINT "activity_mappings_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_mappings" ADD CONSTRAINT "activity_mappings_prescribed_activity_id_prescribed_activities_id_fk" FOREIGN KEY ("prescribed_activity_id") REFERENCES "public"."prescribed_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_mappings" ADD CONSTRAINT "activity_mappings_actual_activity_id_session_activities_id_fk" FOREIGN KEY ("actual_activity_id") REFERENCES "public"."session_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_occurrence_mappings" ADD CONSTRAINT "exercise_occurrence_mappings_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_occurrence_mappings" ADD CONSTRAINT "exercise_occurrence_mappings_prescribed_exercise_id_prescribed_exercises_id_fk" FOREIGN KEY ("prescribed_exercise_id") REFERENCES "public"."prescribed_exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_occurrence_mappings" ADD CONSTRAINT "exercise_occurrence_mappings_occurrence_id_exercise_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."exercise_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step_mappings" ADD CONSTRAINT "run_step_mappings_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step_mappings" ADD CONSTRAINT "run_step_mappings_prescribed_run_step_id_prescribed_run_steps_id_fk" FOREIGN KEY ("prescribed_run_step_id") REFERENCES "public"."prescribed_run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_mappings" ADD CONSTRAINT "session_mappings_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_mappings" ADD CONSTRAINT "session_mappings_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_mappings" ADD CONSTRAINT "session_mappings_source_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("source_prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_mappings" ADD CONSTRAINT "session_mappings_resolved_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("resolved_prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_mappings" ADD CONSTRAINT "set_mappings_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_mappings" ADD CONSTRAINT "set_mappings_prescribed_set_id_prescribed_sets_id_fk" FOREIGN KEY ("prescribed_set_id") REFERENCES "public"."prescribed_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_mappings" ADD CONSTRAINT "set_mappings_performed_set_id_performed_sets_id_fk" FOREIGN KEY ("performed_set_id") REFERENCES "public"."performed_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_mappings_session_idx" ON "activity_mappings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "activity_mappings_prescribed_idx" ON "activity_mappings" USING btree ("prescribed_activity_id");--> statement-breakpoint
CREATE INDEX "activity_mappings_actual_idx" ON "activity_mappings" USING btree ("actual_activity_id");--> statement-breakpoint
CREATE INDEX "exercise_occurrence_mappings_session_idx" ON "exercise_occurrence_mappings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "exercise_occurrence_mappings_prescribed_idx" ON "exercise_occurrence_mappings" USING btree ("prescribed_exercise_id");--> statement-breakpoint
CREATE INDEX "exercise_occurrence_mappings_actual_idx" ON "exercise_occurrence_mappings" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "run_step_mappings_session_idx" ON "run_step_mappings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "run_step_mappings_prescribed_idx" ON "run_step_mappings" USING btree ("prescribed_run_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_mappings_session_planned_unique" ON "session_mappings" USING btree ("session_id","planned_session_id");--> statement-breakpoint
CREATE INDEX "session_mappings_planned_idx" ON "session_mappings" USING btree ("planned_session_id");--> statement-breakpoint
CREATE INDEX "session_mappings_resolved_idx" ON "session_mappings" USING btree ("resolved_prescription_id");--> statement-breakpoint
CREATE INDEX "set_mappings_session_idx" ON "set_mappings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "set_mappings_prescribed_idx" ON "set_mappings" USING btree ("prescribed_set_id");--> statement-breakpoint
CREATE INDEX "set_mappings_actual_idx" ON "set_mappings" USING btree ("performed_set_id");