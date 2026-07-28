CREATE TABLE "training_injuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body_area" text NOT NULL,
	"side" text,
	"severity" text DEFAULT 'moderate' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"onset_date" date NOT NULL,
	"resolved_date" date,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_injuries_side_valid" CHECK ("training_injuries"."side" IS NULL OR "training_injuries"."side" IN ('left', 'right', 'bilateral')),
	CONSTRAINT "training_injuries_severity_valid" CHECK ("training_injuries"."severity" IN ('mild', 'moderate', 'severe')),
	CONSTRAINT "training_injuries_status_valid" CHECK ("training_injuries"."status" IN ('active', 'recovering', 'resolved')),
	CONSTRAINT "training_injuries_resolved_after_onset" CHECK ("training_injuries"."resolved_date" IS NULL OR "training_injuries"."resolved_date" >= "training_injuries"."onset_date"),
	CONSTRAINT "training_injuries_resolved_pair" CHECK (("training_injuries"."status" = 'resolved') = ("training_injuries"."resolved_date" IS NOT NULL)),
	CONSTRAINT "training_injuries_version_positive" CHECK ("training_injuries"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_injury_exercises" (
	"injury_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	CONSTRAINT "training_injury_exercises_injury_id_exercise_id_pk" PRIMARY KEY("injury_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "training_injury_muscles" (
	"injury_id" uuid NOT NULL,
	"muscle_group_id" uuid NOT NULL,
	CONSTRAINT "training_injury_muscles_injury_id_muscle_group_id_pk" PRIMARY KEY("injury_id","muscle_group_id")
);
--> statement-breakpoint
ALTER TABLE "training_injury_exercises" ADD CONSTRAINT "training_injury_exercises_injury_id_training_injuries_id_fk" FOREIGN KEY ("injury_id") REFERENCES "public"."training_injuries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_injury_muscles" ADD CONSTRAINT "training_injury_muscles_injury_id_training_injuries_id_fk" FOREIGN KEY ("injury_id") REFERENCES "public"."training_injuries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_injuries_profile_idx" ON "training_injuries" USING btree ("profile_id","status");