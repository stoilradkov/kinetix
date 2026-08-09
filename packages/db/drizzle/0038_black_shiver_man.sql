CREATE TABLE "analytics_invalidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dependency" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"reason" text NOT NULL,
	"event_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "analytics_invalidations_dependency_valid" CHECK ("analytics_invalidations"."dependency" IN ('session', 'exercise', 'context', 'zone', 'plan')),
	CONSTRAINT "analytics_invalidations_status_valid" CHECK ("analytics_invalidations"."status" IN ('pending', 'processed'))
);
--> statement-breakpoint
CREATE TABLE "derived_metric_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "derived_metric_inputs_revision_valid" CHECK ("derived_metric_inputs"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "derived_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"calculator_key" text NOT NULL,
	"calculator_version" integer NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"period" jsonb NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"natural_key" text NOT NULL,
	"numeric_value" numeric,
	"text_value" text,
	"unit" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_fingerprint" text NOT NULL,
	"state" text DEFAULT 'current' NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "derived_metrics_state_valid" CHECK ("derived_metrics"."state" IN ('current', 'superseded')),
	CONSTRAINT "derived_metrics_version_valid" CHECK ("derived_metrics"."calculator_version" >= 1),
	CONSTRAINT "derived_metrics_natural_key_valid" CHECK ("derived_metrics"."natural_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "derived_metrics_fingerprint_valid" CHECK ("derived_metrics"."source_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"finding_key" text NOT NULL,
	"finding_version" integer NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"natural_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"feedback" jsonb,
	"source_fingerprint" text NOT NULL,
	"state" text DEFAULT 'current' NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_state_valid" CHECK ("findings"."state" IN ('current', 'superseded')),
	CONSTRAINT "findings_status_valid" CHECK ("findings"."status" IN ('active', 'acknowledged', 'dismissed', 'expired')),
	CONSTRAINT "findings_version_valid" CHECK ("findings"."finding_version" >= 1),
	CONSTRAINT "findings_natural_key_valid" CHECK ("findings"."natural_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "findings_fingerprint_valid" CHECK ("findings"."source_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "derived_metric_inputs" ADD CONSTRAINT "derived_metric_inputs_metric_id_derived_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."derived_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_invalidations_pending_unique" ON "analytics_invalidations" USING btree ("dependency","scope_type","scope_id") WHERE "analytics_invalidations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "analytics_invalidations_pending_idx" ON "analytics_invalidations" USING btree ("created_at","id") WHERE "analytics_invalidations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "derived_metric_inputs_metric_idx" ON "derived_metric_inputs" USING btree ("metric_id");--> statement-breakpoint
CREATE INDEX "derived_metric_inputs_source_idx" ON "derived_metric_inputs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "derived_metrics_current_unique" ON "derived_metrics" USING btree ("natural_key") WHERE "derived_metrics"."state" = 'current';--> statement-breakpoint
CREATE INDEX "derived_metrics_scope_idx" ON "derived_metrics" USING btree ("scope_type","scope_id") WHERE "derived_metrics"."state" = 'current';--> statement-breakpoint
CREATE INDEX "derived_metrics_calculator_idx" ON "derived_metrics" USING btree ("calculator_key","calculated_at") WHERE "derived_metrics"."state" = 'current';--> statement-breakpoint
CREATE INDEX "derived_metrics_profile_idx" ON "derived_metrics" USING btree ("profile_id","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_current_unique" ON "findings" USING btree ("natural_key") WHERE "findings"."state" = 'current';--> statement-breakpoint
CREATE INDEX "findings_scope_idx" ON "findings" USING btree ("scope_type","scope_id") WHERE "findings"."state" = 'current';--> statement-breakpoint
CREATE INDEX "findings_profile_idx" ON "findings" USING btree ("profile_id","calculated_at");