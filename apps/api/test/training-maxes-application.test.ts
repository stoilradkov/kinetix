import { describe, expect, it } from "vitest";

import {
    RepositoryTrainingTargetContextReader,
    TrainingMaxBackdatedError,
    TrainingMaxCommands,
    TrainingMaxExerciseNotFoundError,
    TrainingMaxQueries,
    type RecordTrainingMaxCommand,
    type TrainingMaxCatalogReader,
    type TrainingMaxCurrentFilter,
    type TrainingMaxRepository,
    type TrainingMaxSeriesRef,
} from "#src/modules/training/application/index";
import { trainingMaxSeriesKey, type TrainingMaxState } from "#src/modules/training/domain/index";
import type { ExerciseCatalogItem } from "#src/modules/training/application/index";
import type { CommandContext, OutboxWriter } from "#src/platform/application/index";
import type { DomainEvent } from "#src/platform/domain/index";

const ids = {
    max1: "0198a4db-d8da-7000-8000-0000000000f1",
    max2: "0198a4db-d8da-7000-8000-0000000000f2",
    exercise: "0198a4db-d8da-7000-8000-0000000000a1",
    otherExercise: "0198a4db-d8da-7000-8000-0000000000a2",
    coreProfile: "0198a4db-d8da-7000-8000-0000000000d9",
    event1: "0198a4db-d8da-7000-8000-0000000000e1",
    event2: "0198a4db-d8da-7000-8000-0000000000e2",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(overrides: Partial<RecordTrainingMaxCommand> = {}): RecordTrainingMaxCommand {
    return { id: ids.max1, exerciseId: ids.exercise, maxType: "training_max", value: 100, unit: "kg", ...overrides };
}

describe("training maxima application services", () => {
    it("records a training max for the active profile and publishes a change event", async () => {
        const fixture = createFixture([ids.event1]);

        const recorded = await fixture.commands.record(command(), metadata);

        expect(recorded).toMatchObject({
            id: ids.max1,
            profileId: ids.coreProfile,
            exerciseId: ids.exercise,
            maxType: "training_max",
            valueKg: "100",
            effectiveTo: null,
        });
        expect(fixture.outbox.values).toHaveLength(1);
        expect(fixture.outbox.values[0]?.name).toBe("training.training-max.changed");
    });

    it("closes the current interval and opens the new record on the second value", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.record(
            command({ id: ids.max1, value: 100, effectiveFrom: "2026-01-01T00:00:00.000Z" }),
            metadata,
        );

        await fixture.commands.record(
            command({ id: ids.max2, value: 110, effectiveFrom: "2026-06-01T00:00:00.000Z" }),
            metadata,
        );

        const series: TrainingMaxSeriesRef = { exerciseId: ids.exercise, maxType: "training_max", customLabel: null };
        const history = await fixture.queries.history(series);
        expect(history).toHaveLength(2);
        expect(history[0]).toMatchObject({ id: ids.max1, valueKg: "100", effectiveTo: "2026-06-01T00:00:00.000Z" });
        expect(history[1]).toMatchObject({ id: ids.max2, valueKg: "110", effectiveTo: null });
        const current = await fixture.queries.current(series);
        expect(current?.id).toBe(ids.max2);
    });

    it("resolves the value in force at a supplied instant through the context reader", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.record(
            command({ id: ids.max1, value: 100, effectiveFrom: "2026-01-01T00:00:00.000Z" }),
            metadata,
        );
        await fixture.commands.record(
            command({ id: ids.max2, value: 110, effectiveFrom: "2026-06-01T00:00:00.000Z" }),
            metadata,
        );

        const before = await fixture.contextReader.resolveTrainingMax({
            profileId: ids.coreProfile,
            exerciseId: ids.exercise,
            maxType: "training_max",
            at: "2026-03-01T00:00:00.000Z",
        });
        const after = await fixture.contextReader.resolveTrainingMax({
            profileId: ids.coreProfile,
            exerciseId: ids.exercise,
            maxType: "training_max",
            at: "2026-07-01T00:00:00.000Z",
        });

        expect(before).toMatchObject({ trainingMaxId: ids.max1, valueKg: "100" });
        expect(after).toMatchObject({ trainingMaxId: ids.max2, valueKg: "110" });
    });

    it("rejects an unknown exercise and a backdated effective time", async () => {
        const fixture = createFixture([ids.event1]);
        await expect(
            fixture.commands.record(command({ exerciseId: ids.otherExercise }), metadata),
        ).rejects.toBeInstanceOf(TrainingMaxExerciseNotFoundError);

        const dated = createFixture([ids.event1, ids.event2]);
        await dated.commands.record(command({ id: ids.max1, effectiveFrom: "2026-06-01T00:00:00.000Z" }), metadata);
        await expect(
            dated.commands.record(command({ id: ids.max2, effectiveFrom: "2026-05-01T00:00:00.000Z" }), metadata),
        ).rejects.toBeInstanceOf(TrainingMaxBackdatedError);
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeTrainingMaxRepository();
    const outbox = new FakeOutbox();
    const catalog = new FakeCatalog([ids.exercise]);
    const profileReader = { requireActiveProfileId: async () => ids.coreProfile };
    const commands = new TrainingMaxCommands({
        unitOfWork: { execute: work => work(transaction) },
        repository,
        catalog,
        outbox,
        profileReader,
        clock: { now: () => now },
        generateId: () => {
            const id = generatedIds.shift();
            if (!id) throw new Error("No generated ID remains");
            return id;
        },
    });
    const queries = new TrainingMaxQueries(repository, profileReader);
    const contextReader = new RepositoryTrainingTargetContextReader(repository);
    return { repository, outbox, commands, queries, contextReader };
}

class FakeTrainingMaxRepository implements TrainingMaxRepository<typeof transaction> {
    private readonly values = new Map<string, TrainingMaxState>();

    async insert(state: TrainingMaxState): Promise<void> {
        if (this.values.has(state.id)) throw new Error("duplicate training max");
        this.values.set(state.id, structuredClone(state));
    }

    async findOpenForUpdate(profileId: string, series: TrainingMaxSeriesRef): Promise<TrainingMaxState | null> {
        const key = trainingMaxSeriesKey(series);
        const match = [...this.values.values()].find(
            state => state.profileId === profileId && state.effectiveTo === null && trainingMaxSeriesKey(state) === key,
        );
        return match ? structuredClone(match) : null;
    }

    async close(id: string, effectiveTo: string, updatedAt: string): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.effectiveTo !== null) throw new Error("cannot close training max");
        this.values.set(id, { ...stored, effectiveTo, updatedAt });
    }

    async findById(id: string): Promise<TrainingMaxState | null> {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async listCurrent(profileId: string, filter?: TrainingMaxCurrentFilter): Promise<readonly TrainingMaxState[]> {
        return [...this.values.values()]
            .filter(
                state =>
                    state.profileId === profileId &&
                    state.effectiveTo === null &&
                    (filter?.exerciseId === undefined || state.exerciseId === filter.exerciseId),
            )
            .map(state => structuredClone(state));
    }

    async listSeries(profileId: string, series: TrainingMaxSeriesRef): Promise<readonly TrainingMaxState[]> {
        const key = trainingMaxSeriesKey(series);
        return [...this.values.values()]
            .filter(state => state.profileId === profileId && trainingMaxSeriesKey(state) === key)
            .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
            .map(state => structuredClone(state));
    }
}

class FakeOutbox implements OutboxWriter<typeof transaction> {
    readonly values: DomainEvent[] = [];

    async publish(events: readonly DomainEvent[]): Promise<void> {
        this.values.push(...events);
    }
}

class FakeCatalog implements TrainingMaxCatalogReader {
    constructor(private readonly exerciseIds: readonly string[]) {}

    async listExercises(): Promise<readonly ExerciseCatalogItem[]> {
        return this.exerciseIds.map(id => ({ id }) as ExerciseCatalogItem);
    }
}
