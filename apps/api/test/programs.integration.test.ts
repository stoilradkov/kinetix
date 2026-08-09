import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, eq, inArray, sql } from "drizzle-orm";

import {
    createDatabase,
    entityRevisions,
    equipmentTypes,
    exercises,
    movementPatterns,
    plannedSessionBlocks,
    plannedSessionPrescriptions,
    plannedSessions,
    prescribedActivities,
    prescribedExercises,
    prescribedRunSteps,
    prescribedRunningActivities,
    prescribedSetGroupMembers,
    prescribedSetGroups,
    prescribedSets,
    prescribedStrengthActivities,
    programBlocks,
    programPlannedSessions,
    programs,
    sessionMappings,
    sessionPrescriptions,
    trainingSessions,
    workoutTemplatePrescriptions,
    workoutTemplates,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    PLANNED_SESSION_ENTITY_TYPE,
    PROGRAM_ENTITY_TYPE,
    PlannedSessionCommands,
    plannedSessionSerializer,
    PrescriptionCloner,
    PrescriptionPublisher,
    ProgramCommands,
    ProgramQueries,
    programSerializer,
    RepositoryWorkoutTemplatePlanningReader,
    WorkoutTemplateCommands,
    workoutTemplateSerializer,
    type WorkoutTemplateDraft,
} from "#src/modules/training/application/index";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/index";
import { DrizzlePlannedSessionRepository } from "#src/modules/training/infrastructure/drizzle-planned-session-repository";
import { DrizzleProgramMembershipRepository } from "#src/modules/training/infrastructure/drizzle-program-membership-repository";
import { DrizzleProgramGoalValidator } from "#src/modules/training/infrastructure/drizzle-program-goal-validator";
import { DrizzleProgramRepository } from "#src/modules/training/infrastructure/drizzle-program-repository";
import { DrizzleSessionPrescriptionRepository } from "#src/modules/training/infrastructure/drizzle-session-prescription-repository";
import { DrizzleWorkoutTemplateRepository } from "#src/modules/training/infrastructure/drizzle-workout-template-repository";
import { RevisionMutationService, type CommandContext, type UnitOfWork } from "#src/platform/application/index";
import { DrizzleOutboxStore } from "#src/platform/infrastructure/drizzle-outbox-store";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const suffix = randomUUID().slice(0, 8);
const equipmentId = randomUUID();
const movementId = randomUUID();
const exerciseId = randomUUID();
const profileId = randomUUID();
const now = new Date("2026-07-29T10:00:00.000Z");
const metadata: CommandContext = { correlationId: "prog-int", source: "user" };

function snapshot(): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Back Squat",
        equipmentTypeId: equipmentId,
        movementPatternId: movementId,
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
                            exerciseId,
                            snapshot: snapshot(),
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

describe.runIf(testDatabaseUrl)("program PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const programRepository = new DrizzleProgramRepository(db);
    const membership = new DrizzleProgramMembershipRepository(db);
    const goalValidator = new DrizzleProgramGoalValidator(db);
    const templateRepository = new DrizzleWorkoutTemplateRepository(db);
    const sessionRepository = new DrizzlePlannedSessionRepository(db);
    const prescriptionRepository = new DrizzleSessionPrescriptionRepository(db);
    const revisions = new DrizzleRevisionStore(db);
    const outbox = new DrizzleOutboxStore(db);
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const clock = { now: () => now };
    const prescriptionRuntime = {
        unitOfWork,
        repository: prescriptionRepository,
        outbox,
        clock,
        generateId: randomUUID,
    };
    const publisher = new PrescriptionPublisher(prescriptionRuntime);
    const cloner = new PrescriptionCloner(prescriptionRuntime);
    const profileReader = { requireActiveProfileId: async () => profileId };

    const templateCommands = new WorkoutTemplateCommands({
        unitOfWork,
        repository: templateRepository,
        mutations: new RevisionMutationService(
            unitOfWork,
            templateRepository,
            revisions,
            workoutTemplateSerializer,
            outbox,
            clock,
        ),
        publisher,
        prescriptions: prescriptionRepository,
        profileReader,
        clock,
        generateId: randomUUID,
    });
    const planning = new RepositoryWorkoutTemplatePlanningReader(templateRepository, prescriptionRepository, cloner);
    const plannedSessions_ = new PlannedSessionCommands({
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
        plannedSessions: plannedSessions_,
        templates: planning,
        goalValidator,
        profileReader,
        clock,
        generateId: randomUUID,
    });
    const programQueries = new ProgramQueries(programRepository, membership, clock);
    const createdPrescriptionIds: string[] = [];

    beforeAll(async () => {
        await connection.db
            .insert(equipmentTypes)
            .values({ id: equipmentId, slug: `prog-eq-${suffix}`, name: `Prog Eq ${suffix}`, position: 902 });
        await connection.db
            .insert(movementPatterns)
            .values({ id: movementId, slug: `prog-mv-${suffix}`, name: `Prog Mv ${suffix}`, position: 902 });
        await connection.db.insert(exercises).values({
            id: exerciseId,
            slug: `prog-squat-${suffix}`,
            name: "Prog Squat",
            equipmentTypeId: equipmentId,
            movementPatternId: movementId,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "standing",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            position: 902,
        });
    });

    afterAll(async () => {
        try {
            await connection.db
                .delete(entityRevisions)
                .where(inArray(entityRevisions.entityType, [PROGRAM_ENTITY_TYPE, PLANNED_SESSION_ENTITY_TYPE]));
            await connection.db.delete(programs).where(eq(programs.profileId, profileId));
            // Deleting planned/training sessions cascades their session_mappings before the immutable
            // prescriptions those mappings reference are torn down below.
            await connection.db.delete(plannedSessions).where(eq(plannedSessions.profileId, profileId));
            await connection.db.delete(trainingSessions).where(eq(trainingSessions.profileId, profileId));
            await connection.db
                .delete(entityRevisions)
                .where(eq(entityRevisions.entityType, "training.workout-template"));
            await connection.db
                .delete(workoutTemplatePrescriptions)
                .where(inArray(workoutTemplatePrescriptions.prescriptionId, createdPrescriptionIds));
            await connection.db.delete(workoutTemplates).where(eq(workoutTemplates.profileId, profileId));
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
            await connection.db.delete(exercises).where(eq(exercises.id, exerciseId));
            await connection.db.delete(movementPatterns).where(eq(movementPatterns.id, movementId));
            await connection.db.delete(equipmentTypes).where(eq(equipmentTypes.id, equipmentId));
        } catch {
            // Best effort cleanup.
        }
        await connection.client.end({ timeout: 5 });
    });

    it("persists a program with its nested block tree and reloads it bounded", async () => {
        const blockA = randomUUID();
        const blockB = randomUUID();
        const created = await programCommands.create(
            {
                name: `Off-season ${suffix}`,
                scheduleMode: "relative",
                blocks: [
                    { id: blockA, type: "macrocycle", position: 0, tags: ["base"] },
                    { id: blockB, type: "mesocycle", position: 0, parentBlockId: blockA, deload: true },
                ],
            },
            metadata,
        );

        const blockRows = await connection.db
            .select()
            .from(programBlocks)
            .where(eq(programBlocks.programId, created.program.id));
        expect(blockRows).toHaveLength(2);
        const child = blockRows.find(row => row.id === blockB)!;
        expect(child.parentBlockId).toBe(blockA);
        expect(child.deload).toBe(true);

        const reloaded = await programQueries.get(created.program.id);
        expect(reloaded.program.blocks).toHaveLength(2);
        expect(reloaded.program.scheduleMode).toBe("relative");
    });

    it("activates a program, generating a planned session with membership atomically", async () => {
        const template = await templateCommands.create({ name: `Upper ${suffix}`, prescription: draft(5) }, metadata);
        createdPrescriptionIds.push(template.template.currentPrescriptionId);
        const program = await programCommands.create({ name: `Block ${suffix}` }, metadata);

        const activated = await programCommands.activate(
            program.program.id,
            1,
            { sessions: [{ templateId: template.template.id, sequence: 0, localDate: "2026-08-01" }] },
            metadata,
        );
        createdPrescriptionIds.push(activated.generatedSessions[0]!.session.currentPrescriptionId);

        const programRow = (await connection.db.select().from(programs).where(eq(programs.id, program.program.id)))[0]!;
        expect(programRow.status).toBe("active");
        expect(programRow.version).toBe(2);

        const sessionId = activated.generatedSessions[0]!.session.id;
        const link = await connection.db
            .select()
            .from(programPlannedSessions)
            .where(
                and(
                    eq(programPlannedSessions.programId, program.program.id),
                    eq(programPlannedSessions.plannedSessionId, sessionId),
                ),
            );
        expect(link).toHaveLength(1);

        const prescriptionLink = await connection.db
            .select()
            .from(plannedSessionPrescriptions)
            .where(eq(plannedSessionPrescriptions.plannedSessionId, sessionId));
        expect(prescriptionLink).toHaveLength(1);
        // The planned prescription is a distinct immutable clone that retains template lineage.
        expect(prescriptionLink[0]!.prescriptionId).not.toBe(template.template.currentPrescriptionId);
    });

    it("keeps block membership when the program is edited without touching that block", async () => {
        const template = await templateCommands.create({ name: `Blk ${suffix}`, prescription: draft(5) }, metadata);
        createdPrescriptionIds.push(template.template.currentPrescriptionId);
        const blockA = randomUUID();
        const program = await programCommands.create(
            { name: `Scoped ${suffix}`, blocks: [{ id: blockA, type: "mesocycle", position: 0 }] },
            metadata,
        );
        const activated = await programCommands.activate(
            program.program.id,
            1,
            { sessions: [{ templateId: template.template.id, sequence: 0, blockIds: [blockA] }] },
            metadata,
        );
        const sessionId = activated.generatedSessions[0]!.session.id;
        createdPrescriptionIds.push(activated.generatedSessions[0]!.session.currentPrescriptionId);

        const before = await connection.db
            .select()
            .from(plannedSessionBlocks)
            .where(eq(plannedSessionBlocks.plannedSessionId, sessionId));
        expect(before).toHaveLength(1);

        // A metadata-only edit re-saves the unchanged block; membership must survive.
        await programCommands.update(program.program.id, 2, { name: `Renamed ${suffix}` }, metadata);

        const after = await connection.db
            .select()
            .from(plannedSessionBlocks)
            .where(eq(plannedSessionBlocks.plannedSessionId, sessionId));
        expect(after).toHaveLength(1);
        expect(after[0]!.blockId).toBe(blockA);
    });

    it("derives generated-session dates from relative positions on a dated program", async () => {
        const template = await templateCommands.create({ name: `Dated ${suffix}`, prescription: draft(5) }, metadata);
        createdPrescriptionIds.push(template.template.currentPrescriptionId);
        const program = await programCommands.create(
            { name: `Dated program ${suffix}`, scheduleMode: "dated", startDate: "2026-08-03" },
            metadata,
        );
        const activated = await programCommands.activate(
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
        for (const generated of activated.generatedSessions)
            createdPrescriptionIds.push(generated.session.currentPrescriptionId);

        const rows = await connection.db
            .select({ id: plannedSessions.id, localDate: plannedSessions.localDate })
            .from(plannedSessions)
            .where(
                inArray(
                    plannedSessions.id,
                    activated.generatedSessions.map(generated => generated.session.id),
                ),
            );
        const dateById = new Map(rows.map(row => [row.id, row.localDate]));
        expect(dateById.get(activated.generatedSessions[0]!.session.id)).toBe("2026-08-03");
        expect(dateById.get(activated.generatedSessions[1]!.session.id)).toBe("2026-08-12");
    });

    it("moves only incomplete future sessions when the start date changes, persisting the shift", async () => {
        const template = await templateCommands.create({ name: `Shift ${suffix}`, prescription: draft(5) }, metadata);
        createdPrescriptionIds.push(template.template.currentPrescriptionId);
        const program = await programCommands.create(
            { name: `Shift program ${suffix}`, scheduleMode: "dated", startDate: "2026-07-27" },
            metadata,
        );
        const activated = await programCommands.activate(
            program.program.id,
            1,
            {
                sessions: [
                    { templateId: template.template.id, sequence: 0, localDate: "2026-07-20" }, // overdue vs 2026-07-29
                    { templateId: template.template.id, sequence: 1, localDate: "2026-08-05" }, // future
                ],
            },
            metadata,
        );
        const [overdue, future] = activated.generatedSessions;
        for (const generated of activated.generatedSessions)
            createdPrescriptionIds.push(generated.session.currentPrescriptionId);

        const changed = await programCommands.changeStartDate(
            program.program.id,
            2,
            { startDate: "2026-08-01" },
            metadata,
        );
        expect(changed.movedSessions).toEqual([
            { id: future!.session.id, fromDate: "2026-08-05", toDate: "2026-08-10" },
        ]);

        const rows = await connection.db
            .select({ id: plannedSessions.id, localDate: plannedSessions.localDate })
            .from(plannedSessions)
            .where(inArray(plannedSessions.id, [overdue!.session.id, future!.session.id]));
        const dateById = new Map(rows.map(row => [row.id, row.localDate]));
        expect(dateById.get(overdue!.session.id)).toBe("2026-07-20");
        expect(dateById.get(future!.session.id)).toBe("2026-08-10");
    });

    it("surfaces cross-program schedule collisions as warnings from the get query", async () => {
        const template = await templateCommands.create({ name: `Coll ${suffix}`, prescription: draft(5) }, metadata);
        createdPrescriptionIds.push(template.template.currentPrescriptionId);
        const slotDate = "2026-09-01";
        const programA = await programCommands.create({ name: `Coll A ${suffix}` }, metadata);
        const programB = await programCommands.create({ name: `Coll B ${suffix}` }, metadata);
        for (const program of [programA, programB]) {
            const activated = await programCommands.activate(
                program.program.id,
                1,
                {
                    sessions: [
                        { templateId: template.template.id, sequence: 0, localDate: slotDate, preferredTime: "08:00" },
                    ],
                },
                metadata,
            );
            createdPrescriptionIds.push(activated.generatedSessions[0]!.session.currentPrescriptionId);
        }

        const detail = await programQueries.get(programA.program.id);
        expect(detail.warnings.some(warning => warning.code === "schedule_collision")).toBe(true);
    });

    it("resolves each planned session's forward link to the latest non-archived performed session", async () => {
        const template = await templateCommands.create({ name: `Fwd ${suffix}`, prescription: draft(5) }, metadata);
        createdPrescriptionIds.push(template.template.currentPrescriptionId);
        const program = await programCommands.create({ name: `Fwd program ${suffix}` }, metadata);
        const activated = await programCommands.activate(
            program.program.id,
            1,
            {
                sessions: [
                    { templateId: template.template.id, sequence: 0, localDate: "2026-08-01" },
                    { templateId: template.template.id, sequence: 1, localDate: "2026-08-08" },
                ],
            },
            metadata,
        );
        const [linked, unlinked] = activated.generatedSessions;
        for (const generated of activated.generatedSessions)
            createdPrescriptionIds.push(generated.session.currentPrescriptionId);
        const prescriptionId = linked!.session.currentPrescriptionId;

        // Two actuals map to the first planned session: an older archived attempt, then a newer live one.
        const archivedActual = randomUUID();
        const liveActual = randomUUID();
        await connection.db.insert(trainingSessions).values([
            {
                id: archivedActual,
                profileId,
                status: "completed",
                localDate: "2026-08-01",
                timeZone: "UTC",
                startedAt: new Date("2026-08-01T10:00:00Z"),
                endedAt: new Date("2026-08-01T11:00:00Z"),
                archivedAt: new Date("2026-08-02T00:00:00Z"),
            },
            {
                id: liveActual,
                profileId,
                status: "completed",
                localDate: "2026-08-01",
                timeZone: "UTC",
                startedAt: new Date("2026-08-03T10:00:00Z"),
                endedAt: new Date("2026-08-03T11:00:00Z"),
            },
        ]);
        await connection.db.insert(sessionMappings).values([
            {
                sessionId: archivedActual,
                plannedSessionId: linked!.session.id,
                sourcePrescriptionId: prescriptionId,
                resolvedPrescriptionId: prescriptionId,
                createdAt: new Date("2026-08-01T11:00:00Z"),
            },
            {
                sessionId: liveActual,
                plannedSessionId: linked!.session.id,
                sourcePrescriptionId: prescriptionId,
                resolvedPrescriptionId: prescriptionId,
                createdAt: new Date("2026-08-03T11:00:00Z"),
            },
        ]);

        const sessions = await programQueries.sessions(program.program.id);
        const linkedView = sessions.find(session => session.plannedSessionId === linked!.session.id)!;
        const unlinkedView = sessions.find(session => session.plannedSessionId === unlinked!.session.id)!;
        // Live attempt wins over the archived one; the unmapped planned session has no forward link.
        expect(linkedView.actualSessionId).toBe(liveActual);
        expect(linkedView.actualSessionStatus).toBe("completed");
        expect(unlinkedView.actualSessionId).toBeNull();
        expect(unlinkedView.actualSessionStatus).toBeNull();
    });

    it("still resolves the forward link when the only performed session is archived", async () => {
        const template = await templateCommands.create({ name: `Arch ${suffix}`, prescription: draft(5) }, metadata);
        createdPrescriptionIds.push(template.template.currentPrescriptionId);
        const program = await programCommands.create({ name: `Arch program ${suffix}` }, metadata);
        const activated = await programCommands.activate(
            program.program.id,
            1,
            { sessions: [{ templateId: template.template.id, sequence: 0, localDate: "2026-08-01" }] },
            metadata,
        );
        const planned = activated.generatedSessions[0]!;
        createdPrescriptionIds.push(planned.session.currentPrescriptionId);

        const archivedActual = randomUUID();
        await connection.db.insert(trainingSessions).values({
            id: archivedActual,
            profileId,
            status: "completed",
            localDate: "2026-08-01",
            timeZone: "UTC",
            startedAt: new Date("2026-08-01T10:00:00Z"),
            endedAt: new Date("2026-08-01T11:00:00Z"),
            archivedAt: new Date("2026-08-02T00:00:00Z"),
        });
        await connection.db.insert(sessionMappings).values({
            sessionId: archivedActual,
            plannedSessionId: planned.session.id,
            sourcePrescriptionId: planned.session.currentPrescriptionId,
            resolvedPrescriptionId: planned.session.currentPrescriptionId,
            createdAt: new Date("2026-08-01T11:00:00Z"),
        });

        const sessions = await programQueries.sessions(program.program.id);
        const view = sessions.find(session => session.plannedSessionId === planned.session.id)!;
        expect(view.actualSessionId).toBe(archivedActual);
        expect(view.actualSessionStatus).toBe("completed");
    });

    it("rolls back a failed activation, leaving the program in its prior state", async () => {
        const program = await programCommands.create({ name: `Rollback ${suffix}` }, metadata);
        await expect(
            programCommands.activate(
                program.program.id,
                1,
                { sessions: [{ templateId: randomUUID(), sequence: 0 }] },
                metadata,
            ),
        ).rejects.toThrow();

        const row = (await connection.db.select().from(programs).where(eq(programs.id, program.program.id)))[0]!;
        expect(row.status).toBe("draft");
        expect(row.version).toBe(1);
        expect(await connection.db.select().from(plannedSessionBlocks)).toBeDefined();
    });
});
