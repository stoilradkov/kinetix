import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, eq, inArray, sql } from "drizzle-orm";

import {
    createDatabase,
    entityRevisions,
    equipmentTypes,
    exercises,
    movementPatterns,
    prescribedActivities,
    prescribedExercises,
    prescribedRunSteps,
    prescribedRunningActivities,
    prescribedSetGroupMembers,
    prescribedSetGroups,
    prescribedSets,
    prescribedStrengthActivities,
    sessionPrescriptions,
    workoutTemplatePrescriptions,
    workoutTemplates,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    PrescriptionCloner,
    PrescriptionPublisher,
    RepositoryWorkoutTemplatePlanningReader,
    WorkoutTemplateCommands,
    WORKOUT_TEMPLATE_ENTITY_TYPE,
    workoutTemplateSerializer,
    type CreateWorkoutTemplateCommand,
    type WorkoutTemplateDraft,
} from "#src/modules/training/application/index";
import type { ExerciseSnapshotV1 } from "#src/modules/training/domain/index";
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
const metadata: CommandContext = { correlationId: "tmpl-int", source: "user" };

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

function createCommand(prescription: WorkoutTemplateDraft): CreateWorkoutTemplateCommand {
    return { name: "Upper A", prescription };
}

describe.runIf(testDatabaseUrl)("workout template PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const templateRepository = new DrizzleWorkoutTemplateRepository(connection as unknown as DatabaseService);
    const prescriptionRepository = new DrizzleSessionPrescriptionRepository(connection as unknown as DatabaseService);
    const revisions = new DrizzleRevisionStore(connection as unknown as DatabaseService);
    const outbox = new DrizzleOutboxStore(connection as unknown as DatabaseService);
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const mutations = new RevisionMutationService(
        unitOfWork,
        templateRepository,
        revisions,
        workoutTemplateSerializer,
        outbox,
        { now: () => now },
    );
    const publisher = new PrescriptionPublisher({
        unitOfWork,
        repository: prescriptionRepository,
        outbox,
        clock: { now: () => now },
        generateId: randomUUID,
    });
    const cloner = new PrescriptionCloner({
        unitOfWork,
        repository: prescriptionRepository,
        outbox,
        clock: { now: () => now },
        generateId: randomUUID,
    });
    const commands = new WorkoutTemplateCommands({
        unitOfWork,
        repository: templateRepository,
        mutations,
        publisher,
        prescriptions: prescriptionRepository,
        profileReader: { requireActiveProfileId: async () => profileId },
        clock: { now: () => now },
        generateId: randomUUID,
    });
    const planning = new RepositoryWorkoutTemplatePlanningReader(templateRepository, prescriptionRepository, cloner);
    const createdPrescriptionIds: string[] = [];

    beforeAll(async () => {
        await connection.db
            .insert(equipmentTypes)
            .values({ id: equipmentId, slug: `tmpl-eq-${suffix}`, name: `Tmpl Eq ${suffix}`, position: 901 });
        await connection.db
            .insert(movementPatterns)
            .values({ id: movementId, slug: `tmpl-mv-${suffix}`, name: `Tmpl Mv ${suffix}`, position: 901 });
        await connection.db.insert(exercises).values({
            id: exerciseId,
            slug: `tmpl-squat-${suffix}`,
            name: "Tmpl Squat",
            equipmentTypeId: equipmentId,
            movementPatternId: movementId,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "standing",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            position: 901,
        });
    });

    afterAll(async () => {
        try {
            await connection.db
                .delete(entityRevisions)
                .where(eq(entityRevisions.entityType, WORKOUT_TEMPLATE_ENTITY_TYPE));
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
            // Best effort — a non-superuser role may not toggle session_replication_role.
        }
        await connection.client.end({ timeout: 5 });
    });

    it("publishes a template with its prescription, version link, and revision atomically", async () => {
        const created = await commands.create(createCommand(draft(5)), metadata);
        createdPrescriptionIds.push(created.template.currentPrescriptionId);

        const row = (
            await connection.db.select().from(workoutTemplates).where(eq(workoutTemplates.id, created.template.id))
        )[0]!;
        expect(row.version).toBe(1);
        expect(row.currentPrescriptionId).toBe(created.template.currentPrescriptionId);

        const links = await connection.db
            .select()
            .from(workoutTemplatePrescriptions)
            .where(eq(workoutTemplatePrescriptions.templateId, created.template.id));
        expect(links).toEqual([
            expect.objectContaining({ templateVersion: 1, prescriptionId: created.template.currentPrescriptionId }),
        ]);

        const revision = (
            await connection.db
                .select()
                .from(entityRevisions)
                .where(
                    and(
                        eq(entityRevisions.entityType, WORKOUT_TEMPLATE_ENTITY_TYPE),
                        eq(entityRevisions.entityId, created.template.id),
                    ),
                )
        )[0]!;
        expect(revision.version).toBe(1);
    });

    it("edits a template, advancing the version and link log while keeping the earlier prescription stable", async () => {
        const created = await commands.create(createCommand(draft(5)), metadata);
        createdPrescriptionIds.push(created.template.currentPrescriptionId);
        const firstPrescription = await prescriptionRepository.loadTree(created.template.currentPrescriptionId);

        const edited = await commands.update(created.template.id, 1, { prescription: draft(9) }, metadata);
        createdPrescriptionIds.push(edited.template.currentPrescriptionId);
        expect(edited.template.version).toBe(2);
        expect(edited.template.currentPrescriptionId).not.toBe(created.template.currentPrescriptionId);

        const links = await connection.db
            .select()
            .from(workoutTemplatePrescriptions)
            .where(eq(workoutTemplatePrescriptions.templateId, created.template.id))
            .orderBy(workoutTemplatePrescriptions.templateVersion);
        expect(links.map(link => link.templateVersion)).toEqual([1, 2]);

        // The earlier prescription tree is byte-for-byte semantically stable.
        const reloadedFirst = await prescriptionRepository.loadTree(created.template.currentPrescriptionId);
        expect(reloadedFirst).toEqual(firstPrescription);
        expect(reloadedFirst!.activities[0]!.strength!.exercises[0]!.sets[0]!.targets.repsMin).toBe(5);
        expect(edited.prescription.activities[0]!.strength!.exercises[0]!.sets[0]!.targets.repsMin).toBe(9);
    });

    it("rolls back the whole publish when the transaction fails: no template, prescription, or link persists", async () => {
        const created = await commands.create(createCommand(draft(5)), metadata);
        createdPrescriptionIds.push(created.template.currentPrescriptionId);

        let orphanId: string | null = null;
        await expect(
            connection.db.transaction(async tx => {
                const detail = await commands.update(
                    created.template.id,
                    1,
                    { prescription: draft(7) },
                    metadata,
                    tx as never,
                );
                orphanId = detail.template.currentPrescriptionId;
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");

        // The template stays at version 1 pointing at its original prescription; the orphan tree never landed.
        const row = (
            await connection.db.select().from(workoutTemplates).where(eq(workoutTemplates.id, created.template.id))
        )[0]!;
        expect(row.version).toBe(1);
        expect(row.currentPrescriptionId).toBe(created.template.currentPrescriptionId);
        if (orphanId) {
            const orphan = await connection.db
                .select()
                .from(sessionPrescriptions)
                .where(eq(sessionPrescriptions.id, orphanId));
            expect(orphan).toHaveLength(0);
        }
    });

    it("reads a template plus its prescription through the planning port and clones an isolated plan", async () => {
        const created = await commands.create(createCommand(draft(6)), metadata);
        createdPrescriptionIds.push(created.template.currentPrescriptionId);

        const detail = await planning.readForPlanning(created.template.id);
        expect(detail?.prescription.id).toBe(created.template.currentPrescriptionId);

        const planned = await planning.prepareClone(created.template.id, { targetKind: "planned" }, metadata);
        createdPrescriptionIds.push(planned.id);
        expect(planned.sourcePrescriptionId).toBe(created.template.currentPrescriptionId);
        expect(planned.kind).toBe("planned");
    });
});
