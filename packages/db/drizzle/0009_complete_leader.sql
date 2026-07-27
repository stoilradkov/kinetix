CREATE TABLE "training_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"experience" text DEFAULT 'beginner' NOT NULL,
	"one_rep_max_rep_cutoff" smallint DEFAULT 12 NOT NULL,
	"hard_set_rpe_threshold" numeric(3, 1) DEFAULT '7' NOT NULL,
	"hard_set_rir_threshold" smallint DEFAULT 3 NOT NULL,
	"calculator_version" integer DEFAULT 1 NOT NULL,
	"rule_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_profiles_status_valid" CHECK ("training_profiles"."status" IN ('active', 'archived')),
	CONSTRAINT "training_profiles_experience_valid" CHECK ("training_profiles"."experience" IN ('beginner', 'intermediate', 'advanced')),
	CONSTRAINT "training_profiles_rep_cutoff_range" CHECK ("training_profiles"."one_rep_max_rep_cutoff" BETWEEN 1 AND 20),
	CONSTRAINT "training_profiles_rpe_range_step" CHECK ("training_profiles"."hard_set_rpe_threshold" BETWEEN 0 AND 10 AND mod("training_profiles"."hard_set_rpe_threshold", 0.5) = 0),
	CONSTRAINT "training_profiles_rir_range" CHECK ("training_profiles"."hard_set_rir_threshold" BETWEEN 0 AND 10),
	CONSTRAINT "training_profiles_calculator_version_positive" CHECK ("training_profiles"."calculator_version" > 0),
	CONSTRAINT "training_profiles_rule_version_positive" CHECK ("training_profiles"."rule_version" > 0),
	CONSTRAINT "training_profiles_version_positive" CHECK ("training_profiles"."version" > 0),
	CONSTRAINT "training_profiles_archive_state_valid" CHECK (("training_profiles"."status" = 'active' AND "training_profiles"."archived_at" IS NULL)
                OR ("training_profiles"."status" = 'archived' AND "training_profiles"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "training_profiles_single_active_unique" ON "training_profiles" USING btree ("status") WHERE "training_profiles"."status" = 'active';--> statement-breakpoint
CREATE INDEX "training_profiles_profile_idx" ON "training_profiles" USING btree ("profile_id");