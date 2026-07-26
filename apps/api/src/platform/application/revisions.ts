import {
    AggregateVersion,
    revisionReason,
    revisionSource,
    type Clock,
    type EntityId,
    type RevisionSource,
} from "#src/platform/domain/index";

import type { UnitOfWork } from "#src/platform/application/unit-of-work";

export const REVISION_STORE = Symbol("REVISION_STORE");

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
        const migrationVersions = new Set<number>();
        for (const migration of migrations) {
            if (
                !Number.isSafeInteger(migration.fromVersion) ||
                migration.fromVersion < 1 ||
                migration.fromVersion >= currentSchemaVersion
            )
                throw new Error(`Invalid snapshot migration from schema version ${migration.fromVersion}`);
            if (migrationVersions.has(migration.fromVersion))
                throw new Error(`Duplicate snapshot migration from schema version ${migration.fromVersion}`);
            migrationVersions.add(migration.fromVersion);
        }
    }

    serialize(state: State): unknown {
        return this.encode(state);
    }

    deserialize(snapshot: RevisionSnapshot): State {
        if (!Number.isSafeInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1)
            throw new Error("Snapshot schema version must be a positive integer");
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
    loadForUpdate(
        entityType: string,
        entityId: EntityId,
        transaction: Transaction,
    ): Promise<{ state: State; version: number } | null>;
    create(
        entityType: string,
        entityId: EntityId,
        state: State,
        version: number,
        transaction: Transaction,
    ): Promise<void>;
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
    constructor(
        readonly expected: number,
        readonly actual: number,
    ) {
        super(`Expected aggregate version ${expected}, but current version is ${actual}`);
        this.name = "StaleAggregateVersionError";
    }
}

export class RevisionNotFoundError extends Error {
    constructor(
        readonly entityType: string,
        readonly entityId: EntityId,
        readonly version: number,
    ) {
        super(`Revision ${version} was not found for ${entityType} ${entityId}`);
        this.name = "RevisionNotFoundError";
    }
}

export class RevisionAggregateNotFoundError extends Error {
    constructor(
        readonly entityType: string,
        readonly entityId: EntityId,
    ) {
        super(`${entityType} ${entityId} was not found`);
        this.name = "RevisionAggregateNotFoundError";
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

    async create(input: {
        entityType: string;
        entityId: EntityId;
        state: State;
        metadata: RevisionMetadata;
        events?: readonly Event[];
    }): Promise<{ state: State; version: number }> {
        const version = AggregateVersion.initial().value;
        const revision = this.createRevision(input.entityType, input.entityId, version, input.state, input.metadata);
        await this.unitOfWork.execute(async transaction => {
            await this.states.create(input.entityType, input.entityId, input.state, version, transaction);
            await this.revisions.append(revision, transaction);
            await this.events.publish(input.events ?? [], transaction);
        });
        return { state: input.state, version };
    }

    async mutate(input: {
        entityType: string;
        entityId: EntityId;
        expectedVersion: number;
        change: (
            state: State,
        ) => Promise<{ state: State; events?: readonly Event[] }> | { state: State; events?: readonly Event[] };
        metadata: RevisionMetadata;
    }): Promise<{ state: State; version: number }> {
        return this.unitOfWork.execute(transaction => this.mutateInTransaction(input, transaction));
    }

    async restore(input: {
        entityType: string;
        entityId: EntityId;
        expectedVersion: number;
        restoreVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        events?: readonly Event[];
    }): Promise<{ state: State; version: number }> {
        const restoreVersion = AggregateVersion.from(input.restoreVersion).value;
        return this.unitOfWork.execute(transaction =>
            this.mutateInTransaction(
                {
                    entityType: input.entityType,
                    entityId: input.entityId,
                    expectedVersion: input.expectedVersion,
                    change: async () => {
                        const revision = await this.revisions.find(
                            input.entityType,
                            input.entityId,
                            restoreVersion,
                            transaction,
                        );
                        if (!revision)
                            throw new RevisionNotFoundError(input.entityType, input.entityId, restoreVersion);
                        return {
                            state: this.serializer.deserialize({
                                schemaVersion: revision.schemaVersion,
                                value: revision.snapshot,
                            }),
                            events: input.events,
                        };
                    },
                    metadata: { ...input.metadata, source: "restore" },
                },
                transaction,
            ),
        );
    }

    private async mutateInTransaction(
        input: {
            entityType: string;
            entityId: EntityId;
            expectedVersion: number;
            change: (
                state: State,
            ) => Promise<{ state: State; events?: readonly Event[] }> | { state: State; events?: readonly Event[] };
            metadata: RevisionMetadata;
        },
        transaction: Transaction,
    ): Promise<{ state: State; version: number }> {
        const stored = await this.states.loadForUpdate(input.entityType, input.entityId, transaction);
        if (!stored) throw new RevisionAggregateNotFoundError(input.entityType, input.entityId);
        const current = AggregateVersion.from(stored.version);
        const expected = AggregateVersion.from(input.expectedVersion);
        if (!current.equals(expected)) throw new StaleAggregateVersionError(expected.value, current.value);

        const changed = await input.change(stored.state);
        const next = current.next().value;
        const revision = this.createRevision(input.entityType, input.entityId, next, changed.state, input.metadata);
        await this.states.save(input.entityType, input.entityId, changed.state, current.value, next, transaction);
        await this.revisions.append(revision, transaction);
        await this.events.publish(changed.events ?? [], transaction);
        return { state: changed.state, version: next };
    }

    private createRevision(
        entityType: string,
        entityId: EntityId,
        version: number,
        state: State,
        metadata: RevisionMetadata,
    ): EntityRevision {
        return {
            entityType: requiredMetadata(entityType, "entity type"),
            entityId,
            version,
            schemaVersion: this.serializer.currentSchemaVersion,
            snapshot: this.serializer.serialize(state),
            source: revisionSource(metadata.source),
            actorId: metadata.actorId ?? null,
            reason: revisionReason(metadata.reason),
            summary: requiredMetadata(metadata.summary, "summary"),
            correlationId: requiredMetadata(metadata.correlationId, "correlation ID"),
            createdAt: this.clock.now(),
        };
    }
}

function requiredMetadata(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`Revision ${name} cannot be empty`);
    return normalized;
}

export interface SnapshotResourceMapper<State, Resource> {
    toResource(state: State, revision: Omit<EntityRevision, "snapshot">): Resource;
}

export interface RevisionHistoryItem<Resource> extends Omit<EntityRevision, "snapshot"> {
    resource: Resource;
}

export interface RevisionHistoryPage<Resource = unknown> {
    items: RevisionHistoryItem<Resource>[];
    nextCursor: number | null;
}

export class RevisionHistoryService<State, Resource, Transaction = unknown> {
    constructor(
        private readonly revisions: RevisionStore<Transaction>,
        private readonly serializer: SnapshotSerializer<State>,
        private readonly resources: SnapshotResourceMapper<State, Resource>,
    ) {}

    async history(input: {
        entityType: string;
        entityId: EntityId;
        limit: number;
        beforeVersion?: number;
    }): Promise<RevisionHistoryPage<Resource>> {
        const page = await this.revisions.history(input.entityType, input.entityId, input.limit, input.beforeVersion);
        return {
            items: page.items.map(revision => {
                const { snapshot, ...metadata } = revision;
                const state = this.serializer.deserialize({
                    schemaVersion: revision.schemaVersion,
                    value: snapshot,
                });
                return {
                    ...metadata,
                    resource: this.resources.toResource(state, metadata),
                };
            }),
            nextCursor: page.nextCursor,
        };
    }
}

export interface RevisionResourceHandler<Resource = unknown> {
    readonly entityType: string;
    history(
        entityId: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<Resource>>;
    restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
    }): Promise<{ version: number; resource: Resource }>;
}

export class UnsupportedRevisionEntityTypeError extends Error {
    constructor(readonly entityType: string) {
        super(`Revision history is not available for entity type ${entityType}`);
        this.name = "UnsupportedRevisionEntityTypeError";
    }
}

export class RevisionResourceRegistry {
    private readonly handlers = new Map<string, RevisionResourceHandler>();

    register(handler: RevisionResourceHandler): void {
        const entityType = requiredMetadata(handler.entityType, "entity type");
        if (this.handlers.has(entityType)) throw new Error(`Revision handler already registered for ${entityType}`);
        this.handlers.set(entityType, handler);
    }

    async history(
        entityType: string,
        entityId: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage> {
        return this.get(entityType).history(entityId, pagination);
    }

    async restore(
        entityType: string,
        input: {
            entityId: EntityId;
            restoreVersion: number;
            expectedVersion: number;
            metadata: Omit<RevisionMetadata, "source">;
        },
    ): Promise<{ version: number; resource: unknown }> {
        return this.get(entityType).restore(input);
    }

    private get(entityType: string): RevisionResourceHandler {
        const handler = this.handlers.get(entityType);
        if (!handler) throw new UnsupportedRevisionEntityTypeError(entityType);
        return handler;
    }
}
