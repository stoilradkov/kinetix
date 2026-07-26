DROP INDEX "entity_revisions_history_idx";--> statement-breakpoint
CREATE INDEX "entity_revisions_history_idx" ON "entity_revisions" USING btree ("entity_type","entity_id","version" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_entity_type_nonempty" CHECK (length(btrim("entity_revisions"."entity_type")) > 0);--> statement-breakpoint
ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_version_positive" CHECK ("entity_revisions"."version" > 0);--> statement-breakpoint
ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_schema_version_positive" CHECK ("entity_revisions"."schema_version" > 0);--> statement-breakpoint
ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_reason_valid" CHECK ("entity_revisions"."reason" IS NULL OR (length(btrim("entity_revisions"."reason")) BETWEEN 1 AND 500));--> statement-breakpoint
ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_summary_nonempty" CHECK (length(btrim("entity_revisions"."summary")) > 0);--> statement-breakpoint
ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_correlation_nonempty" CHECK (length(btrim("entity_revisions"."correlation_id")) > 0);