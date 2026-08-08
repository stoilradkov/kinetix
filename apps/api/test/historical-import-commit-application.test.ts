import { describe, expect, it } from "vitest";

import {
    CommitHistoricalImport,
    HistoricalImportCommitFailedError,
    HistoricalImportDryRunNotFoundError,
    type BulkExternalIdEntry,
    type StoredHistoricalImportCommit,
    type StoredHistoricalImportDryRun,
} from "#src/modules/training/application/index";
import { ExerciseNotFoundError } from "#src/modules/training/application/exercises";
import {
    DryRunConsumedError,
    DryRunExpiredError,
    DryRunStaleError,
    DryRunTokenInvalidError,
    ExternalIdConflictError,
    hashRequest,
    type CommandContext,
} from "#src/platform/application/index";

// ---------------------------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------------------------

const PROFILE = "0198a4db-d8da-7000-8000-000000000001";
const DRY_RUN = "0198a4db-d8da-7000-8000-0000000000d0";
const BATCH = "0198a4db-d8da-7000-8000-0000000000b0";
const EXERCISE = "0198a4db-d8da-7000-8000-0000000000e1";
const PROGRAM = "0198a4db-d8da-7000-8000-0000000000c1";
const PLANNED_SESSION = "0198a4db-d8da-7000-8000-0000000000c2";
const BLOCK = "0198a4db-d8da-7000-8000-0000000000c3";
const COMPLETED_SESSION = "0198a4db-d8da-7000-8000-0000000000a1";

const now = new Date("2026-08-08T10:00:00.000Z");
const metadata: CommandContext = { correlationId: "corr-1", actorId: null, source: "agent" };
const request = { dryRunId: DRY_RUN, approvalToken: "token-ok" };

/** The affected catalog versions + reference hash the commit re-verifies. */
const affectedVersions = [{ entityType: "training.exercise", entityId: EXERCISE, version: 3 }];
const referenceHash = hashRequest(affectedVersions);

function planEntry(path: (string | number)[], entityType: string, externalId: string) {
    return {
        path,
        entityType,
        externalId,
        operation: "create",
        currentEntityId: null,
        currentVersion: null,
        conflictCode: null,
    };
}

function proposedExercisePreview() {
    return {
        exerciseId: "0198a4db-d8da-7000-8000-0000000000e2",
        exerciseRef: "first-occurrence",
        sessionExternalId: "first-session",
        definition: {
            name: "Cable Chest Fly",
            slug: "cable-chest-fly",
            equipmentTypeId: EXERCISE,
            movementPatternId: EXERCISE,
            classification: "isolation" as const,
            laterality: "bilateral" as const,
            bodyPosition: "standing",
            repetitionSemantics: "total" as const,
            loadModel: "external_only" as const,
            supportedMeasurements: ["repetitions", "external_load"] as const,
        },
    };
}

function storedDryRun(overrides: Partial<StoredHistoricalImportDryRun> = {}): StoredHistoricalImportDryRun {
    return {
        id: DRY_RUN,
        profileId: PROFILE,
        schemaVersion: 1,
        sourceNamespace: "coach-app",
        sourceGeneratedBy: null,
        payloadId: "payload-1",
        checksum: "a".repeat(64),
        mode: "create",
        state: "ready",
        referenceHash,
        approvalToken: "token-ok",
        programs: [
            {
                id: PROGRAM,
                externalId: "prog-1",
                profileId: PROFILE,
                name: "Spring Strength",
                description: null,
                scheduleMode: "ordered",
                startDate: null,
                endDate: null,
                focus: null,
                goalIds: [],
                blocks: [
                    {
                        id: BLOCK,
                        externalId: "blk-1",
                        parentBlockId: null,
                        type: "mesocycle",
                        label: null,
                        position: 0,
                        startDate: null,
                        endDate: null,
                        relativeStartWeek: 0,
                        relativeEndWeek: null,
                        focus: null,
                        targetMuscles: [],
                        targetVolume: null,
                        targetIntensity: null,
                        deload: false,
                        expectedAdaptations: null,
                        notes: null,
                        tags: [],
                    },
                ],
                sessions: [
                    {
                        id: PLANNED_SESSION,
                        externalId: "ps-1",
                        title: null,
                        sequence: 0,
                        relativeWeek: null,
                        relativeDay: null,
                        localDate: null,
                        preferredTime: null,
                        timeZone: null,
                        expectedDurationMinutes: null,
                        notes: null,
                        tags: [],
                        blockIds: [BLOCK],
                        prescription: { id: "presc-source" } as never,
                    },
                ],
            },
        ] as never,
        completedSessions: [{ externalId: "ts-1", id: COMPLETED_SESSION, status: "completed" } as never],
        storagePlan: {
            namespace: "coach-app",
            mode: "create",
            entries: [
                planEntry(["programs", 0], "program", "prog-1"),
                planEntry(["programs", 0, "blocks", 0], "program-block", "blk-1"),
                planEntry(["programs", 0, "sessions", 0], "planned-session", "ps-1"),
                planEntry(["completedSessions", 0], "training-session", "ts-1"),
            ],
            counts: { create: 4, update: 0, "skip-identical": 0, conflict: 0 },
            conflicts: [],
            hasConflicts: false,
        } as never,
        summary: {} as never,
        warnings: [],
        errors: [],
        mappings: [],
        proposedExercises: [],
        affectedVersions,
        createdAt: now,
        expiresAt: new Date("2026-08-08T11:00:00.000Z"),
        consumedAt: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------------------------
// Harness of fakes at the ports
// ---------------------------------------------------------------------------------------------

interface HarnessOptions {
    readonly dryRun?: Partial<StoredHistoricalImportDryRun>;
    readonly activeProfileId?: string;
    readonly currentVersion?: number;
    readonly missingExercise?: boolean;
    readonly registerError?: unknown;
    /** Throw on the Nth (1-based) call to commit a completed session, to simulate an interruption. */
    readonly failSessionOnAttempt?: number;
}

function harness(options: HarnessOptions = {}) {
    const transaction = {};
    const dryRunHolder = { value: storedDryRun(options.dryRun) };
    const commitsById = new Map<string, StoredHistoricalImportCommit>();
    const commitsByDryRun = new Map<string, string>();
    const registered = new Set<string>();
    const createdExercises = new Set<string>();
    const registeredEntries: (BulkExternalIdEntry & { batchId: string | null })[] = [];
    let idSeq = 0;
    let sessionCalls = 0;
    const calls = {
        exerciseCreate: 0,
        programCreate: 0,
        sessionCommit: 0,
        register: [] as BulkExternalIdEntry[],
        markConsumed: 0,
    };

    const runtime = {
        unitOfWork: { execute: (work: (tx: unknown) => Promise<unknown>) => work(transaction) },
        dryRuns: {
            async lockForCommit(id: string) {
                return id === dryRunHolder.value.id ? dryRunHolder.value : null;
            },
            async findById(id: string) {
                return id === dryRunHolder.value.id ? dryRunHolder.value : null;
            },
            async markConsumed(_id: string, input: { consumedAt: Date }) {
                calls.markConsumed += 1;
                dryRunHolder.value = { ...dryRunHolder.value, consumedAt: input.consumedAt };
            },
            async save() {},
        },
        commits: {
            async insertIfAbsent(record: StoredHistoricalImportCommit) {
                if (commitsByDryRun.has(record.dryRunId)) return false;
                commitsById.set(record.id, record);
                commitsByDryRun.set(record.dryRunId, record.id);
                return true;
            },
            async lockByDryRunId(dryRunId: string, profileId: string) {
                const id = commitsByDryRun.get(dryRunId);
                const record = id ? commitsById.get(id) : undefined;
                return record && record.profileId === profileId ? record : null;
            },
            async lockById(id: string, profileId: string) {
                const record = commitsById.get(id);
                return record && record.profileId === profileId ? record : null;
            },
            async findById(id: string, profileId: string) {
                const record = commitsById.get(id);
                return record && record.profileId === profileId ? record : null;
            },
            async save(record: StoredHistoricalImportCommit) {
                commitsById.set(record.id, record);
                commitsByDryRun.set(record.dryRunId, record.id);
            },
        },
        externalIds: {
            async register(input: {
                namespace: string;
                importBatchId?: string | null;
                entries: readonly BulkExternalIdEntry[];
            }) {
                if (options.registerError) throw options.registerError;
                for (const entry of input.entries) {
                    const key = `${input.namespace}:${entry.entityType}:${entry.externalId}`;
                    if (registered.has(key))
                        throw new ExternalIdConflictError(input.namespace, entry.entityType, entry.externalId);
                    registered.add(key);
                    registeredEntries.push({ ...entry, batchId: input.importBatchId ?? null });
                    calls.register.push(entry);
                }
            },
            async resolve() {
                return null;
            },
            async listByBatch(batchId: string) {
                return registeredEntries
                    .filter(entry => entry.batchId === batchId)
                    .map(entry => ({
                        entityType: entry.entityType,
                        externalId: entry.externalId,
                        entityId: entry.entityId,
                    }));
            },
        },
        importBatches: {
            async execute() {
                return { id: BATCH, namespace: "coach-app", resolved: false };
            },
        },
        catalog: {
            async resolveCurrentExercise(id: string) {
                if (options.missingExercise && !createdExercises.has(id)) throw new ExerciseNotFoundError(id);
                return { resolvedExerciseId: id, exercise: { version: options.currentVersion ?? 3 } };
            },
        },
        exercises: {
            async create(input: { id: string }) {
                calls.exerciseCreate += 1;
                createdExercises.add(input.id);
                return {};
            },
        },
        programCommands: {
            async create() {
                calls.programCreate += 1;
                return { program: { id: PROGRAM, version: 1 }, warnings: [] };
            },
        },
        plannedSessions: {
            async materialize() {
                return { session: { id: PLANNED_SESSION, version: 1 }, prescription: {} };
            },
        },
        publisher: {
            async publishPreparedState(state: { id?: string }) {
                return { id: state.id ?? "presc-1" };
            },
        },
        membership: {
            async linkProgramSession() {},
            async linkSessionBlock() {},
        },
        trainingSessions: {
            async commitPreparedState(state: { id: string }) {
                sessionCalls += 1;
                if (options.failSessionOnAttempt !== undefined && sessionCalls === options.failSessionOnAttempt)
                    throw new Error("simulated interruption while committing session");
                calls.sessionCommit += 1;
                return { ...state, version: 1 };
            },
        },
        profileReader: {
            async requireActiveProfileId() {
                return options.activeProfileId ?? PROFILE;
            },
        },
        clock: { now: () => now },
        generateId: () => `0198a4db-d8da-7000-8000-${(++idSeq).toString(16).padStart(12, "0")}`,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commit = new CommitHistoricalImport(runtime as any);
    return { commit, calls, dryRunHolder, commitsById };
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe("CommitHistoricalImport — gating", () => {
    it("rejects a wrong approval token", async () => {
        const { commit } = harness();
        await expect(commit.execute({ ...request, approvalToken: "wrong" }, metadata)).rejects.toBeInstanceOf(
            DryRunTokenInvalidError,
        );
    });

    it("hides a dry-run owned by another profile as not-found", async () => {
        const { commit } = harness({ activeProfileId: "0198a4db-d8da-7000-8000-000000000099" });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(HistoricalImportDryRunNotFoundError);
    });

    it("rejects an expired dry-run", async () => {
        const { commit } = harness({ dryRun: { expiresAt: new Date("2026-08-08T09:00:00.000Z") } });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(DryRunExpiredError);
    });

    it("rejects a dry-run that still needs mapping or has errors", async () => {
        const { commit } = harness({ dryRun: { state: "needs_mapping" } });
        await expect(commit.execute(request, metadata)).rejects.toMatchObject({ code: "CATALOG_MAPPING_REQUIRED" });
    });

    it("rejects a stale dry-run when a referenced exercise version changed", async () => {
        const { commit } = harness({ currentVersion: 4 });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(DryRunStaleError);
    });

    it("rejects a stale dry-run when a referenced exercise was deleted", async () => {
        const { commit } = harness({ missingExercise: true });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(DryRunStaleError);
    });
});

describe("CommitHistoricalImport — commit", () => {
    it("commits every aggregate, registers external IDs, and consumes the dry-run", async () => {
        const { commit, calls, dryRunHolder } = harness();
        const result = await commit.execute(request, metadata);

        expect(result.state).toBe("succeeded");
        expect(result.programs).toBe(1);
        expect(result.completedSessions).toBe(1);
        expect(result.counts).toEqual({ created: 4, updated: 0, skipped: 0, conflicted: 0 });
        expect(calls.programCreate).toBe(1);
        expect(calls.sessionCommit).toBe(1);
        expect(calls.markConsumed).toBe(1);
        expect(dryRunHolder.value.consumedAt).not.toBeNull();
        // Root external IDs registered for every aggregate (program tree + completed session).
        expect(calls.register.map(entry => entry.entityType).sort()).toEqual([
            "planned-session",
            "program",
            "program-block",
            "training-session",
        ]);
        expect(result.entities.map(entity => entity.externalId).sort()).toEqual(["blk-1", "prog-1", "ps-1", "ts-1"]);
        expect(result.failure).toBeNull();
    });

    it("is idempotent: replaying the same dry-run returns the succeeded run without re-committing", async () => {
        const { commit, calls } = harness();
        const first = await commit.execute(request, metadata);
        const second = await commit.execute(request, metadata);

        expect(second.commitId).toBe(first.commitId);
        expect(second.state).toBe("succeeded");
        // No aggregate was written a second time.
        expect(calls.programCreate).toBe(1);
        expect(calls.sessionCommit).toBe(1);
        expect(calls.markConsumed).toBe(1);
    });

    it("creates one unique proposed exercise once across commit replay", async () => {
        const { commit, calls } = harness({
            missingExercise: true,
            dryRun: {
                affectedVersions: [],
                referenceHash: hashRequest([]),
                proposedExercises: [proposedExercisePreview()],
            },
        });

        await commit.execute(request, metadata);
        await commit.execute(request, metadata);
        expect(calls.exerciseCreate).toBe(1);
    });
});

describe("CommitHistoricalImport — interruption and resume", () => {
    it("records a path-anchored failure and leaves the dry-run unconsumed when a batch fails", async () => {
        // The program batch commits; the completed-session batch throws on its first attempt.
        const { commit, calls, dryRunHolder } = harness({ failSessionOnAttempt: 1 });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(HistoricalImportCommitFailedError);

        expect(calls.programCreate).toBe(1);
        expect(calls.markConsumed).toBe(0);
        expect(dryRunHolder.value.consumedAt).toBeNull();
    });

    it("resumes from the committed checkpoint on retry without duplicating the committed program", async () => {
        const { commit, calls } = harness({ failSessionOnAttempt: 1 });
        let commitId = "";
        try {
            await commit.execute(request, metadata);
        } catch (error) {
            expect(error).toBeInstanceOf(HistoricalImportCommitFailedError);
            commitId = (error as HistoricalImportCommitFailedError).commitId;
        }

        // The retry (session no longer throws — attempt 2) skips the already-committed program batch.
        const resumed = await commit.retry(commitId, metadata);
        expect(resumed.state).toBe("succeeded");
        expect(calls.programCreate).toBe(1); // program committed once, across both attempts
        expect(calls.sessionCommit).toBe(1); // the session committed on the retry
        expect(calls.markConsumed).toBe(1);
        expect(resumed.completedSessions).toBe(1);
        expect(resumed.programs).toBe(1);
    });

    it("does not recreate a proposed exercise when an interrupted import is retried", async () => {
        const { commit, calls } = harness({
            missingExercise: true,
            failSessionOnAttempt: 1,
            dryRun: {
                affectedVersions: [],
                referenceHash: hashRequest([]),
                proposedExercises: [proposedExercisePreview()],
            },
        });
        let commitId = "";
        try {
            await commit.execute(request, metadata);
        } catch (error) {
            expect(error).toBeInstanceOf(HistoricalImportCommitFailedError);
            commitId = (error as HistoricalImportCommitFailedError).commitId;
        }

        await commit.retry(commitId, metadata);
        expect(calls.exerciseCreate).toBe(1);
    });
});

describe("CommitHistoricalImport — external-id conflict", () => {
    it("fails the run and does not consume the dry-run when an external ID already exists", async () => {
        const conflict = new ExternalIdConflictError("coach-app", "program", "prog-1");
        const { commit, calls, dryRunHolder } = harness({ registerError: conflict });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(HistoricalImportCommitFailedError);
        expect(calls.markConsumed).toBe(0);
        expect(dryRunHolder.value.consumedAt).toBeNull();
    });
});

describe("CommitHistoricalImport — double commit after success", () => {
    it("returns the succeeded run and never re-consumes when the dry-run is already consumed", async () => {
        const { commit } = harness();
        await commit.execute(request, metadata);
        // A byte-identical replay after success is a no-op returning the same run (not DRY_RUN_CONSUMED).
        const replay = await commit.execute(request, metadata);
        expect(replay.state).toBe("succeeded");
    });

    it("rejects a fresh commit of a dry-run consumed with no surviving run", async () => {
        const { commit } = harness({ dryRun: { consumedAt: now } });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(DryRunConsumedError);
    });
});
