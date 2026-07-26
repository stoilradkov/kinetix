import { describe, expect, it } from "vitest";

import {
    ExerciseCatalogCommands,
    TrainingExerciseCatalog,
    exerciseDefinitionSerializer,
    type ExerciseCatalogItem,
    type ExerciseCatalogPage,
    type ExerciseRepository,
} from "#src/modules/training/application/index";
import {
    ExerciseDefinition,
    type CreateExerciseDefinitionInput,
    type ExerciseDefinitionState,
} from "#src/modules/training/domain/index";
import {
    RevisionMutationService,
    type EntityRevision,
    type RevisionStore,
    type TransactionalEventPublisher,
    type UnitOfWork,
} from "#src/platform/application/index";
import type { DomainEvent, EntityId } from "#src/platform/domain/index";

const ids = {
    exercise: "0198a4db-d8da-7000-8000-000000000001",
    fork: "0198a4db-d8da-7000-8000-000000000002",
    event1: "0198a4db-d8da-7000-8000-000000000003",
    event2: "0198a4db-d8da-7000-8000-000000000004",
    equipment: "0198a4db-d8da-7000-8000-000000000005",
    movement: "0198a4db-d8da-7000-8000-000000000006",
    muscle: "0198a4db-d8da-7000-8000-000000000007",
} as const;
const now = new Date("2026-07-26T12:00:00.000Z");
const transaction = {};

describe("exercise catalog application services", () => {
    it("writes current state, its revision, and an integration event together", async () => {
        const fixture = createFixture([ids.event1]);

        const created = await fixture.commands.create(commandInput(), {
            correlationId: "request-1",
            source: "user",
        });

        expect(created).toMatchObject({ id: ids.exercise, ownership: "user", version: 1 });
        expect(fixture.revisions.values).toEqual([
            expect.objectContaining({
                entityType: "training.exercise",
                entityId: ids.exercise,
                version: 1,
                snapshot: expect.objectContaining({ name: "Bench Press" }),
            }),
        ]);
        expect(fixture.events.values).toEqual([
            expect.objectContaining({
                stableName: "training.exercise.created.v1",
                aggregateRevision: 1,
            }),
        ]);
    });

    it("forks a seeded edit and keeps historical snapshots stable after later changes", async () => {
        const fixture = createFixture([ids.fork, ids.event1, ids.event2]);
        fixture.repository.seed(ExerciseDefinition.create({ ...commandInput(), ownership: "seeded" }, now).state, 2);

        const fork = await fixture.commands.update(
            ids.exercise,
            2,
            { notes: "my setup" },
            { correlationId: "request-2", source: "user" },
        );
        expect(fork).toMatchObject({
            id: ids.fork,
            ownership: "user",
            forkedFromExerciseId: ids.exercise,
            notes: "my setup",
            version: 1,
        });
        expect(fixture.repository.state(ids.exercise)).toMatchObject({
            ownership: "seeded",
            notes: null,
        });

        await fixture.commands.update(
            ids.fork,
            1,
            { name: "My Bench Press" },
            { correlationId: "request-3", source: "user" },
        );
        const current = await fixture.catalog.currentSnapshot(ids.fork);
        const historical = await fixture.catalog.historicalSnapshot(ids.fork, 1);

        expect(current).toMatchObject({ exerciseVersion: 2, name: "My Bench Press" });
        expect(historical).toMatchObject({ exerciseVersion: 1, name: "Bench Press" });
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeExerciseRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = {
        execute: work => work(transaction),
    };
    const mutations = new RevisionMutationService<ExerciseDefinitionState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        exerciseDefinitionSerializer,
        events,
        { now: () => now },
    );
    const commands = new ExerciseCatalogCommands({
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
    return {
        repository,
        revisions,
        events,
        commands,
        catalog: new TrainingExerciseCatalog(repository, revisions),
    };
}

class FakeExerciseRepository implements ExerciseRepository<typeof transaction> {
    private readonly values = new Map<string, { state: ExerciseDefinitionState; version: number }>();

    seed(state: ExerciseDefinitionState, version: number): void {
        this.values.set(state.id, { state: structuredClone(state), version });
    }

    state(id: string): ExerciseDefinitionState | undefined {
        return structuredClone(this.values.get(id)?.state);
    }

    async findDefinition(id: EntityId) {
        const stored = this.values.get(id);
        return stored
            ? {
                  definition: ExerciseDefinition.rehydrate(stored.state),
                  version: stored.version,
              }
            : null;
    }

    async findUserOverride(seedExerciseId: EntityId) {
        const stored = [...this.values.values()].find(item => item.state.forkedFromExerciseId === seedExerciseId);
        return stored
            ? {
                  definition: ExerciseDefinition.rehydrate(stored.state),
                  version: stored.version,
              }
            : null;
    }

    async readExercise(id: EntityId): Promise<ExerciseCatalogItem | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async pageExercises(): Promise<ExerciseCatalogPage> {
        return {
            items: [...this.values.values()].map(item => resource(item.state, item.version)),
            nextCursor: null,
        };
    }

    async resolveAlias(normalizedAlias: string): Promise<ExerciseCatalogItem | null> {
        const stored = [...this.values.values()].find(
            item =>
                item.state.status === "active" &&
                [item.state.name, ...item.state.aliases.map(alias => alias.value)]
                    .map(value => value.toLowerCase())
                    .includes(normalizedAlias),
        );
        return stored ? resource(stored.state, stored.version) : null;
    }

    async areInAnalyticsFamily(leftId: EntityId, rightId: EntityId): Promise<boolean> {
        return [...this.values.values()].some(
            item =>
                (item.state.id === leftId &&
                    item.state.relationships.some(
                        relationship =>
                            relationship.type === "analytics_family" && relationship.targetExerciseId === rightId,
                    )) ||
                (item.state.id === rightId &&
                    item.state.relationships.some(
                        relationship =>
                            relationship.type === "analytics_family" && relationship.targetExerciseId === leftId,
                    )),
        );
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: ExerciseDefinitionState, version: number): Promise<void> {
        if (this.values.has(id)) throw new Error("duplicate exercise");
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: ExerciseDefinitionState,
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

function commandInput(): CreateExerciseDefinitionInput {
    return {
        id: ids.exercise,
        slug: "bench-press",
        name: "Bench Press",
        aliases: ["Flat Bench"],
        equipmentTypeId: ids.equipment,
        movementPatternId: ids.movement,
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "supine",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [{ muscleGroupId: ids.muscle, role: "primary" }],
        tagIds: [],
        relationships: [],
        notes: null,
    };
}

function resource(state: ExerciseDefinitionState, version: number): ExerciseCatalogItem {
    const taxonomy = {
        id: ids.equipment,
        slug: "barbell",
        name: "Barbell",
        position: 0,
        ownership: "seeded" as const,
        analyticsMappingStatus: "standard" as const,
    };
    return {
        id: state.id,
        slug: state.slug,
        name: state.name,
        aliases: state.aliases.map(alias => alias.value),
        status: state.status,
        ownership: state.ownership,
        forkedFromExerciseId: state.forkedFromExerciseId,
        equipment: taxonomy,
        movementPattern: { ...taxonomy, id: ids.movement, slug: "horizontal-push" },
        classification: state.classification,
        laterality: state.laterality,
        bodyPosition: state.bodyPosition,
        repetitionSemantics: state.repetitionSemantics,
        loadModel: state.loadModel,
        supportedMeasurements: state.supportedMeasurements,
        muscles: state.muscles.map(assignment => ({
            muscle: {
                id: assignment.muscleGroupId,
                slug: "chest",
                name: "Chest",
                position: 0,
            },
            role: assignment.role,
        })),
        tags: [],
        relationships: state.relationships,
        notes: state.notes,
        version,
        position: state.position,
        archivedAt: state.archivedAt,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
    };
}
