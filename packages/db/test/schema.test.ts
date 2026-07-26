import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as schema from "#src/schema/index";

describe("database schema boundaries", () => {
    it("exports the platform module instance registry", () => {
        expect(getTableName(schema.moduleInstances)).toBe("module_instances");
        expect(getTableName(schema.entityRevisions)).toBe("entity_revisions");
        expect(getTableName(schema.idempotencyRecords)).toBe("idempotency_records");
        expect(getTableName(schema.jobs)).toBe("jobs");
        expect(getTableName(schema.outboxEvents)).toBe("outbox_events");
        expect(getTableName(schema.workHandlerReceipts)).toBe("work_handler_receipts");
    });

    it("does not expose the starter projects schema", () => {
        expect(schema).not.toHaveProperty("projects");
        expect(schema).not.toHaveProperty("projectStatus");
    });
});
