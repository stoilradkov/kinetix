import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationPath = globSync(new URL("../drizzle/*.sql", import.meta.url).pathname)[0];

if (!migrationPath) {
    throw new Error("Expected a generated migration");
}

const migration = readFileSync(migrationPath, "utf8");

describe("initial module migration", () => {
    it("contains no starter Project objects", () => {
        expect(migration).not.toMatch(/projects|project_status/i);
    });

    it("seeds one active Training instance idempotently", () => {
        expect(migration).toContain("'training'");
        expect(migration).toContain("'active'");
        expect(migration).toContain('ON CONFLICT ("slug") DO NOTHING');
    });
});
