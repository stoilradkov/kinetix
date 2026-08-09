CREATE TABLE "adherence_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"component_key" text NOT NULL,
	"scope" text NOT NULL,
	"score" numeric(6, 3),
	"weight" numeric(6, 3) NOT NULL,
	"included" boolean NOT NULL,
	"exclusion_reason" text,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adherence_components_key_valid" CHECK ("adherence_components"."component_key" IN ('session_completion', 'activity_completion', 'exercise_completion', 'set_completion', 'reps', 'load', 'volume', 'duration', 'distance', 'pace', 'step_completion', 'intensity')),
	CONSTRAINT "adherence_components_scope_valid" CHECK ("adherence_components"."scope" IN ('session', 'strength', 'running', 'mixed')),
	CONSTRAINT "adherence_components_score_valid" CHECK ("adherence_components"."score" IS NULL OR ("adherence_components"."score" >= 0 AND "adherence_components"."score" <= 100)),
	CONSTRAINT "adherence_components_weight_valid" CHECK ("adherence_components"."weight" >= 0),
	CONSTRAINT "adherence_components_position_valid" CHECK ("adherence_components"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "adherence_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"training_session_id" uuid NOT NULL,
	"training_session_version" integer NOT NULL,
	"planned_session_id" uuid,
	"source_prescription_id" uuid NOT NULL,
	"resolved_prescription_id" uuid NOT NULL,
	"formula" text NOT NULL,
	"scope" text NOT NULL,
	"overall_score" numeric(6, 3),
	"source_fingerprint" text NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'current' NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adherence_results_scope_valid" CHECK ("adherence_results"."scope" IN ('strength', 'running', 'mixed')),
	CONSTRAINT "adherence_results_state_valid" CHECK ("adherence_results"."state" IN ('current', 'superseded')),
	CONSTRAINT "adherence_results_version_valid" CHECK ("adherence_results"."training_session_version" >= 1),
	CONSTRAINT "adherence_results_score_valid" CHECK ("adherence_results"."overall_score" IS NULL OR ("adherence_results"."overall_score" >= 0 AND "adherence_results"."overall_score" <= 100)),
	CONSTRAINT "adherence_results_fingerprint_valid" CHECK ("adherence_results"."source_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "adherence_components" ADD CONSTRAINT "adherence_components_result_id_adherence_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."adherence_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adherence_results" ADD CONSTRAINT "adherence_results_training_session_id_training_sessions_id_fk" FOREIGN KEY ("training_session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adherence_results" ADD CONSTRAINT "adherence_results_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adherence_results" ADD CONSTRAINT "adherence_results_source_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("source_prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adherence_results" ADD CONSTRAINT "adherence_results_resolved_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("resolved_prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adherence_components_result_idx" ON "adherence_components" USING btree ("result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "adherence_results_current_unique" ON "adherence_results" USING btree ("training_session_id","resolved_prescription_id") WHERE "adherence_results"."state" = 'current';--> statement-breakpoint
CREATE INDEX "adherence_results_session_idx" ON "adherence_results" USING btree ("training_session_id");--> statement-breakpoint
CREATE INDEX "adherence_results_profile_idx" ON "adherence_results" USING btree ("profile_id","calculated_at");--> statement-breakpoint
CREATE INDEX "adherence_results_planned_idx" ON "adherence_results" USING btree ("planned_session_id");