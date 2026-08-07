import { describe, expect, it } from "vitest";

import {
    SessionMappingOwnershipError,
    TrainingSessionCommands,
    sessionToPrescriptionDraft,
    trainingSessionSerializer,
    type TrainingSessionListFilter,
    type TrainingSessionRepository,
    type TrainingSessionResource,
    type TrainingSessionSummary,
} from "#src/modules/training/application/index";
import {
    SessionPrescription,
    type ExerciseSnapshotV1,
    type PlannedActualOutcome,
    type PublishPrescriptionDraft,
    type SessionPrescriptionState,
    type TrainingSessionState,
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

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const TEMPLATE = "0198a4db-d8da-7000-8000-0000000000c1";
const SQUAT = "0198a4db-d8da-7000-8000-0000000000e1";
const BENCH = "0198a4db-d8da-7000-8000-0000000000e2";
const PLANNED = "0198a4db-d8da-7000-8000-0000000000f1";
const now = new Date("2026-08-02T09:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "req-1", source: "user" };
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

const ACTIVITY = id(0x100);
const OCCURRENCE = id(0x101);
const SET = id(0x102);

function snapshot(exerciseId = SQUAT): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: exerciseId === SQUAT ? "Back Squat" : "Bench Press",
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
    };
}

function prescription(target: Record<string, unknown>): SessionPrescriptionState {
    let counter = 0x9000;
    const minter = { rowId: () => id(++counter), logicalKey: () => id(++counter) };
    const draft: PublishPrescriptionDraft = {
        kind: "planned",
        activities: [
            {
                ref: "a",
                type: "strength",
                position: 0,
                strength: {
                    exercises: [
                        {
                            ref: "e",
                            exerciseId: SQUAT,
                            snapshot: snapshot(),
                            position: 0,
                            sets: [{ ref: "s", position: 0, setType: "working", targets: target }],
                        },
                    ],
                },
            },
        ],
    };
    return SessionPrescription.publishDraft(draft, minter, now).state;
}

/** Add a strength activity with one performed set so mappings have an actual set to reference. */
function addSquatSet(fixture: Fixture, session: TrainingSessionResource): Promise<TrainingSessionResource> {
    return fixture.commands.addActivity(
        session.id,
        session.version,
        {
            activity: {
                id: ACTIVITY,
                type: "strength",
                position: 0,
                strength: {
                    occurrences: [
                        {
                            id: OCCURRENCE,
                            exerciseId: SQUAT,
                            position: 0,
                            performedSets: [{ id: SET, position: 0, setType: "working", status: "completed" }],
                        },
                    ],
                },
            },
        },
        metadata,
    );
}

describe("training session live commands", () => {
    it("starts an empty in-progress session with no plan", async () => {
        const fixture = createFixture();
        const started = await fixture.commands.startEmpty({ title: "Quick lift" }, metadata);
        expect(started.status).toBe("in_progress");
        expect(started.startedAt).not.toBeNull();
        expect(started.plannedLinks).toHaveLength(0);
        const view = await fixture.commands.readActiveView(started.id);
        expect(view?.plans).toHaveLength(0);
    });

    it("starts from a template, freezing a resolved prescription linked with no planned session", async () => {
        const fixture = createFixture();
        fixture.prescriptionStore.set(fixture.templatePrescription.id, fixture.templatePrescription);
        const started = await fixture.commands.startFromTemplate({ templateId: TEMPLATE }, metadata);
        expect(started.status).toBe("in_progress");
        expect(started.plannedLinks).toHaveLength(1);
        const link = started.plannedLinks[0]!;
        expect(link.plannedSessionId).toBeNull();
        expect(link.resolvedPrescriptionId).not.toBe(link.sourcePrescriptionId);
        const view = await fixture.commands.readActiveView(started.id);
        expect(view?.plans).toHaveLength(1);
        expect(view?.plans[0]?.plannedSessionId).toBeNull();
        expect(view?.plans[0]?.prescription.activities[0]?.strength?.exercises[0]?.sets[0]?.targets.loadKgMin).toBe(
            "80",
        );
    });

    it("repeats a previous session, synthesizing a plan from its performed work", async () => {
        const fixture = createFixture();
        const empty = await fixture.commands.startEmpty({}, metadata);
        const withActivity = await addSquatSet(fixture, empty);
        const repeated = await fixture.commands.startFromPrevious({ sourceSessionId: withActivity.id }, metadata);
        expect(repeated.plannedLinks).toHaveLength(1);
        expect(repeated.plannedLinks[0]!.plannedSessionId).toBeNull();
        const view = await fixture.commands.readActiveView(repeated.id);
        expect(view?.plans[0]?.prescription.activities[0]?.strength?.exercises[0]?.exerciseId).toBe(SQUAT);
    });

    it("appends an activity and reorders activities", async () => {
        const fixture = createFixture();
        const started = await fixture.commands.startEmpty({}, metadata);
        const first = await addSquatSet(fixture, started);
        const second = await fixture.commands.addActivity(
            first.id,
            first.version,
            { activity: { id: id(0x200), type: "running", position: 1 } },
            metadata,
        );
        expect(second.activities).toHaveLength(2);
        expect(second.version).toBe(first.version + 1);
        const reordered = await fixture.commands.reorderActivities(
            second.id,
            second.version,
            { activityIds: [id(0x200), ACTIVITY] },
            metadata,
        );
        expect(reordered.activities.map(activity => activity.id)).toEqual([id(0x200), ACTIVITY]);
        expect(reordered.activities[0]?.position).toBe(0);
    });

    it("rejects a reorder list that does not cover every activity exactly once", async () => {
        const fixture = createFixture();
        const started = await fixture.commands.startEmpty({}, metadata);
        const withActivity = await addSquatSet(fixture, started);
        await expect(
            fixture.commands.reorderActivities(
                withActivity.id,
                withActivity.version,
                { activityIds: [id(0xdead)] },
                metadata,
            ),
        ).rejects.toMatchObject({ name: "ApplicationValidationError" });
    });

    it("substitutes an occurrence's exercise and records a substituted mapping against the plan", async () => {
        const fixture = createFixture();
        fixture.prescriptionStore.set(fixture.templatePrescription.id, fixture.templatePrescription);
        const started = await fixture.commands.startFromTemplate({ templateId: TEMPLATE }, metadata);
        const prescribedExerciseId = fixture.prescriptionStore.get(started.plannedLinks[0]!.resolvedPrescriptionId)!
            .activities[0]!.strength!.exercises[0]!.id;
        const withActivity = await addSquatSet(fixture, started);
        const substituted = await fixture.commands.substituteOccurrence(
            withActivity.id,
            withActivity.version,
            {
                activityId: ACTIVITY,
                occurrenceId: OCCURRENCE,
                newExerciseId: BENCH,
                prescribedExerciseId,
                reason: "Rack taken",
            },
            metadata,
        );
        expect(substituted.activities[0]?.strength?.occurrences[0]?.exerciseId).toBe(BENCH);
        expect(substituted.occurrenceMappings[0]).toMatchObject({
            occurrenceId: OCCURRENCE,
            prescribedExerciseId,
            relation: "substituted",
            reason: "Rack taken",
        });
    });

    it("freely swaps an occurrence's exercise with no plan and records no mapping", async () => {
        const fixture = createFixture();
        const started = await fixture.commands.startEmpty({}, metadata);
        const withActivity = await addSquatSet(fixture, started);
        const swapped = await fixture.commands.substituteOccurrence(
            withActivity.id,
            withActivity.version,
            { activityId: ACTIVITY, occurrenceId: OCCURRENCE, newExerciseId: BENCH },
            metadata,
        );
        expect(swapped.activities[0]?.strength?.occurrences[0]?.exerciseId).toBe(BENCH);
        expect(swapped.occurrenceMappings).toHaveLength(0);
    });

    it("records and updates a performed set with a mapping to the frozen plan", async () => {
        const fixture = createFixture();
        fixture.prescriptionStore.set(fixture.templatePrescription.id, fixture.templatePrescription);
        const started = await fixture.commands.startFromTemplate({ templateId: TEMPLATE }, metadata);
        const prescribedSetId = fixture.prescriptionStore.get(started.plannedLinks[0]!.resolvedPrescriptionId)!
            .activities[0]!.strength!.exercises[0]!.sets[0]!.id;
        const withOccurrence = await addSquatSet(fixture, started);
        const mapped = await fixture.commands.recordPerformedSet(
            withOccurrence.id,
            withOccurrence.version,
            {
                activityId: ACTIVITY,
                occurrenceId: OCCURRENCE,
                set: { id: id(0x103), position: 1, setType: "working", status: "completed" },
                mapping: { prescribedSetId, relation: "matched" },
            },
            metadata,
        );
        expect(mapped.activities[0]?.strength?.occurrences[0]?.performedSets).toHaveLength(2);
        expect(mapped.setMappings.at(-1)).toMatchObject({ prescribedSetId, relation: "matched" });

        const skipped = await fixture.commands.updatePerformedSet(
            mapped.id,
            mapped.version,
            id(0x103),
            { status: "skipped" },
            metadata,
        );
        const updatedSet = skipped.activities[0]?.strength?.occurrences[0]?.performedSets.find(
            set => set.id === id(0x103),
        );
        expect(updatedSet?.status).toBe("skipped");
    });

    it("rejects a set mapping to a prescribed row outside the session's linked prescriptions", async () => {
        const fixture = createFixture();
        fixture.prescriptionStore.set(fixture.templatePrescription.id, fixture.templatePrescription);
        const started = await fixture.commands.startFromTemplate({ templateId: TEMPLATE }, metadata);
        const withOccurrence = await addSquatSet(fixture, started);
        await expect(
            fixture.commands.recordPerformedSet(
                withOccurrence.id,
                withOccurrence.version,
                {
                    activityId: ACTIVITY,
                    occurrenceId: OCCURRENCE,
                    set: { id: id(0x103), position: 1, setType: "working", status: "completed" },
                    mapping: { prescribedSetId: id(0xdead), relation: "matched" },
                },
                metadata,
            ),
        ).rejects.toBeInstanceOf(SessionMappingOwnershipError);
    });

    it("surfaces a version conflict on a stale granular write", async () => {
        const fixture = createFixture();
        const started = await fixture.commands.startEmpty({}, metadata);
        await addSquatSet(fixture, started);
        await expect(
            fixture.commands.addActivity(
                started.id,
                started.version,
                { activity: { id: id(0x201), type: "running", position: 1 } },
                metadata,
            ),
        ).rejects.toBeInstanceOf(VersionConflictError);
    });

    it("previews completion with issues and the projected planned-session outcome", async () => {
        const fixture = createFixture(prescription({ loadKgMin: "60", loadKgMax: "60" }));
        const started = await fixture.commands.startPlanned({ plannedSessionId: PLANNED }, metadata);
        const withActivity = await addSquatSet(fixture, started);
        const prescribedSetId = fixture.prescriptionStore.get(started.plannedLinks[0]!.resolvedPrescriptionId)!
            .activities[0]!.strength!.exercises[0]!.sets[0]!.id;
        const mapped = await fixture.commands.recordPerformedSet(
            withActivity.id,
            withActivity.version,
            {
                activityId: ACTIVITY,
                occurrenceId: OCCURRENCE,
                set: { id: id(0x104), position: 1, setType: "working", status: "completed" },
                mapping: { prescribedSetId, relation: "matched" },
            },
            metadata,
        );
        const preview = await fixture.commands.previewCompletion(mapped.id);
        expect(preview.plannedOutcomes).toEqual([
            expect.objectContaining({
                plannedSessionId: PLANNED,
                projectedStatus: "completed",
                prescribedSetCount: 1,
                coveredSetCount: 1,
            }),
        ]);
    });

    it("flags an uncovered prescribed set as a completion warning", async () => {
        const fixture = createFixture(prescription({ loadKgMin: "60", loadKgMax: "60" }));
        const started = await fixture.commands.startPlanned({ plannedSessionId: PLANNED }, metadata);
        const preview = await fixture.commands.previewCompletion(started.id);
        expect(preview.issues.some(issue => issue.code === "prescribed_set_uncovered")).toBe(true);
        expect(preview.plannedOutcomes[0]?.projectedStatus).toBe("planned");
    });
});

describe("sessionToPrescriptionDraft", () => {
    it("maps performed reps and load into single-point prescribed targets", () => {
        const activities: TrainingSessionState["activities"] = [
            {
                id: ACTIVITY,
                type: "strength",
                position: 0,
                startedAt: null,
                endedAt: null,
                durationSeconds: null,
                rpe: null,
                feeling: null,
                notes: null,
                tags: [],
                strength: {
                    occurrences: [
                        {
                            id: OCCURRENCE,
                            exerciseId: SQUAT,
                            snapshot: snapshot(),
                            position: 0,
                            purpose: null,
                            technique: null,
                            discomfort: null,
                            pump: null,
                            notes: null,
                            performedSets: [
                                {
                                    id: SET,
                                    setGroupId: null,
                                    round: null,
                                    position: 0,
                                    setType: "working",
                                    status: "completed",
                                    measurements: {
                                        reps: 5,
                                        externalLoad: { value: 100, unit: "kg" },
                                        bodyweight: null,
                                        addedLoad: null,
                                        assistanceLoad: null,
                                        effectiveLoad: null,
                                        duration: null,
                                        distance: null,
                                        powerWatts: null,
                                        rpe: null,
                                        rir: null,
                                        tempo: null,
                                        restBefore: null,
                                        restAfter: null,
                                    },
                                    failureReason: null,
                                    technique: null,
                                    discomfort: null,
                                    pump: null,
                                    notes: null,
                                },
                            ],
                        },
                    ],
                    setGroups: [],
                },
                running: null,
            },
        ];
        const draft = sessionToPrescriptionDraft(activities);
        expect(draft?.kind).toBe("planned");
        const set = draft?.activities[0]?.strength?.exercises[0]?.sets[0];
        expect(set?.targets?.repsMin).toBe(5);
        expect(set?.targets?.loadKgMin).toBe("100");
    });

    it("returns null when there is no repeatable strength work", () => {
        expect(sessionToPrescriptionDraft([])).toBeNull();
    });
});

type Fixture = ReturnType<typeof createFixture>;

function createFixture(planned: SessionPrescriptionState = prescription({ loadKgMin: "60", loadKgMax: "60" })) {
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
        currentSnapshot: async (exerciseId: string) => snapshot(exerciseId),
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

    const templatePrescription = prescription({ repsMin: 5, repsMax: 5, percent1rm: "80" });
    const prescriptionStore = new Map<string, SessionPrescriptionState>([[planned.id, planned]]);
    const published: string[] = [];
    const recompute: { plannedSessionId: string; outcome: PlannedActualOutcome }[] = [];

    const planning = {
        plannedSessions: {
            readSession: async () =>
                ({
                    id: PLANNED,
                    profileId: PROFILE,
                    currentPrescriptionId: planned.id,
                    timeZone: null,
                    title: null,
                }) as never,
        },
        plannedCommands: {
            recomputeOutcomeWithinTransaction: async (plannedSessionId: string, outcome: PlannedActualOutcome) => {
                recompute.push({ plannedSessionId, outcome });
                return {} as never;
            },
        },
        prescriptions: {
            loadTree: async (treeId: string) => prescriptionStore.get(treeId) ?? null,
            loadTrees: async (ids: readonly string[]) =>
                ids
                    .map(treeId => prescriptionStore.get(treeId))
                    .filter((tree): tree is SessionPrescriptionState => !!tree),
        },
        publisher: {
            publishPreparedState: async (state: SessionPrescriptionState) => {
                prescriptionStore.set(state.id, state);
                published.push(state.id);
                return state;
            },
            publish: async ({ draft }: { draft: PublishPrescriptionDraft }) => {
                let c = 0xb000;
                const minter = { rowId: () => id(++c), logicalKey: () => id(++c) };
                const state = SessionPrescription.publishDraft(draft, minter, now).state;
                prescriptionStore.set(state.id, state);
                published.push(state.id);
                return state;
            },
        },
        templates: {
            readTemplate: async () =>
                ({
                    id: TEMPLATE,
                    profileId: PROFILE,
                    name: "Upper A",
                    currentPrescriptionId: templatePrescription.id,
                    status: "active",
                    version: 1,
                }) as never,
        },
        targetContext: {
            resolveTrainingMax: async () => ({
                trainingMaxId: id(0x300),
                exerciseId: SQUAT,
                maxType: "estimated_1rm" as const,
                customLabel: null,
                valueKg: "100",
                effectiveFrom: "2026-07-01T00:00:00.000Z",
                effectiveTo: null,
            }),
        },
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
    return { commands, repository, events, prescriptionStore, templatePrescription, published, recompute };
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
                const { activities, painRecords, ...core } = structuredClone(item.state);
                return {
                    ...core,
                    version: item.version,
                    activityCount: activities.length,
                    painRecordCount: painRecords.length,
                } as unknown as TrainingSessionSummary;
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
        _expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
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
