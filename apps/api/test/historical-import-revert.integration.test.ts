import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, inArray, sql } from "drizzle-orm";

import {
    bulkExternalIds,
    createDatabase,
    entityRevisions,
    equipmentTypes,
    exerciseAliases,
    exerciseExternalIds,
    exerciseMuscles,
    exercises,
    historicalImportCommits,
    historicalImportDryRuns,
    historicalImportReverts,
    importBatches,
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
    programs,
    sessionPrescriptions,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    BulkCatalogResolver,
    CommitHistoricalImport,
    HistoricalImportCommitQueryService,
    HistoricalImportDryRun,
    PlannedSessionCommands,
    PrescriptionPublisher,
    ProgramCommands,
    ReconcileImportStorage,
    RegisterImportBatch,
    RevertHistoricalImport,
    TrainingExerciseCatalog,
    plannedSessionSerializer,
    programSerializer,
    PLANNED_SESSION_ENTITY_TYPE,
    PROGRAM_ENTITY_TYPE,
    type ExerciseCatalogCommands,
    type HistoricalImportEnvelopeInput,
    type TrainingSessionCommands,
} from "#src/modules/training/application/index";
import { ImportRevertBlockedError } from "#src/platform/application/index";
import { DrizzleBulkExternalIdRegistry } from "#src/modules/training/infrastructure/drizzle-bulk-external-id-registry";
import { DrizzleExerciseExternalIdResolver } from "#src/modules/training/infrastructure/drizzle-exercise-external-id-resolver";
import { DrizzleExerciseSlugResolver } from "#src/modules/training/infrastructure/drizzle-exercise-slug-resolver";
import { DrizzleHistoricalImportCommitRepository } from "#src/modules/training/infrastructure/drizzle-historical-import-commit-repository";
import { DrizzleHistoricalImportDryRunRepository } from "#src/modules/training/infrastructure/drizzle-historical-import-dry-run-repository";
import { DrizzleHistoricalImportEntityInspector } from "#src/modules/training/infrastructure/drizzle-historical-import-entity-inspector";
import { DrizzleHistoricalImportRevertRepository } from "#src/modules/training/infrastructure/drizzle-historical-import-revert-repository";
import { DrizzleImportBatchRepository } from "#src/modules/training/infrastructure/drizzle-import-batch-repository";
import { DrizzleImportStorageReadPort } from "#src/modules/training/infrastructure/drizzle-import-storage-read-port";
import { DrizzlePlannedSessionRepository } from "#src/modules/training/infrastructure/drizzle-planned-session-repository";
import { DrizzleProgramMembershipRepository } from "#src/modules/training/infrastructure/drizzle-program-membership-repository";
import { DrizzleProgramRepository } from "#src/modules/training/infrastructure/drizzle-program-repository";
import { DrizzleSessionPrescriptionRepository } from "#src/modules/training/infrastructure/drizzle-session-prescription-repository";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { DrizzleOutboxStore } from "#src/platform/infrastructure/drizzle-outbox-store";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";
import { RevisionMutationService, type CommandContext, type UnitOfWork } from "#src/platform/application/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const suffix = randomUUID().slice(0, 8);
const profileId = randomUUID();
const muscleId = randomUUID();
const equipmentId = randomUUID();
const movementId = randomUUID();
const exerciseId = randomUUID();
const now = new Date("2026-08-09T10:00:00.000Z");
const namespace = `revert-${suffix}`;
const metadata: CommandContext = { correlationId: "hi6-int", source: "agent" };

function program(externalId: string) {
    return {
        externalId,
        name: `Program ${externalId}`,
        scheduleMode: "dated" as const,
        startDate: "2026-09-07",
        blocks: [{ externalId: `${externalId}-meso`, type: "mesocycle" as const, position: 0, relativeStartWeek: 0 }],
        sessions: [
            {
                externalId: `${externalId}-sess`,
                title: "Squat Day",
                sequence: 0,
                relativeWeek: 0,
                relativeDay: 0,
                blockExternalIds: [`${externalId}-meso`],
                prescription: {
                    activities: [
                        {
                            type: "strength" as const,
                            position: 0,
                            exercises: [
                                {
                                    ref: "ex-1",
                                    reference: {
                                        by: "externalId" as const,
                                        provider: "hevy",
                                        externalId: `sq-${suffix}`,
                                    },
                                    position: 0,
                                    sets: [
                                        {
                                            position: 0,
                                            setType: "working" as const,
                                            targets: {
                                                repsMin: 5,
                                                repsMax: 5,
                                                loadMin: { value: 225, unit: "lb" as const },
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
    };
}

function envelope(payloadId: string, externalIds: string[]): HistoricalImportEnvelopeInput {
    return {
        schemaVersion: 1,
        source: { namespace, payloadId, checksum: "a".repeat(64) },
        mode: "create",
        programs: externalIds.map(program),
    } as unknown as HistoricalImportEnvelopeInput;
}

describe.runIf(testDatabaseUrl)("historical import revert PostgreSQL compensation (HI6)", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const clock = { now: () => now };
    const profileReader = { requireActiveProfileId: async () => profileId };

    const catalogRepository = new DrizzleTrainingCatalogRepository(db);
    const revisions = new DrizzleRevisionStore(db);
    const catalog = new TrainingExerciseCatalog(catalogRepository, revisions);
    const externalIdResolver = new DrizzleExerciseExternalIdResolver(db);
    const resolver = new BulkCatalogResolver(catalog, externalIdResolver);
    const outbox = new DrizzleOutboxStore(db);

    const dryRunRepository = new DrizzleHistoricalImportDryRunRepository(db);
    const commitRepository = new DrizzleHistoricalImportCommitRepository(db);
    const revertRepository = new DrizzleHistoricalImportRevertRepository(db);
    const inspector = new DrizzleHistoricalImportEntityInspector(db);
    const externalIds = new DrizzleBulkExternalIdRegistry(db);
    const reconcile = new ReconcileImportStorage({ readPort: new DrizzleImportStorageReadPort(db) });
    const importBatchRepository = new DrizzleImportBatchRepository(db);
    const registerImportBatch = new RegisterImportBatch({
        unitOfWork,
        repository: importBatchRepository,
        profileReader,
        generateId: randomUUID,
    });

    const programRepository = new DrizzleProgramRepository(db);
    const membership = new DrizzleProgramMembershipRepository(db);
    const sessionRepository = new DrizzlePlannedSessionRepository(db);
    const prescriptionRepository = new DrizzleSessionPrescriptionRepository(db);
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
        templates: undefined as never,
        goalValidator: { assertGoalsExist: async () => {} },
        profileReader,
        clock,
        generateId: randomUUID,
    });
    const exercises_ = { create: async () => ({}) } as unknown as ExerciseCatalogCommands;
    const trainingSessions = {
        commitPreparedState: async () => {
            throw new Error("no completed sessions in these fixtures");
        },
        archive: async () => {
            throw new Error("no completed sessions to archive in these fixtures");
        },
    } as unknown as TrainingSessionCommands;

    const dryRun = new HistoricalImportDryRun({
        unitOfWork,
        repository: dryRunRepository,
        reconcile,
        resolver,
        slugResolver: new DrizzleExerciseSlugResolver(db),
        profileReader,
        clock,
        generateId: randomUUID,
    });
    const commit = new CommitHistoricalImport({
        unitOfWork,
        dryRuns: dryRunRepository,
        commits: commitRepository,
        externalIds,
        importBatches: registerImportBatch,
        catalog,
        exercises: exercises_,
        programCommands,
        plannedSessions: plannedSessionCommands,
        publisher,
        membership,
        trainingSessions,
        profileReader,
        clock,
        generateId: randomUUID,
    });
    const revert = new RevertHistoricalImport({
        unitOfWork,
        commits: commitRepository,
        reverts: revertRepository,
        externalIds,
        inspector,
        programCommands,
        plannedSessions: plannedSessionCommands,
        trainingSessions,
        profileReader,
        clock,
        generateId: randomUUID,
    });
    const query = new HistoricalImportCommitQueryService({
        commits: commitRepository,
        dryRuns: dryRunRepository,
        reverts: revertRepository,
        externalIds,
        inspector,
        profileReader,
    });

    const createdPrescriptionIds: string[] = [];

    async function commitProgram(payloadId: string, externalId: string): Promise<string> {
        const preview = await dryRun.execute(envelope(payloadId, [externalId]), metadata);
        expect(preview.state).toBe("ready");
        const result = await commit.execute(
            { dryRunId: preview.dryRunId, approvalToken: preview.approvalToken },
            metadata,
        );
        for (const session of preview.programs.flatMap(p => p.sessions))
            if (session.prescription) createdPrescriptionIds.push(session.prescription.id);
        expect(result.state).toBe("succeeded");
        return result.commitId;
    }

    beforeAll(async () => {
        await connection.db
            .insert(muscleGroups)
            .values({ id: muscleId, slug: `quads-${suffix}`, name: `Quads ${suffix}`, position: 0, isSeeded: true });
        await connection.db
            .insert(equipmentTypes)
            .values({
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
        await connection.db.insert(exerciseMuscles).values({ exerciseId, muscleGroupId: muscleId, role: "primary" });
        await connection.db
            .insert(exerciseExternalIds)
            .values({ exerciseId, provider: "hevy", externalId: `sq-${suffix}` });
    });

    afterAll(async () => {
        try {
            await connection.db.delete(historicalImportReverts).where(eq(historicalImportReverts.profileId, profileId));
            await connection.db.delete(historicalImportCommits).where(eq(historicalImportCommits.profileId, profileId));
            await connection.db.delete(historicalImportDryRuns).where(eq(historicalImportDryRuns.profileId, profileId));
            await connection.db.delete(importBatches).where(eq(importBatches.profileId, profileId));
            await connection.db
                .delete(entityRevisions)
                .where(inArray(entityRevisions.entityType, [PROGRAM_ENTITY_TYPE, PLANNED_SESSION_ENTITY_TYPE]));
            await connection.db.delete(programs).where(eq(programs.profileId, profileId));
            await connection.db.delete(plannedSessions).where(eq(plannedSessions.profileId, profileId));
            await connection.db.delete(bulkExternalIds).where(eq(bulkExternalIds.profileId, profileId));
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

    it("reverts a committed import by archiving its program and planned session, and records a durable run", async () => {
        const commitId = await commitProgram("revert-1", "r1");

        const result = await revert.execute(commitId, metadata);
        expect(result.state).toBe("succeeded");
        expect(result.counts.archived).toBe(2); // program + planned-session (block is a child of the program)
        expect(result.counts.blocked).toBe(0);

        const programRows = await connection.db.select().from(programs).where(eq(programs.name, "Program r1"));
        expect(programRows).toHaveLength(1);
        expect(programRows[0]!.archivedAt).not.toBeNull();
        expect(programRows[0]!.status).toBe("archived");

        const sessionRows = await connection.db
            .select()
            .from(plannedSessions)
            .where(eq(plannedSessions.profileId, profileId));
        expect(sessionRows.every(row => row.archivedAt !== null)).toBe(true);

        // The revert run is durable and readable, and the audit report reflects the archival + revert.
        const status = await query.revertStatus(commitId);
        expect(status.state).toBe("succeeded");
        const report = await query.report(commitId);
        expect(report.revert?.state).toBe("succeeded");
        expect(report.entities.filter(entity => entity.archived).length).toBeGreaterThanOrEqual(2);
    });

    it("replays a succeeded revert without archiving again (idempotent)", async () => {
        const commitId = await commitProgram("revert-1b", "r2");
        const first = await revert.execute(commitId, metadata);
        const second = await revert.execute(commitId, metadata);
        expect(second.revertId).toBe(first.revertId);
        expect(second.state).toBe("succeeded");
    });

    it("refuses the whole revert and archives nothing when a program was edited after import", async () => {
        const commitId = await commitProgram("revert-2", "r3");

        // Simulate a post-import user edit by bumping the program's version out-of-band (archivedAt stays null).
        await connection.db.update(programs).set({ version: 2 }).where(eq(programs.name, "Program r3"));

        const failure = await revert
            .execute(commitId, metadata)
            .then(() => null)
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ImportRevertBlockedError);

        // The edited program is NOT archived — the revert is history-preserving and refuses to overwrite it.
        const programRows = await connection.db.select().from(programs).where(eq(programs.name, "Program r3"));
        expect(programRows[0]!.archivedAt).toBeNull();

        const status = await query.revertStatus(commitId);
        expect(status.state).toBe("blocked");
        expect(status.blockedEntities.length).toBeGreaterThanOrEqual(1);
        expect(status.counts.archived).toBe(0);
    });
});
