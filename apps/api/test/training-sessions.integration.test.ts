import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, eq, inArray } from "drizzle-orm";

import {
    activityMappings,
    createDatabase,
    entityRevisions,
    equipmentTypes,
    exercises,
    exerciseOccurrences,
    movementPatterns,
    painRecords,
    performedSets,
    plannedSessions,
    prescribedActivities,
    prescribedExercises,
    prescribedSets,
    prescribedStrengthActivities,
    sessionActivities,
    sessionMappings,
    sessionPrescriptions,
    setGroupMembers,
    setGroups,
    setMappings,
    trainingSessions,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    TRAINING_SESSION_ENTITY_TYPE,
    TrainingSessionCommands,
    trainingSessionSerializer,
} from "#src/modules/training/application/index";
import { TrainingSession, type ExerciseSnapshotV1 } from "#src/modules/training/domain/index";
import { DrizzleTrainingSessionRepository } from "#src/modules/training/infrastructure/drizzle-training-session-repository";
import { RevisionMutationService, type CommandContext, type UnitOfWork } from "#src/platform/application/index";
import { DrizzleOutboxStore } from "#src/platform/infrastructure/drizzle-outbox-store";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const profileId = randomUUID();
const now = new Date("2026-08-02T09:00:00.000Z");
const later = new Date("2026-08-02T10:30:00.000Z");
const metadata: CommandContext = { correlationId: "session-int", source: "user" };

const equipmentId = randomUUID();
const movementId = randomUUID();
const benchId = randomUUID();
const rowId = randomUUID();

// Seeded immutable prescription + planned session used by the mapping round-trip test.
const mappingRxId = randomUUID();
const mappingPlannedId = randomUUID();
const mappingActivityRowId = randomUUID();
const mappingExerciseRowId = randomUUID();
const mappingSetRowId = randomUUID();

function snapshotFor(exerciseId: string, name: string): ExerciseSnapshotV1 {
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
        supportedMeasurements: ["repetitions", "external_load", "duration"],
        muscles: [],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
    };
}

const strengthCatalog = {
    resolveCurrentExercise: async (id: string) => ({
        requestedExerciseId: id,
        resolvedExerciseId: id,
        redirected: false,
        exercise: { id, status: "active" as const, version: 1 } as never,
    }),
    currentSnapshot: async (id: string) => snapshotFor(id, id === benchId ? "Bench Press" : "Barbell Row"),
};

describe.runIf(testDatabaseUrl)("training session PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const repository = new DrizzleTrainingSessionRepository(db);
    const revisions = new DrizzleRevisionStore(db);
    const outbox = new DrizzleOutboxStore(db);
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const clock = { now: () => now };
    const profileReader = {
        getActiveProfile: async () => ({
            id: profileId,
            timeZone: "Europe/Sofia",
            unitPreferences: { mass: "kg", distance: "km", height: "cm" } as never,
            birthDate: null,
            sex: null,
            heightMeters: null,
            version: 1,
        }),
    };
    const commands = new TrainingSessionCommands({
        unitOfWork,
        repository,
        mutations: new RevisionMutationService(
            unitOfWork,
            repository,
            revisions,
            trainingSessionSerializer,
            outbox,
            clock,
        ),
        profileReader,
        catalog: strengthCatalog,
        clock,
        generateId: randomUUID,
    });

    beforeAll(async () => {
        await connection.db
            .insert(equipmentTypes)
            .values({
                id: equipmentId,
                slug: `eq-${equipmentId.slice(0, 8)}`,
                name: `Equip ${equipmentId.slice(0, 8)}`,
                position: 0,
            })
            .onConflictDoNothing();
        await connection.db
            .insert(movementPatterns)
            .values({
                id: movementId,
                slug: `mp-${movementId.slice(0, 8)}`,
                name: `Pattern ${movementId.slice(0, 8)}`,
                position: 0,
            })
            .onConflictDoNothing();
        for (const [id, slug, name] of [
            [benchId, `bench-${benchId.slice(0, 8)}`, "Bench Press"],
            [rowId, `row-${rowId.slice(0, 8)}`, "Barbell Row"],
        ] as const)
            await connection.db
                .insert(exercises)
                .values({
                    id,
                    slug,
                    name,
                    status: "active",
                    equipmentTypeId: equipmentId,
                    movementPatternId: movementId,
                    classification: "compound",
                    laterality: "bilateral",
                    bodyPosition: "standing",
                    repetitionSemantics: "total",
                    loadModel: "external_only",
                    supportedMeasurements: ["repetitions", "external_load", "duration"],
                    position: 0,
                })
                .onConflictDoNothing();
    });

    afterAll(async () => {
        try {
            const rows = await connection.db
                .select({ id: trainingSessions.id })
                .from(trainingSessions)
                .where(eq(trainingSessions.profileId, profileId));
            const ids = rows.map(row => row.id);
            if (ids.length > 0) {
                await connection.db.delete(painRecords).where(inArray(painRecords.sessionId, ids));
                await connection.db.delete(sessionActivities).where(inArray(sessionActivities.sessionId, ids));
                await connection.db.delete(entityRevisions).where(inArray(entityRevisions.entityId, ids));
            }
            await connection.db.delete(trainingSessions).where(eq(trainingSessions.profileId, profileId));
            await connection.db.delete(plannedSessions).where(eq(plannedSessions.id, mappingPlannedId));
            await connection.db.delete(prescribedSets).where(eq(prescribedSets.prescriptionId, mappingRxId));
            await connection.db.delete(prescribedExercises).where(eq(prescribedExercises.prescriptionId, mappingRxId));
            await connection.db
                .delete(prescribedStrengthActivities)
                .where(eq(prescribedStrengthActivities.prescriptionId, mappingRxId));
            await connection.db
                .delete(prescribedActivities)
                .where(eq(prescribedActivities.prescriptionId, mappingRxId));
            await connection.db.delete(sessionPrescriptions).where(eq(sessionPrescriptions.id, mappingRxId));
            await connection.db.delete(exercises).where(inArray(exercises.id, [benchId, rowId]));
            await connection.db.delete(movementPatterns).where(eq(movementPatterns.id, movementId));
            await connection.db.delete(equipmentTypes).where(eq(equipmentTypes.id, equipmentId));
        } catch {
            // Best effort cleanup.
        }
        await connection.client.end({ timeout: 5 });
    });

    it("round-trips a session tree through start, edit, and complete", async () => {
        const created = await commands.create(
            {
                title: "Upper A",
                readiness: { energy: 4, motivation: 5 },
                tags: ["Push", "push"],
            },
            metadata,
        );
        expect(created).toMatchObject({ status: "draft", version: 1, tags: ["Push"] });

        const activityId = randomUUID();
        const painId = randomUUID();
        const edited = await commands.update(
            created.id,
            created.version,
            {
                durationMinutes: 60,
                activities: [{ id: activityId, type: "strength", position: 0, rpe: 8 }],
                painRecords: [
                    {
                        id: painId,
                        activityId,
                        bodyArea: "Lower back",
                        side: "left",
                        severity: 5,
                        onsetDuringSession: true,
                        stoppedActivity: false,
                    },
                ],
            },
            metadata,
        );
        expect(edited.version).toBe(2);

        const started = await commands.start(created.id, edited.version, metadata);
        expect(started.startedAt).toBe(now.toISOString());
        const completed = await commands.complete(
            created.id,
            started.version,
            { endedAt: later.toISOString() },
            metadata,
        );
        expect(completed).toMatchObject({ status: "completed", version: 4 });

        const reloaded = await repository.readSession(created.id as never);
        expect(reloaded).not.toBeNull();
        expect(reloaded!.durationMinutes).toBe(60);
        expect(reloaded!.readiness.energy).toBe(4);
        expect(reloaded!.activities).toHaveLength(1);
        expect(reloaded!.painRecords[0]).toMatchObject({ activityId, bodyArea: "Lower back", severity: 5 });
        expect(reloaded!.endedAt).toBe(later.toISOString());

        // Every mutation appended a revision.
        const history = await connection.db
            .select({ version: entityRevisions.version })
            .from(entityRevisions)
            .where(
                and(
                    eq(entityRevisions.entityType, TRAINING_SESSION_ENTITY_TYPE),
                    eq(entityRevisions.entityId, created.id),
                ),
            );
        expect(history).toHaveLength(4);
    });

    it("removes deleted activities and nulls their pain links on edit", async () => {
        const activityId = randomUUID();
        const painId = randomUUID();
        const created = await commands.create(
            {
                activities: [{ id: activityId, type: "strength", position: 0 }],
                painRecords: [{ id: painId, activityId, bodyArea: "Knee", side: "right", severity: 3 }],
            },
            metadata,
        );
        const edited = await commands.update(created.id, created.version, { activities: [] }, metadata);
        expect(edited.activities).toHaveLength(0);
        const reloaded = await repository.readSession(created.id as never);
        expect(reloaded!.painRecords).toHaveLength(1);
        expect(reloaded!.painRecords[0]!.activityId).toBeNull();
        const remainingActivities = await connection.db
            .select()
            .from(sessionActivities)
            .where(eq(sessionActivities.sessionId, created.id));
        expect(remainingActivities).toHaveLength(0);
    });

    it("filters archived sessions out of the default list", async () => {
        const created = await commands.create({ title: "To archive" }, metadata);
        await commands.archive(created.id, created.version, metadata);
        const active = await repository.listSessions();
        const all = await repository.listSessions({ includeArchived: true });
        expect(active.some(session => session.id === created.id)).toBe(false);
        expect(all.some(session => session.id === created.id)).toBe(true);
    });

    it("enforces the unique activity-position constraint", async () => {
        const sessionId = randomUUID();
        await connection.db.insert(trainingSessions).values({
            id: sessionId,
            profileId,
            status: "draft",
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
        });
        await connection.db
            .insert(sessionActivities)
            .values({ id: randomUUID(), sessionId, type: "strength", position: 0 });
        await expect(
            connection.db
                .insert(sessionActivities)
                .values({ id: randomUUID(), sessionId, type: "running", position: 0 }),
        ).rejects.toThrow();
    });

    it("rejects an out-of-range pain severity at the database", async () => {
        const sessionId = randomUUID();
        await connection.db.insert(trainingSessions).values({
            id: sessionId,
            profileId,
            status: "draft",
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
        });
        await expect(
            connection.db
                .insert(painRecords)
                .values({ id: randomUUID(), sessionId, bodyArea: "Knee", side: "left", severity: 11 }),
        ).rejects.toThrow();
    });

    it("round-trips a superset strength tree with occurrences, groups, members, and sets", async () => {
        const activity = randomUUID();
        const benchOcc = randomUUID();
        const rowOcc = randomUUID();
        const group = randomUUID();
        const created = await commands.create(
            {
                activities: [
                    {
                        id: activity,
                        type: "strength",
                        position: 0,
                        strength: {
                            occurrences: [
                                {
                                    id: benchOcc,
                                    exerciseId: benchId,
                                    position: 0,
                                    technique: 4,
                                    performedSets: [
                                        {
                                            id: randomUUID(),
                                            setGroupId: group,
                                            round: 1,
                                            position: 0,
                                            setType: "working",
                                            status: "completed",
                                            measurements: {
                                                reps: 8,
                                                externalLoad: { value: 100, unit: "kg" },
                                                rpe: 8,
                                            },
                                        },
                                        {
                                            id: randomUUID(),
                                            position: 1,
                                            setType: "working",
                                            status: "completed",
                                            measurements: { reps: 8, externalLoad: { value: 100, unit: "kg" } },
                                        },
                                    ],
                                },
                                {
                                    id: rowOcc,
                                    exerciseId: rowId,
                                    position: 1,
                                    performedSets: [
                                        {
                                            id: randomUUID(),
                                            setGroupId: group,
                                            round: 1,
                                            position: 0,
                                            setType: "superset_circuit",
                                            status: "completed",
                                            measurements: { reps: 10, externalLoad: { value: 60, unit: "kg" } },
                                        },
                                    ],
                                },
                            ],
                            setGroups: [
                                {
                                    id: group,
                                    type: "superset",
                                    position: 0,
                                    rounds: 3,
                                    restMs: 90_000,
                                    members: [
                                        { occurrenceId: benchOcc, position: 0 },
                                        { occurrenceId: rowOcc, position: 1 },
                                    ],
                                },
                            ],
                        },
                    },
                ],
            },
            metadata,
        );

        const reloaded = await repository.readSession(created.id as never);
        const strength = reloaded!.activities[0]!.strength!;
        expect(strength.occurrences).toHaveLength(2);
        expect(strength.occurrences[0]!.snapshot.name).toBe("Bench Press");
        expect(strength.occurrences[0]!.performedSets).toHaveLength(2);
        expect(strength.occurrences[0]!.performedSets[0]!.measurements.externalLoad).toEqual({
            value: 100,
            unit: "kg",
        });
        expect(strength.setGroups).toHaveLength(1);
        expect(strength.setGroups[0]!.type).toBe("superset");
        expect(strength.setGroups[0]!.members).toHaveLength(2);

        // Canonical columns are populated for analytics queries even though the API returns entered units.
        const canonical = await connection.db
            .select({ external: performedSets.externalLoadKg })
            .from(performedSets)
            .innerJoin(exerciseOccurrences, eq(performedSets.occurrenceId, exerciseOccurrences.id))
            .where(eq(exerciseOccurrences.id, benchOcc));
        expect(canonical.map(row => row.external).sort()).toEqual(["100.000", "100.000"]);

        // Edit: drop the row occurrence and trim the bench to a single set.
        const edited = await commands.update(
            created.id,
            created.version,
            {
                activities: [
                    {
                        id: activity,
                        type: "strength",
                        position: 0,
                        strength: {
                            occurrences: [
                                {
                                    id: benchOcc,
                                    exerciseId: benchId,
                                    position: 0,
                                    performedSets: [
                                        {
                                            id: randomUUID(),
                                            position: 0,
                                            setType: "working",
                                            status: "completed",
                                            measurements: { reps: 5, externalLoad: { value: 110, unit: "kg" } },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                ],
            },
            metadata,
        );
        expect(edited.version).toBe(2);
        const afterEdit = await repository.readSession(created.id as never);
        const editedStrength = afterEdit!.activities[0]!.strength!;
        expect(editedStrength.occurrences).toHaveLength(1);
        expect(editedStrength.occurrences[0]!.performedSets).toHaveLength(1);
        expect(editedStrength.setGroups).toHaveLength(0);

        // The removed occurrence, group, members, and sets are gone from the database.
        const remainingOcc = await connection.db
            .select({ id: exerciseOccurrences.id })
            .from(exerciseOccurrences)
            .where(eq(exerciseOccurrences.activityId, activity));
        expect(remainingOcc.map(row => row.id)).toEqual([benchOcc]);
        const remainingGroups = await connection.db
            .select({ id: setGroups.id })
            .from(setGroups)
            .where(eq(setGroups.activityId, activity));
        expect(remainingGroups).toHaveLength(0);
        const remainingMembers = await connection.db
            .select({ id: setGroupMembers.id })
            .from(setGroupMembers)
            .where(inArray(setGroupMembers.occurrenceId, [benchOcc, rowOcc]));
        expect(remainingMembers).toHaveLength(0);
    });

    it("round-trips planned/actual mappings and enforces the actual-side foreign keys", async () => {
        // Seed an immutable planned prescription (one activity → exercise → set) and a planned session.
        await connection.db.insert(sessionPrescriptions).values({ id: mappingRxId, kind: "planned" });
        await connection.db.insert(prescribedActivities).values({
            id: mappingActivityRowId,
            prescriptionId: mappingRxId,
            logicalKey: randomUUID(),
            type: "strength",
            position: 0,
        });
        const strengthRowId = randomUUID();
        await connection.db
            .insert(prescribedStrengthActivities)
            .values({ id: strengthRowId, prescriptionId: mappingRxId, activityId: mappingActivityRowId });
        await connection.db.insert(prescribedExercises).values({
            id: mappingExerciseRowId,
            prescriptionId: mappingRxId,
            logicalKey: randomUUID(),
            strengthActivityId: strengthRowId,
            exerciseId: benchId,
            exerciseSnapshot: snapshotFor(benchId, "Bench Press") as unknown as Record<string, unknown>,
            position: 0,
        });
        await connection.db.insert(prescribedSets).values({
            id: mappingSetRowId,
            prescriptionId: mappingRxId,
            logicalKey: randomUUID(),
            exerciseId: mappingExerciseRowId,
            position: 0,
            setType: "working",
        });
        await connection.db
            .insert(plannedSessions)
            .values({ id: mappingPlannedId, profileId, currentPrescriptionId: mappingRxId });

        const sessionId = randomUUID();
        const activityId = randomUUID();
        const occurrenceId = randomUUID();
        const performedSetId = randomUUID();
        const state = TrainingSession.create(
            {
                id: sessionId,
                profileId,
                localDate: "2026-08-02",
                timeZone: "Europe/Sofia",
                sourcePlannedSessionId: mappingPlannedId,
                activities: [
                    {
                        id: activityId,
                        type: "strength",
                        position: 0,
                        strength: {
                            occurrences: [
                                {
                                    id: occurrenceId,
                                    exerciseId: benchId,
                                    snapshot: snapshotFor(benchId, "Bench Press"),
                                    position: 0,
                                    performedSets: [
                                        { id: performedSetId, position: 0, setType: "working", status: "completed" },
                                    ],
                                },
                            ],
                        },
                    },
                ],
                mappings: {
                    plannedLinks: [
                        {
                            plannedSessionId: mappingPlannedId,
                            sourcePrescriptionId: mappingRxId,
                            resolvedPrescriptionId: mappingRxId,
                        },
                    ],
                    activityMappings: [
                        {
                            id: randomUUID(),
                            prescribedActivityId: mappingActivityRowId,
                            actualActivityId: activityId,
                            relation: "matched",
                        },
                    ],
                    setMappings: [
                        {
                            id: randomUUID(),
                            prescribedSetId: mappingSetRowId,
                            performedSetId,
                            relation: "matched",
                            reason: "as planned",
                        },
                    ],
                },
            },
            now,
        ).state;
        await unitOfWork.execute(tx =>
            repository.create(TRAINING_SESSION_ENTITY_TYPE, sessionId as never, state, 1, tx),
        );

        const reloaded = await repository.readSession(sessionId as never);
        expect(reloaded!.plannedLinks).toEqual([
            {
                plannedSessionId: mappingPlannedId,
                sourcePrescriptionId: mappingRxId,
                resolvedPrescriptionId: mappingRxId,
            },
        ]);
        expect(reloaded!.activityMappings[0]).toMatchObject({
            prescribedActivityId: mappingActivityRowId,
            relation: "matched",
        });
        expect(reloaded!.setMappings[0]).toMatchObject({
            prescribedSetId: mappingSetRowId,
            performedSetId,
            relation: "matched",
            reason: "as planned",
        });

        // A set mapping to a performed set that is not part of this session violates the FK.
        await expect(
            connection.db.insert(setMappings).values({
                id: randomUUID(),
                sessionId,
                prescribedSetId: mappingSetRowId,
                performedSetId: randomUUID(),
                relation: "matched",
            }),
        ).rejects.toThrow();

        // Mappings cascade away with their session.
        await connection.db.delete(trainingSessions).where(eq(trainingSessions.id, sessionId));
        const orphaned = await connection.db
            .select()
            .from(sessionMappings)
            .where(eq(sessionMappings.sessionId, sessionId));
        expect(orphaned).toHaveLength(0);
        await connection.db.delete(activityMappings).where(eq(activityMappings.sessionId, sessionId));
    });

    it("round-trips a reference link with no planned session (template/previous start)", async () => {
        // A frozen prescription with no planned session behind it (template/previous start source).
        const referenceRxId = randomUUID();
        await connection.db.insert(sessionPrescriptions).values({ id: referenceRxId, kind: "planned" });

        const sessionId = randomUUID();
        const state = TrainingSession.create(
            {
                id: sessionId,
                profileId,
                localDate: "2026-08-02",
                timeZone: "Europe/Sofia",
                mappings: {
                    plannedLinks: [{ sourcePrescriptionId: referenceRxId, resolvedPrescriptionId: referenceRxId }],
                },
            },
            now,
        ).state;
        await unitOfWork.execute(tx =>
            repository.create(TRAINING_SESSION_ENTITY_TYPE, sessionId as never, state, 1, tx),
        );

        const reloaded = await repository.readSession(sessionId as never);
        expect(reloaded!.plannedLinks).toEqual([
            { plannedSessionId: null, sourcePrescriptionId: referenceRxId, resolvedPrescriptionId: referenceRxId },
        ]);
        // The session is cleaned up by profile in afterAll; the immutable prescription row is left as-is.
    });

    it("drives the live flow: start empty → add exercise → record set → preview → complete", async () => {
        const started = await commands.startEmpty({ title: "Live lift" }, metadata);
        expect(started.status).toBe("in_progress");

        const activityId = randomUUID();
        const occurrenceId = randomUUID();
        const withExercise = await commands.addActivity(
            started.id,
            started.version,
            {
                activity: {
                    id: activityId,
                    type: "strength",
                    position: 0,
                    strength: { occurrences: [{ id: occurrenceId, exerciseId: benchId, position: 0 }] },
                },
            },
            metadata,
        );
        expect(withExercise.activities[0]?.strength?.occurrences[0]?.snapshot.name).toBe("Bench Press");

        const setId = randomUUID();
        const withSet = await commands.recordPerformedSet(
            withExercise.id,
            withExercise.version,
            {
                activityId,
                occurrenceId,
                set: {
                    id: setId,
                    position: 0,
                    setType: "working",
                    status: "completed",
                    measurements: { reps: 8, externalLoad: { value: 60, unit: "kg" } },
                },
                mapping: { relation: "added" },
            },
            metadata,
        );
        expect(withSet.activities[0]?.strength?.occurrences[0]?.performedSets).toHaveLength(1);
        expect(withSet.setMappings[0]).toMatchObject({ performedSetId: setId, relation: "added" });

        const activeView = await commands.readActiveView(withSet.id);
        expect(activeView?.plans).toEqual([]);

        const preview = await commands.previewCompletion(withSet.id);
        expect(preview.plannedOutcomes).toEqual([]);

        const completed = await commands.complete(withSet.id, withSet.version, {}, metadata);
        expect(completed.status).toBe("completed");
        expect(completed.endedAt).not.toBeNull();
    });
});
