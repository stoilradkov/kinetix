import { describe, expect, it } from "vitest";

import {
    ActiveTrainingProfileExistsError,
    TrainingProfileCommands,
    trainingProfileSerializer,
    type CreateTrainingProfileCommand,
    type StoredTrainingProfile,
    type TrainingProfileRepository,
    type TrainingProfileResource,
} from "#src/modules/training/application/index";
import type { TrainingProfileState } from "#src/modules/training/domain/index";
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
    trainingProfile: "0198a4db-d8da-7000-8000-0000000000b1",
    coreProfile: "0198a4db-d8da-7000-8000-0000000000b2",
    event1: "0198a4db-d8da-7000-8000-0000000000b3",
    event2: "0198a4db-d8da-7000-8000-0000000000b4",
} as const;
const now = new Date("2026-07-27T12:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(overrides: Partial<CreateTrainingProfileCommand> = {}): CreateTrainingProfileCommand {
    return { id: ids.trainingProfile, ...overrides };
}

describe("training profile application services", () => {
    it("binds the active core profile id from the ProfileReader and writes state, revision, and event", async () => {
        const fixture = createFixture([ids.event1]);

        const created = await fixture.commands.create(command({ experience: "advanced" }), metadata);

        expect(created).toMatchObject({
            id: ids.trainingProfile,
            profileId: ids.coreProfile,
            experience: "advanced",
            version: 1,
        });
        expect(fixture.revisions.values).toEqual([
            expect.objectContaining({ entityType: "training.profile", entityId: ids.trainingProfile, version: 1 }),
        ]);
        expect(fixture.events.values).toHaveLength(1);
    });

    it("enforces a single active training profile", async () => {
        const fixture = createFixture([ids.event1]);
        await fixture.commands.create(command(), metadata);

        await expect(fixture.commands.create(command(), metadata)).rejects.toBeInstanceOf(
            ActiveTrainingProfileExistsError,
        );
    });

    it("patches the active profile, bumps its version, and rejects a stale version", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.create(command(), metadata);

        const updated = await fixture.commands.update(1, { ruleVersion: 3 }, metadata);
        expect(updated).toMatchObject({ ruleVersion: 3, version: 2 });

        await expect(fixture.commands.update(99, { ruleVersion: 4 }, metadata)).rejects.toThrow();
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeTrainingProfileRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const mutations = new RevisionMutationService<TrainingProfileState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        trainingProfileSerializer,
        events,
        { now: () => now },
    );
    const commands = new TrainingProfileCommands({
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
    return { repository, revisions, events, commands };
}

function resource(state: TrainingProfileState, version: number): TrainingProfileResource {
    return { ...structuredClone(state), version };
}

class FakeTrainingProfileRepository implements TrainingProfileRepository<typeof transaction> {
    private readonly values = new Map<string, { state: TrainingProfileState; version: number }>();

    async findActive(): Promise<StoredTrainingProfile | null> {
        const stored = [...this.values.values()].find(item => item.state.status === "active");
        return stored ? structuredClone(stored) : null;
    }

    async readActive(): Promise<TrainingProfileResource | null> {
        const stored = [...this.values.values()].find(item => item.state.status === "active");
        return stored ? resource(stored.state, stored.version) : null;
    }

    async readProfile(id: EntityId): Promise<TrainingProfileResource | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: TrainingProfileState, version: number): Promise<void> {
        if (this.values.has(id)) throw new Error("duplicate training profile");
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: TrainingProfileState,
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
