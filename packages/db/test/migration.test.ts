import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationPaths = globSync(new URL("../drizzle/*.sql", import.meta.url).pathname);

if (migrationPaths.length === 0) {
    throw new Error("Expected a generated migration");
}

const migration = migrationPaths.map(path => readFileSync(path, "utf8")).join("\n");

describe("initial module migration", () => {
    it("contains no starter Project objects", () => {
        expect(migration).not.toMatch(/projects|project_status/i);
    });

    it("seeds one active Training instance idempotently", () => {
        expect(migration).toContain("'training'");
        expect(migration).toContain("'active'");
        expect(migration).toContain('ON CONFLICT ("slug") DO NOTHING');
    });

    it("creates immutable, schema-versioned entity revisions", () => {
        expect(migration).toContain('CREATE TABLE "entity_revisions"');
        expect(migration).toContain('"schema_version" integer NOT NULL');
        expect(migration).toContain('CREATE UNIQUE INDEX "entity_revisions_entity_version_unique"');
        expect(migration).toContain('"entity_revisions_version_positive"');
        expect(migration).toContain('"version" DESC');
    });

    it("creates expiring operation-scoped idempotency records", () => {
        expect(migration).toContain('CREATE TABLE "idempotency_records"');
        expect(migration).toContain('"request_hash" text NOT NULL');
        expect(migration).toContain('"response_snapshot" jsonb');
        expect(migration).toContain('CREATE UNIQUE INDEX "idempotency_records_operation_key_unique"');
        expect(migration).toContain('"idempotency_records_state_valid"');
    });

    it("creates leased jobs, a transactional outbox, and idempotent handler receipts", () => {
        expect(migration).toContain('CREATE TABLE "jobs"');
        expect(migration).toContain('CREATE TABLE "outbox_events"');
        expect(migration).toContain('CREATE TABLE "work_handler_receipts"');
        expect(migration).toContain('"lease_owner" text');
        expect(migration).toContain('"lease_expires_at" timestamp with time zone');
        expect(migration).toContain('"heartbeat_at" timestamp with time zone');
        expect(migration).toContain('CREATE INDEX "jobs_due_idx"');
        expect(migration).toContain('CREATE INDEX "outbox_events_due_idx"');
        expect(migration).toContain('CREATE UNIQUE INDEX "jobs_type_idempotency_unique"');
        expect(migration).toContain('CONSTRAINT "work_handler_receipts_pk" PRIMARY KEY');
    });

    it("creates normalized Training catalog tables and uniqueness constraints", () => {
        for (const table of [
            "muscle_groups",
            "equipment_types",
            "movement_patterns",
            "training_tags",
            "exercises",
            "exercise_aliases",
            "exercise_muscles",
            "exercise_tags",
            "exercise_relationships",
        ])
            expect(migration).toContain(`CREATE TABLE "${table}"`);
        expect(migration).toContain('CREATE UNIQUE INDEX "muscle_groups_slug_unique"');
        expect(migration).toContain('CREATE UNIQUE INDEX "training_tags_normalized_name_unique"');
        expect(migration).toContain('CREATE UNIQUE INDEX "exercise_aliases_normalized_unique"');
        expect(migration).toContain('WHERE "exercise_aliases"."is_active"');
        expect(migration).toContain('CREATE UNIQUE INDEX "exercises_forked_from_unique"');
        expect(migration).toContain('CONSTRAINT "exercise_muscles_pk" PRIMARY KEY');
        expect(migration).toContain('CONSTRAINT "exercise_relationships_not_self"');
    });

    it("persists reversible exercise redirects, aliases, external IDs, and version evidence", () => {
        expect(migration).toContain('CREATE TABLE "exercise_external_ids"');
        expect(migration).toContain('CREATE TABLE "exercise_merges"');
        expect(migration).toContain('CREATE TABLE "exercise_merge_aliases"');
        expect(migration).toContain('CREATE UNIQUE INDEX "exercise_merges_active_merged_unique"');
        expect(migration).toContain('CREATE UNIQUE INDEX "exercise_merge_aliases_active_value_unique"');
        expect(migration).toContain('"merged_exercise_version_after_apply" integer NOT NULL');
        expect(migration).toContain('"exercise_merges_state_valid"');
    });

    it("stores manual health records with promoted numeric fields and schema-versioned JSON", () => {
        expect(migration).toContain('CREATE TABLE "health_records"');
        expect(migration).toContain('"data_schema_version" integer DEFAULT 1 NOT NULL');
        expect(migration).toContain('"data" jsonb NOT NULL');
        expect(migration).toContain('"mass_kg" numeric(7, 3)');
        expect(migration).toContain('"resting_heart_rate_bpm" integer');
        expect(migration).toContain('"sleep_duration_minutes" integer');
        expect(migration).toContain('"readiness_score" integer');
        expect(migration).toContain('"health_records_type_valid"');
        expect(migration).toContain('"health_records_body_weight_promoted"');
        expect(migration).toContain('"health_records_sleep_interval_valid"');
        expect(migration).toContain('CREATE INDEX "health_records_profile_type_effective_idx"');
    });
});
