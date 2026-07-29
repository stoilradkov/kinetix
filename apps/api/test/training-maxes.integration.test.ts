import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { createDatabase, equipmentTypes, exercises, movementPatterns, trainingMaxes } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    RepositoryTrainingTargetContextReader,
    type TrainingMaxSeriesRef,
} from "#src/modules/training/application/index";
import {
    TrainingMax,
    resolveEffectiveTrainingMax,
    type RecordTrainingMaxInput,
} from "#src/modules/training/domain/index";
import { DrizzleTrainingMaxRepository } from "#src/modules/training/infrastructure/drizzle-training-max-repository";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-07-28T12:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000000d9";
const exerciseId = "0198a4db-d8da-7000-8000-0000000000a1";
const equipmentId = "0198a4db-d8da-7000-8000-0000000000b1";
const movementId = "0198a4db-d8da-7000-8000-0000000000c1";
const idA = "0198a4db-d8da-7000-8000-0000000000f1";
const idB = "0198a4db-d8da-7000-8000-0000000000f2";
const series: TrainingMaxSeriesRef = { exerciseId, maxType: "training_max", customLabel: null };

function state(id: string, overrides: Partial<RecordTrainingMaxInput> = {}) {
    return TrainingMax.record({ id, profileId, exerciseId, maxType: "training_max", value: 100, ...overrides }, now)
        .state;
}

describe.runIf(testDatabaseUrl)("training maxima PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleTrainingMaxRepository(connection as unknown as DatabaseService);
    const contextReader = new RepositoryTrainingTargetContextReader(repository);

    beforeAll(async () => {
        await connection.db
            .insert(equipmentTypes)
            .values({ id: equipmentId, slug: "test-mx-barbell", name: "Test MX Barbell", position: 900 });
        await connection.db
            .insert(movementPatterns)
            .values({ id: movementId, slug: "test-mx-squat", name: "Test MX Squat", position: 900 });
        await connection.db.insert(exercises).values({
            id: exerciseId,
            slug: "test-mx-back-squat",
            name: "Test MX Back Squat",
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

    afterEach(async () => {
        await connection.db.delete(trainingMaxes).where(eq(trainingMaxes.exerciseId, exerciseId));
    });

    afterAll(async () => {
        await connection.db.delete(exercises).where(eq(exercises.id, exerciseId));
        await connection.db.delete(movementPatterns).where(eq(movementPatterns.id, movementId));
        await connection.db.delete(equipmentTypes).where(eq(equipmentTypes.id, equipmentId));
    });

    it("closes the open interval and resolves the value effective at an instant", async () => {
        await repository.insert(state(idA, { value: 100, effectiveFrom: "2026-01-01T00:00:00.000Z" }), connection.db);
        const open = await repository.findOpenForUpdate(profileId, series, connection.db);
        expect(open?.id).toBe(idA);

        const closed = TrainingMax.rehydrate(open!).close("2026-06-01T00:00:00.000Z", now).state;
        await repository.close(idA, closed.effectiveTo!, closed.updatedAt, connection.db);
        await repository.insert(state(idB, { value: 110, effectiveFrom: "2026-06-01T00:00:00.000Z" }), connection.db);

        const history = await repository.listSeries(profileId, series);
        expect(history.map(record => record.id)).toEqual([idA, idB]);
        expect(history[0]?.effectiveTo).toBe("2026-06-01T00:00:00.000Z");

        const current = await repository.listCurrent(profileId);
        expect(current.map(record => record.id)).toEqual([idB]);

        const asOf = resolveEffectiveTrainingMax([...history], "2026-03-01T00:00:00.000Z");
        expect(asOf?.id).toBe(idA);
        const resolved = await contextReader.resolveTrainingMax({
            profileId,
            exerciseId,
            maxType: "training_max",
            at: "2026-07-01T00:00:00.000Z",
        });
        expect(resolved).toMatchObject({ trainingMaxId: idB, valueKg: "110" });
    });

    it("permits only one open interval per series", async () => {
        await repository.insert(state(idA, { effectiveFrom: "2026-01-01T00:00:00.000Z" }), connection.db);
        await expect(
            repository.insert(state(idB, { effectiveFrom: "2026-02-01T00:00:00.000Z" }), connection.db),
        ).rejects.toThrow();
    });
});
