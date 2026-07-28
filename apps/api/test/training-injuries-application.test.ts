import { describe, expect, it } from "vitest";

import {
    TrainingInjuryCommands,
    TrainingInjuryNotFoundError,
    UnknownCatalogLinkError,
    trainingInjurySerializer,
    type CreateTrainingInjuryCommand,
    type ExerciseCatalogItem,
    type InjuryCatalogReader,
    type MuscleCatalogItem,
    type TrainingInjuryListFilter,
    type TrainingInjuryRepository,
    type TrainingInjuryResource,
} from "#src/modules/training/application/index";
import type { TrainingInjuryState } from "#src/modules/training/domain/index";
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
    injury1: "0198a4db-d8da-7000-8000-0000000000f1",
    injury2: "0198a4db-d8da-7000-8000-0000000000f2",
    coreProfile: "0198a4db-d8da-7000-8000-0000000000f9",
    muscle: "0198a4db-d8da-7000-8000-0000000000fa",
    exercise: "0198a4db-d8da-7000-8000-0000000000fb",
    event1: "0198a4db-d8da-7000-8000-0000000000e1",
    event2: "0198a4db-d8da-7000-8000-0000000000e2",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(overrides: Partial<CreateTrainingInjuryCommand> = {}): CreateTrainingInjuryCommand {
    return { id: ids.injury1, name: "Left shoulder strain", bodyArea: "shoulder", ...overrides };
}

describe("training injuries application services", () => {
    it("binds the active profile id and validates catalog links on create", async () => {
        const fixture = createFixture([ids.event1]);

        const created = await fixture.commands.create(
            command({ muscleGroupIds: [ids.muscle], exerciseIds: [ids.exercise], severity: "severe" }),
            metadata,
        );

        expect(created).toMatchObject({
            id: ids.injury1,
            profileId: ids.coreProfile,
            severity: "severe",
            muscleGroupIds: [ids.muscle],
            exerciseIds: [ids.exercise],
            version: 1,
        });
        expect(fixture.revisions.values).toHaveLength(1);
        expect(fixture.events.values).toHaveLength(1);
    });

    it("rejects links that do not exist in the catalog", async () => {
        const fixture = createFixture([ids.event1]);
        await expect(
            fixture.commands.create(command({ muscleGroupIds: [ids.injury2] }), metadata),
        ).rejects.toBeInstanceOf(UnknownCatalogLinkError);
        expect(fixture.revisions.values).toHaveLength(0);
    });

    it("updates an injury by id, bumps its version, and rejects a stale version", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.create(command(), metadata);

        const updated = await fixture.commands.update(
            ids.injury1,
            1,
            { status: "resolved", resolvedDate: "2026-08-01" },
            metadata,
        );
        expect(updated).toMatchObject({ status: "resolved", resolvedDate: "2026-08-01", version: 2 });

        await expect(fixture.commands.update(ids.injury1, 99, { severity: "mild" }, metadata)).rejects.toThrow();
    });

    it("reports an unknown injury", async () => {
        const fixture = createFixture([]);
        await expect(fixture.commands.update(ids.injury2, 1, { severity: "mild" }, metadata)).rejects.toBeInstanceOf(
            TrainingInjuryNotFoundError,
        );
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeTrainingInjuryRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const mutations = new RevisionMutationService<TrainingInjuryState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        trainingInjurySerializer,
        events,
        { now: () => now },
    );
    const commands = new TrainingInjuryCommands({
        unitOfWork,
        repository,
        mutations,
        profileReader: { requireActiveProfileId: async () => ids.coreProfile },
        catalog: new FakeCatalogReader(),
        clock: { now: () => now },
        generateId: () => {
            const id = generatedIds.shift();
            if (!id) throw new Error("No generated ID remains");
            return id;
        },
    });
    return { repository, revisions, events, commands };
}

function resource(state: TrainingInjuryState, version: number): TrainingInjuryResource {
    return { ...structuredClone(state), version };
}

class FakeCatalogReader implements InjuryCatalogReader {
    async listMuscles(): Promise<readonly MuscleCatalogItem[]> {
        return [{ id: ids.muscle, slug: "delts", name: "Deltoids", position: 1 }];
    }

    async listExercises(): Promise<readonly ExerciseCatalogItem[]> {
        return [{ id: ids.exercise } as ExerciseCatalogItem];
    }
}

class FakeTrainingInjuryRepository implements TrainingInjuryRepository<typeof transaction> {
    private readonly values = new Map<string, { state: TrainingInjuryState; version: number }>();

    async readInjury(id: EntityId): Promise<TrainingInjuryResource | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async listInjuries(filter?: TrainingInjuryListFilter): Promise<readonly TrainingInjuryResource[]> {
        return [...this.values.values()]
            .filter(item => filter?.status === undefined || item.state.status === filter.status)
            .map(item => resource(item.state, item.version));
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: TrainingInjuryState, version: number): Promise<void> {
        if (this.values.has(id)) throw new Error("duplicate training injury");
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: TrainingInjuryState,
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
