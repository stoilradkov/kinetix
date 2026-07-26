import { describe, expect, it, vi } from "vitest";

import {
    MigratingSnapshotSerializer,
    RevisionMutationService,
    StaleAggregateVersionError,
    type CurrentStateStore,
    type EntityRevision,
    type RevisionStore,
    type TransactionalEventPublisher,
    type UnitOfWork,
} from "#src/platform/application/index";
import { AggregateVersion, entityId, revisionReason, revisionSource } from "#src/platform/domain/index";

const id = entityId("0198a4db-d8da-7000-8000-000000000001");

describe("revision domain values", () => {
    it("moves only through positive, sequential versions", () => {
        expect(AggregateVersion.from(1).next().value).toBe(2);
        expect(() => AggregateVersion.from(0)).toThrow(/positive integer/);
    });

    it("validates source and optional reasons", () => {
        expect(revisionSource("agent")).toBe("agent");
        expect(revisionReason(" fixed plan ")).toBe("fixed plan");
        expect(() => revisionSource("unknown")).toThrow(/Unknown/);
        expect(() => revisionReason("   ")).toThrow(/empty/);
    });
});

describe("snapshot migrations", () => {
    it("dispatches migrations in schema order and validates the current shape", () => {
        const serializer = new MigratingSnapshotSerializer<{ name: string }>(
            3,
            state => state,
            value => {
                if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string")
                    throw new Error("invalid snapshot");
                return { name: value.name };
            },
            [
                { fromVersion: 1, migrate: value => ({ title: (value as { oldName: string }).oldName }) },
                { fromVersion: 2, migrate: value => ({ name: (value as { title: string }).title }) },
            ],
        );
        expect(serializer.deserialize({ schemaVersion: 1, value: { oldName: "Base" } })).toEqual({ name: "Base" });
        expect(() => serializer.deserialize({ schemaVersion: 4, value: {} })).toThrow(/newer/);
    });
});

describe("revision mutation orchestration", () => {
    it("rejects stale versions before invoking mutation", async () => {
        const fixture = createFixture();
        const change = vi.fn();
        await expect(
            fixture.service.mutate({
                entityType: "program",
                entityId: id,
                version: 2,
                expectedVersion: 1,
                state: { name: "Old" },
                change,
                metadata: metadata(),
            }),
        ).rejects.toBeInstanceOf(StaleAggregateVersionError);
        expect(change).not.toHaveBeenCalled();
        expect(fixture.unitOfWork.execute).not.toHaveBeenCalled();
    });

    it("writes state, snapshot, and events in one transaction", async () => {
        const fixture = createFixture();
        const result = await fixture.service.mutate({
            entityType: "program",
            entityId: id,
            version: 1,
            expectedVersion: 1,
            state: { name: "Old" },
            change: () => ({ state: { name: "New" }, events: ["changed"] }),
            metadata: metadata(),
        });
        expect(result).toEqual({ state: { name: "New" }, version: 2 });
        expect(fixture.states.save).toHaveBeenCalledWith("program", id, { name: "New" }, 1, 2, fixture.transaction);
        expect(fixture.revisions.append).toHaveBeenCalledWith(
            expect.objectContaining({ version: 2, snapshot: { name: "New" } }),
            fixture.transaction,
        );
        expect(fixture.events.publish).toHaveBeenCalledWith(["changed"], fixture.transaction);
    });

    it("restores an old snapshot as a new current revision", async () => {
        const fixture = createFixture();
        fixture.revisions.find.mockResolvedValue(revision(1, { name: "Original" }));
        const result = await fixture.service.restore({
            entityType: "program",
            entityId: id,
            version: 3,
            expectedVersion: 3,
            state: { name: "Current" },
            restoreVersion: 1,
            metadata: { ...metadata(), reason: "undo" },
        });
        expect(result).toEqual({ state: { name: "Original" }, version: 4 });
        expect(fixture.revisions.append).toHaveBeenCalledWith(
            expect.objectContaining({ version: 4, source: "restore" }),
            fixture.transaction,
        );
    });
});

function metadata() {
    return { source: "user" as const, summary: "Renamed program", correlationId: "request-1" };
}

function revision(version: number, snapshot: unknown): EntityRevision {
    return {
        entityType: "program",
        entityId: id,
        version,
        schemaVersion: 1,
        snapshot,
        source: "user",
        actorId: null,
        reason: null,
        summary: "Created program",
        correlationId: "request-0",
        createdAt: new Date(),
    };
}

function createFixture() {
    const transaction = { id: "tx" };
    const unitOfWork: UnitOfWork<typeof transaction> = {
        execute: vi.fn(async work => work(transaction)),
    };
    const states = { save: vi.fn(async () => undefined) } satisfies CurrentStateStore<
        { name: string },
        typeof transaction
    >;
    const findRevision = vi.fn<RevisionStore<typeof transaction>["find"]>(async () => null);
    const revisions = {
        append: vi.fn(async () => undefined),
        find: findRevision,
        history: vi.fn(async () => ({ items: [], nextCursor: null })),
    } satisfies RevisionStore<typeof transaction>;
    const events = { publish: vi.fn(async () => undefined) } satisfies TransactionalEventPublisher<
        string,
        typeof transaction
    >;
    const serializer = new MigratingSnapshotSerializer<{ name: string }>(
        1,
        state => state,
        value => value as { name: string },
        [],
    );
    return {
        transaction,
        unitOfWork: unitOfWork as typeof unitOfWork & { execute: ReturnType<typeof vi.fn> },
        states,
        revisions,
        events,
        service: new RevisionMutationService<{ name: string }, string, typeof transaction>(
            unitOfWork,
            states,
            revisions,
            serializer,
            events,
        ),
    };
}
