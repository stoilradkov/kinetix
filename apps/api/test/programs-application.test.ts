import { describe, expect, it } from "vitest";

import {
    PlannedSessionCommands,
    plannedSessionSerializer,
    PrescriptionCloner,
    PrescriptionPublisher,
    ProgramCommands,
    ProgramNotFoundError,
    ProgramQueries,
    programSerializer,
    RepositoryWorkoutTemplatePlanningReader,
    WorkoutTemplateCommands,
    workoutTemplateSerializer,
    type PlannedSessionListFilter,
    type PlannedSessionRepository,
    type PlannedSessionResource,
    type ProgramGoalValidator,
    type ProgramListFilter,
    type ProgramMembershipRepository,
    type ProgramRepository,
    type ProgramResource,
    type ProgramSessionLinkInput,
    type ProgramSessionMembership,
    type ProgramSummary,
    type SessionPrescriptionRepository,
    type WorkoutTemplateDraft,
    type WorkoutTemplateListFilter,
    type WorkoutTemplateRepository,
    type WorkoutTemplateResource,
} from "#src/modules/training/application/index";
import type {
    ExerciseSnapshotV1,
    PlannedSessionSchedule,
    PlannedSessionState,
    ProgramState,
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
import { entityId, type DomainEvent, type EntityId } from "#src/platform/domain/index";

const EXERCISE_A = "0198a4db-d8da-7000-8000-0000000000a1";
const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
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

function templateDraft(reps: number): WorkoutTemplateDraft {
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

describe("program application services", () => {
    it("creates a draft program with a nested block tree and no warnings", async () => {
        const fixture = createFixture();
        const created = await fixture.programs.create(
            {
                name: "Off-season",
                blocks: [
                    { id: blockId(1), type: "macrocycle", position: 0 },
                    { id: blockId(2), type: "mesocycle", position: 0, parentBlockId: blockId(1) },
                ],
            },
            metadata,
        );
        expect(created.program).toMatchObject({ status: "draft", version: 1, name: "Off-season" });
        expect(created.program.blocks).toHaveLength(2);
        expect(created.warnings).toHaveLength(0);
    });

    it("surfaces block-overlap warnings without rejecting the program", async () => {
        const fixture = createFixture();
        const created = await fixture.programs.create(
            {
                name: "Overlap",
                blocks: [
                    { id: blockId(1), type: "mesocycle", position: 0, startDate: "2026-01-01", endDate: "2026-02-01" },
                    { id: blockId(2), type: "mesocycle", position: 1, startDate: "2026-01-15", endDate: "2026-02-15" },
                ],
            },
            metadata,
        );
        expect(created.warnings.some(warning => warning.code === "block_overlap")).toBe(true);
    });

    it("validates linked goals through the goal-validation port", async () => {
        const fixture = createFixture();
        fixture.goals.add(GOAL);
        const created = await fixture.programs.create({ name: "With goal", goalIds: [GOAL] }, metadata);
        expect(created.program.goalIds).toEqual([GOAL]);
        await expect(fixture.programs.create({ name: "Bad goal", goalIds: [blockId(9)] }, metadata)).rejects.toThrow();
    });

    it("updates metadata and replaces the block set, bumping the version", async () => {
        const fixture = createFixture();
        const created = await fixture.programs.create(
            { name: "P", blocks: [{ id: blockId(1), type: "mesocycle", position: 0 }] },
            metadata,
        );
        const updated = await fixture.programs.update(
            created.program.id,
            1,
            { focus: "Strength", blocks: [{ id: blockId(2), type: "microcycle", position: 0, deload: true }] },
            metadata,
        );
        expect(updated.program).toMatchObject({ version: 2, focus: "Strength" });
        expect(updated.program.blocks).toHaveLength(1);
        expect(updated.program.blocks[0]).toMatchObject({ id: blockId(2), deload: true });
    });

    it("walks lifecycle transitions and archive/restore, each creating a revision", async () => {
        const fixture = createFixture();
        const created = await fixture.programs.create({ name: "P" }, metadata);
        const active = await fixture.programs.activate(created.program.id, 1, {}, metadata);
        expect(active.program).toMatchObject({ status: "active", version: 2 });
        const paused = await fixture.programs.pause(created.program.id, 2, metadata);
        expect(paused.program.status).toBe("paused");
        const archived = await fixture.programs.archive(created.program.id, 3, metadata);
        expect(archived.program).toMatchObject({ status: "archived", version: 4 });
        const restored = await fixture.programs.restore(created.program.id, 4, metadata);
        expect(restored.program).toMatchObject({ status: "draft", version: 5 });
    });

    it("rejects a stale expected version", async () => {
        const fixture = createFixture();
        const created = await fixture.programs.create({ name: "P" }, metadata);
        await fixture.programs.update(created.program.id, 1, { name: "renamed" }, metadata);
        await expect(
            fixture.programs.update(created.program.id, 1, { name: "again" }, metadata),
        ).rejects.toBeInstanceOf(VersionConflictError);
    });

    it("reports an unknown program", async () => {
        const fixture = createFixture();
        await expect(fixture.programs.archive(blockId(9), 1, metadata)).rejects.toBeInstanceOf(ProgramNotFoundError);
    });

    it("activates a program, cloning the template into an immutable planned prescription and writing membership", async () => {
        const fixture = createFixture();
        const template = await fixture.templates.create({ name: "Upper A", prescription: templateDraft(5) }, metadata);
        const program = await fixture.programs.create({ name: "Block 1" }, metadata);

        const activated = await fixture.programs.activate(
            program.program.id,
            1,
            { sessions: [{ templateId: template.template.id, sequence: 0, localDate: "2026-08-01" }] },
            metadata,
        );

        expect(activated.program.status).toBe("active");
        expect(activated.generatedSessions).toHaveLength(1);
        const session = activated.generatedSessions[0]!;
        expect(session.session).toMatchObject({ sourceTemplateId: template.template.id, sourceTemplateVersion: 1 });
        // The planned prescription is a distinct immutable clone of the template tree.
        expect(session.prescription.id).not.toBe(template.template.currentPrescriptionId);
        expect(session.prescription.kind).toBe("planned");
        expect(session.prescription.sourcePrescriptionId).toBe(template.template.currentPrescriptionId);
        // Membership was recorded for the program.
        const membership = await fixture.membership.listProgramSessions(program.program.id);
        expect(membership.map(item => item.plannedSessionId)).toEqual([session.session.id]);
    });

    it("lets one planned session belong to several programs with independent positions", async () => {
        const fixture = createFixture();
        const template = await fixture.templates.create({ name: "Upper", prescription: templateDraft(5) }, metadata);
        const programA = await fixture.programs.create({ name: "A" }, metadata);
        const activated = await fixture.programs.activate(
            programA.program.id,
            1,
            { sessions: [{ templateId: template.template.id, sequence: 0 }] },
            metadata,
        );
        const sessionId = activated.generatedSessions[0]!.session.id;

        const programB = await fixture.programs.create({ name: "B" }, metadata);
        await fixture.programs.attachSession(programB.program.id, { plannedSessionId: sessionId, sequence: 3 });

        const inA = await fixture.membership.listProgramSessions(programA.program.id);
        const inB = await fixture.membership.listProgramSessions(programB.program.id);
        expect(inA[0]).toMatchObject({ plannedSessionId: sessionId, sequence: 0 });
        expect(inB[0]).toMatchObject({ plannedSessionId: sessionId, sequence: 3 });
    });

    it("computes schedule-collision warnings from member sessions in the get query", async () => {
        const fixture = createFixture();
        const template = await fixture.templates.create({ name: "Upper", prescription: templateDraft(5) }, metadata);
        const program = await fixture.programs.create({ name: "Collide" }, metadata);
        await fixture.programs.activate(
            program.program.id,
            1,
            {
                sessions: [
                    { templateId: template.template.id, sequence: 0, localDate: "2026-08-01", preferredTime: "08:00" },
                    { templateId: template.template.id, sequence: 1, localDate: "2026-08-01", preferredTime: "08:00" },
                ],
            },
            metadata,
        );
        const detail = await fixture.queries.get(program.program.id);
        expect(detail.warnings.some(warning => warning.code === "schedule_collision")).toBe(true);
    });

    it("derives generated-session dates from relative positions on a dated program", async () => {
        const fixture = createFixture();
        const template = await fixture.templates.create({ name: "Upper", prescription: templateDraft(5) }, metadata);
        const program = await fixture.programs.create(
            { name: "Dated", scheduleMode: "dated", startDate: "2026-08-03" },
            metadata,
        );
        const activated = await fixture.programs.activate(
            program.program.id,
            1,
            {
                sessions: [
                    { templateId: template.template.id, sequence: 0, relativeWeek: 0, relativeDay: 0 },
                    { templateId: template.template.id, sequence: 1, relativeWeek: 1, relativeDay: 2 },
                ],
            },
            metadata,
        );
        expect(activated.generatedSessions.map(s => s.session.localDate)).toEqual(["2026-08-03", "2026-08-12"]);
    });

    it("generates ordered unscheduled sessions for an undated relative program", async () => {
        const fixture = createFixture();
        const template = await fixture.templates.create({ name: "Upper", prescription: templateDraft(5) }, metadata);
        const program = await fixture.programs.create({ name: "Relative", scheduleMode: "relative" }, metadata);
        const activated = await fixture.programs.activate(
            program.program.id,
            1,
            {
                sessions: [
                    { templateId: template.template.id, sequence: 0, relativeWeek: 0 },
                    { templateId: template.template.id, sequence: 1, relativeWeek: 1 },
                ],
            },
            metadata,
        );
        expect(activated.generatedSessions.every(s => s.session.localDate === null)).toBe(true);
    });

    it("rejects re-activating an already-active program so retries never double-generate", async () => {
        const fixture = createFixture();
        const program = await fixture.programs.create({ name: "P" }, metadata);
        await fixture.programs.activate(program.program.id, 1, {}, metadata);
        await expect(fixture.programs.activate(program.program.id, 2, {}, metadata)).rejects.toThrow();
    });

    it("moves only incomplete future sessions when the start date changes", async () => {
        const fixture = createFixture();
        const template = await fixture.templates.create({ name: "Upper", prescription: templateDraft(5) }, metadata);
        const program = await fixture.programs.create(
            { name: "Dated", scheduleMode: "dated", startDate: "2026-07-27" },
            metadata,
        );
        const activated = await fixture.programs.activate(
            program.program.id,
            1,
            {
                sessions: [
                    { templateId: template.template.id, sequence: 0, localDate: "2026-07-20" }, // overdue
                    { templateId: template.template.id, sequence: 1, localDate: "2026-08-05" }, // future
                ],
            },
            metadata,
        );
        const [overdue, future] = activated.generatedSessions;
        const changed = await fixture.programs.changeStartDate(
            program.program.id,
            2,
            { startDate: "2026-08-01" },
            metadata,
        );
        // Delta = +5 days: only the future planned session moves; the overdue one stays put.
        expect(changed.movedSessions).toEqual([
            { id: future!.session.id, fromDate: "2026-08-05", toDate: "2026-08-10" },
        ]);
        const overdueAfter = await fixture.sessions.readSession(entityId(overdue!.session.id));
        const futureAfter = await fixture.sessions.readSession(entityId(future!.session.id));
        expect(overdueAfter?.localDate).toBe("2026-07-20");
        expect(futureAfter?.localDate).toBe("2026-08-10");
    });

    it("flags overdue member sessions in the sessions query", async () => {
        const fixture = createFixture();
        const template = await fixture.templates.create({ name: "Upper", prescription: templateDraft(5) }, metadata);
        const program = await fixture.programs.create({ name: "P" }, metadata);
        await fixture.programs.activate(
            program.program.id,
            1,
            {
                sessions: [
                    { templateId: template.template.id, sequence: 0, localDate: "2026-07-20" },
                    { templateId: template.template.id, sequence: 1, localDate: "2026-08-30" },
                ],
            },
            metadata,
        );
        const sessions = await fixture.queries.sessions(program.program.id);
        expect(sessions.map(s => s.overdue)).toEqual([true, false]);
    });

    it("excludes archived programs from the default list", async () => {
        const fixture = createFixture();
        const created = await fixture.programs.create({ name: "P" }, metadata);
        await fixture.programs.archive(created.program.id, 1, metadata);
        expect(await fixture.queries.list()).toHaveLength(0);
        expect(await fixture.queries.list({ includeArchived: true })).toHaveLength(1);
    });
});

const GOAL = "0198a4db-d8da-7000-8000-0000000090e1";
function blockId(n: number): string {
    return `0198a4db-d8da-7000-8000-0000000090${n.toString(16).padStart(2, "0")}`;
}

function createFixture() {
    const prescriptions = new FakePrescriptionRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    let counter = 0;
    const generateId = () => `0198a4db-d8da-7000-8000-${(++counter).toString(16).padStart(12, "0")}`;
    const clock = { now: () => now };
    const prescriptionRuntime = { unitOfWork, repository: prescriptions, outbox: events, clock, generateId };
    const publisher = new PrescriptionPublisher(prescriptionRuntime);
    const cloner = new PrescriptionCloner(prescriptionRuntime);
    const profileReader = { requireActiveProfileId: async () => PROFILE };

    const templateRepo = new FakeWorkoutTemplateRepository();
    const templateMutations = new RevisionMutationService<WorkoutTemplateState, DomainEvent, typeof transaction>(
        unitOfWork,
        templateRepo,
        revisions,
        workoutTemplateSerializer,
        events,
        clock,
    );
    const templates = new WorkoutTemplateCommands({
        unitOfWork,
        repository: templateRepo,
        mutations: templateMutations,
        publisher,
        prescriptions,
        profileReader,
        clock,
        generateId,
    });
    const planning = new RepositoryWorkoutTemplatePlanningReader(templateRepo, prescriptions, cloner);

    const sessionRepo = new FakePlannedSessionRepository();
    const sessionMutations = new RevisionMutationService<PlannedSessionState, DomainEvent, typeof transaction>(
        unitOfWork,
        sessionRepo,
        revisions,
        plannedSessionSerializer,
        events,
        clock,
    );
    const plannedSessions = new PlannedSessionCommands({
        unitOfWork,
        repository: sessionRepo,
        mutations: sessionMutations,
        publisher,
        prescriptions,
        profileReader,
        clock,
        generateId,
    });

    const programRepo = new FakeProgramRepository();
    const programMutations = new RevisionMutationService<ProgramState, DomainEvent, typeof transaction>(
        unitOfWork,
        programRepo,
        revisions,
        programSerializer,
        events,
        clock,
    );
    const membership = new FakeMembershipRepository(sessionRepo);
    const goals = new FakeGoalValidator();
    const programs = new ProgramCommands({
        unitOfWork,
        repository: programRepo,
        mutations: programMutations,
        membership,
        plannedSessions,
        templates: planning,
        goalValidator: goals,
        profileReader,
        clock,
        generateId,
    });
    const queries = new ProgramQueries(programRepo, membership, clock);
    return { programs, queries, templates, membership, goals, prescriptions, sessions: sessionRepo };
}

class FakeProgramRepository implements ProgramRepository<typeof transaction> {
    private readonly values = new Map<string, { state: ProgramState; version: number }>();

    async readProgram(id: EntityId): Promise<ProgramResource | null> {
        const stored = this.values.get(id);
        return stored ? { ...structuredClone(stored.state), version: stored.version } : null;
    }

    async listPrograms(filter?: ProgramListFilter): Promise<readonly ProgramSummary[]> {
        return [...this.values.values()]
            .filter(item => filter?.includeArchived || item.state.status !== "archived")
            .map(item => summarize(item.state, item.version));
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: ProgramState, version: number): Promise<void> {
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: ProgramState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new VersionConflictError(expectedVersion, nextVersion);
        this.values.set(id, { state: structuredClone(state), version: nextVersion });
    }
}

function summarize(state: ProgramState, version: number): ProgramSummary {
    return {
        id: state.id,
        profileId: state.profileId,
        name: state.name,
        description: state.description,
        status: state.status,
        scheduleMode: state.scheduleMode,
        startDate: state.startDate,
        endDate: state.endDate,
        focus: state.focus,
        version,
        archivedAt: state.archivedAt,
        blockCount: state.blocks.length,
        sessionCount: 0,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
    };
}

class FakePlannedSessionRepository implements PlannedSessionRepository<typeof transaction> {
    readonly values = new Map<string, { state: PlannedSessionState; version: number }>();

    async readSession(id: EntityId): Promise<PlannedSessionResource | null> {
        const stored = this.values.get(id);
        return stored ? { ...structuredClone(stored.state), version: stored.version } : null;
    }

    async listSessions(filter?: PlannedSessionListFilter): Promise<readonly PlannedSessionResource[]> {
        return [...this.values.values()]
            .filter(item => filter?.includeArchived || item.state.archivedAt === null)
            .map(item => ({ ...structuredClone(item.state), version: item.version }));
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: PlannedSessionState, version: number): Promise<void> {
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: PlannedSessionState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new VersionConflictError(expectedVersion, nextVersion);
        this.values.set(id, { state: structuredClone(state), version: nextVersion });
    }
}

class FakeMembershipRepository implements ProgramMembershipRepository<typeof transaction> {
    private readonly links = new Map<string, ProgramSessionLinkInput>();
    private readonly blocks = new Set<string>();

    constructor(private readonly sessions: FakePlannedSessionRepository) {}

    async linkProgramSession(input: ProgramSessionLinkInput): Promise<void> {
        this.links.set(`${input.programId}:${input.plannedSessionId}`, { ...input });
    }

    async unlinkProgramSession(programId: string, plannedSessionId: string): Promise<void> {
        this.links.delete(`${programId}:${plannedSessionId}`);
    }

    async linkSessionBlock(plannedSessionId: string, blockId: string): Promise<void> {
        this.blocks.add(`${plannedSessionId}:${blockId}`);
    }

    async unlinkSessionBlock(plannedSessionId: string, blockId: string): Promise<void> {
        this.blocks.delete(`${plannedSessionId}:${blockId}`);
    }

    async listProgramSessions(programId: string): Promise<readonly ProgramSessionMembership[]> {
        return [...this.links.values()]
            .filter(link => link.programId === programId)
            .map(link => {
                const session = this.sessions.values.get(link.plannedSessionId)?.state;
                return {
                    plannedSessionId: link.plannedSessionId,
                    sequence: link.sequence,
                    relativeWeek: link.relativeWeek ?? null,
                    relativeDay: link.relativeDay ?? null,
                    localDate: session?.localDate ?? null,
                    preferredTime: session?.preferredTime ?? null,
                    status: session?.status ?? "planned",
                    title: session?.title ?? null,
                };
            })
            .sort((a, b) => a.sequence - b.sequence);
    }

    async listProfileScheduledSessions(profileId: string): Promise<readonly PlannedSessionSchedule[]> {
        const seen = new Map<string, PlannedSessionSchedule>();
        for (const link of this.links.values()) {
            const session = this.sessions.values.get(link.plannedSessionId)?.state;
            if (!session || session.profileId !== profileId || session.localDate === null) continue;
            seen.set(link.plannedSessionId, {
                id: link.plannedSessionId,
                localDate: session.localDate,
                preferredTime: session.preferredTime,
            });
        }
        return [...seen.values()];
    }
}

class FakeGoalValidator implements ProgramGoalValidator<typeof transaction> {
    private readonly known = new Set<string>();

    add(goalId: string): void {
        this.known.add(goalId);
    }

    async assertGoalsExist(goalIds: readonly string[]): Promise<void> {
        const missing = goalIds.filter(id => !this.known.has(id));
        if (missing.length > 0) throw new Error(`missing goals: ${missing.join(", ")}`);
    }
}

class FakeWorkoutTemplateRepository implements WorkoutTemplateRepository<typeof transaction> {
    private readonly values = new Map<string, { state: WorkoutTemplateState; version: number }>();

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
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: WorkoutTemplateState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new VersionConflictError(expectedVersion, nextVersion);
        this.values.set(id, { state: structuredClone(state), version: nextVersion });
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
