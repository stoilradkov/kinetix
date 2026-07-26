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

    it("exports normalized Training catalog tables", () => {
        expect(getTableName(schema.muscleGroups)).toBe("muscle_groups");
        expect(getTableName(schema.equipmentTypes)).toBe("equipment_types");
        expect(getTableName(schema.movementPatterns)).toBe("movement_patterns");
        expect(getTableName(schema.trainingTags)).toBe("training_tags");
        expect(getTableName(schema.exercises)).toBe("exercises");
        expect(getTableName(schema.exerciseAliases)).toBe("exercise_aliases");
        expect(getTableName(schema.exerciseMuscles)).toBe("exercise_muscles");
        expect(getTableName(schema.exerciseTags)).toBe("exercise_tags");
        expect(getTableName(schema.exerciseRelationships)).toBe("exercise_relationships");
        expect(getTableName(schema.exerciseExternalIds)).toBe("exercise_external_ids");
        expect(getTableName(schema.exerciseMerges)).toBe("exercise_merges");
        expect(getTableName(schema.exerciseMergeAliases)).toBe("exercise_merge_aliases");
    });
});
