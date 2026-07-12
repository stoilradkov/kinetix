import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as schema from "#src/schema/index";

describe("database schema boundaries", () => {
    it("exports the platform module instance registry", () => {
        expect(getTableName(schema.moduleInstances)).toBe("module_instances");
    });

    it("does not expose the starter projects schema", () => {
        expect(schema).not.toHaveProperty("projects");
        expect(schema).not.toHaveProperty("projectStatus");
    });
});
