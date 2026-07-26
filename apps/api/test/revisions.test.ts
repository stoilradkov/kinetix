import { describe, expect, it, vi } from "vitest";

import {
    MigratingSnapshotSerializer,
    RevisionHistoryService,
    RevisionMutationService,
    RevisionNotFoundError,
    RevisionResourceRegistry,
    StaleAggregateVersionError,
    UnsupportedRevisionEntityTypeError,
    type CurrentStateStore,
    type EntityRevision,
    type RevisionResourceHandler,
    type RevisionStore,
    type TransactionalEventPublisher,
    type UnitOfWork,
} from "#src/platform/application/index";
import { AggregateVersion, entityId, revisionReason, revisionSource } from "#src/platform/domain/index";

const id = entityId("0198a4db-d8da-7000-8000-000000000001");

describe("revision domain values", () => {
    it("moves only through positive, sequential versions", () => {
        expect(AggregateVersion.initial().value).toBe(1);
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
        expect(() => serializer.deserialize({ schemaVersion: 0, value: {} })).toThrow(/positive integer/);
        expect(() => serializer.deserialize({ schemaVersion: 4, value: {} })).toThrow(/newer/);
    });

    it("rejects ambiguous or invalid migration declarations", () => {
        expect(
            () =>
                new MigratingSnapshotSerializer(
                    2,
                    value => value,
                    value => value,
                    [
                        { fromVersion: 1, migrate: value => value },
                        { fromVersion: 1, migrate: value => value },
                    ],
                ),
        ).toThrow(/Duplicate/);
        expect(
            () =>
                new MigratingSnapshotSerializer(
                    2,
                    value => value,
                    value => value,
                    [{ fromVersion: 2, migrate: value => value }],
                ),
        ).toThrow(/Invalid/);
    });
});

describe("revision mutation orchestration", () => {
    it("creates normalized state and its initial revision together", async () => {
        const fixture = createFixture();
        const result = await fixture.service.create({
            entityType: "program",
            entityId: id,
            state: { name: "Base" },
            metadata: metadata(),
            events: ["created"],
        });
        expect(result).toEqual({ state: { name: "Base" }, version: 1 });
        expect(fixture.states.create).toHaveBeenCalledWith("program", id, { name: "Base" }, 1, fixture.transaction);
        expect(fixture.revisions.append).toHaveBeenCalledWith(
            expect.objectContaining({ version: 1, snapshot: { name: "Base" } }),
            fixture.transaction,
        );
        expect(fixture.events.publish).toHaveBeenCalledWith(["created"], fixture.transaction);
    });

    it("rejects stale versions before invoking mutation", async () => {
        const fixture = createFixture();
        fixture.states.loadForUpdate.mockResolvedValue({ state: { name: "Current" }, version: 2 });
        const change = vi.fn();
        await expect(
            fixture.service.mutate({
                entityType: "program",
                entityId: id,
                expectedVersion: 1,
                change,
                metadata: metadata(),
            }),
        ).rejects.toBeInstanceOf(StaleAggregateVersionError);
        expect(change).not.toHaveBeenCalled();
        expect(fixture.states.save).not.toHaveBeenCalled();
        expect(fixture.revisions.append).not.toHaveBeenCalled();
    });

    it("writes state, snapshot, and events in one transaction", async () => {
        const fixture = createFixture();
        const result = await fixture.service.mutate({
            entityType: "program",
            entityId: id,
            expectedVersion: 1,
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
        fixture.states.loadForUpdate.mockResolvedValue({ state: { name: "Current" }, version: 3 });
        fixture.revisions.find.mockResolvedValue(revision(1, { name: "Original" }));
        const result = await fixture.service.restore({
            entityType: "program",
            entityId: id,
            expectedVersion: 3,
            restoreVersion: 1,
            metadata: { ...metadata(), reason: "undo" },
        });
        expect(result).toEqual({ state: { name: "Original" }, version: 4 });
        expect(fixture.revisions.append).toHaveBeenCalledWith(
            expect.objectContaining({ version: 4, source: "restore" }),
            fixture.transaction,
        );
    });

    it("rejects a stale restore before reading or deserializing history", async () => {
        const fixture = createFixture();
        fixture.states.loadForUpdate.mockResolvedValue({ state: { name: "Current" }, version: 3 });
        await expect(
            fixture.service.restore({
                entityType: "program",
                entityId: id,
                expectedVersion: 2,
                restoreVersion: 1,
                metadata: metadata(),
            }),
        ).rejects.toBeInstanceOf(StaleAggregateVersionError);
        expect(fixture.revisions.find).not.toHaveBeenCalled();
    });

    it("reports a missing restore target without mutating current state", async () => {
        const fixture = createFixture();
        fixture.states.loadForUpdate.mockResolvedValue({ state: { name: "Current" }, version: 3 });
        await expect(
            fixture.service.restore({
                entityType: "program",
                entityId: id,
                expectedVersion: 3,
                restoreVersion: 1,
                metadata: metadata(),
            }),
        ).rejects.toBeInstanceOf(RevisionNotFoundError);
        expect(fixture.states.save).not.toHaveBeenCalled();
        expect(fixture.revisions.append).not.toHaveBeenCalled();
    });

    it("does not publish events when revision persistence fails", async () => {
        const fixture = createFixture();
        fixture.revisions.append.mockRejectedValue(new Error("revision failed"));
        await expect(
            fixture.service.mutate({
                entityType: "program",
                entityId: id,
                expectedVersion: 1,
                change: () => ({ state: { name: "New" }, events: ["changed"] }),
                metadata: metadata(),
            }),
        ).rejects.toThrow("revision failed");
        expect(fixture.events.publish).not.toHaveBeenCalled();
    });

    it("rolls current state, revision, and events back together", async () => {
        type Transaction = {
            state: { name: string };
            version: number;
            revisions: EntityRevision[];
            events: string[];
        };
        let committed: Transaction = {
            state: { name: "Old" },
            version: 1,
            revisions: [],
            events: [],
        };
        const unitOfWork: UnitOfWork<Transaction> = {
            execute: async work => {
                const transaction = structuredClone(committed);
                const result = await work(transaction);
                committed = transaction;
                return result;
            },
        };
        const states: CurrentStateStore<{ name: string }, Transaction> = {
            loadForUpdate: async (_entityType, _entityId, transaction) => ({
                state: transaction.state,
                version: transaction.version,
            }),
            create: async () => undefined,
            save: async (_entityType, _entityId, state, _expected, version, transaction) => {
                transaction.state = state;
                transaction.version = version;
            },
        };
        const revisions: RevisionStore<Transaction> = {
            append: async (value, transaction) => {
                transaction.revisions.push(value);
            },
            find: async () => null,
            history: async () => ({ items: [], nextCursor: null }),
        };
        const events: TransactionalEventPublisher<string, Transaction> = {
            publish: async (values, transaction) => {
                transaction.events.push(...values);
                throw new Error("event persistence failed");
            },
        };
        const service = new RevisionMutationService(
            unitOfWork,
            states,
            revisions,
            new MigratingSnapshotSerializer<{ name: string }>(
                1,
                state => state,
                value => value as { name: string },
                [],
            ),
            events,
        );

        await expect(
            service.mutate({
                entityType: "program",
                entityId: id,
                expectedVersion: 1,
                change: () => ({ state: { name: "New" }, events: ["changed"] }),
                metadata: metadata(),
            }),
        ).rejects.toThrow("event persistence failed");
        expect(committed).toEqual({
            state: { name: "Old" },
            version: 1,
            revisions: [],
            events: [],
        });
    });
});

describe("revision history", () => {
    it("migrates and maps snapshots instead of exposing persistence JSON", async () => {
        const revisions = {
            append: vi.fn(),
            find: vi.fn(),
            history: vi.fn(async () => ({
                items: [
                    {
                        ...revision(2, { oldName: "Base" }),
                        schemaVersion: 1,
                    },
                ],
                nextCursor: null,
            })),
        } satisfies RevisionStore;
        const serializer = new MigratingSnapshotSerializer<{ name: string }>(
            2,
            state => state,
            value => value as { name: string },
            [{ fromVersion: 1, migrate: value => ({ name: (value as { oldName: string }).oldName }) }],
        );
        const history = new RevisionHistoryService(revisions, serializer, {
            toResource: (state, metadata) => ({ displayName: state.name, version: metadata.version }),
        });

        const page = await history.history({ entityType: "program", entityId: id, limit: 20 });

        expect(page.items[0]).toEqual(
            expect.objectContaining({
                version: 2,
                resource: { displayName: "Base", version: 2 },
            }),
        );
        expect(page.items[0]).not.toHaveProperty("snapshot");
    });

    it("routes only explicitly registered aggregate capabilities", async () => {
        const registry = new RevisionResourceRegistry();
        const handler = {
            entityType: "program",
            history: vi.fn(async () => ({ items: [], nextCursor: null })),
            restore: vi.fn(async () => ({ version: 4, resource: { name: "Base" } })),
        } satisfies RevisionResourceHandler;
        registry.register(handler);

        await expect(registry.history("program", id, { limit: 20 })).resolves.toEqual({
            items: [],
            nextCursor: null,
        });
        await expect(
            registry.restore("program", {
                entityId: id,
                restoreVersion: 1,
                expectedVersion: 3,
                metadata: metadata(),
            }),
        ).resolves.toEqual({ version: 4, resource: { name: "Base" } });
        expect(() => registry.register(handler)).toThrow(/already registered/);
        await expect(registry.history("exercise", id, { limit: 20 })).rejects.toBeInstanceOf(
            UnsupportedRevisionEntityTypeError,
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
    const states = {
        loadForUpdate: vi.fn(async () => ({ state: { name: "Old" }, version: 1 })),
        create: vi.fn(async () => undefined),
        save: vi.fn(async () => undefined),
    } satisfies CurrentStateStore<{ name: string }, typeof transaction>;
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
