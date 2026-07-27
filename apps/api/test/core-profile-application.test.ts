import { describe, expect, it } from "vitest";

import {
    ActiveCoreProfileExistsError,
    CoreProfileCommands,
    CoreProfileReader,
    coreProfileSerializer,
    type CoreProfileRepository,
    type CoreProfileResource,
    type CreateCoreProfileCommand,
    type StoredCoreProfile,
} from "#src/modules/profile/application/index";
import type { CoreProfileState, UnitPreferences } from "#src/modules/profile/domain/index";
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
    profile: "0198a4db-d8da-7000-8000-000000000001",
    event1: "0198a4db-d8da-7000-8000-000000000002",
    event2: "0198a4db-d8da-7000-8000-000000000003",
} as const;
const now = new Date("2026-07-27T12:00:00.000Z");
const transaction = {};
const unitPreferences: UnitPreferences = { mass: "kg", distance: "km", length: "cm" };
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(overrides: Partial<CreateCoreProfileCommand> = {}): CreateCoreProfileCommand {
    return { id: ids.profile, timeZone: "Europe/Sofia", unitPreferences, ...overrides };
}

describe("core profile application services", () => {
    it("writes current state, its revision, and an integration event together", async () => {
        const fixture = createFixture([ids.event1]);

        const created = await fixture.commands.create(command({ birthDate: "1990-05-14" }), metadata);

        expect(created).toMatchObject({ id: ids.profile, birthDate: "1990-05-14", version: 1 });
        expect(fixture.revisions.values).toEqual([
            expect.objectContaining({ entityType: "profile.core", entityId: ids.profile, version: 1 }),
        ]);
        expect(fixture.events.values).toHaveLength(1);
        expect(fixture.events.values[0]).toMatchObject({ aggregateRevision: 1 });
    });

    it("enforces a single active profile", async () => {
        const fixture = createFixture([ids.event1]);
        await fixture.commands.create(command(), metadata);

        await expect(fixture.commands.create(command(), metadata)).rejects.toBeInstanceOf(ActiveCoreProfileExistsError);
    });

    it("patches the active profile and bumps its version", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.create(command({ sex: "male" }), metadata);

        const updated = await fixture.commands.update(1, { sex: null, heightMeters: "1.900" }, metadata);

        expect(updated).toMatchObject({ sex: null, heightMeters: "1.900", version: 2 });
    });

    it("rejects a stale expected version", async () => {
        const fixture = createFixture([ids.event1]);
        await fixture.commands.create(command(), metadata);

        await expect(fixture.commands.update(99, { timeZone: "UTC" }, metadata)).rejects.toThrow();
    });

    it("exposes the active profile through the ProfileReader port", async () => {
        const fixture = createFixture([ids.event1]);
        expect(await fixture.reader.findActiveProfile()).toBeNull();

        await fixture.commands.create(command(), metadata);

        expect(await fixture.reader.getActiveProfile()).toMatchObject({ id: ids.profile, timeZone: "Europe/Sofia" });
        expect(await fixture.reader.requireActiveProfileId()).toBe(ids.profile);
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeCoreProfileRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const mutations = new RevisionMutationService<CoreProfileState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        coreProfileSerializer,
        events,
        { now: () => now },
    );
    const commands = new CoreProfileCommands({
        unitOfWork,
        repository,
        mutations,
        clock: { now: () => now },
        generateId: () => {
            const id = generatedIds.shift();
            if (!id) throw new Error("No generated ID remains");
            return id;
        },
    });
    return { repository, revisions, events, commands, reader: new CoreProfileReader(repository) };
}

function resource(state: CoreProfileState, version: number): CoreProfileResource {
    return { ...structuredClone(state), version };
}

class FakeCoreProfileRepository implements CoreProfileRepository<typeof transaction> {
    private readonly values = new Map<string, { state: CoreProfileState; version: number }>();

    async findActive(): Promise<StoredCoreProfile | null> {
        const stored = [...this.values.values()].find(item => item.state.status === "active");
        return stored ? structuredClone(stored) : null;
    }

    async readActive(): Promise<CoreProfileResource | null> {
        const stored = [...this.values.values()].find(item => item.state.status === "active");
        return stored ? resource(stored.state, stored.version) : null;
    }

    async readProfile(id: EntityId): Promise<CoreProfileResource | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: CoreProfileState, version: number): Promise<void> {
        if (this.values.has(id)) throw new Error("duplicate profile");
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: CoreProfileState,
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
