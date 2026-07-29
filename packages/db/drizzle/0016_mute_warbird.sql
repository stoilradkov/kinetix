CREATE TABLE "workout_template_prescriptions" (
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"prescription_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_template_prescriptions_pk" PRIMARY KEY("template_id","template_version"),
	CONSTRAINT "workout_template_prescriptions_version_positive" CHECK ("workout_template_prescriptions"."template_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "workout_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"current_prescription_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_templates_name_valid" CHECK (length(btrim("workout_templates"."name")) > 0),
	CONSTRAINT "workout_templates_status_valid" CHECK ("workout_templates"."status" IN ('active', 'archived')),
	CONSTRAINT "workout_templates_archive_state_valid" CHECK (("workout_templates"."status" = 'active' AND "workout_templates"."archived_at" IS NULL)
                OR ("workout_templates"."status" = 'archived' AND "workout_templates"."archived_at" IS NOT NULL)),
	CONSTRAINT "workout_templates_version_positive" CHECK ("workout_templates"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "workout_template_prescriptions" ADD CONSTRAINT "workout_template_prescriptions_template_id_workout_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workout_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_template_prescriptions" ADD CONSTRAINT "workout_template_prescriptions_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_current_prescription_id_session_prescriptions_id_fk" FOREIGN KEY ("current_prescription_id") REFERENCES "public"."session_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_template_prescriptions_prescription_idx" ON "workout_template_prescriptions" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "workout_templates_profile_idx" ON "workout_templates" USING btree ("profile_id","status");