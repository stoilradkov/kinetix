ALTER TABLE "progression_evaluations" ADD COLUMN "stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "progression_evaluations" ADD COLUMN "result_revisions" jsonb DEFAULT '[]'::jsonb NOT NULL;