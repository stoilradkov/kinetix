CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"birth_date" date,
	"sex" text,
	"height_m" numeric(6, 3),
	"time_zone" text NOT NULL,
	"unit_preferences" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_status_valid" CHECK ("profiles"."status" IN ('active', 'archived')),
	CONSTRAINT "profiles_sex_valid" CHECK ("profiles"."sex" IS NULL OR "profiles"."sex" IN ('female', 'male', 'intersex', 'other')),
	CONSTRAINT "profiles_height_valid" CHECK ("profiles"."height_m" IS NULL OR ("profiles"."height_m" > 0 AND "profiles"."height_m" <= 3)),
	CONSTRAINT "profiles_time_zone_valid" CHECK (length(btrim("profiles"."time_zone")) > 0),
	CONSTRAINT "profiles_version_positive" CHECK ("profiles"."version" > 0),
	CONSTRAINT "profiles_archive_state_valid" CHECK (("profiles"."status" = 'active' AND "profiles"."archived_at" IS NULL)
                OR ("profiles"."status" = 'archived' AND "profiles"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_single_active_unique" ON "profiles" USING btree ("status") WHERE "profiles"."status" = 'active';