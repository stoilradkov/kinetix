import { describe, expect, it } from "vitest";

import {
    RepositoryZoneContextReader,
    ZoneDefinitionCommands,
    ZoneDefinitionQueries,
    type RecordZoneDefinitionCommand,
    type ZoneDefinitionRepository,
} from "#src/modules/training/application/index";
import type { ZoneDefinitionState, ZoneFamily } from "#src/modules/training/domain/index";
import type { CommandContext, OutboxWriter } from "#src/platform/application/index";
import type { DomainEvent } from "#src/platform/domain/index";

const ids = {
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function uuidPool(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `0198a4db-d8da-7000-8000-0000000${(10000 + index).toString()}`);
}
const transaction = {};
const metadata: CommandContext = { correlationId: "request-1", source: "user" };

function command(overrides: Partial<RecordZoneDefinitionCommand> = {}): RecordZoneDefinitionCommand {
    return {
        family: "heart_rate",
        method: "manual",
        ranges: [
            { position: 0, name: "Z1", lowerBound: 0, upperBound: 130 },
            { position: 1, name: "Z2", lowerBound: 130, upperBound: null },
        ],
        ...overrides,
    };
}

describe("zone definition application services", () => {
    it("records a definition and publishes a change event", async () => {
        const fixture = createFixture(uuidPool(8));
        const recorded = await fixture.commands.record(command(), metadata);
        expect(recorded).toMatchObject({ family: "heart_rate", method: "manual", effectiveTo: null });
        expect(recorded.ranges).toHaveLength(2);
        expect(fixture.outbox.values[0]?.name).toBe("training.zone-definition.changed");
    });

    it("closes the prior definition for a family and resolves by instant", async () => {
        const fixture = createFixture(uuidPool(16));
        await fixture.commands.record(command({ effectiveFrom: "2026-01-01T00:00:00.000Z" }), metadata);
        await fixture.commands.record(command({ effectiveFrom: "2026-06-01T00:00:00.000Z" }), metadata);

        const history = await fixture.queries.history("heart_rate");
        expect(history).toHaveLength(2);
        expect(history[0]?.effectiveTo).toBe("2026-06-01T00:00:00.000Z");

        const early = await fixture.contextReader.resolveZoneDefinition({
            profileId: ids.profile,
            family: "heart_rate",
            at: "2026-03-01T00:00:00.000Z",
        });
        expect(early?.effectiveTo).toBe("2026-06-01T00:00:00.000Z");
        const late = await fixture.contextReader.resolveZoneDefinition({
            profileId: ids.profile,
            family: "heart_rate",
            at: "2026-07-01T00:00:00.000Z",
        });
        expect(late?.effectiveTo).toBeNull();
    });
});

function createFixture(generatedIds: string[]) {
    const repository = new FakeZoneDefinitionRepository();
    const outbox = new FakeOutbox();
    const profileReader = { requireActiveProfileId: async () => ids.profile };
    const commands = new ZoneDefinitionCommands({
        unitOfWork: { execute: work => work(transaction) },
        repository,
        outbox,
        profileReader,
        clock: { now: () => now },
        generateId: () => {
            const id = generatedIds.shift();
            if (!id) throw new Error("No generated ID remains");
            return id;
        },
    });
    const queries = new ZoneDefinitionQueries(repository, profileReader);
    const contextReader = new RepositoryZoneContextReader(repository);
    return { repository, outbox, commands, queries, contextReader };
}

class FakeZoneDefinitionRepository implements ZoneDefinitionRepository<typeof transaction> {
    private readonly values = new Map<string, ZoneDefinitionState>();

    async insert(state: ZoneDefinitionState): Promise<void> {
        this.values.set(state.id, structuredClone(state));
    }

    async findOpenForUpdate(profileId: string, family: ZoneFamily): Promise<ZoneDefinitionState | null> {
        const match = [...this.values.values()].find(
            state => state.profileId === profileId && state.family === family && state.effectiveTo === null,
        );
        return match ? structuredClone(match) : null;
    }

    async close(id: string, effectiveTo: string, updatedAt: string): Promise<void> {
        const stored = this.values.get(id);
        if (!stored) throw new Error("missing zone definition");
        this.values.set(id, { ...stored, effectiveTo, updatedAt });
    }

    async listCurrent(profileId: string): Promise<readonly ZoneDefinitionState[]> {
        return [...this.values.values()].filter(state => state.profileId === profileId && state.effectiveTo === null);
    }

    async listSeries(profileId: string, family: ZoneFamily): Promise<readonly ZoneDefinitionState[]> {
        return [...this.values.values()]
            .filter(state => state.profileId === profileId && state.family === family)
            .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    }
}

class FakeOutbox implements OutboxWriter<typeof transaction> {
    readonly values: DomainEvent[] = [];

    async publish(events: readonly DomainEvent[]): Promise<void> {
        this.values.push(...events);
    }
}
