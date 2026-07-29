import { describe, expect, it } from "vitest";

import {
    PrescriptionCloner,
    PrescriptionNotFoundError,
    PrescriptionPublisher,
    type PublishPrescriptionCommand,
    type SessionPrescriptionRepository,
} from "#src/modules/training/application/index";
import type {
    ExerciseSnapshotV1,
    PublishPrescriptionDraft,
    SessionPrescriptionState,
} from "#src/modules/training/domain/index";
import type { CommandContext, OutboxWriter, UnitOfWork } from "#src/platform/application/index";
import type { DomainEvent } from "#src/platform/domain/index";

const EXERCISE_A = "0198a4db-d8da-7000-8000-0000000000a1";
const now = new Date("2026-07-29T10:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function snapshot(exerciseId: string): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId,
        exerciseVersion: 1,
        name: "Back Squat",
        equipmentTypeId: "0198a4db-d8da-7000-8000-0000000000b1",
        movementPatternId: "0198a4db-d8da-7000-8000-0000000000c1",
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

function draft(kind: PublishPrescriptionDraft["kind"] = "template"): PublishPrescriptionDraft {
    return {
        kind,
        activities: [
            {
                ref: "a1",
                type: "strength",
                position: 0,
                strength: {
                    exercises: [
                        {
                            ref: "e1",
                            exerciseId: EXERCISE_A,
                            snapshot: snapshot(EXERCISE_A),
                            position: 0,
                            sets: [{ ref: "s1", position: 0, setType: "working", targets: { repsMin: 5, repsMax: 5 } }],
                        },
                    ],
                },
            },
        ],
    };
}

const command: PublishPrescriptionCommand = { draft: draft() };

class FakeRepository implements SessionPrescriptionRepository<typeof transaction> {
    readonly trees = new Map<string, SessionPrescriptionState>();
    failNextInsert = false;

    async insertTree(state: SessionPrescriptionState): Promise<void> {
        if (this.failNextInsert) throw new Error("insert failed");
        if (this.trees.has(state.id)) throw new Error("duplicate prescription");
        this.trees.set(state.id, structuredClone(state));
    }

    async loadTree(id: string): Promise<SessionPrescriptionState | null> {
        const stored = this.trees.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async loadTrees(ids: readonly string[]): Promise<readonly SessionPrescriptionState[]> {
        return ids.map(id => this.trees.get(id)).filter((tree): tree is SessionPrescriptionState => tree != null);
    }
}

class FakeOutbox implements OutboxWriter<typeof transaction> {
    readonly values: DomainEvent[] = [];
    async publish(events: readonly DomainEvent[]): Promise<void> {
        this.values.push(...events);
    }
}

function createFixture() {
    const repository = new FakeRepository();
    const outbox = new FakeOutbox();
    let executeCount = 0;
    const unitOfWork: UnitOfWork<typeof transaction> = {
        execute: work => {
            executeCount += 1;
            return work(transaction);
        },
    };
    let counter = 0;
    const generateId = () => `0198a4db-d8da-7000-8000-${(++counter).toString(16).padStart(12, "0")}`;
    const runtime = { unitOfWork, repository, outbox, clock: { now: () => now }, generateId };
    return {
        repository,
        outbox,
        publisher: new PrescriptionPublisher(runtime),
        cloner: new PrescriptionCloner(runtime),
        executeCount: () => executeCount,
    };
}

describe("session prescription application services", () => {
    it("publishes a draft as one immutable tree and emits one published event", async () => {
        const fixture = createFixture();

        const published = await fixture.publisher.publish(command, metadata);

        expect(fixture.repository.trees.size).toBe(1);
        expect(fixture.repository.trees.has(published.id)).toBe(true);
        expect(published.kind).toBe("template");
        expect(fixture.outbox.values).toHaveLength(1);
        expect(fixture.outbox.values[0]?.name).toBe("training.session-prescription.published");
    });

    it("uses the supplied transaction without opening its own unit of work", async () => {
        const fixture = createFixture();

        await fixture.publisher.publish(command, metadata, transaction);

        expect(fixture.executeCount()).toBe(0);
        expect(fixture.repository.trees.size).toBe(1);
    });

    it("rolls back when the tree insert fails: no event is published", async () => {
        const fixture = createFixture();
        fixture.repository.failNextInsert = true;

        await expect(fixture.publisher.publish(command, metadata)).rejects.toThrow("insert failed");
        expect(fixture.outbox.values).toHaveLength(0);
    });

    it("clones a published tree, recording source lineage and emitting a cloned event", async () => {
        const fixture = createFixture();
        const template = await fixture.publisher.publish(command, metadata);

        const planned = await fixture.cloner.clone(
            { sourcePrescriptionId: template.id, targetKind: "planned" },
            metadata,
        );

        expect(planned.kind).toBe("planned");
        expect(planned.sourcePrescriptionId).toBe(template.id);
        expect(planned.sourceKind).toBe("template");
        const plannedExercise = planned.activities[0]!.strength!.exercises[0]!;
        const templateExercise = template.activities[0]!.strength!.exercises[0]!;
        expect(plannedExercise.sourceRowId).toBe(templateExercise.id);
        expect(plannedExercise.logicalKey).not.toBe(templateExercise.logicalKey);
        expect(fixture.outbox.values.at(-1)?.name).toBe("training.session-prescription.cloned");
    });

    it("clones planned → resolved_execution preserving logical keys by default", async () => {
        const fixture = createFixture();
        const planned = await fixture.publisher.publish({ draft: draft("planned") }, metadata);

        const resolved = await fixture.cloner.clone(
            { sourcePrescriptionId: planned.id, targetKind: "resolved_execution" },
            metadata,
        );

        expect(resolved.activities[0]!.strength!.exercises[0]!.logicalKey).toBe(
            planned.activities[0]!.strength!.exercises[0]!.logicalKey,
        );
    });

    it("rejects cloning a missing source prescription", async () => {
        const fixture = createFixture();

        await expect(
            fixture.cloner.clone({ sourcePrescriptionId: EXERCISE_A, targetKind: "planned" }, metadata),
        ).rejects.toBeInstanceOf(PrescriptionNotFoundError);
    });
});
