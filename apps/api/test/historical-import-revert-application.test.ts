import { describe, expect, it } from "vitest";

import {
    HistoricalImportCommitFailedError,
    HistoricalImportCommitNotFoundError,
    HistoricalImportCommitQueryService,
    HistoricalImportRevertNotFoundError,
    RevertHistoricalImport,
    type StoredHistoricalImportCommit,
    type StoredHistoricalImportDryRun,
    type StoredHistoricalImportRevert,
} from "#src/modules/training/application/index";
import {
    ImportNotRevertibleError,
    ImportRevertBlockedError,
    IdempotencyInProgressError,
    type CommandContext,
} from "#src/platform/application/index";

// ---------------------------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------------------------

const PROFILE = "0198a4db-d8da-7000-8000-000000000001";
const DRY_RUN = "0198a4db-d8da-7000-8000-0000000000d0";
const COMMIT = "0198a4db-d8da-7000-8000-0000000000c0";
const BATCH = "0198a4db-d8da-7000-8000-0000000000b0";
const PROGRAM = "0198a4db-d8da-7000-8000-0000000000c1";
const PLANNED = "0198a4db-d8da-7000-8000-0000000000c2";
const SESSION = "0198a4db-d8da-7000-8000-0000000000a1";

const now = new Date("2026-08-09T10:00:00.000Z");
const metadata: CommandContext = { correlationId: "corr-1", actorId: null, source: "agent" };

/** External-ID mappings owned by the import batch: three revertible roots + one non-revertible child. */
const mappings = [
    { entityType: "program", externalId: "prog-1", entityId: PROGRAM },
    { entityType: "program-block", externalId: "blk-1", entityId: "0198a4db-d8da-7000-8000-0000000000c3" },
    { entityType: "planned-session", externalId: "ps-1", entityId: PLANNED },
    { entityType: "training-session", externalId: "ts-1", entityId: SESSION },
] as const;

function storedCommit(overrides: Partial<StoredHistoricalImportCommit> = {}): StoredHistoricalImportCommit {
    return {
        id: COMMIT,
        dryRunId: DRY_RUN,
        profileId: PROFILE,
        importBatchId: BATCH,
        sourceNamespace: "coach-app",
        sourceGeneratedBy: null,
        mode: "create",
        idempotencyKey: null,
        state: "succeeded",
        committedBatchKeys: ["program#0", "completed-session#0"],
        attempts: 1,
        failure: null,
        createdAt: now,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        ...overrides,
    };
}

interface HarnessOptions {
    readonly commit?: Partial<StoredHistoricalImportCommit>;
    readonly activeProfileId?: string;
    /** Version each entity currently sits at; default 1 (untouched since import). */
    readonly versions?: Record<string, number>;
    readonly archivedIds?: readonly string[];
    /** Throw on the Nth (1-based) archive call to simulate an interruption. */
    readonly failArchiveOnAttempt?: number;
    readonly seedRevert?: StoredHistoricalImportRevert;
}

function harness(options: HarnessOptions = {}) {
    const transaction = {};
    const commitHolder = { value: storedCommit(options.commit) };
    const revertsByCommit = new Map<string, StoredHistoricalImportRevert>();
    if (options.seedRevert) revertsByCommit.set(options.seedRevert.commitId, options.seedRevert);
    const versions = { ...options.versions };
    const archived = new Set<string>(options.archivedIds ?? []);
    let idSeq = 0;
    let archiveCalls = 0;
    const calls = { archive: [] as string[] };

    const inspect = async (_entityType: string, entityId: string) => {
        if (!(entityId in versions) && !archived.has(entityId)) return { version: 1, archived: archived.has(entityId) };
        if (!(entityId in versions) && archived.has(entityId)) return { version: 2, archived: true };
        return { version: versions[entityId] ?? 1, archived: archived.has(entityId) };
    };

    const archiveEntity = async (id: string, expectedVersion: number) => {
        archiveCalls += 1;
        if (options.failArchiveOnAttempt !== undefined && archiveCalls === options.failArchiveOnAttempt)
            throw new Error("simulated interruption while archiving");
        calls.archive.push(id);
        archived.add(id);
        versions[id] = expectedVersion + 1;
        return { id, version: expectedVersion + 1 };
    };

    const runtime = {
        unitOfWork: { execute: (work: (tx: unknown) => Promise<unknown>) => work(transaction) },
        commits: {
            async lockById(id: string, profileId: string) {
                return id === commitHolder.value.id && commitHolder.value.profileId === profileId
                    ? commitHolder.value
                    : null;
            },
            async findById(id: string, profileId: string) {
                return id === commitHolder.value.id && commitHolder.value.profileId === profileId
                    ? commitHolder.value
                    : null;
            },
            async listByProfile(profileId: string) {
                return commitHolder.value.profileId === profileId ? [commitHolder.value] : [];
            },
        },
        reverts: {
            async lockByCommitId(commitId: string, profileId: string) {
                const record = revertsByCommit.get(commitId);
                return record && record.profileId === profileId ? record : null;
            },
            async findByCommitId(commitId: string, profileId: string) {
                const record = revertsByCommit.get(commitId);
                return record && record.profileId === profileId ? record : null;
            },
            async insertIfAbsent(record: StoredHistoricalImportRevert) {
                if (revertsByCommit.has(record.commitId)) return false;
                revertsByCommit.set(record.commitId, record);
                return true;
            },
            async listByProfile(profileId: string) {
                return [...revertsByCommit.values()].filter(revert => revert.profileId === profileId);
            },
            async save(record: StoredHistoricalImportRevert) {
                revertsByCommit.set(record.commitId, record);
            },
        },
        externalIds: {
            async listByBatch(batchId: string) {
                return batchId === BATCH ? mappings.map(mapping => ({ ...mapping })) : [];
            },
        },
        inspector: { inspect },
        programCommands: {
            async archive(id: string, expectedVersion: number) {
                return archiveEntity(id, expectedVersion);
            },
        },
        plannedSessions: {
            async archive(id: string, expectedVersion: number) {
                return archiveEntity(id, expectedVersion);
            },
        },
        trainingSessions: {
            async archive(id: string, expectedVersion: number) {
                return archiveEntity(id, expectedVersion);
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
    const revert = new RevertHistoricalImport(runtime as any);
    return { revert, runtime, revertsByCommit, calls };
}

// ---------------------------------------------------------------------------------------------
// Revert use case
// ---------------------------------------------------------------------------------------------

describe("RevertHistoricalImport — safe compensation", () => {
    it("archives every import-owned aggregate (roots only), skips child rows, and succeeds", async () => {
        const { revert, calls } = harness();
        const result = await revert.execute(COMMIT, metadata);

        expect(result.state).toBe("succeeded");
        expect(result.counts.archived).toBe(3);
        expect(result.counts.blocked).toBe(0);
        // Training session first, then planned session, then program (innermost-first).
        expect(calls.archive).toEqual([SESSION, PLANNED, PROGRAM]);
        expect(result.archivedEntities.map(entity => entity.entityType)).toEqual([
            "training-session",
            "planned-session",
            "program",
        ]);
    });

    it("refuses the whole revert and archives nothing when an aggregate was edited after import", async () => {
        const { revert, calls } = harness({ versions: { [SESSION]: 3 } });
        await expect(revert.execute(COMMIT, metadata)).rejects.toBeInstanceOf(ImportRevertBlockedError);
        expect(calls.archive).toEqual([]);
    });

    it("records the blocked aggregates on the durable run for a status read", async () => {
        const { revert, revertsByCommit } = harness({ versions: { [PROGRAM]: 2 } });
        await expect(revert.execute(COMMIT, metadata)).rejects.toBeInstanceOf(ImportRevertBlockedError);
        const stored = revertsByCommit.get(COMMIT)!;
        expect(stored.state).toBe("blocked");
        expect(stored.blockedEntities).toHaveLength(1);
        expect(stored.blockedEntities[0]?.entityId).toBe(PROGRAM);
        expect(stored.blockedEntities[0]?.reason).toBe("edited-after-import");
    });

    it("rejects reverting a commit that never succeeded", async () => {
        const { revert } = harness({ commit: { state: "failed" } });
        await expect(revert.execute(COMMIT, metadata)).rejects.toBeInstanceOf(ImportNotRevertibleError);
    });

    it("hides a commit owned by another profile as not-found", async () => {
        const { revert } = harness({ activeProfileId: "0198a4db-d8da-7000-8000-000000000099" });
        await expect(revert.execute(COMMIT, metadata)).rejects.toBeInstanceOf(HistoricalImportCommitNotFoundError);
    });

    it("skips an aggregate already archived out-of-band without blocking", async () => {
        const { revert, calls } = harness({ archivedIds: [PROGRAM] });
        const result = await revert.execute(COMMIT, metadata);
        expect(result.state).toBe("succeeded");
        expect(calls.archive).toEqual([SESSION, PLANNED]);
        expect(result.counts.archived).toBe(2);
        expect(result.counts.skipped).toBe(1);
    });

    it("replays a succeeded revert without archiving again", async () => {
        const { revert, calls } = harness();
        await revert.execute(COMMIT, metadata);
        const replay = await revert.execute(COMMIT, metadata);
        expect(replay.state).toBe("succeeded");
        expect(calls.archive).toEqual([SESSION, PLANNED, PROGRAM]); // no extra archive calls
    });

    it("resumes from its checkpoint after an interruption, never re-archiving a committed aggregate", async () => {
        // Fail on the 2nd archive (planned session) — the training session is already checkpointed.
        const first = harness({ failArchiveOnAttempt: 2 });
        await expect(first.revert.execute(COMMIT, metadata)).rejects.toBeInstanceOf(HistoricalImportCommitFailedError);
        const stored = first.revertsByCommit.get(COMMIT)!;
        expect(stored.state).toBe("failed");
        expect(stored.archivedEntities.map(entity => entity.entityId)).toEqual([SESSION]);
        expect(first.calls.archive).toEqual([SESSION]);

        // Resume with a fresh harness pre-seeded with the failed run and the already-archived session.
        const resumed = harness({ seedRevert: { ...stored, state: "failed" }, archivedIds: [SESSION] });
        const result = await resumed.revert.execute(COMMIT, metadata);
        expect(result.state).toBe("succeeded");
        // Only the two un-archived aggregates are archived on resume; SESSION is not re-archived.
        expect(resumed.calls.archive).toEqual([PLANNED, PROGRAM]);
        expect(result.counts.archived).toBe(3);
    });

    it("serializes a concurrent in-flight revert as idempotency-in-progress", async () => {
        const running: StoredHistoricalImportRevert = {
            id: "0198a4db-d8da-7000-8000-0000000000f9",
            commitId: COMMIT,
            dryRunId: DRY_RUN,
            profileId: PROFILE,
            importBatchId: BATCH,
            state: "running",
            archivedEntities: [],
            blockedEntities: [],
            attempts: 1,
            failure: null,
            createdAt: now,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
        };
        const { revert } = harness({ seedRevert: running });
        await expect(revert.execute(COMMIT, metadata)).rejects.toBeInstanceOf(IdempotencyInProgressError);
    });
});

// ---------------------------------------------------------------------------------------------
// List + report query projections
// ---------------------------------------------------------------------------------------------

function storedDryRun(): StoredHistoricalImportDryRun {
    return {
        id: DRY_RUN,
        profileId: PROFILE,
        schemaVersion: 1,
        sourceNamespace: "coach-app",
        sourceGeneratedBy: "coach@1.0",
        payloadId: "archive-1",
        checksum: "a".repeat(64),
        mode: "create",
        state: "ready",
        referenceHash: "b".repeat(64),
        approvalToken: "tok",
        programs: [],
        completedSessions: [],
        storagePlan: {
            namespace: "coach-app",
            mode: "create",
            entries: [
                {
                    path: ["programs", 0],
                    entityType: "program",
                    externalId: "prog-1",
                    operation: "create",
                    currentEntityId: null,
                    currentVersion: null,
                    conflictCode: null,
                },
                {
                    path: ["programs", 0, "blocks", 0],
                    entityType: "program-block",
                    externalId: "blk-1",
                    operation: "create",
                    currentEntityId: null,
                    currentVersion: null,
                    conflictCode: null,
                },
                {
                    path: ["programs", 0, "sessions", 0],
                    entityType: "planned-session",
                    externalId: "ps-1",
                    operation: "create",
                    currentEntityId: null,
                    currentVersion: null,
                    conflictCode: null,
                },
                {
                    path: ["completedSessions", 0],
                    entityType: "training-session",
                    externalId: "ts-1",
                    operation: "create",
                    currentEntityId: null,
                    currentVersion: null,
                    conflictCode: null,
                },
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
        affectedVersions: [],
        createdAt: now,
        expiresAt: now,
        consumedAt: now,
    };
}

function queryHarness(revert?: StoredHistoricalImportRevert, versions: Record<string, number> = {}) {
    const commit = storedCommit();
    const dryRun = storedDryRun();
    const service = new HistoricalImportCommitQueryService({
        commits: {
            async findById(id: string, profileId: string) {
                return id === COMMIT && profileId === PROFILE ? commit : null;
            },
            async listByProfile(profileId: string) {
                return profileId === PROFILE ? [commit] : [];
            },
        } as never,
        dryRuns: {
            async findById(id: string) {
                return id === DRY_RUN ? dryRun : null;
            },
        } as never,
        reverts: {
            async findByCommitId(commitId: string, profileId: string) {
                return revert && revert.commitId === commitId && profileId === PROFILE ? revert : null;
            },
            async listByProfile(profileId: string) {
                return revert && profileId === PROFILE ? [revert] : [];
            },
        } as never,
        externalIds: {
            async listByBatch(batchId: string) {
                return batchId === BATCH ? mappings.map(mapping => ({ ...mapping })) : [];
            },
        } as never,
        inspector: {
            async inspect(_entityType: string, entityId: string) {
                return { version: versions[entityId] ?? 1, archived: false };
            },
        } as never,
        profileReader: {
            async requireActiveProfileId() {
                return PROFILE;
            },
        } as never,
    });
    return { service };
}

describe("HistoricalImportCommitQueryService — HI6 list + report", () => {
    it("lists imports with program/session counts derived from the checkpoint", async () => {
        const { service } = queryHarness();
        const result = await service.list();
        expect(result.count).toBe(1);
        expect(result.items[0]?.programs).toBe(1);
        expect(result.items[0]?.completedSessions).toBe(1);
        expect(result.items[0]?.reverted).toBe(false);
    });

    it("marks an import reverted when a succeeded revert run exists", async () => {
        const revert: StoredHistoricalImportRevert = {
            id: "0198a4db-d8da-7000-8000-0000000000f2",
            commitId: COMMIT,
            dryRunId: DRY_RUN,
            profileId: PROFILE,
            importBatchId: BATCH,
            state: "succeeded",
            archivedEntities: [{ entityType: "program", entityId: PROGRAM, externalId: "prog-1", version: 1 }],
            blockedEntities: [],
            attempts: 1,
            failure: null,
            createdAt: now,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
        };
        const { service } = queryHarness(revert);
        const result = await service.list();
        expect(result.items[0]?.reverted).toBe(true);
    });

    it("traces the payload checksum through to every stored entity and its current version", async () => {
        const { service } = queryHarness(undefined, { [PROGRAM]: 1, [PLANNED]: 1, [SESSION]: 1 });
        const report = await service.report(COMMIT);
        expect(report.checksum).toBe("a".repeat(64));
        expect(report.payloadId).toBe("archive-1");
        expect(report.entities).toHaveLength(4);
        const program = report.entities.find(entity => entity.entityType === "program");
        expect(program?.currentVersion).toBe(1);
        // A non-revertible child row is listed but not version-inspected.
        const block = report.entities.find(entity => entity.entityType === "program-block");
        expect(block?.currentVersion).toBeNull();
        expect(report.revert).toBeNull();
    });

    it("embeds a revert summary in the report when the import was reverted", async () => {
        const revert: StoredHistoricalImportRevert = {
            id: "0198a4db-d8da-7000-8000-0000000000f3",
            commitId: COMMIT,
            dryRunId: DRY_RUN,
            profileId: PROFILE,
            importBatchId: BATCH,
            state: "succeeded",
            archivedEntities: [
                { entityType: "training-session", entityId: SESSION, externalId: "ts-1", version: 1 },
                { entityType: "planned-session", entityId: PLANNED, externalId: "ps-1", version: 1 },
                { entityType: "program", entityId: PROGRAM, externalId: "prog-1", version: 1 },
            ],
            blockedEntities: [],
            attempts: 1,
            failure: null,
            createdAt: now,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
        };
        const { service } = queryHarness(revert);
        const report = await service.report(COMMIT);
        expect(report.revert?.state).toBe("succeeded");
        expect(report.revert?.archived).toBe(3);
    });

    it("reads a revert status by commit id, or 404s when never reverted", async () => {
        const { service } = queryHarness();
        await expect(service.revertStatus(COMMIT)).rejects.toBeInstanceOf(HistoricalImportRevertNotFoundError);
    });
});
