CREATE TYPE "public"."module_instance_status" AS ENUM('active', 'disabled', 'archived');--> statement-breakpoint
CREATE TABLE "module_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_type" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "module_instance_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "module_instances_slug_unique" ON "module_instances" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "module_instances_type_status_idx" ON "module_instances" USING btree ("module_type","status");
--> statement-breakpoint
INSERT INTO "module_instances" ("id", "module_type", "name", "slug", "status", "settings")
VALUES (
	'00000000-0000-4000-8000-000000000001',
	'training',
	'Training',
	'training',
	'active',
	'{}'::jsonb
)
ON CONFLICT ("slug") DO NOTHING;
