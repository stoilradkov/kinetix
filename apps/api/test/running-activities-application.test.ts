import { describe, expect, it } from "vitest";

import {
    RunActivityNotFoundError,
    RunningActivityService,
    TrainingSessionCommands,
    trainingSessionSerializer,
    type RunListFilter,
    type RunListItem,
    type RunningActivityQueries,
    type TrainingSessionListFilter,
    type TrainingSessionRepository,
    type TrainingSessionResource,
    type TrainingSessionSummary,
} from "#src/modules/training/application/index";
import type { SessionPrescriptionState, TrainingSessionState } from "#src/modules/training/domain/index";
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
const now = new Date("2026-08-07T09:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "req-1", source: "user" };
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

describe("running activity facade", () => {
    it("logs a run: creates, starts, and completes a run-only session in one call", async () => {
        const fixture = createFixture();
        const run = await fixture.service.addRun(
            {
                title: "Tempo run",
                tags: ["Long run"],
                durationSeconds: 2_400,
                rpe: 7,
                running: { distance: { value: 10, unit: "km" }, movingTime: { value: 45, unit: "min" } },
            },
            metadata,
        );

        expect(run.status).toBe("completed");
        expect(run.version).toBe(3); // created → started → completed
        expect(run.title).toBe("Tempo run");
        expect(run.tags).toEqual(["Long run"]);
        expect(run.durationSeconds).toBe(2_400);
        expect(run.running.distance).toEqual({ value: 10, unit: "km" });
        expect(fixture.events.values.map(event => event.name)).toEqual([
            "training.session.created",
            "training.session.started",
            "training.session.completed",
        ]);
    });

    it("carries pain records and an explicit activity id through addRun", async () => {
        const fixture = createFixture();
        const activityId = id(0x500);
        const run = await fixture.service.addRun(
            {
                activityId,
                running: { distance: { value: 5, unit: "km" } },
                painRecords: [{ id: id(0x501), activityId, bodyArea: "Knee", side: "left", severity: 3 }],
            },
            metadata,
        );
        expect(run.activityId).toBe(activityId);
        const stored = await fixture.repository.readSession(run.sessionId as EntityId);
        expect(stored?.painRecords).toHaveLength(1);
    });

    it("updates a run's summary and records a run-step mapping, chaining the version", async () => {
        const fixture = createFixture();
        const stepId = id(0x600);
        const created = await fixture.service.addRun(
            { running: { steps: [{ id: stepId, type: "work", position: 0 }] } },
            metadata,
        );

        const updated = await fixture.service.updateRun(
            created.sessionId,
            created.activityId,
            created.version,
            {
                running: {
                    distance: { value: 8, unit: "km" },
                    steps: [{ id: stepId, type: "work", position: 0 }],
                },
                mappings: {
                    runStepMappings: [{ id: id(0x610), performedRunStepId: stepId, relation: "added" }],
                },
            },
            metadata,
        );

        // Editing a completed run reopens → setRunning → recordMappings → re-completes (4 revisions).
        expect(updated.version).toBe(created.version + 4);
        expect(updated.status).toBe("completed");
        expect(updated.running.distance).toEqual({ value: 8, unit: "km" });
        expect(updated.runStepMappings).toHaveLength(1);
        expect(updated.runStepMappings[0]!.relation).toBe("added");
        expect(fixture.events.values.some(event => event.name === "training.mapping.changed")).toBe(true);
    });

    it("shows a run and filters run-step mappings to the requested activity's steps", async () => {
        const fixture = createFixture();
        const stepId = id(0x700);
        const created = await fixture.service.addRun(
            { running: { steps: [{ id: stepId, type: "work", position: 0 }] } },
            metadata,
        );
        await fixture.service.updateRun(
            created.sessionId,
            created.activityId,
            created.version,
            {
                running: { steps: [{ id: stepId, type: "work", position: 0 }] },
                mappings: { runStepMappings: [{ id: id(0x710), performedRunStepId: stepId, relation: "added" }] },
            },
            metadata,
        );

        const view = await fixture.service.showRun(created.sessionId);
        expect(view).not.toBeNull();
        expect(view!.activityId).toBe(created.activityId);
        expect(view!.runStepMappings).toHaveLength(1);

        const byActivity = await fixture.service.showRun(created.sessionId, created.activityId);
        expect(byActivity!.activityId).toBe(created.activityId);
    });

    it("returns null from showRun when the session has no running activity", async () => {
        const fixture = createFixture();
        const draft = await fixture.commands.create({}, metadata);
        expect(await fixture.service.showRun(draft.id)).toBeNull();
        expect(await fixture.service.showRun(id(0xffff))).toBeNull();
    });

    it("raises when updating a run activity that does not exist", async () => {
        const fixture = createFixture();
        const created = await fixture.service.addRun({ running: { distance: { value: 3, unit: "km" } } }, metadata);
        await expect(
            fixture.service.updateRun(
                created.sessionId,
                id(0xdead),
                created.version,
                { running: { distance: { value: 4, unit: "km" } } },
                metadata,
            ),
        ).rejects.toBeInstanceOf(RunActivityNotFoundError);
    });

    it("delegates run listing to the bounded query port", async () => {
        const items: RunListItem[] = [
            {
                sessionId: id(1),
                activityId: id(2),
                version: 3,
                localDate: "2026-08-07",
                status: "completed",
                title: "Tempo",
                archivedAt: null,
                distanceMetres: "10000.000",
                movingTimeMs: "2700000",
                runTags: ["tempo"],
            },
        ];
        const fixture = createFixture(items);
        const listed = await fixture.service.listRuns({ includeArchived: true });
        expect(listed).toEqual(items);
        expect(fixture.queries.calls).toEqual([{ includeArchived: true }]);
    });
});

function createFixture(runs: readonly RunListItem[] = []) {
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    let counter = 0;
    const generateId = () => id(0xa000 + ++counter);
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
    const catalog = {
        resolveCurrentExercise: async (exerciseId: string) => ({
            requestedExerciseId: exerciseId,
            resolvedExerciseId: exerciseId,
            redirected: false,
            exercise: { id: exerciseId, status: "active", version: 1 } as never,
        }),
        currentSnapshot: async () => ({}) as never,
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
    // Minimal planning: `recordMappings` requires the planning ports; a run with no plan carries only
    // `added` mappings (prescribed side null), so an empty prescription set satisfies ownership.
    const planning = {
        plannedSessions: { readSession: async () => null },
        plannedCommands: { recomputeOutcomeWithinTransaction: async () => ({}) as never },
        prescriptions: {
            loadTree: async () => null,
            loadTrees: async () => [] as readonly SessionPrescriptionState[],
        },
        publisher: {
            publishPreparedState: async (state: SessionPrescriptionState) => state,
            publish: async () => ({}) as never,
        },
        templates: { readTemplate: async () => null },
        targetContext: { resolveTrainingMax: async () => null },
        increments: { resolveForExercise: async () => null },
    };
    const commands = new TrainingSessionCommands({
        unitOfWork,
        repository,
        mutations,
        profileReader,
        catalog,
        planning: planning as never,
        clock,
        generateId,
    });
    const queries = new FakeRunningActivityQueries(runs);
    const service = new RunningActivityService({ unitOfWork, sessions: commands, repository, queries, generateId });
    return { service, commands, repository, events, queries };
}

class FakeRunningActivityQueries implements RunningActivityQueries<typeof transaction> {
    readonly calls: (RunListFilter | undefined)[] = [];
    constructor(private readonly runs: readonly RunListItem[]) {}
    async listRuns(filter?: RunListFilter): Promise<readonly RunListItem[]> {
        this.calls.push(filter);
        return this.runs;
    }
}

class FakeTrainingSessionRepository implements TrainingSessionRepository<typeof transaction> {
    private readonly values = new Map<string, { state: TrainingSessionState; version: number }>();

    async readSession(sessionId: EntityId): Promise<TrainingSessionResource | null> {
        const stored = this.values.get(sessionId);
        return stored ? { ...structuredClone(stored.state), version: stored.version } : null;
    }

    async listSessions(filter?: TrainingSessionListFilter): Promise<readonly TrainingSessionSummary[]> {
        return [...this.values.values()]
            .filter(item => filter?.includeArchived || item.state.archivedAt === null)
            .map(item => {
                const {
                    activities,
                    painRecords,
                    plannedLinks,
                    activityMappings,
                    occurrenceMappings,
                    setMappings,
                    runStepMappings,
                    ...core
                } = structuredClone(item.state);
                void plannedLinks;
                void activityMappings;
                void occurrenceMappings;
                void setMappings;
                void runStepMappings;
                return {
                    ...core,
                    version: item.version,
                    activityCount: activities.length,
                    painRecordCount: painRecords.length,
                };
            });
    }

    async loadForUpdate(_entityType: string, sessionId: EntityId) {
        const stored = this.values.get(sessionId);
        return stored ? structuredClone(stored) : null;
    }

    async create(
        _entityType: string,
        sessionId: EntityId,
        state: TrainingSessionState,
        version: number,
    ): Promise<void> {
        this.values.set(sessionId, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        sessionId: EntityId,
        state: TrainingSessionState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(sessionId);
        if (!stored || stored.version !== expectedVersion) throw new VersionConflictError(expectedVersion, nextVersion);
        this.values.set(sessionId, { state: structuredClone(state), version: nextVersion });
    }
}

class FakeRevisionStore implements RevisionStore<typeof transaction> {
    readonly values: EntityRevision[] = [];
    async append(revision: EntityRevision): Promise<void> {
        this.values.push(structuredClone(revision));
    }
    async find(entityType: string, entity: EntityId, version: number): Promise<EntityRevision | null> {
        return (
            this.values.find(i => i.entityType === entityType && i.entityId === entity && i.version === version) ?? null
        );
    }
    async history(entityType: string, entity: EntityId, limit: number) {
        return {
            items: this.values.filter(i => i.entityType === entityType && i.entityId === entity).slice(0, limit),
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
