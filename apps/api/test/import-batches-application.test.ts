import { describe, expect, it } from "vitest";

import { ImportPayloadConflictError, PayloadTooLargeError, type UnitOfWork } from "#src/platform/application/index";
import type { ImportBatchSnapshot } from "#src/modules/training/domain/index";
import {
    ImportBatchNotFoundError,
    ImportBatchQueryService,
    RegisterImportBatch,
    type BulkExternalIdMapping,
    type ImportBatchRepository,
    type RegisterImportBatchInput,
} from "#src/modules/training/application/index";

const PROFILE_ID = "0198a4db-d8da-7000-8000-0000000000f2";
const CHECKSUM = "a".repeat(64);
const OTHER_CHECKSUM = "b".repeat(64);
const NOW = new Date("2026-08-08T10:00:00.000Z");

/** In-memory batch store keyed by `(namespace, payloadId)`, mirroring the DB unique index. */
class FakeRepository implements ImportBatchRepository {
    readonly rows = new Map<string, ImportBatchSnapshot>();
    lockCount = 0;

    async lockByIdentity(
        _profileId: string,
        namespace: string,
        payloadId: string,
    ): Promise<ImportBatchSnapshot | null> {
        this.lockCount += 1;
        return this.rows.get(`${namespace}::${payloadId}`) ?? null;
    }

    async insertIfAbsent(record: ImportBatchSnapshot): Promise<boolean> {
        const key = `${record.namespace}::${record.payloadId}`;
        if (this.rows.has(key)) return false;
        this.rows.set(key, record);
        return true;
    }

    async findById(profileId: string, id: string): Promise<ImportBatchSnapshot | null> {
        for (const row of this.rows.values()) if (row.id === id && row.profileId === profileId) return row;
        return null;
    }
}

const unitOfWork: UnitOfWork = { execute: work => work(undefined) };
const profileReader = { requireActiveProfileId: async () => PROFILE_ID };

function useCase(repository: FakeRepository, generateId: () => string = mintSequential()) {
    return new RegisterImportBatch({
        unitOfWork,
        repository,
        profileReader,
        clock: { now: () => NOW },
        generateId,
    });
}

function mintSequential(): () => string {
    let n = 0;
    return () => `0198a4db-d8da-7000-8000-${String(++n).padStart(12, "0")}`;
}

function input(overrides: Partial<RegisterImportBatchInput["source"]> = {}): RegisterImportBatchInput {
    return {
        source: {
            namespace: "coach-app",
            payloadId: "archive-2021",
            schemaVersion: 1,
            checksum: CHECKSUM,
            ...overrides,
        },
    };
}

describe("RegisterImportBatch", () => {
    it("opens a fresh pending batch on first registration", async () => {
        const repository = new FakeRepository();
        const view = await useCase(repository).execute(input({ description: "Hevy 2021" }));
        expect(view).toMatchObject({ state: "pending", resolved: false, description: "Hevy 2021", checksum: CHECKSUM });
        expect(repository.rows.size).toBe(1);
    });

    it("resolves the same batch when the same identity is re-submitted", async () => {
        const repository = new FakeRepository();
        const register = useCase(repository);
        const first = await register.execute(input());
        const second = await register.execute(input());
        expect(second.id).toBe(first.id);
        expect(second.resolved).toBe(true);
        expect(repository.rows.size).toBe(1);
    });

    it("conflicts when a payload id is reused with a different checksum", async () => {
        const repository = new FakeRepository();
        const register = useCase(repository);
        await register.execute(input());
        await expect(register.execute(input({ checksum: OTHER_CHECKSUM }))).rejects.toBeInstanceOf(
            ImportPayloadConflictError,
        );
    });

    it("rejects an over-large declared payload with PAYLOAD_TOO_LARGE", async () => {
        const repository = new FakeRepository();
        await expect(
            useCase(repository).execute({ ...input(), payloadSize: { programs: 1, completedSessions: 20_001 } }),
        ).rejects.toBeInstanceOf(PayloadTooLargeError);
        expect(repository.rows.size).toBe(0);
    });
});

describe("ImportBatchQueryService", () => {
    const mappings: BulkExternalIdMapping[] = [
        { entityType: "program", externalId: "prog-1", entityId: "0198a4db-d8da-7000-8000-00000000aaa1" },
        { entityType: "training-session", externalId: "sess-1", entityId: "0198a4db-d8da-7000-8000-00000000aaa2" },
    ];
    const externalIds = { listByBatch: async () => mappings };

    it("reads a batch by id", async () => {
        const repository = new FakeRepository();
        const view = await useCase(repository).execute(input());
        const query = new ImportBatchQueryService({ repository, externalIds, profileReader });
        expect((await query.findById(view.id)).payloadId).toBe("archive-2021");
    });

    it("lists a batch's external-id mappings", async () => {
        const repository = new FakeRepository();
        const view = await useCase(repository).execute(input());
        const query = new ImportBatchQueryService({ repository, externalIds, profileReader });
        const result = await query.listMappings(view.id);
        expect(result).toMatchObject({ batchId: view.id, namespace: "coach-app", count: 2 });
    });

    it("throws not-found for an unknown batch", async () => {
        const query = new ImportBatchQueryService({ repository: new FakeRepository(), externalIds, profileReader });
        await expect(query.findById("0198a4db-d8da-7000-8000-00000000ffff")).rejects.toBeInstanceOf(
            ImportBatchNotFoundError,
        );
    });
});
