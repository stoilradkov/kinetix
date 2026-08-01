import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import {
    bulkDryRuns,
    createDatabase,
    equipmentTypes,
    exerciseAliases,
    exerciseExternalIds,
    exerciseMuscles,
    exercises,
    movementPatterns,
    muscleGroups,
    programs,
} from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    BulkCatalogResolver,
    DryRunBulkProgram,
    TrainingExerciseCatalog,
} from "#src/modules/training/application/index";
import { DrizzleBulkDryRunRepository } from "#src/modules/training/infrastructure/drizzle-bulk-dry-run-repository";
import { DrizzleExerciseExternalIdResolver } from "#src/modules/training/infrastructure/drizzle-exercise-external-id-resolver";
import { DrizzleTrainingCatalogRepository } from "#src/modules/training/infrastructure/drizzle-training-catalog-repository";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";
import type { CommandContext, UnitOfWork } from "#src/platform/application/index";
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

function envelope(): BulkProgramEnvelope {
    return {
        schemaVersion: 1,
        source: { namespace: "coach-app", generatedBy: "agent" },
        mode: "create",
        program: {
            externalId: "prog-1",
            name: "Bulk Program",
            scheduleMode: "dated",
            startDate: "2026-09-07",
            blocks: [{ externalId: "meso", type: "mesocycle", position: 0, relativeStartWeek: 0 }],
            sessions: [
                {
                    externalId: "sess-1",
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
    const useCase = new DryRunBulkProgram({
        unitOfWork,
        repository,
        resolver,
        profileReader: { requireActiveProfileId: async () => profileId },
        clock: { now: () => now },
        generateId: randomUUID,
    });

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
        await connection.db.delete(bulkDryRuns).where(eq(bulkDryRuns.profileId, profileId));
        await connection.db.delete(exerciseExternalIds).where(eq(exerciseExternalIds.exerciseId, exerciseId));
        await connection.db.delete(exerciseMuscles).where(eq(exerciseMuscles.exerciseId, exerciseId));
        await connection.db.delete(exerciseAliases).where(eq(exerciseAliases.exerciseId, exerciseId));
        await connection.db.delete(exercises).where(eq(exercises.id, exerciseId));
        await connection.db.delete(movementPatterns).where(eq(movementPatterns.id, movementId));
        await connection.db.delete(equipmentTypes).where(eq(equipmentTypes.id, equipmentId));
        await connection.db.delete(muscleGroups).where(eq(muscleGroups.id, muscleId));
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
});
