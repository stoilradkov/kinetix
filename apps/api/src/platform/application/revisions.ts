import {
    AggregateVersion,
    revisionReason,
    revisionSource,
    type Clock,
    type EntityId,
    type RevisionSource,
} from "#src/platform/domain/index";

import type { UnitOfWork } from "#src/platform/application/unit-of-work";

export interface RevisionSnapshot {
    schemaVersion: number;
    value: unknown;
}

export interface SnapshotSerializer<State> {
    readonly currentSchemaVersion: number;
    serialize(state: State): unknown;
    deserialize(snapshot: RevisionSnapshot): State;
}

export interface SnapshotMigration {
    fromVersion: number;
    migrate(value: unknown): unknown;
}

export class MigratingSnapshotSerializer<State> implements SnapshotSerializer<State> {
    constructor(
        readonly currentSchemaVersion: number,
        private readonly encode: (state: State) => unknown,
        private readonly decodeCurrent: (value: unknown) => State,
        private readonly migrations: readonly SnapshotMigration[],
    ) {
        if (!Number.isSafeInteger(currentSchemaVersion) || currentSchemaVersion < 1)
            throw new Error("Snapshot schema version must be a positive integer");
    }

    serialize(state: State): unknown {
        return this.encode(state);
    }

    deserialize(snapshot: RevisionSnapshot): State {
        if (snapshot.schemaVersion > this.currentSchemaVersion)
            throw new Error(
                `Snapshot schema version ${snapshot.schemaVersion} is newer than supported version ${this.currentSchemaVersion}`,
            );
        let version = snapshot.schemaVersion;
        let value = snapshot.value;
        while (version < this.currentSchemaVersion) {
            const migration = this.migrations.find(candidate => candidate.fromVersion === version);
            if (!migration) throw new Error(`No snapshot migration from schema version ${version}`);
            value = migration.migrate(value);
            version += 1;
        }
        return this.decodeCurrent(value);
    }
}

export interface EntityRevision {
    entityType: string;
    entityId: EntityId;
    version: number;
    schemaVersion: number;
    snapshot: unknown;
    source: RevisionSource;
    actorId: string | null;
    reason: string | null;
    summary: string;
    correlationId: string;
    createdAt: Date;
}

export interface RevisionPage {
    items: EntityRevision[];
    nextCursor: number | null;
}

export interface RevisionStore<Transaction = unknown> {
    append(revision: EntityRevision, transaction: Transaction): Promise<void>;
    find(
        entityType: string,
        entityId: EntityId,
        version: number,
        transaction?: Transaction,
    ): Promise<EntityRevision | null>;
    history(entityType: string, entityId: EntityId, limit: number, beforeVersion?: number): Promise<RevisionPage>;
}

export interface CurrentStateStore<State, Transaction = unknown> {
    save(
        entityType: string,
        entityId: EntityId,
        state: State,
        expectedVersion: number,
        nextVersion: number,
        transaction: Transaction,
    ): Promise<void>;
}

export interface TransactionalEventPublisher<Event, Transaction = unknown> {
    publish(events: readonly Event[], transaction: Transaction): Promise<void>;
}

export interface RevisionMetadata {
    source: RevisionSource;
    actorId?: string | null;
    reason?: string | null;
    summary: string;
    correlationId: string;
}

export class StaleAggregateVersionError extends Error {
    constructor(expected: number, actual: number) {
        super(`Expected aggregate version ${expected}, but current version is ${actual}`);
        this.name = "StaleAggregateVersionError";
    }
}

export class RevisionMutationService<State, Event = never, Transaction = unknown> {
    constructor(
        private readonly unitOfWork: UnitOfWork<Transaction>,
        private readonly states: CurrentStateStore<State, Transaction>,
        private readonly revisions: RevisionStore<Transaction>,
        private readonly serializer: SnapshotSerializer<State>,
        private readonly events: TransactionalEventPublisher<Event, Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
    ) {}

    async mutate(input: {
        entityType: string;
        entityId: EntityId;
        version: number;
        expectedVersion: number;
        state: State;
        change: (
            state: State,
        ) => Promise<{ state: State; events?: readonly Event[] }> | { state: State; events?: readonly Event[] };
        metadata: RevisionMetadata;
    }): Promise<{ state: State; version: number }> {
        const current = AggregateVersion.from(input.version);
        const expected = AggregateVersion.from(input.expectedVersion);
        if (!current.equals(expected)) throw new StaleAggregateVersionError(expected.value, current.value);

        const changed = await input.change(input.state);
        const next = current.next().value;
        const source = revisionSource(input.metadata.source);
        const reason = revisionReason(input.metadata.reason);
        const summary = requiredMetadata(input.metadata.summary, "summary");
        const correlationId = requiredMetadata(input.metadata.correlationId, "correlation ID");
        await this.unitOfWork.execute(async transaction => {
            await this.states.save(input.entityType, input.entityId, changed.state, current.value, next, transaction);
            await this.revisions.append(
                {
                    entityType: input.entityType,
                    entityId: input.entityId,
                    version: next,
                    schemaVersion: this.serializer.currentSchemaVersion,
                    snapshot: this.serializer.serialize(changed.state),
                    source,
                    actorId: input.metadata.actorId ?? null,
                    reason,
                    summary,
                    correlationId,
                    createdAt: this.clock.now(),
                },
                transaction,
            );
            await this.events.publish(changed.events ?? [], transaction);
        });
        return { state: changed.state, version: next };
    }

    async restore(input: {
        entityType: string;
        entityId: EntityId;
        version: number;
        expectedVersion: number;
        state: State;
        restoreVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        events?: readonly Event[];
    }): Promise<{ state: State; version: number }> {
        const revision = await this.revisions.find(input.entityType, input.entityId, input.restoreVersion);
        if (!revision) throw new Error(`Revision ${input.restoreVersion} was not found`);
        const restored = this.serializer.deserialize({
            schemaVersion: revision.schemaVersion,
            value: revision.snapshot,
        });
        return this.mutate({
            ...input,
            state: input.state,
            change: () => ({ state: restored, events: input.events }),
            metadata: { ...input.metadata, source: "restore" },
        });
    }
}

function requiredMetadata(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`Revision ${name} cannot be empty`);
    return normalized;
}
