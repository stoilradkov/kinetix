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
    CoreProfile,
    type CoreProfileState,
    type CreateCoreProfileInput,
    type UpdateCoreProfileInput,
} from "#src/modules/profile/domain/index";

export const CORE_PROFILE_REPOSITORY = Symbol("CORE_PROFILE_REPOSITORY");
export const CORE_PROFILE_MUTATION_SERVICE = Symbol("CORE_PROFILE_MUTATION_SERVICE");
export const CORE_PROFILE_COMMANDS = Symbol("CORE_PROFILE_COMMANDS");
export const CORE_PROFILE_REVISION_HANDLER = Symbol("CORE_PROFILE_REVISION_HANDLER");
export const CORE_PROFILE_ENTITY_TYPE = "profile.core";

export interface StoredCoreProfile {
    readonly state: CoreProfileState;
    readonly version: number;
}

export interface CoreProfileResource extends CoreProfileState {
    readonly version: number;
}

export interface CoreProfileRepository<Transaction = unknown> extends CurrentStateStore<CoreProfileState, Transaction> {
    findActive(transaction?: Transaction): Promise<StoredCoreProfile | null>;
    readActive(transaction?: Transaction): Promise<CoreProfileResource | null>;
    readProfile(id: EntityId, transaction?: Transaction): Promise<CoreProfileResource | null>;
}

export interface CoreProfileMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateCoreProfileCommand extends Omit<CreateCoreProfileInput, "id"> {
    readonly id?: string;
}

export class ActiveCoreProfileExistsError extends ApplicationValidationError {
    constructor() {
        super("An active core profile already exists; update it instead of creating another");
        this.name = "ActiveCoreProfileExistsError";
    }
}

export class CoreProfileNotFoundError extends ApplicationNotFoundError {
    constructor() {
        super("No active core profile exists");
        this.name = "CoreProfileNotFoundError";
    }
}

export const coreProfileSerializer = new MigratingSnapshotSerializer<CoreProfileState>(
    1,
    state => structuredClone(state),
    value => CoreProfile.rehydrate(value as CoreProfileState).state,
    [],
);

interface CoreProfileCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: CoreProfileRepository<Transaction>;
    readonly mutations: RevisionMutationService<CoreProfileState, DomainEvent, Transaction>;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class CoreProfileCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: CoreProfileCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Core profile ID generation is not configured");
            });
    }

    create(
        input: CreateCoreProfileCommand,
        metadata: CoreProfileMutationMetadata,
        transaction?: Transaction,
    ): Promise<CoreProfileResource> {
        const now = this.clock.now();
        const profile = CoreProfile.create({ ...input, id: input.id ?? this.generateId() }, now);
        return this.inTransaction(transaction, async activeTransaction => {
            if (await this.runtime.repository.findActive(activeTransaction)) throw new ActiveCoreProfileExistsError();
            await this.runtime.mutations.create({
                entityType: CORE_PROFILE_ENTITY_TYPE,
                entityId: entityId(profile.state.id),
                state: profile.state,
                metadata: revisionMetadata(metadata, "Created core profile"),
                events: [this.event("created", profile.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(profile.state.id, activeTransaction);
        });
    }

    update(
        expectedVersion: number | undefined,
        input: UpdateCoreProfileInput,
        metadata: CoreProfileMutationMetadata,
        transaction?: Transaction,
    ): Promise<CoreProfileResource> {
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.findActive(activeTransaction);
            if (!stored) throw new CoreProfileNotFoundError();
            this.expectedVersions.verify(expectedVersion, stored.version);
            const id = entityId(stored.state.id);
            const result = await this.runtime.mutations.mutate({
                entityType: CORE_PROFILE_ENTITY_TYPE,
                entityId: id,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = CoreProfile.rehydrate(state).update(input, now);
                    return {
                        state: next.state,
                        events: [this.event("updated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Updated core profile"),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<CoreProfileResource> {
        const resource = await this.runtime.repository.readProfile(entityId(id), transaction);
        if (!resource) throw new CoreProfileNotFoundError();
        return resource;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: "created" | "updated",
        state: CoreProfileState,
        aggregateRevision: number,
        metadata: CoreProfileMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `profile.core.${action}`,
            version: 1,
            occurredAt,
            aggregateType: CORE_PROFILE_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: { profileId: state.id, profileVersion: aggregateRevision, status: state.status },
        });
    }
}

const coreProfileRevisionResourceMapper: SnapshotResourceMapper<CoreProfileState, CoreProfileResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class CoreProfileRevisionHandler<Transaction = unknown> implements RevisionResourceHandler<CoreProfileResource> {
    readonly entityType = CORE_PROFILE_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<CoreProfileState, CoreProfileResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<CoreProfileState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Core profile event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            coreProfileSerializer,
            coreProfileRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<CoreProfileResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: CoreProfileResource }> {
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
                    name: "profile.core.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: {
                        profileId: input.entityId,
                        profileVersion: input.expectedVersion + 1,
                        restoredVersion: input.restoreVersion,
                    },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: coreProfileRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: coreProfileSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: CoreProfileMutationMetadata, summary: string): RevisionMetadata {
    return {
        source: metadata.source ?? "user",
        actorId: metadata.actorId ?? null,
        reason: metadata.reason ?? null,
        summary,
        correlationId: metadata.correlationId,
    };
}
