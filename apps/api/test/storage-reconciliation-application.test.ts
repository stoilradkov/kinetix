import { describe, expect, it, vi } from "vitest";

import {
    ReconcileImportStorage,
    fingerprintImportContent,
    type AggregateVersionRecord,
    type AggregateVersionRef,
    type ExternalIdMappingRecord,
    type ImportEntityRef,
    type ImportStorageReadPort,
    type StorageReconciliationRequest,
} from "#src/modules/training/application/index";

const NAMESPACE = "coach-app";

/** An in-memory read port over a fixed set of mappings + versions, recording call arity for batching. */
class FakeReadPort implements ImportStorageReadPort {
    readonly mappingCalls: ImportEntityRef[][] = [];
    readonly versionCalls: AggregateVersionRef[][] = [];

    constructor(
        private readonly mappings: readonly ExternalIdMappingRecord[],
        private readonly versions: readonly AggregateVersionRecord[],
    ) {}

    readExternalIdMappings(
        _namespace: string,
        refs: readonly ImportEntityRef[],
    ): Promise<readonly ExternalIdMappingRecord[]> {
        this.mappingCalls.push([...refs]);
        const requested = new Set(refs.map(ref => `${ref.entityType}:${ref.externalId}`));
        return Promise.resolve(this.mappings.filter(m => requested.has(`${m.entityType}:${m.externalId}`)));
    }

    readAggregateVersions(refs: readonly AggregateVersionRef[]): Promise<readonly AggregateVersionRecord[]> {
        this.versionCalls.push([...refs]);
        const requested = new Set(refs.map(ref => `${ref.entityType}:${ref.entityId}`));
        return Promise.resolve(this.versions.filter(v => requested.has(`${v.entityType}:${v.entityId}`)));
    }
}

function request(overrides: Partial<StorageReconciliationRequest> = {}): StorageReconciliationRequest {
    return {
        path: ["programs", 0],
        entityType: "program",
        externalId: "prog-1",
        incomingFingerprint: fingerprintImportContent({ name: "5x5" }),
        ...overrides,
    };
}

describe("ReconcileImportStorage", () => {
    it("classifies a new external ID as create", async () => {
        const port = new FakeReadPort([], []);
        const service = new ReconcileImportStorage({ readPort: port });

        const plan = await service.execute([request()], { namespace: NAMESPACE, mode: "create" });

        expect(plan.entries).toHaveLength(1);
        expect(plan.entries[0]).toMatchObject({ operation: "create", externalId: "prog-1", currentEntityId: null });
        expect(plan.counts).toMatchObject({ create: 1, update: 0, "skip-identical": 0, conflict: 0 });
        expect(plan.hasConflicts).toBe(false);
    });

    it("classifies identical content under the same external ID as skip-identical", async () => {
        const fingerprint = fingerprintImportContent({ name: "5x5" });
        const port = new FakeReadPort(
            [{ entityType: "program", externalId: "prog-1", entityId: "prog-id", contentFingerprint: fingerprint }],
            [{ entityType: "program", entityId: "prog-id", version: 4 }],
        );
        const service = new ReconcileImportStorage({ readPort: port });

        const plan = await service.execute([request({ incomingFingerprint: fingerprint })], {
            namespace: NAMESPACE,
            mode: "upsert",
        });

        expect(plan.entries[0]).toMatchObject({ operation: "skip-identical", currentEntityId: "prog-id" });
    });

    it("classifies changed content with a matching expected version as update", async () => {
        const port = new FakeReadPort(
            [
                {
                    entityType: "program",
                    externalId: "prog-1",
                    entityId: "prog-id",
                    contentFingerprint: "old".padEnd(64, "0"),
                },
            ],
            [{ entityType: "program", entityId: "prog-id", version: 4 }],
        );
        const service = new ReconcileImportStorage({ readPort: port });

        const plan = await service.execute([request({ expectedVersion: 4 })], { namespace: NAMESPACE, mode: "upsert" });

        expect(plan.entries[0]).toMatchObject({ operation: "update", currentEntityId: "prog-id", currentVersion: 4 });
    });

    it("classifies a stale expected version as a version-mismatch conflict", async () => {
        const port = new FakeReadPort(
            [
                {
                    entityType: "program",
                    externalId: "prog-1",
                    entityId: "prog-id",
                    contentFingerprint: "old".padEnd(64, "0"),
                },
            ],
            [{ entityType: "program", entityId: "prog-id", version: 6 }],
        );
        const service = new ReconcileImportStorage({ readPort: port });

        const plan = await service.execute([request({ expectedVersion: 4 })], { namespace: NAMESPACE, mode: "upsert" });

        expect(plan.entries[0]).toMatchObject({
            operation: "conflict",
            conflictCode: "VERSION_MISMATCH",
            currentVersion: 6,
        });
        expect(plan.conflicts).toHaveLength(1);
        expect(plan.hasConflicts).toBe(true);
    });

    it("classifies create over an existing binding with changed content as an external-id conflict", async () => {
        const port = new FakeReadPort(
            [
                {
                    entityType: "program",
                    externalId: "prog-1",
                    entityId: "prog-id",
                    contentFingerprint: "old".padEnd(64, "0"),
                },
            ],
            [{ entityType: "program", entityId: "prog-id", version: 1 }],
        );
        const service = new ReconcileImportStorage({ readPort: port });

        const plan = await service.execute([request()], { namespace: NAMESPACE, mode: "create" });

        expect(plan.entries[0]).toMatchObject({ operation: "conflict", conflictCode: "EXTERNAL_ID_EXISTS" });
    });

    it("keeps distinct same-day sessions and identical content under distinct external IDs as separate creates", async () => {
        const identical = fingerprintImportContent({ localDate: "2021-05-01", title: "Push" });
        const port = new FakeReadPort([], []);
        const service = new ReconcileImportStorage({ readPort: port });

        const plan = await service.execute(
            [
                request({
                    entityType: "training-session",
                    externalId: "sess-a",
                    incomingFingerprint: identical,
                    path: ["completedSessions", 0],
                }),
                request({
                    entityType: "training-session",
                    externalId: "sess-b",
                    incomingFingerprint: identical,
                    path: ["completedSessions", 1],
                }),
            ],
            { namespace: NAMESPACE, mode: "create" },
        );

        expect(plan.entries.map(e => e.operation)).toEqual(["create", "create"]);
        expect(plan.entries.map(e => e.externalId)).toEqual(["sess-a", "sess-b"]);
    });

    it("preserves payload order and reconciles a mixed batch across entity types", async () => {
        const fpSkip = fingerprintImportContent({ v: "same" });
        const port = new FakeReadPort(
            [
                { entityType: "program", externalId: "prog-1", entityId: "prog-id", contentFingerprint: fpSkip },
                {
                    entityType: "occurrence",
                    externalId: "occ-1",
                    entityId: "occ-id",
                    contentFingerprint: "old".padEnd(64, "0"),
                },
            ],
            [{ entityType: "program", entityId: "prog-id", version: 2 }],
        );
        const service = new ReconcileImportStorage({ readPort: port });

        const plan = await service.execute(
            [
                request({
                    entityType: "occurrence",
                    externalId: "occ-1",
                    incomingFingerprint: "new".padEnd(64, "0"),
                    expectedVersion: 1,
                    path: ["occ"],
                }),
                request({ entityType: "program", externalId: "prog-1", incomingFingerprint: fpSkip, path: ["prog"] }),
                request({
                    entityType: "training-session",
                    externalId: "sess-new",
                    incomingFingerprint: "x".repeat(64),
                    path: ["sess"],
                }),
            ],
            { namespace: NAMESPACE, mode: "upsert" },
        );

        expect(plan.entries.map(e => `${e.entityType}:${e.operation}`)).toEqual([
            "occurrence:update", // child entity, version null → not version-gated, changed content → update
            "program:skip-identical",
            "training-session:create",
        ]);
    });

    it("performs exactly one batched mapping read and one batched version read regardless of size", async () => {
        const port = new FakeReadPort(
            [
                { entityType: "program", externalId: "prog-1", entityId: "p1", contentFingerprint: "a".repeat(64) },
                { entityType: "program", externalId: "prog-2", entityId: "p2", contentFingerprint: "b".repeat(64) },
            ],
            [
                { entityType: "program", entityId: "p1", version: 1 },
                { entityType: "program", entityId: "p2", version: 1 },
            ],
        );
        const service = new ReconcileImportStorage({ readPort: port });

        await service.execute(
            [
                request({ externalId: "prog-1", incomingFingerprint: "a".repeat(64) }),
                request({ externalId: "prog-2", incomingFingerprint: "b".repeat(64) }),
            ],
            { namespace: NAMESPACE, mode: "upsert" },
        );

        expect(port.mappingCalls).toHaveLength(1);
        expect(port.mappingCalls[0]).toHaveLength(2);
        expect(port.versionCalls).toHaveLength(1);
        expect(port.versionCalls[0]).toHaveLength(2);
    });

    it("deduplicates repeated identities before reading", async () => {
        const port = new FakeReadPort([], []);
        const service = new ReconcileImportStorage({ readPort: port });

        await service.execute([request({ externalId: "prog-1" }), request({ externalId: "prog-1", path: ["dup"] })], {
            namespace: NAMESPACE,
            mode: "create",
        });

        expect(port.mappingCalls[0]).toHaveLength(1);
    });

    it("threads the caller transaction through both reads", async () => {
        const port = new FakeReadPort([], []);
        const mappingSpy = vi.spyOn(port, "readExternalIdMappings");
        const service = new ReconcileImportStorage<string>({ readPort: port });
        const tx = "tx-1";

        await service.execute([request()], { namespace: NAMESPACE, mode: "create" }, tx);

        expect(mappingSpy).toHaveBeenCalledWith(NAMESPACE, expect.any(Array), tx);
    });

    it("short-circuits the version read when nothing resolves", async () => {
        const port = new FakeReadPort([], []);
        const service = new ReconcileImportStorage({ readPort: port });

        await service.execute([request()], { namespace: NAMESPACE, mode: "create" });

        expect(port.versionCalls).toHaveLength(0);
    });
});
