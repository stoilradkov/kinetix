import { DomainEvent as PlatformDomainEvent, type Clock } from "#src/platform/domain/index";
import type { DomainEvent } from "#src/platform/domain/index";

import {
    ApplicationValidationError,
    type CommandContext,
    type OutboxWriter,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    ZoneDefinition,
    resolveEffectiveZoneDefinition,
    type RecordZoneDefinitionInput,
    type ZoneDefinitionState,
    type ZoneFamily,
    type ZoneMethod,
    type ZoneRangeInput,
    type ZoneRangeState,
} from "#src/modules/training/domain/index";
import type { ProfileReader } from "#src/modules/profile/index";

export const ZONE_DEFINITION_REPOSITORY = Symbol("ZONE_DEFINITION_REPOSITORY");
export const ZONE_DEFINITION_COMMANDS = Symbol("ZONE_DEFINITION_COMMANDS");
export const ZONE_DEFINITION_QUERIES = Symbol("ZONE_DEFINITION_QUERIES");
export const ZONE_CONTEXT_READER = Symbol("ZONE_CONTEXT_READER");
export const ZONE_DEFINITION_ENTITY_TYPE = "training.zone-definition";

export type ZoneDefinitionResource = ZoneDefinitionState;

export interface ZoneDefinitionRepository<Transaction = unknown> {
    insert(state: ZoneDefinitionState, transaction: Transaction): Promise<void>;
    findOpenForUpdate(
        profileId: string,
        family: ZoneFamily,
        transaction: Transaction,
    ): Promise<ZoneDefinitionState | null>;
    close(id: string, effectiveTo: string, updatedAt: string, transaction: Transaction): Promise<void>;
    listCurrent(profileId: string): Promise<readonly ZoneDefinitionState[]>;
    listSeries(profileId: string, family: ZoneFamily): Promise<readonly ZoneDefinitionState[]>;
}

export interface ZoneDefinitionMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

/** Controller-facing command: ranges omit IDs, which the command generates. */
export interface RecordZoneDefinitionCommand extends Omit<RecordZoneDefinitionInput, "id" | "profileId" | "ranges"> {
    readonly ranges: readonly Omit<ZoneRangeInput, "id">[];
}

interface ZoneDefinitionCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: ZoneDefinitionRepository<Transaction>;
    readonly outbox: OutboxWriter<Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class ZoneDefinitionBackdatedError extends ApplicationValidationError {
    constructor() {
        super("A new zone definition must take effect after the current record", {
            effectiveFrom: ["Effective-from must be after the current record's start"],
        });
        this.name = "ZoneDefinitionBackdatedError";
    }
}

export class ZoneDefinitionCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;

    constructor(private readonly runtime: ZoneDefinitionCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Zone definition ID generation is not configured");
            });
    }

    async record(
        input: RecordZoneDefinitionCommand,
        metadata: ZoneDefinitionMutationMetadata,
        transaction?: Transaction,
    ): Promise<ZoneDefinitionResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        const ranges: ZoneRangeInput[] = input.ranges.map(range => ({ ...range, id: this.generateId() }));
        const definition = ZoneDefinition.record({ ...input, id: this.generateId(), profileId, ranges }, now);
        const state = definition.state;
        return this.inTransaction(transaction, async activeTransaction => {
            const open = await this.runtime.repository.findOpenForUpdate(profileId, state.family, activeTransaction);
            let closed: ZoneDefinitionState | null = null;
            if (open) {
                if (state.effectiveFrom <= open.effectiveFrom) throw new ZoneDefinitionBackdatedError();
                closed = ZoneDefinition.rehydrate(open).close(state.effectiveFrom, now).state;
                await this.runtime.repository.close(open.id, closed.effectiveTo!, closed.updatedAt, activeTransaction);
            }
            await this.runtime.repository.insert(state, activeTransaction);
            await this.runtime.outbox.publish(
                [this.changedEvent(state, closed, now, metadata)],
                activeTransaction,
                metadata,
            );
            return state;
        });
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private changedEvent(
        state: ZoneDefinitionState,
        closed: ZoneDefinitionState | null,
        occurredAt: Date,
        metadata: ZoneDefinitionMutationMetadata,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: "training.zone-definition.changed",
            version: 1,
            occurredAt,
            aggregateType: ZONE_DEFINITION_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision: 1,
            correlationId: metadata.correlationId,
            payload: {
                zoneDefinitionId: state.id,
                profileId: state.profileId,
                family: state.family,
                method: state.method,
                // Only runs within the affected interval need invalidation (design 16.3).
                effectiveFrom: closed ? closed.effectiveFrom : state.effectiveFrom,
                effectiveTo: null,
                supersededZoneDefinitionId: closed ? closed.id : null,
            },
        });
    }
}

export class ZoneDefinitionQueries<Transaction = unknown> {
    constructor(
        private readonly repository: ZoneDefinitionRepository<Transaction>,
        private readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">,
    ) {}

    async listCurrent(): Promise<readonly ZoneDefinitionResource[]> {
        const profileId = await this.profileReader.requireActiveProfileId();
        return this.repository.listCurrent(profileId);
    }

    async history(family: ZoneFamily): Promise<readonly ZoneDefinitionResource[]> {
        const profileId = await this.profileReader.requireActiveProfileId();
        return this.repository.listSeries(profileId, family);
    }

    async current(family: ZoneFamily): Promise<ZoneDefinitionResource | null> {
        const profileId = await this.profileReader.requireActiveProfileId();
        const records = await this.repository.listSeries(profileId, family);
        return records.find(record => record.effectiveTo === null) ?? null;
    }

    async asOf(family: ZoneFamily, at: string): Promise<ZoneDefinitionResource | null> {
        const profileId = await this.profileReader.requireActiveProfileId();
        const records = await this.repository.listSeries(profileId, family);
        return resolveEffectiveZoneDefinition(records, at);
    }
}

/** Effective zone definition in force at an instant, for session start/analytics. */
export interface ResolvedZoneDefinition {
    readonly zoneDefinitionId: string;
    readonly family: ZoneFamily;
    readonly method: ZoneMethod;
    readonly ranges: readonly ZoneRangeState[];
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
}

export interface ResolveZoneDefinitionQuery {
    readonly profileId: string;
    readonly family: ZoneFamily;
    readonly at: string;
}

export interface ZoneContextReader {
    resolveZoneDefinition(query: ResolveZoneDefinitionQuery): Promise<ResolvedZoneDefinition | null>;
}

export class RepositoryZoneContextReader<Transaction = unknown> implements ZoneContextReader {
    constructor(private readonly repository: ZoneDefinitionRepository<Transaction>) {}

    async resolveZoneDefinition(query: ResolveZoneDefinitionQuery): Promise<ResolvedZoneDefinition | null> {
        const records = await this.repository.listSeries(query.profileId, query.family);
        const effective = resolveEffectiveZoneDefinition(records, query.at);
        if (!effective) return null;
        return {
            zoneDefinitionId: effective.id,
            family: effective.family,
            method: effective.method,
            ranges: effective.ranges,
            effectiveFrom: effective.effectiveFrom,
            effectiveTo: effective.effectiveTo,
        };
    }
}
