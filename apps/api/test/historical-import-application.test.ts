import { describe, expect, it } from "vitest";

import {
    BulkCatalogResolver,
    HistoricalImportDryRun,
    ReconcileImportStorage,
    ExerciseNotFoundError,
    fingerprintImportContent,
    type AggregateVersionRecord,
    type ExerciseExternalIdResolver,
    type ExerciseSlugResolver,
    type ExternalIdMappingRecord,
    type HistoricalCompletedSessionInput,
    type HistoricalImportDryRunRepository,
    type HistoricalImportEnvelopeInput,
    type ImportStorageReadPort,
    type StoredHistoricalImportDryRun,
    type TrainingExerciseCatalogPort,
} from "#src/modules/training/application/index";
import {
    collectHistoricalStorageRequests,
    createExerciseSnapshot,
    ExerciseDefinition,
} from "#src/modules/training/domain/index";
import type { CommandContext, UnitOfWork } from "#src/platform/application/index";

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const EQUIPMENT = "0198a4db-d8da-7000-8000-0000000000b1";
const MOVEMENT = "0198a4db-d8da-7000-8000-0000000000c1";
const MUSCLE = "0198a4db-d8da-7000-8000-0000000000e1";
const SQUAT = "0198a4db-d8da-7000-8000-0000000000a1";
const CHECKSUM = "a".repeat(64);
const now = new Date("2026-08-01T10:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "req-1", source: "agent" };

function idFactory(): () => string {
    let index = 0;
    return () => {
        index += 1;
        return `0198a4db-d8da-7000-8000-${index.toString(16).padStart(12, "0")}`;
    };
}

function squatDefinition(id = SQUAT): ExerciseDefinition {
    return ExerciseDefinition.create(
        {
            id,
            slug: "back-squat",
            name: "Back Squat",
            ownership: "seeded",
            equipmentTypeId: EQUIPMENT,
            movementPatternId: MOVEMENT,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "standing",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            muscles: [{ muscleGroupId: MUSCLE, role: "primary" }],
        },
        now,
    );
}

function catalogItem(id: string, name: string, slug: string) {
    return {
        id,
        slug,
        name,
        aliases: [] as string[],
        status: "active" as const,
        ownership: "seeded" as const,
        equipment: {
            id: EQUIPMENT,
            slug: "barbell",
            name: "Barbell",
            position: 0,
            ownership: "seeded" as const,
            analyticsMappingStatus: "standard" as const,
        },
        movementPattern: {
            id: MOVEMENT,
            slug: "squat",
            name: "Squat",
            position: 0,
            ownership: "seeded" as const,
            analyticsMappingStatus: "standard" as const,
        },
        classification: "compound" as const,
        laterality: "bilateral" as const,
        bodyPosition: "standing",
        repetitionSemantics: "total" as const,
        loadModel: "external_only" as const,
        supportedMeasurements: ["repetitions", "external_load"] as const,
        muscles: [],
        tags: [],
        notes: null,
        version: 3,
        position: 0,
    };
}

function fakeCatalog(byId: Record<string, ReturnType<typeof catalogItem>>): TrainingExerciseCatalogPort {
    const snapshotFor = (id: string) => createExerciseSnapshot(squatDefinition(id), byId[id]?.version ?? 3);
    return {
        async getExercise(id) {
            const item = byId[id];
            if (!item) throw new ExerciseNotFoundError(id);
            return item;
        },
        async resolveCurrentExercise(id) {
            const item = byId[id];
            if (!item) throw new ExerciseNotFoundError(id);
            return { requestedExerciseId: id, resolvedExerciseId: id, redirected: false, exercise: item };
        },
        async listExercises() {
            return { items: [], nextCursor: null };
        },
        async resolveAlias() {
            return null;
        },
        async currentSnapshot(id) {
            return snapshotFor(id);
        },
        async historicalSnapshot(id) {
            return snapshotFor(id);
        },
        async areInAnalyticsFamily() {
            return false;
        },
    };
}

const noExternalIds: ExerciseExternalIdResolver = { resolveByExternalId: async () => null };
const noSlugs: ExerciseSlugResolver = { resolveBySlug: async () => null };

function recordingRepository(): HistoricalImportDryRunRepository<typeof transaction> & {
    saved: StoredHistoricalImportDryRun[];
} {
    const saved: StoredHistoricalImportDryRun[] = [];
    return {
        saved,
        async save(record) {
            saved.push(record);
        },
        async findById(id) {
            return saved.find(record => record.id === id) ?? null;
        },
        async lockForCommit(id) {
            return saved.find(record => record.id === id) ?? null;
        },
        async markConsumed() {},
    };
}

function fakeReadPort(options: {
    mappings?: readonly ExternalIdMappingRecord[];
    versions?: readonly AggregateVersionRecord[];
}): ImportStorageReadPort<typeof transaction> {
    return {
        async readExternalIdMappings(_namespace, refs) {
            const wanted = new Set(refs.map(ref => `${ref.entityType}:${ref.externalId}`));
            return (options.mappings ?? []).filter(m => wanted.has(`${m.entityType}:${m.externalId}`));
        },
        async readAggregateVersions(refs) {
            const wanted = new Set(refs.map(ref => `${ref.entityType}:${ref.entityId}`));
            return (options.versions ?? []).filter(v => wanted.has(`${v.entityType}:${v.entityId}`));
        },
    };
}

interface UseCaseParts {
    resolver?: BulkCatalogResolver;
    slugResolver?: ExerciseSlugResolver;
    readPort?: ImportStorageReadPort<typeof transaction>;
    repository?: ReturnType<typeof recordingRepository>;
}

function useCase(parts: UseCaseParts = {}) {
    const repository = parts.repository ?? recordingRepository();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const reconcile = new ReconcileImportStorage({ readPort: parts.readPort ?? fakeReadPort({}) });
    const useCaseInstance = new HistoricalImportDryRun({
        unitOfWork,
        repository,
        reconcile,
        resolver:
            parts.resolver ??
            new BulkCatalogResolver(
                fakeCatalog({ [SQUAT]: catalogItem(SQUAT, "Back Squat", "back-squat") }),
                noExternalIds,
            ),
        slugResolver: parts.slugResolver ?? noSlugs,
        profileReader: { requireActiveProfileId: async () => PROFILE },
        clock: { now: () => now },
        generateId: idFactory(),
    });
    return { useCaseInstance, repository };
}

function completedSession(overrides: Partial<HistoricalCompletedSessionInput> = {}): HistoricalCompletedSessionInput {
    return {
        externalId: "ts-1",
        localDate: "2024-03-04",
        timeZone: "Europe/London",
        title: "Squat Day",
        activities: [
            {
                type: "strength",
                externalId: "act-1",
                position: 0,
                strength: {
                    occurrences: [
                        {
                            externalId: "occ-1",
                            reference: { by: "id", exerciseId: SQUAT },
                            position: 0,
                            performedSets: [
                                {
                                    externalId: "set-1",
                                    position: 0,
                                    setType: "working",
                                    status: "completed",
                                    measurements: { reps: 5, externalLoad: { value: 100, unit: "kg" } },
                                },
                            ],
                        },
                    ],
                },
            },
        ],
        ...overrides,
    };
}

function envelope(overrides: Partial<HistoricalImportEnvelopeInput> = {}): HistoricalImportEnvelopeInput {
    return {
        schemaVersion: 1,
        source: { namespace: "coach-app", payloadId: "archive-2024", checksum: CHECKSUM },
        mode: "create",
        completedSessions: [completedSession()],
        ...overrides,
    };
}

describe("HistoricalImportDryRun", () => {
    it("previews programs and completed sessions together with a full create storage plan", async () => {
        const program = {
            externalId: "prog-1",
            name: "Spring Strength",
            scheduleMode: "dated" as const,
            startDate: "2026-09-07",
            sessions: [
                {
                    externalId: "sess-1",
                    title: "Squat Day",
                    sequence: 0,
                    relativeWeek: 0,
                    relativeDay: 0,
                    prescription: {
                        activities: [
                            {
                                type: "strength" as const,
                                position: 0,
                                exercises: [
                                    {
                                        ref: "ex-1",
                                        reference: { by: "id" as const, exerciseId: SQUAT },
                                        position: 0,
                                        sets: [{ position: 0, setType: "working" as const }],
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        };
        const { useCaseInstance, repository } = useCase();
        const result = await useCaseInstance.execute(
            envelope({ programs: [program], completedSessions: [completedSession()] }),
            metadata,
        );

        expect(result.state).toBe("ready");
        expect(result.errors).toHaveLength(0);
        expect(result.programs).toHaveLength(1);
        expect(result.completedSessions).toHaveLength(1);
        expect(result.completedSessions[0]!.status).toBe("completed");
        expect(result.completedSessions[0]!.externalId).toBe("ts-1");
        // program, planned-session, training-session, session-activity, occurrence, performed-set
        expect(result.storagePlan.counts.create).toBe(result.summary.entities);
        expect(result.storagePlan.counts.conflict).toBe(0);
        expect(result.storagePlan.hasConflicts).toBe(false);
        expect(result.affectedVersions).toContainEqual({
            entityType: "training.exercise",
            entityId: SQUAT,
            version: 3,
        });
        expect(repository.saved).toHaveLength(1);
        expect(repository.saved[0]!.id).toBe(result.dryRunId);
    });

    it("persists exactly one artifact and holds no program/session/catalog write port", async () => {
        const { useCaseInstance, repository } = useCase();
        const result = await useCaseInstance.execute(envelope(), metadata);
        expect(repository.saved).toHaveLength(1);
        expect(repository.saved[0]!.approvalToken).toBe(result.approvalToken);
        expect(repository.saved[0]!.expiresAt.getTime()).toBeGreaterThan(now.getTime());
        expect(repository.saved[0]!.checksum).toBe(CHECKSUM);
    });

    it("rejects a missing canonical exercise reference instead of repairing it", async () => {
        const resolver = new BulkCatalogResolver(fakeCatalog({}), noExternalIds);
        const { useCaseInstance } = useCase({ resolver });
        const result = await useCaseInstance.execute(envelope(), metadata);

        expect(result.state).toBe("needs_mapping");
        expect(result.mappings).toHaveLength(1);
        expect(result.mappings[0]!.status).toBe("missing");
        expect(result.errors[0]!.code).toBe("CATALOG_MAPPING_REQUIRED");
        // The unresolved session is omitted from the normalized preview, never repaired.
        expect(result.completedSessions).toHaveLength(0);
    });

    it("rejects an unsupported measurement rather than dropping it", async () => {
        const session = completedSession();
        const withBadMeasurement: HistoricalCompletedSessionInput = {
            ...session,
            activities: [
                {
                    ...session.activities[0]!,
                    type: "strength",
                    strength: {
                        occurrences: [
                            {
                                externalId: "occ-1",
                                reference: { by: "id", exerciseId: SQUAT },
                                position: 0,
                                performedSets: [
                                    {
                                        externalId: "set-1",
                                        position: 0,
                                        setType: "working",
                                        status: "completed",
                                        // Back Squat supports repetitions + external_load only.
                                        measurements: { distance: { value: 5, unit: "km" } },
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        };
        const { useCaseInstance } = useCase();
        const result = await useCaseInstance.execute(envelope({ completedSessions: [withBadMeasurement] }), metadata);

        expect(result.state).toBe("needs_mapping");
        expect(result.errors).toHaveLength(1);
        expect(result.completedSessions).toHaveLength(0);
    });

    it("classifies a byte-identical existing entity as skip-identical", async () => {
        const env = envelope();
        const request = collectHistoricalStorageRequests(env as never).find(
            entry => entry.entityType === "training-session",
        )!;
        const mappings: ExternalIdMappingRecord[] = [
            {
                entityType: "training-session",
                externalId: request.externalId,
                entityId: "0198a4db-d8da-7000-8000-0000000000f1",
                contentFingerprint: fingerprintImportContent(request.content),
            },
        ];
        const { useCaseInstance } = useCase({ readPort: fakeReadPort({ mappings }) });
        const result = await useCaseInstance.execute(env, metadata);

        const entry = result.storagePlan.entries.find(e => e.entityType === "training-session")!;
        expect(entry.operation).toBe("skip-identical");
        expect(result.storagePlan.counts["skip-identical"]).toBe(1);
    });

    it("classifies a changed existing entity in create mode as a conflict", async () => {
        const env = envelope();
        const request = collectHistoricalStorageRequests(env as never).find(
            entry => entry.entityType === "training-session",
        )!;
        const mappings: ExternalIdMappingRecord[] = [
            {
                entityType: "training-session",
                externalId: request.externalId,
                entityId: "0198a4db-d8da-7000-8000-0000000000f1",
                contentFingerprint: fingerprintImportContent({ ...request.content, changed: true }),
            },
        ];
        const { useCaseInstance } = useCase({ readPort: fakeReadPort({ mappings }) });
        const result = await useCaseInstance.execute(env, metadata);

        const entry = result.storagePlan.entries.find(e => e.entityType === "training-session")!;
        expect(entry.operation).toBe("conflict");
        expect(entry.conflictCode).toBe("EXTERNAL_ID_EXISTS");
        expect(result.storagePlan.hasConflicts).toBe(true);
    });

    it("previews a large multi-year fixture with batched reconciliation reads", async () => {
        // ~5 years at 4 sessions/week ≈ 1040 completed sessions, each 4 addressable entities. Every
        // external id is unique across the archive (per-type uniqueness is a contract invariant).
        const sessions: HistoricalCompletedSessionInput[] = Array.from({ length: 1040 }, (_, i) => ({
            externalId: `ts-${i}`,
            localDate: "2024-03-04",
            timeZone: "Europe/London",
            activities: [
                {
                    type: "strength",
                    externalId: `act-${i}`,
                    position: 0,
                    strength: {
                        occurrences: [
                            {
                                externalId: `occ-${i}`,
                                reference: { by: "id", exerciseId: SQUAT },
                                position: 0,
                                performedSets: [
                                    {
                                        externalId: `set-${i}`,
                                        position: 0,
                                        setType: "working",
                                        status: "completed",
                                        measurements: { reps: 5, externalLoad: { value: 100, unit: "kg" } },
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        }));
        let mappingReads = 0;
        let versionReads = 0;
        const readPort: ImportStorageReadPort<typeof transaction> = {
            async readExternalIdMappings() {
                mappingReads += 1;
                return [];
            },
            async readAggregateVersions() {
                versionReads += 1;
                return [];
            },
        };
        const { useCaseInstance } = useCase({ readPort });
        const result = await useCaseInstance.execute(envelope({ completedSessions: sessions }), metadata);

        expect(result.summary.completedSessions).toBe(1040);
        expect(result.storagePlan.entries).toHaveLength(1040 * 4);
        expect(result.storagePlan.counts.create).toBe(1040 * 4);
        // Reconciliation resolves the whole archive in a single batched external-ID read (no per-entity
        // round-trips); with nothing bound, no version read is needed at all.
        expect(mappingReads).toBe(1);
        expect(versionReads).toBe(0);
    });

    it("resolves a canonical exercise reference by slug", async () => {
        const resolver = new BulkCatalogResolver(
            fakeCatalog({ [SQUAT]: catalogItem(SQUAT, "Back Squat", "back-squat") }),
            noExternalIds,
        );
        const slugResolver: ExerciseSlugResolver = {
            resolveBySlug: async slug => (slug === "back-squat" ? SQUAT : null),
        };
        const session = completedSession();
        const bySlug: HistoricalCompletedSessionInput = {
            ...session,
            activities: [
                {
                    ...session.activities[0]!,
                    type: "strength",
                    strength: {
                        occurrences: [
                            {
                                externalId: "occ-1",
                                reference: { by: "slug", slug: "back-squat" },
                                position: 0,
                                performedSets: [
                                    {
                                        externalId: "set-1",
                                        position: 0,
                                        setType: "working",
                                        status: "completed",
                                        measurements: { reps: 5 },
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        };
        const { useCaseInstance } = useCase({ resolver, slugResolver });
        const result = await useCaseInstance.execute(envelope({ completedSessions: [bySlug] }), metadata);

        expect(result.state).toBe("ready");
        expect(result.completedSessions).toHaveLength(1);
    });
});
