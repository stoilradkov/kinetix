CREATE TABLE "progression_evaluation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action_type" text NOT NULL,
	"action" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progression_evaluation_actions_status_valid" CHECK ("progression_evaluation_actions"."status" IN ('proposed', 'applied', 'rejected')),
	CONSTRAINT "progression_evaluation_actions_position_valid" CHECK ("progression_evaluation_actions"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "progression_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_name" text NOT NULL,
	"training_session_id" uuid NOT NULL,
	"training_session_version" integer NOT NULL,
	"trigger" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"target_mode" text NOT NULL,
	"target_selector" jsonb NOT NULL,
	"matched" boolean NOT NULL,
	"status" text NOT NULL,
	"explanation" jsonb NOT NULL,
	"missing_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_revisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_fingerprint" text NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progression_evaluations_trigger_valid" CHECK ("progression_evaluations"."trigger" IN ('session_completed', 'scheduled', 'manual')),
	CONSTRAINT "progression_evaluations_scope_type_valid" CHECK ("progression_evaluations"."scope_type" IN ('program', 'block', 'template', 'exercise', 'set')),
	CONSTRAINT "progression_evaluations_target_mode_valid" CHECK ("progression_evaluations"."target_mode" IN ('next', 'block_future', 'template')),
	CONSTRAINT "progression_evaluations_status_valid" CHECK ("progression_evaluations"."status" IN ('unmatched', 'pending', 'blocked', 'applied', 'rejected')),
	CONSTRAINT "progression_evaluations_version_valid" CHECK ("progression_evaluations"."training_session_version" >= 1 AND "progression_evaluations"."rule_version" >= 1),
	CONSTRAINT "progression_evaluations_fingerprint_valid" CHECK ("progression_evaluations"."context_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "progression_evaluation_actions" ADD CONSTRAINT "progression_evaluation_actions_evaluation_id_progression_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."progression_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_rule_id_progression_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."progression_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_training_session_id_training_sessions_id_fk" FOREIGN KEY ("training_session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "progression_evaluation_actions_evaluation_idx" ON "progression_evaluation_actions" USING btree ("evaluation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "progression_evaluations_fingerprint_unique" ON "progression_evaluations" USING btree ("context_fingerprint");--> statement-breakpoint
CREATE INDEX "progression_evaluations_session_idx" ON "progression_evaluations" USING btree ("training_session_id");--> statement-breakpoint
CREATE INDEX "progression_evaluations_rule_idx" ON "progression_evaluations" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "progression_evaluations_profile_idx" ON "progression_evaluations" USING btree ("profile_id","status","evaluated_at");