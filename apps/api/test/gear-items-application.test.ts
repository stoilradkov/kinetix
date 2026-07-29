import { describe, expect, it } from "vitest";

import {
    GearItemCommands,
    GearItemNotFoundError,
    gearItemSerializer,
    type CreateGearItemCommand,
    type GearItemListFilter,
    type GearItemRepository,
    type GearItemResource,
} from "#src/modules/training/application/index";
import type { GearItemState } from "#src/modules/training/domain/index";
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
    gear: "0198a4db-d8da-7000-8000-000000003001",
    other: "0198a4db-d8da-7000-8000-000000003002",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    event1: "0198a4db-d8da-7000-8000-0000000000e1",
    event2: "0198a4db-d8da-7000-8000-0000000000e2",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(overrides: Partial<CreateGearItemCommand> = {}): CreateGearItemCommand {
    return { id: ids.gear, name: "Daily Trainers", gearType: "shoes", ...overrides };
}

describe("gear item application services", () => {
    it("creates gear then archives and restores it, bumping the version each time", async () => {
        const fixture = createFixture([ids.event1, ids.event2, "e3"]);
        const created = await fixture.commands.create(command(), metadata);
        expect(created).toMatchObject({ status: "active", version: 1 });

        const archived = await fixture.commands.archive(ids.gear, 1, metadata);
        expect(archived).toMatchObject({ status: "archived", version: 2 });
        expect(await fixture.repository.listGear()).toHaveLength(0);
        expect(await fixture.repository.listGear({ includeArchived: true })).toHaveLength(1);

        const restored = await fixture.commands.restore(ids.gear, 2, metadata);
        expect(restored).toMatchObject({ status: "active", version: 3 });
    });

    it("reports an unknown gear item", async () => {
        const fixture = createFixture([]);
        await expect(fixture.commands.archive(ids.other, 1, metadata)).rejects.toBeInstanceOf(GearItemNotFoundError);
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeGearItemRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const mutations = new RevisionMutationService<GearItemState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        gearItemSerializer,
        events,
        { now: () => now },
    );
    const commands = new GearItemCommands({
        unitOfWork,
        repository,
        mutations,
        profileReader: { requireActiveProfileId: async () => ids.profile },
        clock: { now: () => now },
        generateId: () => {
            const id = generatedIds.shift();
            if (!id) throw new Error("No generated ID remains");
            return id;
        },
    });
    return { repository, commands };
}

function resource(state: GearItemState, version: number): GearItemResource {
    return { ...structuredClone(state), version };
}

class FakeGearItemRepository implements GearItemRepository<typeof transaction> {
    private readonly values = new Map<string, { state: GearItemState; version: number }>();

    async readGear(id: EntityId): Promise<GearItemResource | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async listGear(filter?: GearItemListFilter): Promise<readonly GearItemResource[]> {
        return [...this.values.values()]
            .filter(item => filter?.includeArchived || item.state.status === "active")
            .map(item => resource(item.state, item.version));
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: GearItemState, version: number): Promise<void> {
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: GearItemState,
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
