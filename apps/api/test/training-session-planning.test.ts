import { describe, expect, it } from "vitest";

import {
    SessionMappingOwnershipError,
    TrainingSessionCommands,
    trainingSessionSerializer,
    type PlannedSessionRepository,
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
    type CommandContext,
    type EntityRevision,
    type OutboxWriter,
    type RevisionStore,
    type UnitOfWork,
} from "#src/platform/application/index";
import type { DomainEvent, EntityId } from "#src/platform/domain/index";

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const PLANNED = "0198a4db-d8da-7000-8000-0000000000f1";
const SQUAT = "0198a4db-d8da-7000-8000-0000000000e1";
const now = new Date("2026-08-02T09:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "req-1", source: "user" };
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

function snapshot(): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId: SQUAT,
        exerciseVersion: 1,
        name: "Back Squat",
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

function plannedPrescription(target: Record<string, unknown>): SessionPrescriptionState {
    let counter = 0x9000;
    const minter = {
        rowId: () => id(++counter),
        logicalKey: () => id(++counter),
    };
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

describe("training session planning services", () => {
    it("starts from a percentage plan, freezing a resolved-execution prescription and linking it", async () => {
        const fixture = createFixture(plannedPrescription({ repsMin: 5, repsMax: 5, percent1rm: "80" }));
        const started = await fixture.commands.startPlanned({ plannedSessionId: PLANNED }, metadata);

        expect(started.status).toBe("in_progress");
        expect(started.sourcePlannedSessionId).toBe(PLANNED);
        expect(started.plannedLinks).toHaveLength(1);
        const link = started.plannedLinks[0]!;
        expect(link.plannedSessionId).toBe(PLANNED);
        expect(link.resolvedPrescriptionId).not.toBe(link.sourcePrescriptionId);

        const resolved = fixture.prescriptionStore.get(link.resolvedPrescriptionId)!;
        const set = resolved.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(set.targets.percent1rm).toBeNull();
        expect(set.targets.loadKgMin).toBe("80");
        expect((set.targets.enteredTargets as { resolution?: unknown }).resolution).toMatchObject({
            maxValueKg: "100",
            resolvedLoadKg: "80",
        });
    });

    it("links source == resolved when no target needs resolution", async () => {
        const fixture = createFixture(
            plannedPrescription({ repsMin: 5, repsMax: 5, loadKgMin: "60", loadKgMax: "60" }),
        );
        const started = await fixture.commands.startPlanned({ plannedSessionId: PLANNED }, metadata);
        const link = started.plannedLinks[0]!;
        expect(link.resolvedPrescriptionId).toBe(link.sourcePrescriptionId);
        // No new prescription was published beyond the planned one.
        expect(fixture.published).toHaveLength(0);
    });

    it("throws when a percentage target has no recorded max", async () => {
        const fixture = createFixture(plannedPrescription({ percent1rm: "80" }), { max: null });
        await expect(fixture.commands.startPlanned({ plannedSessionId: PLANNED }, metadata)).rejects.toMatchObject({
            name: "MissingTrainingMaxError",
        });
    });

    it("rejects a mapping to a prescribed row outside the session's linked prescriptions", async () => {
        const fixture = createFixture(plannedPrescription({ loadKgMin: "60", loadKgMax: "60" }));
        const started = await fixture.commands.startPlanned({ plannedSessionId: PLANNED }, metadata);
        const withActivity = await addSquatSet(fixture, started);
        await expect(
            fixture.commands.recordMappings(
                withActivity.id,
                withActivity.version,
                {
                    setMappings: [
                        { id: id(700), prescribedSetId: id(0xdead), performedSetId: SET, relation: "matched" },
                    ],
                },
                metadata,
            ),
        ).rejects.toBeInstanceOf(SessionMappingOwnershipError);
    });

    it("recomputes the linked plan to completed when every prescribed set is mapped, then partially on reopen", async () => {
        const fixture = createFixture(plannedPrescription({ loadKgMin: "60", loadKgMax: "60" }));
        const started = await fixture.commands.startPlanned({ plannedSessionId: PLANNED }, metadata);
        const withActivity = await addSquatSet(fixture, started);
        const prescribedSetId = fixture.prescriptionStore.get(started.plannedLinks[0]!.resolvedPrescriptionId)!
            .activities[0]!.strength!.exercises[0]!.sets[0]!.id;
        const mapped = await fixture.commands.recordMappings(
            withActivity.id,
            withActivity.version,
            { setMappings: [{ id: id(700), prescribedSetId, performedSetId: SET, relation: "matched" }] },
            metadata,
        );
        await fixture.commands.complete(mapped.id, mapped.version, {}, metadata);
        expect(fixture.recompute.at(-1)).toEqual({ plannedSessionId: PLANNED, outcome: "completed" });

        const completed = await fixture.repository.readSession(started.id as EntityId);
        await fixture.commands.reopen(completed!.id, completed!.version, metadata);
        expect(fixture.recompute.at(-1)).toEqual({ plannedSessionId: PLANNED, outcome: "partially_completed" });
    });
});

const ACTIVITY = id(0x100);
const OCCURRENCE = id(0x101);
const SET = id(0x102);

/** Add a strength activity with one performed set so mappings have an actual set to reference. */
async function addSquatSet(fixture: Fixture, session: TrainingSessionResource): Promise<TrainingSessionResource> {
    return fixture.commands.update(
        session.id,
        session.version,
        {
            activities: [
                {
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
            ],
        },
        metadata,
    );
}

type Fixture = ReturnType<typeof createFixture>;

function createFixture(planned: SessionPrescriptionState, options: { max?: { valueKg: string } | null } = {}) {
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
        currentSnapshot: async () => snapshot(),
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

    const prescriptionStore = new Map<string, SessionPrescriptionState>([[planned.id, planned]]);
    const published: string[] = [];
    const recompute: { plannedSessionId: string; outcome: PlannedActualOutcome }[] = [];
    const maxRef = options.max === undefined ? { valueKg: "100" } : options.max;

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
        } as Pick<PlannedSessionRepository<typeof transaction>, "readSession">,
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
        },
        targetContext: {
            resolveTrainingMax: async () =>
                maxRef
                    ? {
                          trainingMaxId: id(0x200),
                          exerciseId: SQUAT,
                          maxType: "estimated_1rm" as const,
                          customLabel: null,
                          valueKg: maxRef.valueKg,
                          effectiveFrom: "2026-07-01T00:00:00.000Z",
                          effectiveTo: null,
                      }
                    : null,
        },
        increments: {
            resolveForExercise: async () => null,
        },
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
    return { commands, repository, events, prescriptionStore, published, recompute };
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
