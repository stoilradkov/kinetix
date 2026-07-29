import { DomainEvent as PlatformDomainEvent, entityId, type Clock, type EntityId } from "#src/platform/domain/index";
import type { DomainEvent } from "#src/platform/domain/index";

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
    WorkoutTemplate,
    type CreateWorkoutTemplateInput,
    type PrescriptionKind,
    type PublishPrescriptionDraft,
    type SessionPrescriptionState,
    type UpdateWorkoutTemplateInput,
    type WorkoutTemplateState,
} from "#src/modules/training/domain/index";
import type {
    PrescriptionCloner,
    PrescriptionPublisher,
    SessionPrescriptionRepository,
} from "#src/modules/training/application/session-prescriptions";
import type { ProfileReader } from "#src/modules/profile/index";

export const WORKOUT_TEMPLATE_REPOSITORY = Symbol("WORKOUT_TEMPLATE_REPOSITORY");
export const WORKOUT_TEMPLATE_MUTATION_SERVICE = Symbol("WORKOUT_TEMPLATE_MUTATION_SERVICE");
export const WORKOUT_TEMPLATE_COMMANDS = Symbol("WORKOUT_TEMPLATE_COMMANDS");
export const WORKOUT_TEMPLATE_REVISION_HANDLER = Symbol("WORKOUT_TEMPLATE_REVISION_HANDLER");
export const WORKOUT_TEMPLATE_PLANNING_READER = Symbol("WORKOUT_TEMPLATE_PLANNING_READER");
export const WORKOUT_TEMPLATE_ENTITY_TYPE = "training.workout-template";

export interface WorkoutTemplateResource extends WorkoutTemplateState {
    readonly version: number;
}

/** Full template read model: metadata + version plus its current immutable prescription tree. */
export interface WorkoutTemplateDetail {
    readonly template: WorkoutTemplateResource;
    readonly prescription: SessionPrescriptionState;
}

export interface WorkoutTemplateListFilter {
    readonly includeArchived?: boolean;
}

/**
 * Capability port over the editable template root plus its version→prescription link log.
 * Extends {@link CurrentStateStore} so the shared {@link RevisionMutationService} can drive
 * versioning; `create`/`save` additionally record the version→prescription link so every
 * published template prescription is preserved (design 10.3, 12.1).
 */
export interface WorkoutTemplateRepository<Transaction = unknown> extends CurrentStateStore<
    WorkoutTemplateState,
    Transaction
> {
    readTemplate(id: EntityId, transaction?: Transaction): Promise<WorkoutTemplateResource | null>;
    listTemplates(filter?: WorkoutTemplateListFilter): Promise<readonly WorkoutTemplateResource[]>;
}

export interface WorkoutTemplateMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

/** A template edit always describes the whole prescription tree; `kind` is forced to template. */
export type WorkoutTemplateDraft = Omit<PublishPrescriptionDraft, "kind">;

export interface CreateWorkoutTemplateCommand extends Omit<
    CreateWorkoutTemplateInput,
    "id" | "profileId" | "currentPrescriptionId"
> {
    readonly id?: string;
    readonly prescription: WorkoutTemplateDraft;
}

export interface UpdateWorkoutTemplateCommand {
    readonly name?: string;
    readonly description?: string | null;
    /** Present when the edit republishes the prescription tree; absent for metadata-only edits. */
    readonly prescription?: WorkoutTemplateDraft;
}

export class WorkoutTemplateNotFoundError extends ApplicationNotFoundError {
    constructor(readonly workoutTemplateId: string) {
        super(`Workout template ${workoutTemplateId} was not found`, { workoutTemplateId });
        this.name = "WorkoutTemplateNotFoundError";
    }
}

export const workoutTemplateSerializer = new MigratingSnapshotSerializer<WorkoutTemplateState>(
    1,
    state => structuredClone(state),
    value => WorkoutTemplate.rehydrate(value as WorkoutTemplateState).state,
    [],
);

interface WorkoutTemplateCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: WorkoutTemplateRepository<Transaction>;
    readonly mutations: RevisionMutationService<WorkoutTemplateState, DomainEvent, Transaction>;
    readonly publisher: PrescriptionPublisher<Transaction>;
    readonly prescriptions: SessionPrescriptionRepository<Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

type WorkoutTemplateAction = "created" | "updated" | "archived" | "restored";

export class WorkoutTemplateCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: WorkoutTemplateCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Workout template ID generation is not configured");
            });
    }

    async create(
        command: CreateWorkoutTemplateCommand,
        metadata: WorkoutTemplateMutationMetadata,
        transaction?: Transaction,
    ): Promise<WorkoutTemplateDetail> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        return this.inTransaction(transaction, async activeTransaction => {
            const prescription = await this.publish(command.prescription, metadata, activeTransaction);
            const template = WorkoutTemplate.create(
                {
                    id: command.id ?? this.generateId(),
                    profileId,
                    name: command.name,
                    description: command.description ?? null,
                    currentPrescriptionId: prescription.id,
                },
                now,
            );
            await this.runtime.mutations.create({
                entityType: WORKOUT_TEMPLATE_ENTITY_TYPE,
                entityId: entityId(template.state.id),
                state: template.state,
                metadata: revisionMetadata(metadata, "Created workout template"),
                events: [this.event("created", template.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            const resource = await this.requiredResource(template.state.id, activeTransaction);
            return { template: resource, prescription };
        });
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        command: UpdateWorkoutTemplateCommand,
        metadata: WorkoutTemplateMutationMetadata,
        transaction?: Transaction,
    ): Promise<WorkoutTemplateDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "updated", metadata, transaction, async activeTransaction => {
            const published = command.prescription
                ? await this.publish(command.prescription, metadata, activeTransaction)
                : null;
            const input: UpdateWorkoutTemplateInput = {
                ...(command.name !== undefined ? { name: command.name } : {}),
                ...(command.description !== undefined ? { description: command.description } : {}),
                ...(published ? { currentPrescriptionId: published.id } : {}),
            };
            return {
                apply: (template: WorkoutTemplate) => template.update(input, now),
                prescription: published,
            };
        });
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: WorkoutTemplateMutationMetadata,
        transaction?: Transaction,
    ): Promise<WorkoutTemplateDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "archived", metadata, transaction, () =>
            Promise.resolve({ apply: (template: WorkoutTemplate) => template.archive(now), prescription: null }),
        );
    }

    restore(
        id: string,
        expectedVersion: number | undefined,
        metadata: WorkoutTemplateMutationMetadata,
        transaction?: Transaction,
    ): Promise<WorkoutTemplateDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "restored", metadata, transaction, () =>
            Promise.resolve({ apply: (template: WorkoutTemplate) => template.restore(now), prescription: null }),
        );
    }

    private async mutate(
        id: string,
        expectedVersion: number | undefined,
        action: WorkoutTemplateAction,
        metadata: WorkoutTemplateMutationMetadata,
        transaction: Transaction | undefined,
        prepare: (transaction: Transaction) => Promise<{
            apply: (template: WorkoutTemplate) => WorkoutTemplate;
            prescription: SessionPrescriptionState | null;
        }>,
    ): Promise<WorkoutTemplateDetail> {
        const templateId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                WORKOUT_TEMPLATE_ENTITY_TYPE,
                templateId,
                activeTransaction,
            );
            if (!stored) throw new WorkoutTemplateNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const prepared = await prepare(activeTransaction);
            const result = await this.runtime.mutations.mutate({
                entityType: WORKOUT_TEMPLATE_ENTITY_TYPE,
                entityId: templateId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = prepared.apply(WorkoutTemplate.rehydrate(state));
                    return {
                        state: next.state,
                        events: [this.event(action, next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, `${capitalize(action)} workout template`),
                transaction: activeTransaction,
            });
            const resource = await this.requiredResource(result.state.id, activeTransaction);
            const prescription =
                prepared.prescription ??
                (await this.requiredPrescription(result.state.currentPrescriptionId, activeTransaction));
            return { template: resource, prescription };
        });
    }

    private publish(
        draft: WorkoutTemplateDraft,
        metadata: WorkoutTemplateMutationMetadata,
        transaction: Transaction,
    ): Promise<SessionPrescriptionState> {
        return this.runtime.publisher.publish({ draft: { ...draft, kind: "template" } }, metadata, transaction);
    }

    private async requiredResource(id: string, transaction: Transaction): Promise<WorkoutTemplateResource> {
        const resource = await this.runtime.repository.readTemplate(entityId(id), transaction);
        if (!resource) throw new WorkoutTemplateNotFoundError(id);
        return resource;
    }

    private async requiredPrescription(id: string, transaction: Transaction): Promise<SessionPrescriptionState> {
        const prescription = await this.runtime.prescriptions.loadTree(id, transaction);
        if (!prescription)
            throw new ApplicationNotFoundError(`Prescription ${id} was not found`, { prescriptionId: id });
        return prescription;
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: WorkoutTemplateAction,
        state: WorkoutTemplateState,
        aggregateRevision: number,
        metadata: WorkoutTemplateMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.workout-template.${action}`,
            version: 1,
            occurredAt,
            aggregateType: WORKOUT_TEMPLATE_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: {
                workoutTemplateId: state.id,
                profileId: state.profileId,
                status: state.status,
                currentPrescriptionId: state.currentPrescriptionId,
            },
        });
    }
}

/**
 * Read/preparation port consumed by program generation (design 5.5, 5.6). Programs read a
 * template's current prescription and clone it into an independent planned prescription so
 * template edits never mutate placed plans.
 */
export interface WorkoutTemplatePlanningReader<Transaction = unknown> {
    readForPlanning(templateId: string, transaction?: Transaction): Promise<WorkoutTemplateDetail | null>;
    prepareClone(
        templateId: string,
        options: { targetKind: PrescriptionKind; preserveLogicalKeys?: boolean },
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<SessionPrescriptionState>;
}

export class RepositoryWorkoutTemplatePlanningReader<
    Transaction = unknown,
> implements WorkoutTemplatePlanningReader<Transaction> {
    constructor(
        private readonly repository: WorkoutTemplateRepository<Transaction>,
        private readonly prescriptions: SessionPrescriptionRepository<Transaction>,
        private readonly cloner: PrescriptionCloner<Transaction>,
    ) {}

    async readForPlanning(templateId: string, transaction?: Transaction): Promise<WorkoutTemplateDetail | null> {
        const template = await this.repository.readTemplate(validEntityId(templateId), transaction);
        if (!template) return null;
        const prescription = await this.prescriptions.loadTree(template.currentPrescriptionId, transaction);
        if (!prescription) return null;
        return { template, prescription };
    }

    async prepareClone(
        templateId: string,
        options: { targetKind: PrescriptionKind; preserveLogicalKeys?: boolean },
        metadata: CommandContext,
        transaction?: Transaction,
    ): Promise<SessionPrescriptionState> {
        const template = await this.repository.readTemplate(validEntityId(templateId), transaction);
        if (!template) throw new WorkoutTemplateNotFoundError(templateId);
        return this.cloner.clone(
            {
                sourcePrescriptionId: template.currentPrescriptionId,
                targetKind: options.targetKind,
                ...(options.preserveLogicalKeys !== undefined
                    ? { preserveLogicalKeys: options.preserveLogicalKeys }
                    : {}),
            },
            metadata,
            transaction,
        );
    }
}

const workoutTemplateRevisionResourceMapper: SnapshotResourceMapper<WorkoutTemplateState, WorkoutTemplateResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class WorkoutTemplateRevisionHandler<
    Transaction = unknown,
> implements RevisionResourceHandler<WorkoutTemplateResource> {
    readonly entityType = WORKOUT_TEMPLATE_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<WorkoutTemplateState, WorkoutTemplateResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<WorkoutTemplateState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Workout template event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(
            revisions,
            workoutTemplateSerializer,
            workoutTemplateRevisionResourceMapper,
        );
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<WorkoutTemplateResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: WorkoutTemplateResource }> {
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
                    name: "training.workout-template.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: { workoutTemplateId: input.entityId, restoredVersion: input.restoreVersion },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: workoutTemplateRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: workoutTemplateSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: WorkoutTemplateMutationMetadata, summary: string): RevisionMetadata {
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
        throw new ApplicationValidationError("Workout template ID must be a UUID", {
            workoutTemplateId: ["Workout template ID must be a UUID"],
        });
    }
}
