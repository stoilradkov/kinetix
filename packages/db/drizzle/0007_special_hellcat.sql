CREATE TABLE "exercise_external_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_external_ids_provider_valid" CHECK (length(btrim("exercise_external_ids"."provider")) BETWEEN 1 AND 120),
	CONSTRAINT "exercise_external_ids_value_valid" CHECK (length(btrim("exercise_external_ids"."external_id")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "exercise_merge_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merge_id" uuid NOT NULL,
	"canonical_exercise_id" uuid NOT NULL,
	"original_exercise_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "exercise_merge_aliases_alias_valid" CHECK (length(btrim("exercise_merge_aliases"."alias")) > 0),
	CONSTRAINT "exercise_merge_aliases_normalized_matches" CHECK ("exercise_merge_aliases"."normalized_alias" = lower(regexp_replace(btrim("exercise_merge_aliases"."alias"), '\s+', ' ', 'g'))),
	CONSTRAINT "exercise_merge_aliases_state_valid" CHECK (("exercise_merge_aliases"."is_active" AND "exercise_merge_aliases"."deactivated_at" IS NULL)
                OR (NOT "exercise_merge_aliases"."is_active" AND "exercise_merge_aliases"."deactivated_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "exercise_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_exercise_id" uuid NOT NULL,
	"merged_exercise_id" uuid NOT NULL,
	"canonical_exercise_name" text NOT NULL,
	"merged_exercise_name" text NOT NULL,
	"canonical_exercise_version" integer NOT NULL,
	"merged_exercise_version" integer NOT NULL,
	"merged_exercise_version_after_apply" integer NOT NULL,
	"reverted_canonical_exercise_version" integer,
	"reverted_merged_exercise_version" integer,
	"reference_impact" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_exercise_ids" jsonb NOT NULL,
	"affected_family_exercise_ids" jsonb NOT NULL,
	"external_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"revert_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_merges_not_self" CHECK ("exercise_merges"."canonical_exercise_id" <> "exercise_merges"."merged_exercise_id"),
	CONSTRAINT "exercise_merges_names_valid" CHECK (length(btrim("exercise_merges"."canonical_exercise_name")) > 0 AND length(btrim("exercise_merges"."merged_exercise_name")) > 0),
	CONSTRAINT "exercise_merges_apply_versions_positive" CHECK ("exercise_merges"."canonical_exercise_version" > 0
                AND "exercise_merges"."merged_exercise_version" > 0
                AND "exercise_merges"."merged_exercise_version_after_apply" > 0),
	CONSTRAINT "exercise_merges_revert_versions_positive" CHECK (("exercise_merges"."reverted_canonical_exercise_version" IS NULL
                    OR "exercise_merges"."reverted_canonical_exercise_version" > 0)
                AND ("exercise_merges"."reverted_merged_exercise_version" IS NULL
                    OR "exercise_merges"."reverted_merged_exercise_version" > 0)),
	CONSTRAINT "exercise_merges_reason_valid" CHECK ("exercise_merges"."reason" IS NULL OR length(btrim("exercise_merges"."reason")) BETWEEN 1 AND 500),
	CONSTRAINT "exercise_merges_revert_reason_valid" CHECK ("exercise_merges"."revert_reason" IS NULL OR length(btrim("exercise_merges"."revert_reason")) BETWEEN 1 AND 500),
	CONSTRAINT "exercise_merges_state_valid" CHECK ((
                "exercise_merges"."version" = 1
                AND "exercise_merges"."reverted_at" IS NULL
                AND "exercise_merges"."revert_reason" IS NULL
                AND "exercise_merges"."reverted_canonical_exercise_version" IS NULL
                AND "exercise_merges"."reverted_merged_exercise_version" IS NULL
            ) OR (
                "exercise_merges"."version" = 2
                AND "exercise_merges"."reverted_at" IS NOT NULL
                AND "exercise_merges"."reverted_canonical_exercise_version" IS NOT NULL
                AND "exercise_merges"."reverted_merged_exercise_version" IS NOT NULL
            ))
);
--> statement-breakpoint
ALTER TABLE "exercise_external_ids" ADD CONSTRAINT "exercise_external_ids_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_merge_aliases" ADD CONSTRAINT "exercise_merge_aliases_merge_id_exercise_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."exercise_merges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_merge_aliases" ADD CONSTRAINT "exercise_merge_aliases_canonical_exercise_id_exercises_id_fk" FOREIGN KEY ("canonical_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_merge_aliases" ADD CONSTRAINT "exercise_merge_aliases_original_exercise_id_exercises_id_fk" FOREIGN KEY ("original_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_merges" ADD CONSTRAINT "exercise_merges_canonical_exercise_id_exercises_id_fk" FOREIGN KEY ("canonical_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_merges" ADD CONSTRAINT "exercise_merges_merged_exercise_id_exercises_id_fk" FOREIGN KEY ("merged_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_external_ids_provider_value_unique" ON "exercise_external_ids" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "exercise_external_ids_exercise_idx" ON "exercise_external_ids" USING btree ("exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_merge_aliases_merge_value_unique" ON "exercise_merge_aliases" USING btree ("merge_id","normalized_alias");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_merge_aliases_active_value_unique" ON "exercise_merge_aliases" USING btree ("normalized_alias") WHERE "exercise_merge_aliases"."is_active";--> statement-breakpoint
CREATE INDEX "exercise_merge_aliases_canonical_idx" ON "exercise_merge_aliases" USING btree ("canonical_exercise_id","is_active");--> statement-breakpoint
CREATE INDEX "exercise_merge_aliases_original_idx" ON "exercise_merge_aliases" USING btree ("original_exercise_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_merges_active_merged_unique" ON "exercise_merges" USING btree ("merged_exercise_id") WHERE "exercise_merges"."reverted_at" is null;--> statement-breakpoint
CREATE INDEX "exercise_merges_canonical_history_idx" ON "exercise_merges" USING btree ("canonical_exercise_id","applied_at");--> statement-breakpoint
CREATE INDEX "exercise_merges_merged_history_idx" ON "exercise_merges" USING btree ("merged_exercise_id","applied_at");