import { describe, expect, it } from "vitest";

import {
    commitBatchKey,
    partitionCommitBatches,
    planCommitBatches,
    tallyCommitCounts,
    type CommitBatch,
} from "#src/modules/training/domain/index";
import type { StoragePlanEntry } from "#src/modules/training/domain/index";

function entry(
    overrides: Partial<StoragePlanEntry> & Pick<StoragePlanEntry, "path" | "entityType" | "externalId">,
): StoragePlanEntry {
    return {
        operation: "create",
        currentEntityId: null,
        currentVersion: null,
        conflictCode: null,
        ...overrides,
    };
}

/** A plan with one program (root + block + planned-session) and two completed sessions. */
function samplePlan(): StoragePlanEntry[] {
    return [
        entry({ path: ["programs", 0], entityType: "program", externalId: "prog-1" }),
        entry({ path: ["programs", 0, "blocks", 0], entityType: "program-block", externalId: "blk-1" }),
        entry({ path: ["programs", 0, "sessions", 0], entityType: "planned-session", externalId: "ps-1" }),
        entry({ path: ["completedSessions", 0], entityType: "training-session", externalId: "ts-1" }),
        entry({
            path: ["completedSessions", 0, "activities", 0],
            entityType: "session-activity",
            externalId: "act-1",
        }),
        entry({ path: ["completedSessions", 1], entityType: "training-session", externalId: "ts-2" }),
    ];
}

describe("planCommitBatches", () => {
    it("groups plan entries into one batch per aggregate, in payload order, counting entities", () => {
        const batches = planCommitBatches(samplePlan());
        expect(batches.map(batch => batch.key)).toEqual(["program#0", "completed-session#0", "completed-session#1"]);
        expect(batches[0]).toMatchObject({ kind: "program", index: 0, rootExternalId: "prog-1", entityCount: 3 });
        expect(batches[1]).toMatchObject({
            kind: "completed-session",
            index: 0,
            rootExternalId: "ts-1",
            entityCount: 2,
        });
        expect(batches[2]).toMatchObject({
            kind: "completed-session",
            index: 1,
            rootExternalId: "ts-2",
            entityCount: 1,
        });
    });

    it("captures a null root external id for a program with no external id", () => {
        const batches = planCommitBatches([
            entry({ path: ["programs", 0, "blocks", 0], entityType: "program-block", externalId: "blk-1" }),
            entry({ path: ["programs", 0, "sessions", 0], entityType: "planned-session", externalId: "ps-1" }),
        ]);
        expect(batches).toHaveLength(1);
        expect(batches[0]).toMatchObject({ key: "program#0", rootExternalId: null, entityCount: 2 });
    });

    it("ignores entries with an unrecognized root", () => {
        const batches = planCommitBatches([entry({ path: ["mystery", 0], entityType: "program", externalId: "x" })]);
        expect(batches).toEqual([]);
    });
});

describe("partitionCommitBatches", () => {
    it("splits into pending vs already-committed by checkpoint key, preserving order", () => {
        const batches = planCommitBatches(samplePlan());
        const { pending, completed } = partitionCommitBatches(batches, new Set(["program#0", "completed-session#0"]));
        expect(completed.map(batch => batch.key)).toEqual(["program#0", "completed-session#0"]);
        expect(pending.map(batch => batch.key)).toEqual(["completed-session#1"]);
    });

    it("returns every batch pending when the checkpoint is empty (a fresh run)", () => {
        const batches = planCommitBatches(samplePlan());
        const { pending, completed } = partitionCommitBatches(batches, new Set());
        expect(completed).toEqual([]);
        expect(pending).toHaveLength(3);
    });
});

describe("tallyCommitCounts", () => {
    const batch = (key: string, entityCount: number): CommitBatch => ({
        key,
        kind: "program",
        index: 0,
        path: ["programs", 0],
        rootExternalId: null,
        entityCount,
    });

    it("sums entity counts for committed vs skipped batches; updates stay zero at create MVP", () => {
        const counts = tallyCommitCounts({
            committed: [batch("a", 3), batch("b", 2)],
            skipped: [batch("c", 4)],
        });
        expect(counts).toEqual({ created: 5, updated: 0, skipped: 4, conflicted: 0 });
    });

    it("counts a conflicting batch's entities as conflicted", () => {
        const counts = tallyCommitCounts({ committed: [batch("a", 2)], skipped: [], conflicted: [batch("b", 5)] });
        expect(counts).toEqual({ created: 2, updated: 0, skipped: 0, conflicted: 5 });
    });
});

describe("commitBatchKey", () => {
    it("is stable and deterministic per kind and index", () => {
        expect(commitBatchKey("program", 2)).toBe("program#2");
        expect(commitBatchKey("completed-session", 0)).toBe("completed-session#0");
    });
});
