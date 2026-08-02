import { describe, expect, it } from "vitest";

import {
    TrainingSessionCommands,
    TrainingSessionNotFoundError,
    trainingSessionSerializer,
    type TrainingSessionListFilter,
    type TrainingSessionRepository,
    type TrainingSessionResource,
    type TrainingSessionSummary,
} from "#src/modules/training/application/index";
import type { TrainingSessionState } from "#src/modules/training/domain/index";
import {
    RevisionMutationService,
    VersionConflictError,
    type CommandContext,
    type EntityRevision,
    type OutboxWriter,
    type RevisionStore,
    type UnitOfWork,
} from "#src/platform/application/index";
import type { DomainEvent, EntityId } from "#src/platform/domain/index";

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const now = new Date("2026-08-02T09:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "req-1", source: "user" };

describe("training session application services", () => {
    it("creates an unplanned draft, defaulting local date and time zone from the active profile", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        expect(created).toMatchObject({
            status: "draft",
            profileId: PROFILE,
            timeZone: "Europe/Sofia",
            localDate: "2026-08-02",
            version: 1,
        });
        expect(fixture.events.values.map(event => event.name)).toEqual(["training.session.created"]);
    });

    it("honours an explicit date and zone and records the planned-session link", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create(
            { localDate: "2026-08-05", timeZone: "America/New_York", sourcePlannedSessionId: PROFILE },
            metadata,
        );
        expect(created).toMatchObject({ localDate: "2026-08-05", timeZone: "America/New_York" });
        expect(created.sourcePlannedSessionId).toBe(PROFILE);
    });

    it("walks the full lifecycle start → complete → reopen → complete", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        const started = await fixture.commands.start(created.id, created.version, metadata);
        expect(started).toMatchObject({ status: "in_progress", version: 2 });
        expect(started.startedAt).toBe(now.toISOString());
        const completed = await fixture.commands.complete(
            started.id,
            started.version,
            { postWorkout: { enjoyment: 5 } },
            metadata,
        );
        expect(completed).toMatchObject({ status: "completed", version: 3 });
        expect(completed.postWorkout.enjoyment).toBe(5);
        const reopened = await fixture.commands.reopen(completed.id, completed.version, metadata);
        expect(reopened).toMatchObject({ status: "in_progress", version: 4 });
        const recompleted = await fixture.commands.complete(reopened.id, reopened.version, {}, metadata);
        expect(recompleted).toMatchObject({ status: "completed", version: 5 });
    });

    it("updates readiness, tags, notes, and activities on an in-progress session", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        const started = await fixture.commands.start(created.id, created.version, metadata);
        const updated = await fixture.commands.update(
            started.id,
            started.version,
            {
                readiness: { energy: 4, stress: 2 },
                tags: ["Push", "push"],
                notes: "felt strong",
                durationMinutes: 55,
                activities: [{ id: activityId(1), type: "strength", position: 0, rpe: 8 }],
            },
            metadata,
        );
        expect(updated.readiness).toMatchObject({ energy: 4, stress: 2 });
        expect(updated.tags).toEqual(["Push"]);
        expect(updated.durationMinutes).toBe(55);
        expect(updated.activities).toHaveLength(1);
    });

    it("archives and restores independently of lifecycle status", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        const archived = await fixture.commands.archive(created.id, created.version, metadata);
        expect(archived.archivedAt).not.toBeNull();
        const restored = await fixture.commands.restore(archived.id, archived.version, metadata);
        expect(restored.archivedAt).toBeNull();
    });

    it("excludes archived sessions from the default list", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        await fixture.commands.archive(created.id, created.version, metadata);
        expect(await fixture.repository.listSessions()).toHaveLength(0);
        expect(await fixture.repository.listSessions({ includeArchived: true })).toHaveLength(1);
    });

    it("rejects a mutation whose expected version is stale", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        await fixture.commands.start(created.id, created.version, metadata);
        await expect(fixture.commands.start(created.id, created.version, metadata)).rejects.toBeInstanceOf(
            VersionConflictError,
        );
    });

    it("reports a missing session on mutation", async () => {
        const fixture = createFixture();
        await expect(
            fixture.commands.start("0198a4db-d8da-7000-8000-000000009999", 1, metadata),
        ).rejects.toBeInstanceOf(TrainingSessionNotFoundError);
    });

    it("uses the injected clock for the created timestamp", async () => {
        const fixture = createFixture();
        const created = await fixture.commands.create({}, metadata);
        expect(created.createdAt).toBe(now.toISOString());
    });
});

function activityId(index: number): string {
    return `0198a4db-d8da-7000-8000-${index.toString(16).padStart(12, "0")}`;
}

function createFixture() {
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    let counter = 0;
    const generateId = () => `0198a4db-d8da-7000-8000-a${(++counter).toString(16).padStart(11, "0")}`;
    const clock = { now: () => now };
    const profileReader = {
        getActiveProfile: async () => ({
            id: PROFILE,
            timeZone: "Europe/Sofia",
            unitPreferences: { mass: "kg", distance: "km", height: "cm" } as never,
            birthDate: null,
            sex: null,
            heightMeters: null,
            version: 1,
        }),
    };
    const repository = new FakeTrainingSessionRepository();
    const mutations = new RevisionMutationService<TrainingSessionState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        trainingSessionSerializer,
        events,
        clock,
    );
    const commands = new TrainingSessionCommands({
        unitOfWork,
        repository,
        mutations,
        profileReader,
        clock,
        generateId,
    });
    return { commands, repository, events, revisions };
}

class FakeTrainingSessionRepository implements TrainingSessionRepository<typeof transaction> {
    private readonly values = new Map<string, { state: TrainingSessionState; version: number }>();

    async readSession(id: EntityId): Promise<TrainingSessionResource | null> {
        const stored = this.values.get(id);
        return stored ? { ...structuredClone(stored.state), version: stored.version } : null;
    }

    async listSessions(filter?: TrainingSessionListFilter): Promise<readonly TrainingSessionSummary[]> {
        return [...this.values.values()]
            .filter(item => filter?.includeArchived || item.state.archivedAt === null)
            .map(item => {
                const { activities, painRecords, ...core } = structuredClone(item.state);
                return {
                    ...core,
                    version: item.version,
                    activityCount: activities.length,
                    painRecordCount: painRecords.length,
                };
            });
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: TrainingSessionState, version: number): Promise<void> {
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: TrainingSessionState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new VersionConflictError(expectedVersion, nextVersion);
        this.values.set(id, { state: structuredClone(state), version: nextVersion });
    }
}

class FakeRevisionStore implements RevisionStore<typeof transaction> {
    readonly values: EntityRevision[] = [];

    async append(revision: EntityRevision): Promise<void> {
        this.values.push(structuredClone(revision));
    }

    async find(entityType: string, id: EntityId, version: number): Promise<EntityRevision | null> {
        return (
            this.values.find(
                item => item.entityType === entityType && item.entityId === id && item.version === version,
            ) ?? null
        );
    }

    async history(entityType: string, id: EntityId, limit: number) {
        return {
            items: this.values.filter(item => item.entityType === entityType && item.entityId === id).slice(0, limit),
            nextCursor: null,
        };
    }
}

class FakeEvents implements OutboxWriter<typeof transaction> {
    readonly values: DomainEvent[] = [];

    async publish(events: readonly DomainEvent[]): Promise<void> {
        this.values.push(...events);
    }
}
