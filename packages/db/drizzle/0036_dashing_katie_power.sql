ALTER TABLE "progression_evaluations" ADD COLUMN "safety_outcome" text DEFAULT 'pass' NOT NULL;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "safety_findings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "safety_missing_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "conflicting_rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "conflict_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "auto_apply_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "auto_apply_reason" text;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_safety_outcome_valid" CHECK ("progression_evaluations"."safety_outcome" IN ('pass', 'requires_approval', 'block'));