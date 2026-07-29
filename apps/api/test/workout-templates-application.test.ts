import { describe, expect, it } from "vitest";

import {
    PrescriptionCloner,
    PrescriptionPublisher,
    RepositoryWorkoutTemplatePlanningReader,
    WorkoutTemplateCommands,
    WorkoutTemplateNotFoundError,
    workoutTemplateSerializer,
    type CreateWorkoutTemplateCommand,
    type SessionPrescriptionRepository,
    type WorkoutTemplateDraft,
    type WorkoutTemplateListFilter,
    type WorkoutTemplateRepository,
    type WorkoutTemplateResource,
} from "#src/modules/training/application/index";
import type {
    ExerciseSnapshotV1,
    SessionPrescriptionState,
    WorkoutTemplateState,
} from "#src/modules/training/domain/index";
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

const EXERCISE_A = "0198a4db-d8da-7000-8000-0000000000a1";
const now = new Date("2026-07-29T10:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function snapshot(exerciseId: string): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Back Squat",
        equipmentTypeId: "0198a4db-d8da-7000-8000-0000000000b1",
        movementPatternId: "0198a4db-d8da-7000-8000-0000000000c1",
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "standing",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
    };
}

function draft(reps: number): WorkoutTemplateDraft {
    return {
        activities: [
            {
                ref: "a1",
                type: "strength",
                position: 0,
                strength: {
                    exercises: [
                        {
                            ref: "e1",
                            exerciseId: EXERCISE_A,
                            snapshot: snapshot(EXERCISE_A),
                            position: 0,
                            sets: [
                                {
                                    ref: "s1",
                                    position: 0,
                                    setType: "working",
                                    targets: { repsMin: reps, repsMax: reps },
                                },
                            ],
                        },
                    ],
                },
            },
        ],
    };
}

function createCommand(overrides: Partial<CreateWorkoutTemplateCommand> = {}): CreateWorkoutTemplateCommand {
    return { name: "Upper A", prescription: draft(5), ...overrides };
}

describe("workout template application services", () => {
    it("creates a template that owns its published prescription, then edits publish a new tree and bump the version", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(createCommand(), metadata);
        expect(created.template).toMatchObject({ status: "active", version: 1, name: "Upper A" });
        expect(created.prescription.kind).toBe("template");
        expect(created.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!.targets.repsMin).toBe(5);
        expect(fixture.prescriptions.trees.size).toBe(1);

        const edited = await fixture.commands.update(
            created.template.id,
            1,
            { name: "Upper A (v2)", prescription: draft(8) },
            metadata,
        );
        expect(edited.template).toMatchObject({ version: 2, name: "Upper A (v2)" });
        expect(edited.template.currentPrescriptionId).not.toBe(created.template.currentPrescriptionId);
        expect(edited.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!.targets.repsMin).toBe(8);
        // Both the original and edited prescription trees are preserved immutably.
        expect(fixture.prescriptions.trees.size).toBe(2);
    });

    it("keeps a placed planned clone byte-for-byte stable when the template is later edited", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(createCommand(), metadata);

        // Program generation clones the current template prescription into a placed plan.
        const planned = await fixture.planning.prepareClone(created.template.id, { targetKind: "planned" }, metadata);
        const plannedBefore = structuredClone(fixture.prescriptions.trees.get(planned.id)!);

        // Editing the template republishes a new tree; the placed plan must not change.
        await fixture.commands.update(created.template.id, 1, { prescription: draft(12) }, metadata);

        expect(fixture.prescriptions.trees.get(planned.id)).toEqual(plannedBefore);
        expect(planned.sourcePrescriptionId).toBe(created.template.currentPrescriptionId);
    });

    it("archives then restores a template, keeping the current prescription pointer", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(createCommand(), metadata);

        const archived = await fixture.commands.archive(created.template.id, 1, metadata);
        expect(archived.template).toMatchObject({ status: "archived", version: 2 });
        expect(archived.template.currentPrescriptionId).toBe(created.template.currentPrescriptionId);
        expect(await fixture.repository.listTemplates()).toHaveLength(0);
        expect(await fixture.repository.listTemplates({ includeArchived: true })).toHaveLength(1);

        const restored = await fixture.commands.restore(created.template.id, 2, metadata);
        expect(restored.template).toMatchObject({ status: "active", version: 3 });
    });

    it("rejects a stale expected version", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(createCommand(), metadata);
        await fixture.commands.update(created.template.id, 1, { name: "renamed" }, metadata);
        await expect(
            fixture.commands.update(created.template.id, 1, { name: "again" }, metadata),
        ).rejects.toBeInstanceOf(VersionConflictError);
    });

    it("reports an unknown template", async () => {
        const fixture = createFixture();
        await expect(fixture.commands.archive(EXERCISE_A, 1, metadata)).rejects.toBeInstanceOf(
            WorkoutTemplateNotFoundError,
        );
    });

    it("reads a template plus its current prescription through the planning port", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(createCommand(), metadata);
        const detail = await fixture.planning.readForPlanning(created.template.id);
        expect(detail?.template.id).toBe(created.template.id);
        expect(detail?.prescription.id).toBe(created.template.currentPrescriptionId);
    });
});

function createFixture() {
    const repository = new FakeWorkoutTemplateRepository();
    const prescriptions = new FakePrescriptionRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    let counter = 0;
    const generateId = () => `0198a4db-d8da-7000-8000-${(++counter).toString(16).padStart(12, "0")}`;
    const mutations = new RevisionMutationService<WorkoutTemplateState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        workoutTemplateSerializer,
        events,
        { now: () => now },
    );
    const prescriptionRuntime = {
        unitOfWork,
        repository: prescriptions,
        outbox: events,
        clock: { now: () => now },
        generateId,
    };
    const publisher = new PrescriptionPublisher(prescriptionRuntime);
    const cloner = new PrescriptionCloner(prescriptionRuntime);
    const commands = new WorkoutTemplateCommands({
        unitOfWork,
        repository,
        mutations,
        publisher,
        prescriptions,
        profileReader: { requireActiveProfileId: async () => "0198a4db-d8da-7000-8000-0000000000d9" },
        clock: { now: () => now },
        generateId,
    });
    const planning = new RepositoryWorkoutTemplatePlanningReader(repository, prescriptions, cloner);
    return { repository, prescriptions, commands, planning };
}

class FakeWorkoutTemplateRepository implements WorkoutTemplateRepository<typeof transaction> {
    private readonly values = new Map<string, { state: WorkoutTemplateState; version: number }>();
    readonly links: { templateId: string; version: number; prescriptionId: string }[] = [];

    async readTemplate(id: EntityId): Promise<WorkoutTemplateResource | null> {
        const stored = this.values.get(id);
        return stored ? { ...structuredClone(stored.state), version: stored.version } : null;
    }

    async listTemplates(filter?: WorkoutTemplateListFilter): Promise<readonly WorkoutTemplateResource[]> {
        return [...this.values.values()]
            .filter(item => filter?.includeArchived || item.state.status === "active")
            .map(item => ({ ...structuredClone(item.state), version: item.version }));
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: WorkoutTemplateState, version: number): Promise<void> {
        this.values.set(id, { state: structuredClone(state), version });
        this.links.push({ templateId: id, version, prescriptionId: state.currentPrescriptionId });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: WorkoutTemplateState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new Error("version conflict");
        this.values.set(id, { state: structuredClone(state), version: nextVersion });
        this.links.push({ templateId: id, version: nextVersion, prescriptionId: state.currentPrescriptionId });
    }
}

class FakePrescriptionRepository implements SessionPrescriptionRepository<typeof transaction> {
    readonly trees = new Map<string, SessionPrescriptionState>();

    async insertTree(state: SessionPrescriptionState): Promise<void> {
        if (this.trees.has(state.id)) throw new Error("duplicate prescription");
        this.trees.set(state.id, structuredClone(state));
    }

    async loadTree(id: string): Promise<SessionPrescriptionState | null> {
        const stored = this.trees.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async loadTrees(ids: readonly string[]): Promise<readonly SessionPrescriptionState[]> {
        return ids.map(id => this.trees.get(id)).filter((tree): tree is SessionPrescriptionState => tree != null);
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
