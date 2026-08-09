CREATE TABLE "progression_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"target_mode" text NOT NULL,
	"target_selector" jsonb NOT NULL,
	"condition_schema_version" smallint DEFAULT 1 NOT NULL,
	"condition" jsonb NOT NULL,
	"action_schema_version" smallint DEFAULT 1 NOT NULL,
	"actions" jsonb NOT NULL,
	"triggers" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_apply" boolean DEFAULT false NOT NULL,
	"safety_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progression_rules_name_valid" CHECK (length(btrim("progression_rules"."name")) > 0),
	CONSTRAINT "progression_rules_scope_type_valid" CHECK ("progression_rules"."scope_type" IN ('program', 'block', 'template', 'exercise', 'set')),
	CONSTRAINT "progression_rules_target_mode_valid" CHECK ("progression_rules"."target_mode" IN ('next', 'block_future', 'template')),
	CONSTRAINT "progression_rules_condition_schema_version_positive" CHECK ("progression_rules"."condition_schema_version" > 0),
	CONSTRAINT "progression_rules_action_schema_version_positive" CHECK ("progression_rules"."action_schema_version" > 0),
	CONSTRAINT "progression_rules_status_valid" CHECK ("progression_rules"."status" IN ('active', 'archived')),
	CONSTRAINT "progression_rules_archive_state_valid" CHECK (("progression_rules"."status" = 'active' AND "progression_rules"."archived_at" IS NULL)
                OR ("progression_rules"."status" = 'archived' AND "progression_rules"."archived_at" IS NOT NULL)),
	CONSTRAINT "progression_rules_template_approval_valid" CHECK (NOT ("progression_rules"."auto_apply" AND "progression_rules"."target_mode" = 'template')),
	CONSTRAINT "progression_rules_version_positive" CHECK ("progression_rules"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX "progression_rules_profile_idx" ON "progression_rules" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "progression_rules_scope_idx" ON "progression_rules" USING btree ("scope_type","scope_id");