import { describe, expect, it } from "vitest";

import {
    EquipmentIncrementCommands,
    EquipmentIncrementQueries,
    equipmentIncrementSerializer,
    type CreateEquipmentIncrementCommand,
    type EquipmentIncrementCatalogReader,
    type EquipmentIncrementRepository,
    type EquipmentIncrementResource,
} from "#src/modules/training/application/index";
import type { EquipmentIncrementState } from "#src/modules/training/domain/index";
import type { ExerciseCatalogItem, ExtensibleCatalogItem } from "#src/modules/training/application/index";
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
    def: "0198a4db-d8da-7000-8000-000000002001",
    exerciseInc: "0198a4db-d8da-7000-8000-000000002002",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    exercise: "0198a4db-d8da-7000-8000-0000000000a1",
    equipment: "0198a4db-d8da-7000-8000-0000000000b1",
    event1: "0198a4db-d8da-7000-8000-0000000000e1",
    event2: "0198a4db-d8da-7000-8000-0000000000e2",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(overrides: Partial<CreateEquipmentIncrementCommand> = {}): CreateEquipmentIncrementCommand {
    return { id: ids.def, scope: "default", increment: { value: 2.5, unit: "kg" }, ...overrides };
}

describe("equipment increment application services", () => {
    it("creates an increment, bumps its version on update", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        const created = await fixture.commands.create(command(), metadata);
        expect(created).toMatchObject({ scope: "default", incrementKg: "2.5", version: 1 });

        const updated = await fixture.commands.update(ids.def, 1, { increment: { value: 5, unit: "kg" } }, metadata);
        expect(updated).toMatchObject({ incrementKg: "5", version: 2 });
    });

    it("resolves the most specific increment and rounds a load with it", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.create(
            command({ id: ids.def, scope: "default", increment: { value: 5, unit: "kg" } }),
            metadata,
        );
        await fixture.commands.create(
            command({
                id: ids.exerciseInc,
                scope: "exercise",
                exerciseId: ids.exercise,
                increment: { value: 2.5, unit: "kg" },
            }),
            metadata,
        );

        const resolved = await fixture.queries.resolveForExercise(ids.exercise);
        expect(resolved?.id).toBe(ids.exerciseInc);
        const rounded = await fixture.queries.roundForExercise(ids.exercise, "101.3");
        expect(rounded).toMatchObject({ valueKg: "102.5", scope: "exercise" });
    });

    it("falls back to the default increment for an unmatched exercise", async () => {
        const fixture = createFixture([ids.event1]);
        await fixture.commands.create(command({ increment: { value: 5, unit: "kg" } }), metadata);
        const rounded = await fixture.queries.roundForExercise(ids.exercise, "101.3");
        expect(rounded).toMatchObject({ valueKg: "100", scope: "default" });
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeEquipmentIncrementRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const catalog = new FakeCatalog();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const mutations = new RevisionMutationService<EquipmentIncrementState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        equipmentIncrementSerializer,
        events,
        { now: () => now },
    );
    const profileReader = { requireActiveProfileId: async () => ids.profile };
    const commands = new EquipmentIncrementCommands({
        unitOfWork,
        repository,
        mutations,
        profileReader,
        catalog,
        clock: { now: () => now },
        generateId: () => {
            const id = generatedIds.shift();
            if (!id) throw new Error("No generated ID remains");
            return id;
        },
    });
    const queries = new EquipmentIncrementQueries(repository, profileReader, catalog);
    return { repository, commands, queries };
}

function resource(state: EquipmentIncrementState, version: number): EquipmentIncrementResource {
    return { ...structuredClone(state), version };
}

class FakeEquipmentIncrementRepository implements EquipmentIncrementRepository<typeof transaction> {
    private readonly values = new Map<string, { state: EquipmentIncrementState; version: number }>();

    async read(id: EntityId): Promise<EquipmentIncrementResource | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async list(profileId: string): Promise<readonly EquipmentIncrementResource[]> {
        return [...this.values.values()]
            .filter(item => item.state.profileId === profileId)
            .map(item => resource(item.state, item.version));
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: EquipmentIncrementState, version: number): Promise<void> {
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: EquipmentIncrementState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new Error("version conflict");
        this.values.set(id, { state: structuredClone(state), version: nextVersion });
    }
}

class FakeCatalog implements EquipmentIncrementCatalogReader {
    async listExercises(): Promise<readonly ExerciseCatalogItem[]> {
        return [{ id: ids.exercise, equipment: { id: ids.equipment } } as ExerciseCatalogItem];
    }

    async listEquipment(): Promise<readonly ExtensibleCatalogItem[]> {
        return [{ id: ids.equipment } as ExtensibleCatalogItem];
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
