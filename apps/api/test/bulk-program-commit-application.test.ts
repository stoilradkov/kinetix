import { describe, expect, it } from "vitest";

import {
    BulkDryRunNotFoundError,
    CommitBulkProgram,
    ExerciseNotFoundError,
    type BulkNormalizedProgram,
    type StoredBulkDryRun,
} from "#src/modules/training/application/index";
import {
    ApplicationError,
    DryRunConsumedError,
    DryRunExpiredError,
    DryRunStaleError,
    DryRunTokenInvalidError,
    ExternalIdConflictError,
    hashRequest,
    type CommandContext,
} from "#src/platform/application/index";
import type { SessionPrescriptionState } from "#src/modules/training/domain/index";

const DRY_RUN = "0198a4db-d8da-7000-8000-0000000000d1";
const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const PROGRAM = "0198a4db-d8da-7000-8000-0000000000e1";
const SESSION = "0198a4db-d8da-7000-8000-000000000101";
const PRESCRIPTION = "0198a4db-d8da-7000-8000-000000000111";
const SQUAT = "0198a4db-d8da-7000-8000-0000000000a1";
const now = new Date("2026-08-01T10:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "req-1", source: "agent" };

const affectedVersions = [{ entityType: "training.exercise", entityId: SQUAT, version: 3 }];
const referenceHash = hashRequest(affectedVersions);

function normalizedProgram(overrides: Partial<BulkNormalizedProgram> = {}): BulkNormalizedProgram {
    return {
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
        blocks: [],
        sessions: [
            {
                id: SESSION,
                externalId: "sess-1",
                title: "Day 1",
                sequence: 0,
                relativeWeek: null,
                relativeDay: null,
                localDate: null,
                preferredTime: null,
                timeZone: null,
                expectedDurationMinutes: null,
                notes: null,
                tags: [],
                blockIds: [],
                prescription: { id: PRESCRIPTION } as unknown as SessionPrescriptionState,
            },
        ],
        ...overrides,
    };
}

function storedDryRun(overrides: Partial<StoredBulkDryRun> = {}): StoredBulkDryRun {
    return {
        id: DRY_RUN,
        profileId: PROFILE,
        schemaVersion: 1,
        sourceNamespace: "coach-app",
        sourceGeneratedBy: null,
        mode: "create",
        state: "ready",
        referenceHash,
        approvalToken: "tok-1",
        normalizedProgram: normalizedProgram(),
        warnings: [],
        errors: [],
        mappings: [],
        proposedExercises: [],
        affectedVersions,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 3_600_000),
        consumedAt: null,
        ...overrides,
    };
}

interface Options {
    readonly record?: Partial<StoredBulkDryRun>;
    readonly activeProfileId?: string;
    readonly currentVersion?: number;
    readonly registerError?: unknown;
    readonly programCreateError?: unknown;
    readonly missingExercise?: boolean;
}

function harness(options: Options = {}) {
    const stored = storedDryRun(options.record);
    const calls = {
        markConsumed: [] as { id: string; committedProgramId: string }[],
        register: [] as { entityType: string; externalId: string; entityId: string }[],
        materialize: [] as string[],
        linkProgramSession: [] as string[],
        linkSessionBlock: [] as { session: string; block: string }[],
        createExercise: [] as string[],
        programCreate: 0,
    };
    const runtime = {
        unitOfWork: { execute: (work: (tx: unknown) => Promise<unknown>) => work(transaction) },
        repository: {
            async lockForCommit(id: string) {
                return id === stored.id ? stored : null;
            },
            async markConsumed(id: string, input: { committedProgramId: string; consumedAt: Date }) {
                calls.markConsumed.push({ id, committedProgramId: input.committedProgramId });
            },
            async save() {},
            async findById() {
                return null;
            },
        },
        externalIds: {
            async register(input: {
                entries: readonly { entityType: string; externalId: string; entityId: string }[];
            }) {
                if (options.registerError) throw options.registerError;
                for (const entry of input.entries) calls.register.push(entry);
            },
            async resolve() {
                return null;
            },
        },
        catalog: {
            async resolveCurrentExercise(id: string) {
                if (options.missingExercise) throw new ExerciseNotFoundError(id);
                return {
                    requestedExerciseId: id,
                    resolvedExerciseId: id,
                    redirected: false,
                    exercise: { version: options.currentVersion ?? 3 },
                };
            },
        },
        exercises: {
            async create(command: { id?: string }) {
                calls.createExercise.push(command.id ?? "");
                return {};
            },
        },
        programCommands: {
            async create(command: { id?: string }) {
                calls.programCreate += 1;
                if (options.programCreateError) throw options.programCreateError;
                return { program: { id: command.id, version: 1 }, warnings: [] };
            },
        },
        plannedSessions: {
            async materialize(input: { id?: string }) {
                calls.materialize.push(input.id ?? "");
                return { session: { id: input.id, version: 1 }, prescription: {} };
            },
        },
        publisher: {
            async publishPreparedState(state: { id: string }) {
                return state;
            },
        },
        membership: {
            async linkProgramSession(input: { plannedSessionId: string }) {
                calls.linkProgramSession.push(input.plannedSessionId);
            },
            async linkSessionBlock(session: string, block: string) {
                calls.linkSessionBlock.push({ session, block });
            },
        },
        profileReader: { requireActiveProfileId: async () => options.activeProfileId ?? PROFILE },
        clock: { now: () => now },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { commit: new CommitBulkProgram(runtime as any), calls, stored };
}

const request = { dryRunId: DRY_RUN, approvalToken: "tok-1" };

describe("CommitBulkProgram", () => {
    it("commits the approved tree, registers external ids, and consumes the dry-run", async () => {
        const { commit, calls } = harness();
        const result = await commit.execute(request, metadata);

        expect(result.programId).toBe(PROGRAM);
        expect(result.programVersion).toBe(1);
        expect(result.sessions).toEqual([{ id: SESSION, externalId: "sess-1", prescriptionId: PRESCRIPTION }]);
        expect(calls.programCreate).toBe(1);
        expect(calls.materialize).toEqual([SESSION]);
        expect(calls.linkProgramSession).toEqual([SESSION]);
        expect(calls.register.map(entry => entry.entityType)).toEqual(["program", "planned-session"]);
        expect(calls.markConsumed).toEqual([{ id: DRY_RUN, committedProgramId: PROGRAM }]);
    });

    it("creates proposed exercises before persisting the tree", async () => {
        const { commit, calls } = harness({
            record: {
                proposedExercises: [
                    {
                        exerciseId: SQUAT,
                        exerciseRef: "squat",
                        sessionExternalId: "sess-1",
                        definition: {
                            name: "Zercher Squat",
                            equipmentTypeId: "0198a4db-d8da-7000-8000-0000000000b1",
                            movementPatternId: "0198a4db-d8da-7000-8000-0000000000c1",
                            classification: "compound",
                            laterality: "bilateral",
                            bodyPosition: "standing",
                            repetitionSemantics: "total",
                            loadModel: "external_only",
                            supportedMeasurements: ["repetitions"],
                        },
                    },
                ],
                affectedVersions: [],
                referenceHash: hashRequest([]),
            },
        });
        await commit.execute(request, metadata);
        expect(calls.createExercise).toEqual([SQUAT]);
    });

    it("rejects a mismatched approval token", async () => {
        const { commit } = harness();
        await expect(commit.execute({ dryRunId: DRY_RUN, approvalToken: "wrong" }, metadata)).rejects.toBeInstanceOf(
            DryRunTokenInvalidError,
        );
    });

    it("rejects an already-consumed dry-run", async () => {
        const { commit } = harness({ record: { consumedAt: now } });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(DryRunConsumedError);
    });

    it("rejects an expired dry-run", async () => {
        const { commit } = harness({ record: { expiresAt: new Date(now.getTime() - 1) } });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(DryRunExpiredError);
    });

    it("rejects a dry-run that still needs mapping", async () => {
        const { commit } = harness({ record: { state: "needs_mapping" } });
        await expect(commit.execute(request, metadata)).rejects.toMatchObject({ code: "CATALOG_MAPPING_REQUIRED" });
    });

    it("rejects a dry-run carrying validation errors", async () => {
        const { commit } = harness({
            record: { errors: [{ path: ["program"], code: "VALIDATION_FAILED", message: "bad" }] },
        });
        const error = await commit.execute(request, metadata).catch(caught => caught);
        expect(error).toBeInstanceOf(ApplicationError);
        expect((error as ApplicationError).code).toBe("CATALOG_MAPPING_REQUIRED");
    });

    it("rejects a dry-run whose referenced catalog version changed", async () => {
        const { commit } = harness({ currentVersion: 4 });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(DryRunStaleError);
    });

    it("treats a deleted referenced exercise as stale", async () => {
        const { commit } = harness({ missingExercise: true });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(DryRunStaleError);
    });

    it("hides a dry-run owned by another profile", async () => {
        const { commit } = harness({ activeProfileId: "0198a4db-d8da-7000-8000-0000000000ff" });
        await expect(commit.execute(request, metadata)).rejects.toBeInstanceOf(BulkDryRunNotFoundError);
    });

    it("surfaces an external-id conflict and does not consume the dry-run", async () => {
        const conflict = new ExternalIdConflictError("coach-app", "program", "prog-1");
        const { commit, calls } = harness({ registerError: conflict });
        await expect(commit.execute(request, metadata)).rejects.toBe(conflict);
        expect(calls.markConsumed).toEqual([]);
    });

    it("rolls back without consuming the dry-run when a child write fails", async () => {
        const failure = new Error("program insert failed");
        const { commit, calls } = harness({ programCreateError: failure });
        await expect(commit.execute(request, metadata)).rejects.toBe(failure);
        expect(calls.markConsumed).toEqual([]);
        expect(calls.register).toEqual([]);
    });
});
