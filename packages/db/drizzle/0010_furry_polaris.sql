CREATE TABLE "training_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"type" text NOT NULL,
	"target_value" numeric(12, 3),
	"target_unit" text,
	"start_date" date NOT NULL,
	"target_date" date,
	"priority" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"program_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_goals_type_valid" CHECK ("training_goals"."type" IN ('strength', 'endurance', 'body_composition', 'skill', 'other')),
	CONSTRAINT "training_goals_status_valid" CHECK ("training_goals"."status" IN ('active', 'achieved', 'abandoned')),
	CONSTRAINT "training_goals_target_value_nonnegative" CHECK ("training_goals"."target_value" IS NULL OR "training_goals"."target_value" >= 0),
	CONSTRAINT "training_goals_target_pair" CHECK (("training_goals"."target_value" IS NULL) = ("training_goals"."target_unit" IS NULL)),
	CONSTRAINT "training_goals_target_after_start" CHECK ("training_goals"."target_date" IS NULL OR "training_goals"."target_date" >= "training_goals"."start_date"),
	CONSTRAINT "training_goals_priority_range" CHECK ("training_goals"."priority" BETWEEN 1 AND 1000),
	CONSTRAINT "training_goals_version_positive" CHECK ("training_goals"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX "training_goals_profile_idx" ON "training_goals" USING btree ("profile_id","status","priority");