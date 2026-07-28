import { describe, expect, it } from "vitest";

import {
    HealthContextReaderService,
    ManualHealthRecordCommands,
    ManualHealthRecordNotFoundError,
    manualHealthRecordSerializer,
    type CreateManualHealthRecordCommand,
    type HealthRecordListFilter,
    type HealthRecordRepository,
    type ManualHealthRecordResource,
} from "#src/modules/health-data/application/index";
import {
    HEALTH_RECORD_BODY_SCHEMA_VERSION,
    type HealthRecordBody,
    type ManualHealthRecordState,
} from "#src/modules/health-data/domain/index";
import {
    RevisionMutationService,
    type CommandContext,
    type EntityRevision,
    type RevisionStore,
    type TransactionalEventPublisher,
    type UnitOfWork,
} from "#src/platform/application/index";
import type { DomainEvent, EntityId } from "#src/platform/domain/index";

const ids = {
    record1: "0198a4db-d8da-7000-8000-0000000000b1",
    record2: "0198a4db-d8da-7000-8000-0000000000b2",
    coreProfile: "0198a4db-d8da-7000-8000-0000000000b9",
    event1: "0198a4db-d8da-7000-8000-0000000000e1",
    event2: "0198a4db-d8da-7000-8000-0000000000e2",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(
    body: HealthRecordBody,
    overrides: Partial<CreateManualHealthRecordCommand> = {},
): CreateManualHealthRecordCommand {
    return { id: ids.record1, effectiveAt: "2026-07-28T06:30:00.000Z", body, ...overrides };
}

describe("manual health records application services", () => {
    it("binds the active profile id and raises health.record.upserted on create", async () => {
        const fixture = createFixture([ids.event1]);

        const created = await fixture.commands.create(command({ type: "body_weight", massKg: 82.1 }), metadata);

        expect(created).toMatchObject({
            id: ids.record1,
            profileId: ids.coreProfile,
            type: "body_weight",
            source: "manual",
            bodySchemaVersion: HEALTH_RECORD_BODY_SCHEMA_VERSION,
            version: 1,
        });
        expect(fixture.revisions.values).toHaveLength(1);
        expect(fixture.events.values).toHaveLength(1);
        expect(fixture.events.values[0]?.name).toBe("health.record.upserted");
    });

    it("updates a record, bumps its version, and rejects a stale version", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.create(command({ type: "body_weight", massKg: 82 }), metadata);

        const updated = await fixture.commands.update(
            ids.record1,
            1,
            { body: { type: "body_weight", massKg: 81.5 } },
            metadata,
        );
        expect(updated).toMatchObject({ version: 2, body: { type: "body_weight", massKg: 81.5 } });

        await expect(fixture.commands.update(ids.record1, 99, { notes: "x" }, metadata)).rejects.toThrow();
    });

    it("archives a record and hides it from the context reader", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.create(command({ type: "resting_heart_rate", beatsPerMinute: 52 }), metadata);

        const archived = await fixture.commands.archive(ids.record1, 1, metadata);
        expect(archived.archivedAt).not.toBeNull();
        expect(fixture.events.values.at(-1)?.payload).toMatchObject({ archived: true });

        const window = await fixture.reader.readWindow({
            type: "resting_heart_rate",
            from: "2026-07-01T00:00:00.000Z",
            to: "2026-08-01T00:00:00.000Z",
        });
        expect(window.available).toBe(false);
        expect(window.points).toHaveLength(0);
    });

    it("distinguishes missing context from a genuine zero reading", async () => {
        const fixture = createFixture([ids.event1]);
        await fixture.commands.create(
            command({ type: "daily_readiness", score: 0, scaleMin: 0, scaleMax: 100 }),
            metadata,
        );

        const present = await fixture.reader.readWindow({
            type: "daily_readiness",
            from: "2026-07-01T00:00:00.000Z",
            to: "2026-08-01T00:00:00.000Z",
        });
        expect(present).toMatchObject({ available: true, source: "manual" });
        expect(present.points[0]?.value).toBe(0);

        const missing = await fixture.reader.readWindow({
            type: "sleep",
            from: "2026-07-01T00:00:00.000Z",
            to: "2026-08-01T00:00:00.000Z",
        });
        expect(missing).toMatchObject({ available: false, source: null });
    });

    it("reports an unknown record", async () => {
        const fixture = createFixture([]);
        await expect(fixture.commands.archive(ids.record2, 1, metadata)).rejects.toBeInstanceOf(
            ManualHealthRecordNotFoundError,
        );
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeHealthRecordRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const mutations = new RevisionMutationService<ManualHealthRecordState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        manualHealthRecordSerializer,
        events,
        { now: () => now },
    );
    const commands = new ManualHealthRecordCommands({
        unitOfWork,
        repository,
        mutations,
        profileReader: { requireActiveProfileId: async () => ids.coreProfile },
        clock: { now: () => now },
        generateId: () => {
            const id = generatedIds.shift();
            if (!id) throw new Error("No generated ID remains");
            return id;
        },
    });
    const reader = new HealthContextReaderService(repository);
    return { repository, revisions, events, commands, reader };
}

function resource(state: ManualHealthRecordState, version: number): ManualHealthRecordResource {
    return { ...structuredClone(state), version, bodySchemaVersion: HEALTH_RECORD_BODY_SCHEMA_VERSION };
}

class FakeHealthRecordRepository implements HealthRecordRepository<typeof transaction> {
    private readonly values = new Map<string, { state: ManualHealthRecordState; version: number }>();

    async readRecord(id: EntityId): Promise<ManualHealthRecordResource | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async listRecords(filter?: HealthRecordListFilter): Promise<readonly ManualHealthRecordResource[]> {
        return [...this.values.values()]
            .filter(item => filter?.type === undefined || item.state.type === filter.type)
            .filter(item => filter?.includeArchived === true || item.state.archivedAt === null)
            .filter(item => filter?.from === undefined || item.state.effectiveAt >= filter.from)
            .filter(item => filter?.to === undefined || item.state.effectiveAt <= filter.to)
            .sort((a, b) => a.state.effectiveAt.localeCompare(b.state.effectiveAt))
            .map(item => resource(item.state, item.version));
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: ManualHealthRecordState, version: number): Promise<void> {
        if (this.values.has(id)) throw new Error("duplicate health record");
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: ManualHealthRecordState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new Error("version conflict");
        this.values.set(id, { state: structuredClone(state), version: nextVersion });
    }
}

class FakeRevisionStore implements RevisionStore<typeof transaction> {
    readonly values: EntityRevision[] = [];

    async append(revision: EntityRevision): Promise<void> {
        this.values.push(structuredClone(revision));
    }

    async find(entityType: string, id: EntityId, version: number): Promise<EntityRevision | null> {
        return (
            this.values.find(
                item => item.entityType === entityType && item.entityId === id && item.version === version,
            ) ?? null
        );
    }

    async history(entityType: string, id: EntityId, limit: number) {
        return {
            items: this.values.filter(item => item.entityType === entityType && item.entityId === id).slice(0, limit),
            nextCursor: null,
        };
    }
}

class FakeEvents implements TransactionalEventPublisher<DomainEvent, typeof transaction> {
    readonly values: DomainEvent[] = [];

    async publish(events: readonly DomainEvent[]): Promise<void> {
        this.values.push(...events);
    }
}
