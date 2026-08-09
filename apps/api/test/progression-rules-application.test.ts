import { describe, expect, it } from "vitest";

import {
    ArchivedProgressionTargetError,
    ProgressionRuleCommands,
    ProgressionRuleNotFoundError,
    UnknownProgressionTargetError,
    progressionRuleSerializer,
    type CreateProgressionRuleCommand,
    type ProgressionPlanningReader,
    type ProgressionRuleListFilter,
    type ProgressionRuleRepository,
    type ProgressionRuleResource,
    type ProgressionScopeDescriptor,
} from "#src/modules/training/application/index";
import type { ProgressionRuleState, RuleScope } from "#src/modules/training/domain/index";
import {
    RevisionMutationService,
    type CommandContext,
    type EntityRevision,
    type RevisionStore,
    type TransactionalEventPublisher,
    type UnitOfWork,
} from "#src/platform/application/index";
import type { DomainEvent, EntityId } from "#src/platform/domain/index";

const ids = {
    rule1: "0198a4db-d8da-7000-8000-000000000b01",
    rule2: "0198a4db-d8da-7000-8000-000000000b02",
    profile: "0198a4db-d8da-7000-8000-000000000b09",
    scope: "0198a4db-d8da-7000-8000-000000000b0a",
    missing: "0198a4db-d8da-7000-8000-000000000b0b",
    archived: "0198a4db-d8da-7000-8000-000000000b0c",
    event1: "0198a4db-d8da-7000-8000-000000000e01",
    event2: "0198a4db-d8da-7000-8000-000000000e02",
} as const;
const now = new Date("2026-08-09T12:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(overrides: Partial<CreateProgressionRuleCommand> = {}): CreateProgressionRuleCommand {
    return {
        id: ids.rule1,
        name: "Progress bench",
        scope: { type: "template", id: ids.scope },
        target: { mode: "next", selector: { kind: "scope" } },
        condition: {
            kind: "metric",
            metric: { key: "completed_all_sets", scope: "exercise" },
            operator: "eq",
            value: true,
        },
        actions: [{ type: "adjust_load", mode: "percent", value: 2.5 }],
        ...overrides,
    };
}

describe("progression rule application services", () => {
    it("binds the active profile, validates the scope target, and records a revision + event", async () => {
        const fixture = createFixture([ids.event1]);
        const created = await fixture.commands.create(command(), metadata);
        expect(created).toMatchObject({ id: ids.rule1, profileId: ids.profile, version: 1, enabled: true });
        expect(fixture.revisions.values).toHaveLength(1);
        expect(fixture.events.values).toHaveLength(1);
    });

    it("rejects an unknown scope target before persisting", async () => {
        const fixture = createFixture([ids.event1]);
        await expect(
            fixture.commands.create(command({ scope: { type: "template", id: ids.missing } }), metadata),
        ).rejects.toBeInstanceOf(UnknownProgressionTargetError);
        expect(fixture.revisions.values).toHaveLength(0);
    });

    it("rejects an archived scope target", async () => {
        const fixture = createFixture([ids.event1]);
        await expect(
            fixture.commands.create(command({ scope: { type: "program", id: ids.archived } }), metadata),
        ).rejects.toBeInstanceOf(ArchivedProgressionTargetError);
    });

    it("updates a rule, bumps its version, and rejects a stale version", async () => {
        const fixture = createFixture([ids.event1, ids.event2]);
        await fixture.commands.create(command(), metadata);
        const updated = await fixture.commands.update(ids.rule1, 1, { enabled: false }, metadata);
        expect(updated).toMatchObject({ enabled: false, version: 2 });
        await expect(fixture.commands.update(ids.rule1, 99, { enabled: true }, metadata)).rejects.toThrow();
    });

    it("re-validates the scope target when an update changes it", async () => {
        const fixture = createFixture([ids.event1]);
        await fixture.commands.create(command(), metadata);
        await expect(
            fixture.commands.update(ids.rule1, 1, { scope: { type: "template", id: ids.missing } }, metadata),
        ).rejects.toBeInstanceOf(UnknownProgressionTargetError);
    });

    it("archives and restores across versions", async () => {
        const fixture = createFixture([ids.event1, ids.event2, "0198a4db-d8da-7000-8000-000000000e03"]);
        await fixture.commands.create(command(), metadata);
        const archived = await fixture.commands.archive(ids.rule1, 1, metadata);
        expect(archived).toMatchObject({ status: "archived", version: 2 });
        const restored = await fixture.commands.restore(ids.rule1, 2, metadata);
        expect(restored).toMatchObject({ status: "active", archivedAt: null, version: 3 });
    });

    it("reports an unknown rule", async () => {
        const fixture = createFixture([]);
        await expect(fixture.commands.update(ids.rule2, 1, { enabled: false }, metadata)).rejects.toBeInstanceOf(
            ProgressionRuleNotFoundError,
        );
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeProgressionRuleRepository();
    const revisions = new FakeRevisionStore();
    const events = new FakeEvents();
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    const mutations = new RevisionMutationService<ProgressionRuleState, DomainEvent, typeof transaction>(
        unitOfWork,
        repository,
        revisions,
        progressionRuleSerializer,
        events,
        { now: () => now },
    );
    const commands = new ProgressionRuleCommands({
        unitOfWork,
        repository,
        mutations,
        profileReader: { requireActiveProfileId: async () => ids.profile },
        planning: new FakePlanningReader(),
        clock: { now: () => now },
        generateId: () => {
            const id = generatedIds.shift();
            if (!id) throw new Error("No generated ID remains");
            return id;
        },
    });
    return { repository, revisions, events, commands };
}

function resource(state: ProgressionRuleState, version: number): ProgressionRuleResource {
    return { ...structuredClone(state), version };
}

class FakePlanningReader implements ProgressionPlanningReader<typeof transaction> {
    async describeScope(scope: RuleScope): Promise<ProgressionScopeDescriptor | null> {
        if (scope.id === ids.missing) return { exists: false, archived: false };
        if (scope.id === ids.archived) return { exists: true, archived: true };
        return { exists: true, archived: false };
    }
}

class FakeProgressionRuleRepository implements ProgressionRuleRepository<typeof transaction> {
    private readonly values = new Map<string, { state: ProgressionRuleState; version: number }>();

    async readRule(id: EntityId): Promise<ProgressionRuleResource | null> {
        const stored = this.values.get(id);
        return stored ? resource(stored.state, stored.version) : null;
    }

    async listRules(filter?: ProgressionRuleListFilter): Promise<readonly ProgressionRuleResource[]> {
        return [...this.values.values()]
            .filter(item => filter?.includeArchived || item.state.status === "active")
            .map(item => resource(item.state, item.version));
    }

    async loadForUpdate(_entityType: string, id: EntityId) {
        const stored = this.values.get(id);
        return stored ? structuredClone(stored) : null;
    }

    async create(_entityType: string, id: EntityId, state: ProgressionRuleState, version: number): Promise<void> {
        if (this.values.has(id)) throw new Error("duplicate progression rule");
        this.values.set(id, { state: structuredClone(state), version });
    }

    async save(
        _entityType: string,
        id: EntityId,
        state: ProgressionRuleState,
        expectedVersion: number,
        nextVersion: number,
    ): Promise<void> {
        const stored = this.values.get(id);
        if (!stored || stored.version !== expectedVersion) throw new Error("version conflict");
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

class FakeEvents implements TransactionalEventPublisher<DomainEvent, typeof transaction> {
    readonly values: DomainEvent[] = [];

    async publish(events: readonly DomainEvent[]): Promise<void> {
        this.values.push(...events);
    }
}
