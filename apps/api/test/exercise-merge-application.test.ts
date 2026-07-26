import { describe, expect, it } from "vitest";

import {
    ExerciseMergeService,
    exerciseDefinitionSerializer,
    type ExerciseCatalogItem,
    type ExerciseCatalogPage,
    type ExerciseMergeHistoryPage,
    type ExerciseMergeRecord,
    type ExerciseMergeRepository,
    type ExerciseReferenceUpdater,
    type ExerciseRepository,
} from "#src/modules/training/application/index";
import {
    ExerciseDefinition,
    type ExerciseDefinitionState,
    type ExerciseMergeIntent,
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
    canonical: "0198a4db-d8da-7000-8000-000000000001",
    merged: "0198a4db-d8da-7000-8000-000000000002",
    family: "0198a4db-d8da-7000-8000-000000000003",
    merge: "0198a4db-d8da-7000-8000-000000000004",
    event1: "0198a4db-d8da-7000-8000-000000000005",
    event2: "0198a4db-d8da-7000-8000-000000000006",
    equipment: "0198a4db-d8da-7000-8000-000000000007",
    movement: "0198a4db-d8da-7000-8000-000000000008",
    muscle: "0198a4db-d8da-7000-8000-000000000009",
} as const;
const appliedAt = new Date("2026-07-26T12:00:00.000Z");
const revertedAt = new Date("2026-07-26T13:00:00.000Z");
const transaction = {};

describe("ExerciseMergeService", () => {
    it("archives, redirects, records evidence, and publishes invalidation in one unit of work", async () => {
        const fixture = createFixture();

        const preview = await fixture.service.preview(command());
        expect(preview).toMatchObject({
            redirectedAliases: ["Barbell Bench Press", "Imported Bench"],
            totalReferenceCount: 3,
            after: {
                resolvedExerciseId: ids.canonical,
                historicalSnapshotsPreserved: true,
            },
        });

        const merged = await fixture.service.merge(
            { ...command(), reason: "Duplicate import" },
            { correlationId: "request-1", source: "user" },
        );

        expect(merged).toMatchObject({
            id: ids.merge,
            status: "applied",
            version: 1,
            mergedExerciseVersionAfterApply: 2,
            reason: "Duplicate import",
        });
        expect(fixture.exercises.stored(ids.merged)).toMatchObject({
            version: 2,
            state: { status: "archived" },
        });
        expect(await fixture.merges.resolveCanonicalId(ids.merged as EntityId)).toBe(ids.canonical);
        expect(fixture.references.redirected).toEqual([ids.merge]);
        expect(fixture.events.values.at(-1)).toMatchObject({
            stableName: "training.catalog.changed.v1",
            payload: {
                action: "merged",
                affectedExerciseIds: [ids.canonical, ids.merged],
            },
        });
        expect(fixture.revisions.values.at(-1)).toMatchObject({
            entityId: ids.merged,
            version: 2,
            snapshot: expect.objectContaining({ status: "archived" }),
        });
    });

    it("reverts the exact redirect and restores the merged definition without rewriting old revisions", async () => {
        const fixture = createFixture();
        await fixture.service.merge(command(), { correlationId: "request-1", source: "user" });
        fixture.clock.current = revertedAt;

        const reverted = await fixture.service.revert(
            ids.merge,
            {
                expectedMergeVersion: 1,
                expectedCanonicalVersion: 1,
                expectedMergedVersion: 2,
                reason: "They are distinct after all",
            },
            { correlationId: "request-2", source: "user" },
        );

        expect(reverted).toMatchObject({
            status: "reverted",
            version: 2,
            revertedCanonicalExerciseVersion: 1,
            revertedMergedExerciseVersion: 3,
            revertReason: "They are distinct after all",
        });
        expect(fixture.exercises.stored(ids.merged)).toMatchObject({
            version: 3,
            state: { status: "active", archivedAt: null },
        });
        expect(await fixture.merges.resolveCanonicalId(ids.merged as EntityId)).toBe(ids.merged);
        expect(fixture.revisions.values.map(revision => revision.version)).toEqual([2, 3]);
        expect(fixture.revisions.values[0]?.snapshot).toMatchObject({ status: "archived" });
    });

    it("rolls back the archived root and its revision when reference redirection fails", async () => {
        const fixture = createFixture();
        fixture.references.failRedirect = true;

        await expect(fixture.service.merge(command(), { correlationId: "request-3", source: "user" })).rejects.toThrow(
            /reference update failed/,
        );

        expect(fixture.exercises.stored(ids.merged)).toMatchObject({
            version: 1,
            state: { status: "active" },
        });
        expect(fixture.revisions.values).toEqual([]);
        expect(fixture.merges.values).toEqual([]);
        expect(fixture.events.values).toEqual([]);
    });

    it("rejects stale exercise and merge versions before changing state", async () => {
        const staleExerciseFixture = createFixture();
        await expect(
            staleExerciseFixture.service.merge(
                { ...command(), expectedMergedVersion: 2 },
                { correlationId: "request-4", source: "user" },
            ),
        ).rejects.toThrow(/Expected aggregate version 2/);

        const fixture = createFixture();
        await fixture.service.merge(command(), { correlationId: "request-5", source: "user" });
        await expect(
            fixture.service.revert(
                ids.merge,
                {
                    expectedMergeVersion: 2,
                    expectedCanonicalVersion: 1,
                    expectedMergedVersion: 2,
                },
                { correlationId: "request-6", source: "user" },
            ),
        ).rejects.toThrow(/Expected aggregate version 2/);
    });
});

function createFixture() {
    const exercises = new FakeExerciseRepository();
    exercises.seed(exercise(ids.canonical, "Bench Press", "seeded"), 1);
    exercises.seed(exercise(ids.merged, "Barbell Bench Press", "user"), 1);
    const merges = new FakeMergeRepository();
    const references = new FakeReferences();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork = new RollbackUnitOfWork([exercises, merges, references, revisions, events]);
    const clock = { current: appliedAt, now: () => clock.current };
    const mutations = new RevisionMutationService<ExerciseDefinitionState, DomainEvent, typeof transaction>(
        unitOfWork,
        exercises,
        revisions,
        exerciseDefinitionSerializer,
        events,
        { now: () => clock.current },
    );
    const generatedIds = [ids.merge, ids.event1, ids.event2];
    const service = new ExerciseMergeService({
        unitOfWork,
        exercises,
        merges,
        references,
        mutations,
        events,
        clock,
        generateId: () => generatedIds.shift()!,
    });
    return { service, exercises, merges, references, revisions, events, clock };
}

function command() {
    return {
        canonicalExerciseId: ids.canonical,
        mergedExerciseId: ids.merged,
        expectedCanonicalVersion: 1,
        expectedMergedVersion: 1,
    };
}

interface SnapshotParticipant {
    snapshot(): unknown;
    restore(snapshot: unknown): void;
}

class RollbackUnitOfWork implements UnitOfWork<typeof transaction> {
    constructor(private readonly participants: readonly SnapshotParticipant[]) {}

    async execute<Result>(work: (activeTransaction: typeof transaction) => Promise<Result>): Promise<Result> {
        const snapshots = this.participants.map(participant => participant.snapshot());
        try {
            return await work(transaction);
        } catch (error) {
            this.participants.forEach((participant, index) => participant.restore(snapshots[index]));
            throw error;
        }
    }
}

class FakeExerciseRepository implements ExerciseRepository<typeof transaction>, SnapshotParticipant {
    private values = new Map<string, { state: ExerciseDefinitionState; version: number }>();

    seed(state: ExerciseDefinitionState, version: number): void {
        this.values.set(state.id, { state: structuredClone(state), version });
    }

    stored(id: string) {
        return structuredClone(this.values.get(id));
    }

    snapshot(): unknown {
        return structuredClone([...this.values.entries()]);
    }

    restore(snapshot: unknown): void {
        this.values = new Map(snapshot as [string, { state: ExerciseDefinitionState; version: number }][]);
    }

    async findDefinition(id: EntityId) {
        const stored = this.values.get(id);
        return stored ? { definition: ExerciseDefinition.rehydrate(stored.state), version: stored.version } : null;
    }

    async findUserOverride() {
        return null;
    }

    async readExercise(id: EntityId): Promise<ExerciseCatalogItem | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async pageExercises(): Promise<ExerciseCatalogPage> {
        return { items: [], nextCursor: null };
    }

    async resolveAlias(): Promise<ExerciseCatalogItem | null> {
        return null;
    }

    async areInAnalyticsFamily(): Promise<boolean> {
        return false;
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        return this.stored(id) ?? null;
    }

    async create(_entityType: string, id: EntityId, state: ExerciseDefinitionState, version: number): Promise<void> {
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

class FakeMergeRepository implements ExerciseMergeRepository<typeof transaction>, SnapshotParticipant {
    values: ExerciseMergeRecord[] = [];

    snapshot(): unknown {
        return structuredClone(this.values);
    }

    restore(snapshot: unknown): void {
        this.values = snapshot as ExerciseMergeRecord[];
    }

    async activeRedirects() {
        return this.values
            .filter(value => value.status === "applied")
            .map(value => ({
                mergedExerciseId: value.mergedExercise.id,
                canonicalExerciseId: value.canonicalExercise.id,
            }));
    }

    async resolveCanonicalId(exerciseId: EntityId): Promise<EntityId> {
        const redirect = (await this.activeRedirects()).find(item => item.mergedExerciseId === exerciseId);
        return (redirect?.canonicalExerciseId ?? exerciseId) as EntityId;
    }

    async externalIdsFor() {
        return [{ provider: "strong", externalId: "bench-42" }];
    }

    async affectedFamilyExerciseIds() {
        return [ids.family];
    }

    async apply(intent: ExerciseMergeIntent, mergedExerciseVersionAfterApply: number) {
        const record = recordFrom(intent, mergedExerciseVersionAfterApply);
        this.values.push(record);
        return structuredClone(record);
    }

    async loadForUpdate(id: EntityId) {
        return structuredClone(this.values.find(value => value.id === id) ?? null);
    }

    async revert(input: {
        id: EntityId;
        expectedVersion: number;
        revertedCanonicalExerciseVersion: number;
        revertedMergedExerciseVersion: number;
        revertedAt: Date;
        reason: string | null;
    }) {
        const index = this.values.findIndex(value => value.id === input.id);
        const current = this.values[index]!;
        const reverted: ExerciseMergeRecord = {
            ...current,
            status: "reverted",
            version: 2,
            revertedCanonicalExerciseVersion: input.revertedCanonicalExerciseVersion,
            revertedMergedExerciseVersion: input.revertedMergedExerciseVersion,
            revertReason: input.reason,
            revertedAt: input.revertedAt.toISOString(),
        };
        this.values[index] = reverted;
        return structuredClone(reverted);
    }

    async get(id: EntityId) {
        return structuredClone(this.values.find(value => value.id === id) ?? null);
    }

    async history(): Promise<ExerciseMergeHistoryPage> {
        return { items: structuredClone(this.values), nextCursor: null };
    }
}

class FakeReferences implements ExerciseReferenceUpdater<typeof transaction>, SnapshotParticipant {
    redirected: string[] = [];
    failRedirect = false;

    snapshot(): unknown {
        return structuredClone(this.redirected);
    }

    restore(snapshot: unknown): void {
        this.redirected = snapshot as string[];
    }

    async preview() {
        return [{ referenceType: "planned_exercises", count: 3 }];
    }

    async redirect(mergeId: EntityId) {
        if (this.failRedirect) throw new Error("reference update failed");
        this.redirected.push(mergeId);
        return this.preview();
    }

    async revert(mergeId: EntityId): Promise<void> {
        this.redirected = this.redirected.filter(id => id !== mergeId);
    }
}

class FakeRevisionStore implements RevisionStore<typeof transaction>, SnapshotParticipant {
    values: EntityRevision[] = [];

    snapshot(): unknown {
        return structuredClone(this.values);
    }

    restore(snapshot: unknown): void {
        this.values = snapshot as EntityRevision[];
    }

    async append(revision: EntityRevision): Promise<void> {
        this.values.push(structuredClone(revision));
    }

    async find(): Promise<EntityRevision | null> {
        return null;
    }

    async history() {
        return { items: [], nextCursor: null };
    }
}

class FakeEvents implements TransactionalEventPublisher<DomainEvent, typeof transaction>, SnapshotParticipant {
    values: DomainEvent[] = [];

    snapshot(): unknown {
        return structuredClone(this.values);
    }

    restore(snapshot: unknown): void {
        this.values = snapshot as DomainEvent[];
    }

    async publish(events: readonly DomainEvent[]): Promise<void> {
        this.values.push(...events);
    }
}

function exercise(id: string, name: string, ownership: "seeded" | "user"): ExerciseDefinitionState {
    return ExerciseDefinition.create(
        {
            id,
            slug: name.toLowerCase().replaceAll(" ", "-"),
            name,
            aliases: name.startsWith("Barbell") ? ["Imported Bench"] : [],
            ownership,
            equipmentTypeId: ids.equipment,
            movementPatternId: ids.movement,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "supine",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            muscles: [{ muscleGroupId: ids.muscle, role: "primary" }],
            relationships: [{ targetExerciseId: ids.family, type: "analytics_family" }],
        },
        appliedAt,
    ).state;
}

function recordFrom(intent: ExerciseMergeIntent, mergedExerciseVersionAfterApply: number): ExerciseMergeRecord {
    return {
        id: intent.id,
        status: "applied",
        version: 1,
        canonicalExercise: {
            id: intent.canonicalExerciseId,
            name: intent.canonicalExerciseName,
            version: intent.canonicalExerciseVersion,
        },
        mergedExercise: {
            id: intent.mergedExerciseId,
            name: intent.mergedExerciseName,
            version: intent.mergedExerciseVersion,
        },
        mergedExerciseVersionAfterApply,
        revertedCanonicalExerciseVersion: null,
        revertedMergedExerciseVersion: null,
        redirectedAliases: intent.redirectedAliases,
        externalIds: intent.externalIds,
        referenceImpact: intent.referenceImpact,
        totalReferenceCount: intent.referenceImpact.reduce((total, impact) => total + impact.count, 0),
        affectedExerciseIds: intent.affectedExerciseIds,
        affectedFamilyExerciseIds: intent.affectedFamilyExerciseIds,
        reason: intent.reason,
        revertReason: null,
        appliedAt: intent.appliedAt,
        revertedAt: null,
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
        muscles: [],
        tags: [],
        relationships: state.relationships,
        notes: state.notes,
        version,
        position: state.position,
    };
}
