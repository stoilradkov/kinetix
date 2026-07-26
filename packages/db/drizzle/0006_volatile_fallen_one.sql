CREATE TABLE "exercise_relationships" (
	"source_exercise_id" uuid NOT NULL,
	"target_exercise_id" uuid NOT NULL,
	"type" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_relationships_pk" PRIMARY KEY("source_exercise_id","target_exercise_id","type"),
	CONSTRAINT "exercise_relationships_type_valid" CHECK ("exercise_relationships"."type" IN ('variation', 'progression', 'regression', 'analytics_family')),
	CONSTRAINT "exercise_relationships_not_self" CHECK ("exercise_relationships"."source_exercise_id" <> "exercise_relationships"."target_exercise_id")
);
--> statement-breakpoint
DROP INDEX "exercise_aliases_normalized_unique";--> statement-breakpoint
ALTER TABLE "exercise_aliases" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "forked_from_exercise_id" uuid;--> statement-breakpoint
ALTER TABLE "exercise_relationships" ADD CONSTRAINT "exercise_relationships_source_exercise_id_exercises_id_fk" FOREIGN KEY ("source_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_relationships" ADD CONSTRAINT "exercise_relationships_target_exercise_id_exercises_id_fk" FOREIGN KEY ("target_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_relationships_target_type_idx" ON "exercise_relationships" USING btree ("target_exercise_id","type","archived_at");--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_forked_from_exercise_id_exercises_id_fk" FOREIGN KEY ("forked_from_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_forked_from_unique" ON "exercises" USING btree ("forked_from_exercise_id") WHERE "exercises"."forked_from_exercise_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_aliases_normalized_unique" ON "exercise_aliases" USING btree ("normalized_alias") WHERE "exercise_aliases"."is_active";--> statement-breakpoint
ALTER TABLE "exercise_aliases" ADD CONSTRAINT "exercise_aliases_normalized_matches" CHECK ("exercise_aliases"."normalized_alias" = lower(regexp_replace(btrim("exercise_aliases"."alias"), '\s+', ' ', 'g')));