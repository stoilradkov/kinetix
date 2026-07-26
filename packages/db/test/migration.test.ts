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
});
