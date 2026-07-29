import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, inArray, sql } from "drizzle-orm";

import {
    createDatabase,
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
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { PrescriptionCloner, PrescriptionPublisher } from "#src/modules/training/application/index";
import {
    SessionPrescription,
    type ExerciseSnapshotV1,
    type IdMinter,
    type PublishPrescriptionDraft,
} from "#src/modules/training/domain/index";
import { DrizzleSessionPrescriptionRepository } from "#src/modules/training/infrastructure/drizzle-session-prescription-repository";
import type { CommandContext, OutboxWriter, UnitOfWork } from "#src/platform/application/index";
import type { DomainEvent } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const suffix = randomUUID().slice(0, 8);
const equipmentId = randomUUID();
const movementId = randomUUID();
const exerciseAId = randomUUID();
const exerciseBId = randomUUID();
const now = new Date("2026-07-29T10:00:00.000Z");
const metadata: CommandContext = { correlationId: "presc-int", source: "user" };

function minter(): IdMinter {
    return { rowId: () => randomUUID(), logicalKey: () => randomUUID() };
}

function snapshot(exerciseId: string, name: string): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name,
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

/** Mixed tree: a superset strength activity plus a running activity with a repeat block. */
function mixedDraft(kind: PublishPrescriptionDraft["kind"] = "template"): PublishPrescriptionDraft {
    return {
        kind,
        expectedDurationMs: 3_600_000,
        activities: [
            {
                ref: "strength",
                type: "strength",
                position: 0,
                strength: {
                    exercises: [
                        {
                            ref: "ex-a",
                            exerciseId: exerciseAId,
                            snapshot: snapshot(exerciseAId, "Back Squat"),
                            position: 0,
                            sets: [
                                {
                                    ref: "sa",
                                    position: 0,
                                    setType: "working",
                                    setGroupRef: "grp",
                                    targets: { repsMin: 8, repsMax: 8, loadKgMin: "100", loadKgMax: "100" },
                                },
                            ],
                        },
                        {
                            ref: "ex-b",
                            exerciseId: exerciseBId,
                            snapshot: snapshot(exerciseBId, "Bench Press"),
                            position: 1,
                            sets: [
                                {
                                    ref: "sb",
                                    position: 0,
                                    setType: "working",
                                    setGroupRef: "grp",
                                    targets: { repsMin: 8, repsMax: 8, percent1rm: "75" },
                                },
                            ],
                        },
                    ],
                    setGroups: [
                        {
                            ref: "grp",
                            type: "superset",
                            position: 0,
                            rounds: 3,
                            members: [
                                { exerciseRef: "ex-a", position: 0 },
                                { exerciseRef: "ex-b", position: 1 },
                            ],
                        },
                    ],
                },
            },
            {
                ref: "run",
                type: "running",
                position: 1,
                running: {
                    runTags: ["intervals"],
                    overallTargets: { distanceMMin: "5000", distanceMMax: "5000" },
                    steps: [
                        {
                            ref: "warm",
                            type: "warm_up",
                            position: 0,
                            targets: { durationMsMin: 600000, durationMsMax: 600000 },
                        },
                        { ref: "rep", type: "repeat", position: 1, repeatCount: 4 },
                        {
                            ref: "work",
                            type: "work",
                            position: 0,
                            parentStepRef: "rep",
                            targets: { distanceMMin: "400", distanceMMax: "400" },
                        },
                        {
                            ref: "rec",
                            type: "recovery",
                            position: 1,
                            parentStepRef: "rep",
                            targets: { durationMsMin: 90000, durationMsMax: 90000 },
                        },
                    ],
                },
            },
        ],
    };
}

describe.runIf(testDatabaseUrl)("session prescription PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleSessionPrescriptionRepository(connection as unknown as DatabaseService);
    const createdPrescriptionIds: string[] = [];

    class FakeOutbox implements OutboxWriter {
        readonly values: DomainEvent[] = [];
        async publish(events: readonly DomainEvent[]): Promise<void> {
            this.values.push(...events);
        }
    }
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const outbox = new FakeOutbox();
    const publisher = new PrescriptionPublisher({
        unitOfWork,
        repository,
        outbox,
        clock: { now: () => now },
        generateId: randomUUID,
    });
    const cloner = new PrescriptionCloner({
        unitOfWork,
        repository,
        outbox,
        clock: { now: () => now },
        generateId: randomUUID,
    });

    async function track<T extends { id: string }>(promise: Promise<T>): Promise<T> {
        const result = await promise;
        createdPrescriptionIds.push(result.id);
        return result;
    }

    beforeAll(async () => {
        await connection.db
            .insert(equipmentTypes)
            .values({ id: equipmentId, slug: `test-presc-eq-${suffix}`, name: `Presc Eq ${suffix}`, position: 900 });
        await connection.db
            .insert(movementPatterns)
            .values({ id: movementId, slug: `test-presc-mv-${suffix}`, name: `Presc Mv ${suffix}`, position: 900 });
        for (const [id, slug, name] of [
            [exerciseAId, `test-presc-squat-${suffix}`, "Presc Squat"],
            [exerciseBId, `test-presc-bench-${suffix}`, "Presc Bench"],
        ] as const)
            await connection.db.insert(exercises).values({
                id,
                slug,
                name,
                equipmentTypeId: equipmentId,
                movementPatternId: movementId,
                classification: "compound",
                laterality: "bilateral",
                bodyPosition: "standing",
                repetitionSemantics: "total",
                loadModel: "external_only",
                supportedMeasurements: ["repetitions", "external_load"],
                position: 900,
            });
    });

    afterAll(async () => {
        // Prescription rows are immutable; disable triggers to clean up test data best-effort.
        try {
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
            await connection.db.delete(exercises).where(inArray(exercises.id, [exerciseAId, exerciseBId]));
            await connection.db.delete(movementPatterns).where(eq(movementPatterns.id, movementId));
            await connection.db.delete(equipmentTypes).where(eq(equipmentTypes.id, equipmentId));
        } catch {
            // Best effort — a non-superuser role may not toggle session_replication_role.
        }
        await connection.client.end({ timeout: 5 });
    });

    it("inserts a mixed tree and loads it back with ordering and logical-key references", async () => {
        const published = await track(publisher.publish({ draft: mixedDraft() }, metadata));

        const loaded = (await repository.loadTree(published.id))!;
        expect(loaded.expectedDurationMs).toBe(3_600_000);
        expect(loaded.activities.map(activity => activity.type)).toEqual(["strength", "running"]);

        const strength = loaded.activities[0]!.strength!;
        expect(strength.exercises.map(exercise => exercise.position)).toEqual([0, 1]);
        const group = strength.setGroups[0]!;
        expect(group.type).toBe("superset");
        expect(group.members.map(member => member.exerciseLogicalKey)).toEqual(
            strength.exercises.map(exercise => exercise.logicalKey),
        );
        // set → group references survive the row-id/logical-key round trip.
        for (const exercise of strength.exercises) expect(exercise.sets[0]!.setGroupLogicalKey).toBe(group.logicalKey);
        expect(strength.exercises[0]!.sets[0]!.targets.loadKgMin).toBe("100");
        expect(strength.exercises[1]!.sets[0]!.targets.percent1rm).toBe("75");

        const running = loaded.activities[1]!.running!;
        expect(running.runTags).toEqual(["intervals"]);
        const repeat = running.steps.find(step => step.type === "repeat")!;
        expect(repeat.repeatCount).toBe(4);
        const children = running.steps.filter(step => step.parentStepLogicalKey === repeat.logicalKey);
        expect(children.map(step => step.type).sort()).toEqual(["recovery", "work"]);
    });

    it("rejects UPDATE and DELETE of published rows via the immutability triggers", async () => {
        const published = await track(publisher.publish({ draft: mixedDraft() }, metadata));
        const anExercise = (
            await connection.db
                .select()
                .from(prescribedExercises)
                .where(eq(prescribedExercises.prescriptionId, published.id))
        )[0]!;

        await expect(
            connection.db
                .update(sessionPrescriptions)
                .set({ notes: "x" })
                .where(eq(sessionPrescriptions.id, published.id)),
        ).rejects.toThrow();
        await expect(
            connection.db
                .update(prescribedExercises)
                .set({ purpose: "x" })
                .where(eq(prescribedExercises.id, anExercise.id)),
        ).rejects.toThrow();
        await expect(
            connection.db.delete(prescribedExercises).where(eq(prescribedExercises.id, anExercise.id)),
        ).rejects.toThrow();
        await expect(
            connection.db.delete(sessionPrescriptions).where(eq(sessionPrescriptions.id, published.id)),
        ).rejects.toThrow();
    });

    it("preserves source lineage columns after cloning template → planned", async () => {
        const template = await track(publisher.publish({ draft: mixedDraft("template") }, metadata));
        const planned = await track(
            cloner.clone({ sourcePrescriptionId: template.id, targetKind: "planned" }, metadata),
        );

        const root = (
            await connection.db.select().from(sessionPrescriptions).where(eq(sessionPrescriptions.id, planned.id))
        )[0]!;
        expect(root.kind).toBe("planned");
        expect(root.sourcePrescriptionId).toBe(template.id);
        expect(root.sourceKind).toBe("template");

        const plannedExercises = await connection.db
            .select()
            .from(prescribedExercises)
            .where(eq(prescribedExercises.prescriptionId, planned.id));
        expect(plannedExercises).toHaveLength(2);
        for (const exercise of plannedExercises) {
            expect(exercise.sourceRowId).not.toBeNull();
            expect(exercise.sourceLogicalKey).not.toBeNull();
        }
    });

    it("rejects a reversed target range via a database check constraint", async () => {
        const published = await track(publisher.publish({ draft: mixedDraft() }, metadata));
        await expect(
            connection.db.insert(prescribedSets).values({
                prescriptionId: published.id,
                logicalKey: randomUUID(),
                exerciseId: (
                    await connection.db
                        .select()
                        .from(prescribedExercises)
                        .where(eq(prescribedExercises.prescriptionId, published.id))
                )[0]!.id,
                position: 99,
                setType: "working",
                repsMin: 10,
                repsMax: 5,
            }),
        ).rejects.toThrow();
    });

    it("rolls back a failed publish transaction leaving no rows", async () => {
        const draft = mixedDraft();
        const built = SessionPrescription.publishDraft(draft, minter(), now).state;
        await expect(
            connection.db.transaction(async tx => {
                await repository.insertTree(built, tx);
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        const rows = await connection.db
            .select()
            .from(sessionPrescriptions)
            .where(eq(sessionPrescriptions.id, built.id));
        expect(rows).toHaveLength(0);
    });
});
