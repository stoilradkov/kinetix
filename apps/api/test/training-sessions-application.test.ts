import { describe, expect, it } from "vitest";

import {
    TrainingSessionCommands,
    TrainingSessionNotFoundError,
    trainingSessionSerializer,
    type TrainingSessionListFilter,
    type TrainingSessionRepository,
    type TrainingSessionResource,
    type TrainingSessionSummary,
} from "#src/modules/training/application/index";
import type { ExerciseSnapshotV1, TrainingSessionState } from "#src/modules/training/domain/index";
import {
    RevisionMutationService,
    VersionConflictError,
    type CommandContext,
    type EntityRevision,
    type OutboxWriter,
    type RevisionStore,
    type UnitOfWork,
} from "#src/platform/application/index";
import type { DomainEvent, EntityId } from "#src/platform/domain/index";

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const now = new Date("2026-08-02T09:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "req-1", source: "user" };

describe("training session application services", () => {
    it("creates an unplanned draft, defaulting local date and time zone from the active profile", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        expect(created).toMatchObject({
            status: "draft",
            profileId: PROFILE,
            timeZone: "Europe/Sofia",
            localDate: "2026-08-02",
            version: 1,
        });
        expect(fixture.events.values.map(event => event.name)).toEqual(["training.session.created"]);
    });

    it("honours an explicit date and zone and records the planned-session link", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(
            { localDate: "2026-08-05", timeZone: "America/New_York", sourcePlannedSessionId: PROFILE },
            metadata,
        );
        expect(created).toMatchObject({ localDate: "2026-08-05", timeZone: "America/New_York" });
        expect(created.sourcePlannedSessionId).toBe(PROFILE);
    });

    it("walks the full lifecycle start → complete → reopen → complete", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        const started = await fixture.commands.start(created.id, created.version, metadata);
        expect(started).toMatchObject({ status: "in_progress", version: 2 });
        expect(started.startedAt).toBe(now.toISOString());
        const completed = await fixture.commands.complete(
            started.id,
            started.version,
            { postWorkout: { enjoyment: 5 } },
            metadata,
        );
        expect(completed).toMatchObject({ status: "completed", version: 3 });
        expect(completed.postWorkout.enjoyment).toBe(5);
        const reopened = await fixture.commands.reopen(completed.id, completed.version, metadata);
        expect(reopened).toMatchObject({ status: "in_progress", version: 4 });
        const recompleted = await fixture.commands.complete(reopened.id, reopened.version, {}, metadata);
        expect(recompleted).toMatchObject({ status: "completed", version: 5 });
    });

    it("updates readiness, tags, notes, and activities on an in-progress session", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        const started = await fixture.commands.start(created.id, created.version, metadata);
        const updated = await fixture.commands.update(
            started.id,
            started.version,
            {
                readiness: { energy: 4, stress: 2 },
                tags: ["Push", "push"],
                notes: "felt strong",
                durationMinutes: 55,
                activities: [{ id: activityId(1), type: "strength", position: 0, rpe: 8 }],
            },
            metadata,
        );
        expect(updated.readiness).toMatchObject({ energy: 4, stress: 2 });
        expect(updated.tags).toEqual(["Push"]);
        expect(updated.durationMinutes).toBe(55);
        expect(updated.activities).toHaveLength(1);
    });

    it("archives and restores independently of lifecycle status", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        const archived = await fixture.commands.archive(created.id, created.version, metadata);
        expect(archived.archivedAt).not.toBeNull();
        const restored = await fixture.commands.restore(archived.id, archived.version, metadata);
        expect(restored.archivedAt).toBeNull();
    });

    it("excludes archived sessions from the default list", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        await fixture.commands.archive(created.id, created.version, metadata);
        expect(await fixture.repository.listSessions()).toHaveLength(0);
        expect(await fixture.repository.listSessions({ includeArchived: true })).toHaveLength(1);
    });

    it("rejects a mutation whose expected version is stale", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        await fixture.commands.start(created.id, created.version, metadata);
        await expect(fixture.commands.start(created.id, created.version, metadata)).rejects.toBeInstanceOf(
            VersionConflictError,
        );
    });

    it("reports a missing session on mutation", async () => {
        const fixture = createFixture();
        await expect(
            fixture.commands.start("0198a4db-d8da-7000-8000-000000009999", 1, metadata),
        ).rejects.toBeInstanceOf(TrainingSessionNotFoundError);
    });

    it("uses the injected clock for the created timestamp", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        expect(created.createdAt).toBe(now.toISOString());
    });

    it("resolves an immutable exercise snapshot through the catalog for new strength occurrences", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(
            {
                activities: [
                    {
                        id: activityId(1),
                        type: "strength",
                        position: 0,
                        strength: {
                            occurrences: [
                                {
                                    id: activityId(2),
                                    exerciseId: SQUAT,
                                    position: 0,
                                    performedSets: [
                                        {
                                            id: activityId(3),
                                            position: 0,
                                            setType: "working",
                                            status: "completed",
                                            measurements: {
                                                reps: 5,
                                                externalLoad: { value: 100, unit: "kg" },
                                                rpe: 8,
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                ],
            },
            metadata,
        );
        const occurrence = created.activities[0]!.strength!.occurrences[0]!;
        expect(occurrence.snapshot.name).toBe("Back Squat");
        expect(occurrence.snapshot.exerciseId).toBe(SQUAT);
        expect(occurrence.performedSets[0]!.measurements.externalLoad).toEqual({ value: 100, unit: "kg" });
    });

    it("rejects new work against an archived exercise", async () => {
        const fixture = createFixture();
        await expect(
            fixture.commands.create(
                {
                    activities: [
                        {
                            id: activityId(1),
                            type: "strength",
                            position: 0,
                            strength: { occurrences: [{ id: activityId(2), exerciseId: ARCHIVED, position: 0 }] },
                        },
                    ],
                },
                metadata,
            ),
        ).rejects.toMatchObject({ name: "ArchivedExerciseError" });
    });

    it("rejects a measurement the exercise does not support", async () => {
        const fixture = createFixture();
        await expect(
            fixture.commands.create(
                {
                    activities: [
                        {
                            id: activityId(1),
                            type: "strength",
                            position: 0,
                            strength: {
                                occurrences: [
                                    {
                                        id: activityId(2),
                                        exerciseId: SQUAT,
                                        position: 0,
                                        performedSets: [
                                            {
                                                id: activityId(3),
                                                position: 0,
                                                setType: "working",
                                                status: "completed",
                                                // Squat supports external_load, not distance.
                                                measurements: { distance: { value: 100, unit: "m" } },
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                },
                metadata,
            ),
        ).rejects.toThrow(/does not support/);
    });

    it("preserves an existing occurrence snapshot across edits and reorders/removes sets", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(
            {
                activities: [
                    {
                        id: activityId(1),
                        type: "strength",
                        position: 0,
                        strength: {
                            occurrences: [
                                {
                                    id: activityId(2),
                                    exerciseId: SQUAT,
                                    position: 0,
                                    performedSets: [
                                        { id: activityId(3), position: 0, setType: "working", status: "completed" },
                                        { id: activityId(4), position: 1, setType: "working", status: "completed" },
                                    ],
                                },
                            ],
                        },
                    },
                ],
            },
            metadata,
        );
        const originalVersion = created.activities[0]!.strength!.occurrences[0]!.snapshot.exerciseVersion;
        const started = await fixture.commands.start(created.id, created.version, metadata);
        // Keep only the second set, moved to position 0.
        const updated = await fixture.commands.update(
            started.id,
            started.version,
            {
                activities: [
                    {
                        id: activityId(1),
                        type: "strength",
                        position: 0,
                        strength: {
                            occurrences: [
                                {
                                    id: activityId(2),
                                    exerciseId: SQUAT,
                                    position: 0,
                                    performedSets: [
                                        { id: activityId(4), position: 0, setType: "working", status: "completed" },
                                    ],
                                },
                            ],
                        },
                    },
                ],
            },
            metadata,
        );
        const occurrence = updated.activities[0]!.strength!.occurrences[0]!;
        expect(occurrence.performedSets).toHaveLength(1);
        expect(occurrence.performedSets[0]!.id).toBe(activityId(4));
        expect(occurrence.snapshot.exerciseVersion).toBe(originalVersion);
    });

    it("computes objective effective load only through the snapshotted load model", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(
            {
                activities: [
                    {
                        id: activityId(1),
                        type: "strength",
                        position: 0,
                        strength: {
                            occurrences: [
                                {
                                    id: activityId(2),
                                    exerciseId: PULLUP,
                                    position: 0,
                                    performedSets: [
                                        {
                                            id: activityId(3),
                                            position: 0,
                                            setType: "working",
                                            status: "completed",
                                            measurements: {
                                                reps: 8,
                                                bodyweight: { value: 80, unit: "kg" },
                                                addedLoad: { value: 10, unit: "kg" },
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                ],
            },
            metadata,
        );
        const set = created.activities[0]!.strength!.occurrences[0]!.performedSets[0]!;
        expect(set.measurements.bodyweight).toEqual({ value: 80, unit: "kg" });
        expect(set.measurements.addedLoad).toEqual({ value: 10, unit: "kg" });
    });
});

function activityId(index: number): string {
    return `0198a4db-d8da-7000-8000-${index.toString(16).padStart(12, "0")}`;
}

const SQUAT = "0198a4db-d8da-7000-8000-0000000000e1";
const PULLUP = "0198a4db-d8da-7000-8000-0000000000e2";
const ARCHIVED = "0198a4db-d8da-7000-8000-0000000000e3";

function snapshotFor(exerciseId: string, overrides: Partial<ExerciseSnapshotV1> = {}): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Exercise",
        equipmentTypeId: PROFILE,
        movementPatternId: PROFILE,
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "standing",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
        ...overrides,
    };
}

function defaultCatalog() {
    const exercises = new Map<string, { status: "active" | "archived"; snapshot: ExerciseSnapshotV1 }>([
        [SQUAT, { status: "active", snapshot: snapshotFor(SQUAT, { name: "Back Squat" }) }],
        [
            PULLUP,
            {
                status: "active",
                snapshot: snapshotFor(PULLUP, {
                    name: "Pull-up",
                    loadModel: "full_bodyweight_plus_added_minus_assistance",
                    laterality: "bilateral",
                    supportedMeasurements: ["repetitions", "bodyweight", "added_load", "assistance"],
                }),
            },
        ],
        [ARCHIVED, { status: "archived", snapshot: snapshotFor(ARCHIVED, { name: "Retired" }) }],
    ]);
    return {
        resolveCurrentExercise: async (id: string) => {
            const found = exercises.get(id);
            if (!found) throw new Error(`unknown exercise ${id}`);
            return {
                requestedExerciseId: id,
                resolvedExerciseId: id,
                redirected: false,
                exercise: { id, status: found.status, version: 1 } as never,
            };
        },
        currentSnapshot: async (id: string) => {
            const found = exercises.get(id);
            if (!found) throw new Error(`unknown exercise ${id}`);
            return found.snapshot;
        },
    };
}

function createFixture(catalog: ReturnType<typeof defaultCatalog> = defaultCatalog()) {
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    let counter = 0;
    const generateId = () => `0198a4db-d8da-7000-8000-a${(++counter).toString(16).padStart(11, "0")}`;
    const clock = { now: () => now };
    const profileReader = {
        getActiveProfile: async () => ({
            id: PROFILE,
            timeZone: "Europe/Sofia",
            unitPreferences: { mass: "kg", distance: "km", height: "cm" } as never,
            birthDate: null,
            sex: null,
            heightMeters: null,
            version: 1,
        }),
    };
    const repository = new FakeTrainingSessionRepository();
    const mutations = new RevisionMutationService<TrainingSessionState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        trainingSessionSerializer,
        events,
        clock,
    );
    const commands = new TrainingSessionCommands({
        unitOfWork,
        repository,
        mutations,
        profileReader,
        catalog,
        clock,
        generateId,
    });
    return { commands, repository, events, revisions };
}

class FakeTrainingSessionRepository implements TrainingSessionRepository<typeof transaction> {
    private readonly values = new Map<string, { state: TrainingSessionState; version: number }>();

    async readSession(id: EntityId): Promise<TrainingSessionResource | null> {
        const stored = this.values.get(id);
        return stored ? { ...structuredClone(stored.state), version: stored.version } : null;
    }

    async listSessions(filter?: TrainingSessionListFilter): Promise<readonly TrainingSessionSummary[]> {
        return [...this.values.values()]
            .filter(item => filter?.includeArchived || item.state.archivedAt === null)
            .map(item => {
                const { activities, painRecords, ...core } = structuredClone(item.state);
                return {
                    ...core,
                    version: item.version,
                    activityCount: activities.length,
                    painRecordCount: painRecords.length,
                };
            });
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: TrainingSessionState, version: number): Promise<void> {
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: TrainingSessionState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new VersionConflictError(expectedVersion, nextVersion);
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

class FakeEvents implements OutboxWriter<typeof transaction> {
    readonly values: DomainEvent[] = [];

    async publish(events: readonly DomainEvent[]): Promise<void> {
        this.values.push(...events);
    }
}
