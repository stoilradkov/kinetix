import type { DomainEvent } from "#src/platform/domain/index";
import { DomainEvent as PlatformDomainEvent, entityId, type Clock, type EntityId } from "#src/platform/domain/index";

import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    ExpectedVersionGuard,
    MigratingSnapshotSerializer,
    RevisionHistoryService,
    type CommandContext,
    type CurrentStateStore,
    type RevisionHistoryPage,
    type RevisionMetadata,
    type RevisionMutationService,
    type RevisionResourceHandler,
    type RevisionStore,
    type SnapshotResourceMapper,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    HEALTH_RECORD_BODY_SCHEMA_VERSION,
    ManualHealthRecord,
    promoteHealthRecord,
    type CreateManualHealthRecordInput,
    type HealthRecordBody,
    type HealthRecordSource,
    type HealthRecordType,
    type ManualHealthRecordState,
    type UpdateManualHealthRecordInput,
} from "#src/modules/health-data/domain/index";
import type { ProfileReader } from "#src/modules/profile/index";

export const HEALTH_RECORD_REPOSITORY = Symbol("HEALTH_RECORD_REPOSITORY");
export const HEALTH_RECORD_MUTATION_SERVICE = Symbol("HEALTH_RECORD_MUTATION_SERVICE");
export const HEALTH_RECORD_COMMANDS = Symbol("HEALTH_RECORD_COMMANDS");
export const HEALTH_RECORD_REVISION_HANDLER = Symbol("HEALTH_RECORD_REVISION_HANDLER");
export const HEALTH_CONTEXT_READER = Symbol("HEALTH_CONTEXT_READER");
export const HEALTH_RECORD_ENTITY_TYPE = "health.record";

export interface ManualHealthRecordResource extends ManualHealthRecordState {
    readonly version: number;
    readonly bodySchemaVersion: number;
}

export interface HealthRecordListFilter {
    readonly type?: HealthRecordType;
    readonly from?: string;
    readonly to?: string;
    readonly includeArchived?: boolean;
}

export interface HealthRecordRepository<Transaction = unknown> extends CurrentStateStore<
    ManualHealthRecordState,
    Transaction
> {
    readRecord(id: EntityId, transaction?: Transaction): Promise<ManualHealthRecordResource | null>;
    listRecords(filter?: HealthRecordListFilter): Promise<readonly ManualHealthRecordResource[]>;
}

export interface HealthRecordMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateManualHealthRecordCommand extends Omit<CreateManualHealthRecordInput, "id" | "profileId"> {
    readonly id?: string;
}

export class ManualHealthRecordNotFoundError extends ApplicationNotFoundError {
    constructor(readonly recordId: string) {
        super(`Health record ${recordId} was not found`, { recordId });
        this.name = "ManualHealthRecordNotFoundError";
    }
}

export const manualHealthRecordSerializer = new MigratingSnapshotSerializer<ManualHealthRecordState>(
    1,
    state => structuredClone(state),
    value => ManualHealthRecord.rehydrate(value as ManualHealthRecordState).state,
    [],
);

interface ManualHealthRecordCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: HealthRecordRepository<Transaction>;
    readonly mutations: RevisionMutationService<ManualHealthRecordState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class ManualHealthRecordCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: ManualHealthRecordCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Health record ID generation is not configured");
            });
    }

    async create(
        input: CreateManualHealthRecordCommand,
        metadata: HealthRecordMutationMetadata,
        transaction?: Transaction,
    ): Promise<ManualHealthRecordResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const record = ManualHealthRecord.create({ ...input, id: input.id ?? this.generateId(), profileId }, now);
        return this.inTransaction(transaction, async activeTransaction => {
            await this.runtime.mutations.create({
                entityType: HEALTH_RECORD_ENTITY_TYPE,
                entityId: entityId(record.state.id),
                state: record.state,
                metadata: revisionMetadata(metadata, "Recorded health data"),
                events: [this.upserted(record.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(record.state.id, activeTransaction);
        });
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        input: UpdateManualHealthRecordInput,
        metadata: HealthRecordMutationMetadata,
        transaction?: Transaction,
    ): Promise<ManualHealthRecordResource> {
        return this.applyChange(
            id,
            expectedVersion,
            (record, now) => record.update(input, now),
            "Updated health data",
            metadata,
            transaction,
        );
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: HealthRecordMutationMetadata,
        transaction?: Transaction,
    ): Promise<ManualHealthRecordResource> {
        return this.applyChange(
            id,
            expectedVersion,
            (record, now) => record.archive(now),
            "Archived health data",
            metadata,
            transaction,
        );
    }

    private applyChange(
        id: string,
        expectedVersion: number | undefined,
        change: (record: ManualHealthRecord, now: Date) => ManualHealthRecord,
        summary: string,
        metadata: HealthRecordMutationMetadata,
        transaction?: Transaction,
    ): Promise<ManualHealthRecordResource> {
        const recordId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                HEALTH_RECORD_ENTITY_TYPE,
                recordId,
                activeTransaction,
            );
            if (!stored) throw new ManualHealthRecordNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const result = await this.runtime.mutations.mutate({
                entityType: HEALTH_RECORD_ENTITY_TYPE,
                entityId: recordId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = change(ManualHealthRecord.rehydrate(state), now);
                    return {
                        state: next.state,
                        events: [this.upserted(next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, summary),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<ManualHealthRecordResource> {
        const resource = await this.runtime.repository.readRecord(entityId(id), transaction);
        if (!resource) throw new ManualHealthRecordNotFoundError(id);
        return resource;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private upserted(
        state: ManualHealthRecordState,
        aggregateRevision: number,
        metadata: HealthRecordMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: "health.record.upserted",
            version: 1,
            occurredAt,
            aggregateType: HEALTH_RECORD_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                recordId: state.id,
                profileId: state.profileId,
                type: state.type,
                recordVersion: aggregateRevision,
                effectiveAt: state.effectiveAt,
                archived: state.archivedAt !== null,
            },
        });
    }
}

const manualHealthRecordResourceMapper: SnapshotResourceMapper<ManualHealthRecordState, ManualHealthRecordResource> = {
    toResource: (state, revision) => ({
        ...state,
        version: revision.version,
        bodySchemaVersion: HEALTH_RECORD_BODY_SCHEMA_VERSION,
    }),
};

export class ManualHealthRecordRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<ManualHealthRecordResource> {
    readonly entityType = HEALTH_RECORD_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<
        ManualHealthRecordState,
        ManualHealthRecordResource,
        Transaction
    >;

    constructor(
        private readonly mutations: RevisionMutationService<ManualHealthRecordState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Health record event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            manualHealthRecordSerializer,
            manualHealthRecordResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<ManualHealthRecordResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: ManualHealthRecordResource }> {
        const now = this.clock.now();
        const result = await this.mutations.restore({
            entityType: this.entityType,
            entityId: input.entityId,
            restoreVersion: input.restoreVersion,
            expectedVersion: input.expectedVersion,
            metadata: input.metadata,
            events: [
                new PlatformDomainEvent({
                    id: this.generateId(),
                    name: "health.record.upserted",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: {
                        recordId: input.entityId,
                        recordVersion: input.expectedVersion + 1,
                        restoredVersion: input.restoreVersion,
                    },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: manualHealthRecordResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: manualHealthRecordSerializer.currentSchemaVersion,
                source: "restore",
                actorId: input.metadata.actorId ?? null,
                reason: input.metadata.reason ?? null,
                summary: input.metadata.summary,
                correlationId: input.metadata.correlationId,
                createdAt: now,
            }),
        };
    }
}

/** A single normalized point in a health context window, carrying its provenance. */
export interface HealthContextPoint {
    readonly id: string;
    readonly type: HealthRecordType;
    readonly source: HealthRecordSource;
    readonly effectiveAt: string;
    readonly value: number | null;
    readonly body: HealthRecordBody;
    readonly recordVersion: number;
}

/**
 * Explicit availability metadata so Training can tell "no context recorded" apart
 * from a genuine zero measurement.
 */
export interface HealthContextWindow {
    readonly type: HealthRecordType;
    readonly from: string;
    readonly to: string;
    readonly available: boolean;
    readonly source: HealthRecordSource | null;
    readonly points: readonly HealthContextPoint[];
}

export interface HealthContextQuery {
    readonly type: HealthRecordType;
    readonly from: string;
    readonly to: string;
}

/**
 * Public port other modules use to read health context by type over a time window,
 * without reaching into Health Data tables. See ADR 0005 / design 16.3.
 */
export interface HealthContextReader {
    readWindow(query: HealthContextQuery): Promise<HealthContextWindow>;
}

export class HealthContextReaderService implements HealthContextReader {
    constructor(private readonly repository: Pick<HealthRecordRepository, "listRecords">) {}

    async readWindow(query: HealthContextQuery): Promise<HealthContextWindow> {
        const from = instant(query.from, "from");
        const to = instant(query.to, "to");
        if (from > to)
            throw new ApplicationValidationError("Window start must not be after its end", {
                from: ["from must be on or before to"],
            });
        const records = await this.repository.listRecords({ type: query.type, from, to, includeArchived: false });
        const points = records.map(canonicalPoint);
        return {
            type: query.type,
            from,
            to,
            available: points.length > 0,
            source: points[0]?.source ?? null,
            points,
        };
    }
}

function canonicalPoint(resource: ManualHealthRecordResource): HealthContextPoint {
    return {
        id: resource.id,
        type: resource.type,
        source: resource.source,
        effectiveAt: resource.effectiveAt,
        value: canonicalValue(resource),
        body: resource.body,
        recordVersion: resource.version,
    };
}

function canonicalValue(resource: ManualHealthRecordResource): number | null {
    const promotion = promoteHealthRecord(resource);
    switch (resource.type) {
        case "body_weight":
            return promotion.massKg;
        case "resting_heart_rate":
            return promotion.restingHeartRateBpm;
        case "sleep":
            return promotion.sleepDurationMinutes;
        case "daily_readiness":
            return promotion.readinessScore;
    }
}

function instant(value: string, name: string): string {
    const date = new Date(String(value ?? "").trim());
    if (Number.isNaN(date.getTime()))
        throw new ApplicationValidationError(`Window bound '${name}' must be an ISO 8601 date-time`, {
            [name]: [`${name} must be an ISO 8601 date-time`],
        });
    return date.toISOString();
}

function revisionMetadata(metadata: HealthRecordMutationMetadata, summary: string): RevisionMetadata {
    return {
        source: metadata.source ?? "user",
        actorId: metadata.actorId ?? null,
        reason: metadata.reason ?? null,
        summary,
        correlationId: metadata.correlationId,
    };
}

function validEntityId(value: string): EntityId {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Health record ID must be a UUID", {
            recordId: ["Health record ID must be a UUID"],
        });
    }
}
