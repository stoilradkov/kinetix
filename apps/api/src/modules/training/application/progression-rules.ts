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
    ProgressionRule,
    type CreateProgressionRuleInput,
    type ProgressionRuleState,
    type RuleScope,
    type RuleScopeType,
    type UpdateProgressionRuleInput,
} from "#src/modules/training/domain/index";
import type { ProfileReader } from "#src/modules/profile/index";

export const PROGRESSION_RULE_REPOSITORY = Symbol("PROGRESSION_RULE_REPOSITORY");
export const PROGRESSION_RULE_MUTATION_SERVICE = Symbol("PROGRESSION_RULE_MUTATION_SERVICE");
export const PROGRESSION_RULE_COMMANDS = Symbol("PROGRESSION_RULE_COMMANDS");
export const PROGRESSION_RULE_REVISION_HANDLER = Symbol("PROGRESSION_RULE_REVISION_HANDLER");
export const PROGRESSION_PLANNING_READER = Symbol("PROGRESSION_PLANNING_READER");
export const PROGRESSION_RULE_ENTITY_TYPE = "training.progression-rule";

export interface ProgressionRuleResource extends ProgressionRuleState {
    readonly version: number;
}

export interface ProgressionRuleListFilter {
    readonly includeArchived?: boolean;
    readonly scopeType?: RuleScopeType;
    readonly enabled?: boolean;
}

/**
 * Capability port over the editable rule root plus its read models. Extends
 * {@link CurrentStateStore} so the shared {@link RevisionMutationService} can drive versioning.
 */
export interface ProgressionRuleRepository<Transaction = unknown> extends CurrentStateStore<
    ProgressionRuleState,
    Transaction
> {
    readRule(id: EntityId, transaction?: Transaction): Promise<ProgressionRuleResource | null>;
    listRules(filter?: ProgressionRuleListFilter): Promise<readonly ProgressionRuleResource[]>;
}

/** What the planning layer knows about a scope target the rule wants to attach to. */
export interface ProgressionScopeDescriptor {
    readonly exists: boolean;
    readonly archived: boolean;
}

/**
 * Read port the rule commands use to resolve and validate scope targets against plans, so the
 * pure aggregate never queries plans itself (design 15.2, ADR 0007). Deep logical-selector
 * resolution against prescription trees is an evaluation concern (G2); this port only decides
 * whether the scoped entity exists and is still active.
 */
export interface ProgressionPlanningReader<Transaction = unknown> {
    describeScope(scope: RuleScope, transaction?: Transaction): Promise<ProgressionScopeDescriptor | null>;
}

export interface ProgressionRuleMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateProgressionRuleCommand extends Omit<CreateProgressionRuleInput, "id" | "profileId"> {
    readonly id?: string;
}

export type UpdateProgressionRuleCommand = UpdateProgressionRuleInput;

export class ProgressionRuleNotFoundError extends ApplicationNotFoundError {
    constructor(readonly ruleId: string) {
        super(`Progression rule ${ruleId} was not found`, { ruleId });
        this.name = "ProgressionRuleNotFoundError";
    }
}

export class UnknownProgressionTargetError extends ApplicationValidationError {
    constructor(scope: RuleScope) {
        super(`Progression rule ${scope.type} target ${scope.id} does not exist`, {
            scope: [`The ${scope.type} target does not exist`],
        });
        this.name = "UnknownProgressionTargetError";
    }
}

export class ArchivedProgressionTargetError extends ApplicationValidationError {
    constructor(scope: RuleScope) {
        super(`Progression rule ${scope.type} target ${scope.id} is archived`, {
            scope: [`The ${scope.type} target is archived and cannot be targeted`],
        });
        this.name = "ArchivedProgressionTargetError";
    }
}

export const progressionRuleSerializer = new MigratingSnapshotSerializer<ProgressionRuleState>(
    1,
    state => structuredClone(state),
    value => ProgressionRule.rehydrate(value as ProgressionRuleState).state,
    [],
);

interface ProgressionRuleCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: ProgressionRuleRepository<Transaction>;
    readonly mutations: RevisionMutationService<ProgressionRuleState, DomainEvent, Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly planning: ProgressionPlanningReader<Transaction>;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

type ProgressionRuleAction = "created" | "updated" | "archived" | "restored";

export class ProgressionRuleCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: ProgressionRuleCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Progression rule ID generation is not configured");
            });
    }

    async create(
        command: CreateProgressionRuleCommand,
        metadata: ProgressionRuleMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgressionRuleResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        return this.inTransaction(transaction, async activeTransaction => {
            await this.assertTargetResolvable(command.scope, activeTransaction);
            const rule = ProgressionRule.create({ ...command, id: command.id ?? this.generateId(), profileId }, now);
            await this.runtime.mutations.create({
                entityType: PROGRESSION_RULE_ENTITY_TYPE,
                entityId: entityId(rule.state.id),
                state: rule.state,
                metadata: revisionMetadata(metadata, "Created progression rule"),
                events: [this.event("created", rule.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.requiredResource(rule.state.id, activeTransaction);
        });
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        command: UpdateProgressionRuleCommand,
        metadata: ProgressionRuleMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgressionRuleResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "updated", metadata, transaction, async activeTransaction => {
            if (command.scope !== undefined) await this.assertTargetResolvable(command.scope, activeTransaction);
            return rule => rule.update(command, now);
        });
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: ProgressionRuleMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgressionRuleResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "archived", metadata, transaction, () =>
            Promise.resolve(rule => rule.archive(now)),
        );
    }

    restore(
        id: string,
        expectedVersion: number | undefined,
        metadata: ProgressionRuleMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgressionRuleResource> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "restored", metadata, transaction, () =>
            Promise.resolve(rule => rule.restore(now)),
        );
    }

    private async mutate(
        id: string,
        expectedVersion: number | undefined,
        action: ProgressionRuleAction,
        metadata: ProgressionRuleMutationMetadata,
        transaction: Transaction | undefined,
        prepare: (transaction: Transaction) => Promise<(rule: ProgressionRule) => ProgressionRule>,
    ): Promise<ProgressionRuleResource> {
        const ruleId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                PROGRESSION_RULE_ENTITY_TYPE,
                ruleId,
                activeTransaction,
            );
            if (!stored) throw new ProgressionRuleNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const apply = await prepare(activeTransaction);
            const result = await this.runtime.mutations.mutate({
                entityType: PROGRESSION_RULE_ENTITY_TYPE,
                entityId: ruleId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = apply(ProgressionRule.rehydrate(state));
                    return {
                        state: next.state,
                        events: [this.event(action, next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, `${capitalize(action)} progression rule`),
                transaction: activeTransaction,
            });
            return this.requiredResource(result.state.id, activeTransaction);
        });
    }

    private async assertTargetResolvable(scope: RuleScope, transaction: Transaction): Promise<void> {
        const descriptor = await this.runtime.planning.describeScope(scope, transaction);
        if (!descriptor || !descriptor.exists) throw new UnknownProgressionTargetError(scope);
        if (descriptor.archived) throw new ArchivedProgressionTargetError(scope);
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<ProgressionRuleResource> {
        const resource = await this.runtime.repository.readRule(entityId(id), transaction);
        if (!resource) throw new ProgressionRuleNotFoundError(id);
        return resource;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: ProgressionRuleAction,
        state: ProgressionRuleState,
        aggregateRevision: number,
        metadata: ProgressionRuleMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.progression-rule.${action}`,
            version: 1,
            occurredAt,
            aggregateType: PROGRESSION_RULE_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                progressionRuleId: state.id,
                profileId: state.profileId,
                ruleVersion: aggregateRevision,
                scopeType: state.scope.type,
                scopeId: state.scope.id,
                status: state.status,
                enabled: state.enabled,
                autoApply: state.autoApply,
            },
        });
    }
}

const progressionRuleRevisionResourceMapper: SnapshotResourceMapper<ProgressionRuleState, ProgressionRuleResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class ProgressionRuleRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<ProgressionRuleResource> {
    readonly entityType = PROGRESSION_RULE_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<ProgressionRuleState, ProgressionRuleResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<ProgressionRuleState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Progression rule event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            progressionRuleSerializer,
            progressionRuleRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<ProgressionRuleResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: ProgressionRuleResource }> {
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
                    name: "training.progression-rule.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: {
                        progressionRuleId: input.entityId,
                        ruleVersion: input.expectedVersion + 1,
                        restoredVersion: input.restoreVersion,
                    },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: progressionRuleRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: progressionRuleSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: ProgressionRuleMutationMetadata, summary: string): RevisionMetadata {
    return {
        source: metadata.source ?? "user",
        actorId: metadata.actorId ?? null,
        reason: metadata.reason ?? null,
        summary,
        correlationId: metadata.correlationId,
    };
}

function capitalize(value: string): string {
    return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function validEntityId(value: string): EntityId {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Progression rule ID must be a UUID", {
            ruleId: ["Progression rule ID must be a UUID"],
        });
    }
}
