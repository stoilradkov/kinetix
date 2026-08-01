import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, inArray, sql } from "drizzle-orm";

import {
    bulkDryRuns,
    bulkExternalIds,
    createDatabase,
    entityRevisions,
    equipmentTypes,
    exerciseAliases,
    exerciseExternalIds,
    exerciseMuscles,
    exercises,
    movementPatterns,
    muscleGroups,
    plannedSessions,
    prescribedActivities,
    prescribedExercises,
    prescribedRunningActivities,
    prescribedRunSteps,
    prescribedSetGroupMembers,
    prescribedSetGroups,
    prescribedSets,
    prescribedStrengthActivities,
    programPlannedSessions,
    programs,
    sessionPrescriptions,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    BulkCatalogResolver,
    CommitBulkProgram,
    DryRunBulkProgram,
    PlannedSessionCommands,
    PrescriptionPublisher,
    ProgramCommands,
    TrainingExerciseCatalog,
    plannedSessionSerializer,
    programSerializer,
    PLANNED_SESSION_ENTITY_TYPE,
    PROGRAM_ENTITY_TYPE,
    type ExerciseCatalogCommands,
} from "#src/modules/training/application/index";
import { DrizzleBulkDryRunRepository } from "#src/modules/training/infrastructure/drizzle-bulk-dry-run-repository";
import { DrizzleBulkExternalIdRegistry } from "#src/modules/training/infrastructure/drizzle-bulk-external-id-registry";
import { DrizzleExerciseExternalIdResolver } from "#src/modules/training/infrastructure/drizzle-exercise-external-id-resolver";
import { DrizzlePlannedSessionRepository } from "#src/modules/training/infrastructure/drizzle-planned-session-repository";
import { DrizzleProgramMembershipRepository } from "#src/modules/training/infrastructure/drizzle-program-membership-repository";
import { DrizzleProgramRepository } from "#src/modules/training/infrastructure/drizzle-program-repository";
import { DrizzleSessionPrescriptionRepository } from "#src/modules/training/infrastructure/drizzle-session-prescription-repository";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { DrizzleOutboxStore } from "#src/platform/infrastructure/drizzle-outbox-store";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";
import {
    DryRunConsumedError,
    DryRunStaleError,
    RevisionMutationService,
    type CommandContext,
    type UnitOfWork,
} from "#src/platform/application/index";
import type { BulkProgramEnvelope } from "@kinetix/types";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const suffix = randomUUID().slice(0, 8);
const profileId = randomUUID();
const muscleId = randomUUID();
const equipmentId = randomUUID();
const movementId = randomUUID();
const exerciseId = randomUUID();
const now = new Date("2026-08-01T10:00:00.000Z");
const metadata: CommandContext = { correlationId: "bulk-int", source: "agent" };

function envelope(namespace = "coach-app", externalId = "prog-1"): BulkProgramEnvelope {
    return {
        schemaVersion: 1,
        source: { namespace, generatedBy: "agent" },
        mode: "create",
        program: {
            externalId,
            name: "Bulk Program",
            scheduleMode: "dated",
            startDate: "2026-09-07",
            blocks: [{ externalId: "meso", type: "mesocycle", position: 0, relativeStartWeek: 0 }],
            sessions: [
                {
                    externalId: `${externalId}-sess`,
                    title: "Squat Day",
                    sequence: 0,
                    relativeWeek: 0,
                    relativeDay: 0,
                    blockExternalIds: ["meso"],
                    prescription: {
                        activities: [
                            {
                                type: "strength",
                                position: 0,
                                exercises: [
                                    {
                                        ref: "ex-1",
                                        reference: { by: "externalId", provider: "hevy", externalId: "sq-123" },
                                        position: 0,
                                        sets: [
                                            {
                                                position: 0,
                                                setType: "working",
                                                targets: {
                                                    repsMin: 5,
                                                    repsMax: 5,
                                                    loadMin: { value: 225, unit: "lb" },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        },
    };
}

describe.runIf(testDatabaseUrl)("bulk dry-run PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const repository = new DrizzleBulkDryRunRepository(db);
    const catalogRepository = new DrizzleTrainingCatalogRepository(db);
    const externalIdResolver = new DrizzleExerciseExternalIdResolver(db);
    const revisions = new DrizzleRevisionStore(db);
    const resolver = new BulkCatalogResolver(
        new TrainingExerciseCatalog(catalogRepository, revisions),
        externalIdResolver,
    );
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const profileReader = { requireActiveProfileId: async () => profileId };
    const useCase = new DryRunBulkProgram({
        unitOfWork,
        repository,
        resolver,
        profileReader,
        clock: { now: () => now },
        generateId: randomUUID,
    });

    // Commit graph — the same aggregate commands the module wires, over real repositories.
    const clock = { now: () => now };
    const outbox = new DrizzleOutboxStore(db);
    const programRepository = new DrizzleProgramRepository(db);
    const membership = new DrizzleProgramMembershipRepository(db);
    const sessionRepository = new DrizzlePlannedSessionRepository(db);
    const prescriptionRepository = new DrizzleSessionPrescriptionRepository(db);
    const catalog = new TrainingExerciseCatalog(catalogRepository, revisions);
    const publisher = new PrescriptionPublisher({
        unitOfWork,
        repository: prescriptionRepository,
        outbox,
        clock,
        generateId: randomUUID,
    });
    const plannedSessionCommands = new PlannedSessionCommands({
        unitOfWork,
        repository: sessionRepository,
        mutations: new RevisionMutationService(
            unitOfWork,
            sessionRepository,
            revisions,
            plannedSessionSerializer,
            outbox,
            clock,
        ),
        publisher,
        prescriptions: prescriptionRepository,
        profileReader,
        clock,
        generateId: randomUUID,
    });
    const programCommands = new ProgramCommands({
        unitOfWork,
        repository: programRepository,
        mutations: new RevisionMutationService(
            unitOfWork,
            programRepository,
            revisions,
            programSerializer,
            outbox,
            clock,
        ),
        membership,
        plannedSessions: plannedSessionCommands,
        // create never clones a template, so a planning reader is not needed for bulk commit.
        templates: undefined as never,
        goalValidator: { assertGoalsExist: async () => {} },
        profileReader,
        clock,
        generateId: randomUUID,
    });
    const externalIds = new DrizzleBulkExternalIdRegistry(db);
    // No proposed exercises in these fixtures, so the catalog commands are never invoked.
    const exercises_ = { create: async () => ({}) } as unknown as ExerciseCatalogCommands;
    const commitUseCase = new CommitBulkProgram({
        unitOfWork,
        repository,
        externalIds,
        catalog,
        exercises: exercises_,
        programCommands,
        plannedSessions: plannedSessionCommands,
        publisher,
        membership,
        profileReader,
        clock,
    });
    const createdPrescriptionIds: string[] = [];

    beforeAll(async () => {
        await connection.db
            .insert(muscleGroups)
            .values({ id: muscleId, slug: `quads-${suffix}`, name: `Quads ${suffix}`, position: 0, isSeeded: true });
        await connection.db.insert(equipmentTypes).values({
            id: equipmentId,
            slug: `barbell-${suffix}`,
            name: `Barbell ${suffix}`,
            position: 0,
            isSeeded: true,
        });
        await connection.db
            .insert(movementPatterns)
            .values({ id: movementId, slug: `squat-${suffix}`, name: `Squat ${suffix}`, position: 0, isSeeded: true });
        await connection.db.insert(exercises).values({
            id: exerciseId,
            slug: `back-squat-${suffix}`,
            name: "Back Squat",
            equipmentTypeId: equipmentId,
            movementPatternId: movementId,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "standing",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            version: 1,
            position: 0,
        });
        await connection.db
            .insert(exerciseAliases)
            .values({ exerciseId, alias: "Back Squat", normalizedAlias: "back squat", source: "seeded" });
        await connection.db.insert(exerciseMuscles).values({ exerciseId, muscleGroupId: muscleId, role: "primary" });
        await connection.db.insert(exerciseExternalIds).values({ exerciseId, provider: "hevy", externalId: "sq-123" });
    });

    afterAll(async () => {
        try {
            await connection.db
                .delete(entityRevisions)
                .where(inArray(entityRevisions.entityType, [PROGRAM_ENTITY_TYPE, PLANNED_SESSION_ENTITY_TYPE]));
            await connection.db.delete(programs).where(eq(programs.profileId, profileId));
            await connection.db.delete(plannedSessions).where(eq(plannedSessions.profileId, profileId));
            await connection.db.delete(bulkExternalIds).where(eq(bulkExternalIds.profileId, profileId));
            await connection.db.delete(bulkDryRuns).where(eq(bulkDryRuns.profileId, profileId));
            if (createdPrescriptionIds.length > 0) {
                await connection.db.execute(sql`SET session_replication_role = 'replica'`);
                for (const table of [
                    prescribedRunSteps,
                    prescribedSets,
                    prescribedSetGroupMembers,
                    prescribedSetGroups,
                    prescribedExercises,
                    prescribedRunningActivities,
                    prescribedStrengthActivities,
                    prescribedActivities,
                ])
                    await connection.db.delete(table).where(inArray(table.prescriptionId, createdPrescriptionIds));
                await connection.db
                    .delete(sessionPrescriptions)
                    .where(inArray(sessionPrescriptions.id, createdPrescriptionIds));
                await connection.db.execute(sql`SET session_replication_role = 'origin'`);
            }
            await connection.db.delete(exerciseExternalIds).where(eq(exerciseExternalIds.exerciseId, exerciseId));
            await connection.db.delete(exerciseMuscles).where(eq(exerciseMuscles.exerciseId, exerciseId));
            await connection.db.delete(exerciseAliases).where(eq(exerciseAliases.exerciseId, exerciseId));
            await connection.db.delete(exercises).where(eq(exercises.id, exerciseId));
            await connection.db.delete(movementPatterns).where(eq(movementPatterns.id, movementId));
            await connection.db.delete(equipmentTypes).where(eq(equipmentTypes.id, equipmentId));
            await connection.db.delete(muscleGroups).where(eq(muscleGroups.id, muscleId));
        } catch {
            // Best-effort cleanup.
        }
    });

    it("resolves by external id, persists the artifact, and reloads it — with no program side effects", async () => {
        const result = await useCase.execute(envelope(), metadata);

        expect(result.state).toBe("ready");
        expect(result.mappings).toHaveLength(0);
        // 225 lb → canonical kg
        const set = result.program.sessions[0]!.prescription!.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(Number(set.targets.loadKgMin)).toBeCloseTo(102.058, 2);
        expect(result.affectedVersions).toEqual([
            { entityType: "training.exercise", entityId: exerciseId, version: 1 },
        ]);

        const reloaded = await repository.findById(result.dryRunId);
        expect(reloaded).not.toBeNull();
        expect(reloaded!.referenceHash).toBe(result.referenceHash);
        expect(reloaded!.expiresAt.getTime()).toBe(new Date(now.getTime() + 60 * 60 * 1000).getTime());
        expect(reloaded!.mode).toBe("create");

        // No program was created — the dry-run touched only the artifact table.
        const programRows = await connection.db.select().from(programs).where(eq(programs.profileId, profileId));
        expect(programRows).toHaveLength(0);
    });

    it("recomputes a different reference fingerprint when the referenced exercise version changes", async () => {
        const before = (await useCase.execute(envelope(), metadata)).referenceHash;
        await connection.db.update(exercises).set({ version: 2 }).where(eq(exercises.id, exerciseId));
        const after = (await useCase.execute(envelope(), metadata)).referenceHash;
        await connection.db.update(exercises).set({ version: 1 }).where(eq(exercises.id, exerciseId));
        expect(before).not.toBe(after);
    });

    it("commits the approved tree in one transaction, registers external ids, and consumes the dry-run", async () => {
        const dryRun = await useCase.execute(envelope("commit-happy", "prog-happy"), metadata);
        const result = await commitUseCase.execute(
            { dryRunId: dryRun.dryRunId, approvalToken: dryRun.approvalToken },
            metadata,
        );
        for (const session of result.sessions)
            if (session.prescriptionId) createdPrescriptionIds.push(session.prescriptionId);

        expect(result.programId).toBe(dryRun.program.id);
        expect(result.programVersion).toBe(1);

        const programRows = await connection.db.select().from(programs).where(eq(programs.id, result.programId));
        expect(programRows).toHaveLength(1);
        expect(programRows[0]!.status).toBe("draft");

        const sessionId = result.sessions[0]!.id;
        const sessionRows = await connection.db.select().from(plannedSessions).where(eq(plannedSessions.id, sessionId));
        expect(sessionRows).toHaveLength(1);
        expect(sessionRows[0]!.currentPrescriptionId).toBe(result.sessions[0]!.prescriptionId);

        const prescriptionRows = await connection.db
            .select()
            .from(sessionPrescriptions)
            .where(eq(sessionPrescriptions.id, result.sessions[0]!.prescriptionId!));
        expect(prescriptionRows).toHaveLength(1);

        const membershipRows = await connection.db
            .select()
            .from(programPlannedSessions)
            .where(eq(programPlannedSessions.programId, result.programId));
        expect(membershipRows).toHaveLength(1);

        const externalIdRows = await connection.db
            .select()
            .from(bulkExternalIds)
            .where(eq(bulkExternalIds.entityId, result.programId));
        expect(externalIdRows).toHaveLength(1);
        expect(externalIdRows[0]!.entityType).toBe("program");

        const reloaded = await repository.findById(dryRun.dryRunId);
        expect(reloaded!.consumedAt).not.toBeNull();
    });

    it("refuses to commit the same dry-run twice", async () => {
        const dryRun = await useCase.execute(envelope("commit-twice", "prog-twice"), metadata);
        const commit = { dryRunId: dryRun.dryRunId, approvalToken: dryRun.approvalToken };
        const first = await commitUseCase.execute(commit, metadata);
        for (const session of first.sessions)
            if (session.prescriptionId) createdPrescriptionIds.push(session.prescriptionId);

        await expect(commitUseCase.execute(commit, metadata)).rejects.toBeInstanceOf(DryRunConsumedError);
    });

    it("rejects a commit whose referenced exercise version changed since the dry-run", async () => {
        const dryRun = await useCase.execute(envelope("commit-stale", "prog-stale"), metadata);
        await connection.db.update(exercises).set({ version: 2 }).where(eq(exercises.id, exerciseId));
        try {
            await expect(
                commitUseCase.execute({ dryRunId: dryRun.dryRunId, approvalToken: dryRun.approvalToken }, metadata),
            ).rejects.toBeInstanceOf(DryRunStaleError);
        } finally {
            await connection.db.update(exercises).set({ version: 1 }).where(eq(exercises.id, exerciseId));
        }
        // No program was written and the dry-run stays committable.
        const programRows = await connection.db.select().from(programs).where(eq(programs.id, dryRun.program.id));
        expect(programRows).toHaveLength(0);
        expect((await repository.findById(dryRun.dryRunId))!.consumedAt).toBeNull();
    });

    it("rolls the whole tree back and leaves the dry-run committable when external-id registration conflicts", async () => {
        const dryRun = await useCase.execute(envelope("commit-conflict", "prog-conflict"), metadata);
        // Pre-claim the program's external ID so registration fails after the tree is written.
        await connection.db.insert(bulkExternalIds).values({
            profileId,
            sourceNamespace: "commit-conflict",
            entityType: "program",
            externalId: "prog-conflict",
            entityId: randomUUID(),
        });

        await expect(
            commitUseCase.execute({ dryRunId: dryRun.dryRunId, approvalToken: dryRun.approvalToken }, metadata),
        ).rejects.toMatchObject({ code: "EXTERNAL_ID_CONFLICT" });

        const programRows = await connection.db.select().from(programs).where(eq(programs.id, dryRun.program.id));
        expect(programRows).toHaveLength(0);
        const sessionRows = await connection.db
            .select()
            .from(plannedSessions)
            .where(eq(plannedSessions.id, dryRun.program.sessions[0]!.id));
        expect(sessionRows).toHaveLength(0);
        expect((await repository.findById(dryRun.dryRunId))!.consumedAt).toBeNull();
    });
});
