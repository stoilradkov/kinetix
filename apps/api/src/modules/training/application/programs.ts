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
    Program,
    evaluateProgramWarnings,
    type CreateProgramInput,
    type PlannedSessionSchedule,
    type PlanningWarning,
    type ProgramScheduleMode,
    type ProgramState,
    type PlannedSessionStatus,
    type UpdateProgramInput,
} from "#src/modules/training/domain/index";
import type { PlannedSessionCommands, PlannedSessionDetail } from "#src/modules/training/application/planned-sessions";
import type { WorkoutTemplatePlanningReader } from "#src/modules/training/application/workout-templates";
import type { ProfileReader } from "#src/modules/profile/index";

export const PROGRAM_REPOSITORY = Symbol("PROGRAM_REPOSITORY");
export const PROGRAM_MEMBERSHIP_REPOSITORY = Symbol("PROGRAM_MEMBERSHIP_REPOSITORY");
export const PROGRAM_GOAL_VALIDATOR = Symbol("PROGRAM_GOAL_VALIDATOR");
export const PROGRAM_MUTATION_SERVICE = Symbol("PROGRAM_MUTATION_SERVICE");
export const PROGRAM_COMMANDS = Symbol("PROGRAM_COMMANDS");
export const PROGRAM_QUERIES = Symbol("PROGRAM_QUERIES");
export const PROGRAM_REVISION_HANDLER = Symbol("PROGRAM_REVISION_HANDLER");
export const PROGRAM_ENTITY_TYPE = "training.program";

export interface ProgramResource extends ProgramState {
    readonly version: number;
}

/** Bounded list projection: metadata + counts, never the full block tree (design 10.3). */
export interface ProgramSummary {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly description: string | null;
    readonly status: ProgramState["status"];
    readonly scheduleMode: ProgramScheduleMode;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly focus: string | null;
    readonly version: number;
    readonly archivedAt: string | null;
    readonly blockCount: number;
    readonly sessionCount: number;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface ProgramDetail {
    readonly program: ProgramResource;
    readonly warnings: readonly PlanningWarning[];
}

export interface ProgramListFilter {
    readonly includeArchived?: boolean;
}

/** Program-relative placement of a member session (design 10.3). */
export interface ProgramSessionLinkInput {
    readonly programId: string;
    readonly plannedSessionId: string;
    readonly relativeWeek?: number | null;
    readonly relativeDay?: number | null;
    readonly sequence: number;
}

export interface ProgramSessionMembership {
    readonly plannedSessionId: string;
    readonly sequence: number;
    readonly relativeWeek: number | null;
    readonly relativeDay: number | null;
    readonly localDate: string | null;
    readonly preferredTime: string | null;
    readonly status: PlannedSessionStatus;
    readonly title: string | null;
}

/**
 * Capability port over the editable program root, its block tree, and goal links. Extends
 * {@link CurrentStateStore} so the shared {@link RevisionMutationService} drives versioning;
 * `create`/`save` additionally replace the normalized `program_blocks`/`program_goals` rows.
 */
export interface ProgramRepository<Transaction = unknown> extends CurrentStateStore<ProgramState, Transaction> {
    readProgram(id: EntityId, transaction?: Transaction): Promise<ProgramResource | null>;
    listPrograms(filter?: ProgramListFilter): Promise<readonly ProgramSummary[]>;
}

/** Membership join rows live outside the Program aggregate so a session can belong to many programs. */
export interface ProgramMembershipRepository<Transaction = unknown> {
    linkProgramSession(input: ProgramSessionLinkInput, transaction?: Transaction): Promise<void>;
    unlinkProgramSession(programId: string, plannedSessionId: string, transaction?: Transaction): Promise<void>;
    linkSessionBlock(plannedSessionId: string, blockId: string, transaction?: Transaction): Promise<void>;
    unlinkSessionBlock(plannedSessionId: string, blockId: string, transaction?: Transaction): Promise<void>;
    listProgramSessions(programId: string, transaction?: Transaction): Promise<readonly ProgramSessionMembership[]>;
}

/** Application port validating that linked training goals exist for the active profile. */
export interface ProgramGoalValidator<Transaction = unknown> {
    assertGoalsExist(goalIds: readonly string[], transaction?: Transaction): Promise<void>;
}

export interface ProgramMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface CreateProgramCommand extends Omit<CreateProgramInput, "id" | "profileId"> {
    readonly id?: string;
}

export type UpdateProgramCommand = UpdateProgramInput;

export interface ActivateSessionPlan {
    readonly templateId: string;
    readonly title?: string | null;
    readonly localDate?: string | null;
    readonly timeZone?: string | null;
    readonly preferredTime?: string | null;
    readonly expectedDurationMinutes?: number | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
    readonly relativeWeek?: number | null;
    readonly relativeDay?: number | null;
    readonly sequence: number;
    readonly blockIds?: readonly string[];
}

export interface ActivateProgramCommand {
    readonly sessions?: readonly ActivateSessionPlan[];
}

export interface ActivateProgramResult extends ProgramDetail {
    readonly generatedSessions: readonly PlannedSessionDetail[];
}

export interface AttachSessionCommand extends Omit<ProgramSessionLinkInput, "programId"> {
    readonly blockIds?: readonly string[];
}

export class ProgramNotFoundError extends ApplicationNotFoundError {
    constructor(readonly programId: string) {
        super(`Program ${programId} was not found`, { programId });
        this.name = "ProgramNotFoundError";
    }
}

export const programSerializer = new MigratingSnapshotSerializer<ProgramState>(
    1,
    state => structuredClone(state),
    value => Program.rehydrate(value as ProgramState).state,
    [],
);

interface ProgramCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: ProgramRepository<Transaction>;
    readonly mutations: RevisionMutationService<ProgramState, DomainEvent, Transaction>;
    readonly membership: ProgramMembershipRepository<Transaction>;
    readonly plannedSessions: PlannedSessionCommands<Transaction>;
    readonly templates: WorkoutTemplatePlanningReader<Transaction>;
    readonly goalValidator: ProgramGoalValidator<Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

type ProgramAction = "created" | "updated" | "activated" | "paused" | "resumed" | "completed" | "archived" | "restored";

export class ProgramCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;
    private readonly expectedVersions = new ExpectedVersionGuard();

    constructor(private readonly runtime: ProgramCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Program ID generation is not configured");
            });
    }

    async create(
        command: CreateProgramCommand,
        metadata: ProgramMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgramDetail> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        return this.inTransaction(transaction, async activeTransaction => {
            await this.runtime.goalValidator.assertGoalsExist(command.goalIds ?? [], activeTransaction);
            const program = Program.create({ ...command, id: command.id ?? this.generateId(), profileId }, now);
            await this.runtime.mutations.create({
                entityType: PROGRAM_ENTITY_TYPE,
                entityId: entityId(program.state.id),
                state: program.state,
                metadata: revisionMetadata(metadata, "Created program"),
                events: [this.event("created", program.state, 1, metadata, now)],
                transaction: activeTransaction,
            });
            return this.detail(program.state.id, activeTransaction);
        });
    }

    update(
        id: string,
        expectedVersion: number | undefined,
        command: UpdateProgramCommand,
        metadata: ProgramMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgramDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "updated", metadata, transaction, async activeTransaction => {
            await this.runtime.goalValidator.assertGoalsExist(command.goalIds ?? [], activeTransaction);
            const input: UpdateProgramInput = { ...command };
            return (program: Program) => program.update(input, now);
        });
    }

    pause(
        id: string,
        expectedVersion: number | undefined,
        metadata: ProgramMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgramDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "paused", metadata, transaction, () =>
            Promise.resolve((program: Program) => program.pause(now)),
        );
    }

    resume(
        id: string,
        expectedVersion: number | undefined,
        metadata: ProgramMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgramDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "resumed", metadata, transaction, () =>
            Promise.resolve((program: Program) => program.resume(now)),
        );
    }

    complete(
        id: string,
        expectedVersion: number | undefined,
        metadata: ProgramMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgramDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "completed", metadata, transaction, () =>
            Promise.resolve((program: Program) => program.complete(now)),
        );
    }

    archive(
        id: string,
        expectedVersion: number | undefined,
        metadata: ProgramMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgramDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "archived", metadata, transaction, () =>
            Promise.resolve((program: Program) => program.archive(now)),
        );
    }

    restore(
        id: string,
        expectedVersion: number | undefined,
        metadata: ProgramMutationMetadata,
        transaction?: Transaction,
    ): Promise<ProgramDetail> {
        const now = this.clock.now();
        return this.mutate(id, expectedVersion, "restored", metadata, transaction, () =>
            Promise.resolve((program: Program) => program.restore(now)),
        );
    }

    /**
     * Activate a program and generate its owned planned sessions in one transaction (design 5.6).
     * Each plan clones the source template's current prescription into an immutable planned tree
     * (retaining source-template logical lineage) before materializing the session and writing its
     * program/block membership.
     */
    async activate(
        id: string,
        expectedVersion: number | undefined,
        command: ActivateProgramCommand,
        metadata: ProgramMutationMetadata,
        transaction?: Transaction,
    ): Promise<ActivateProgramResult> {
        const now = this.clock.now();
        const programId = validEntityId(id);
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                PROGRAM_ENTITY_TYPE,
                programId,
                activeTransaction,
            );
            if (!stored) throw new ProgramNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const blockIds = new Set(stored.state.blocks.map(block => block.id));
            const result = await this.runtime.mutations.mutate({
                entityType: PROGRAM_ENTITY_TYPE,
                entityId: programId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = Program.rehydrate(state).activate(now);
                    return {
                        state: next.state,
                        events: [this.event("activated", next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, "Activated program"),
                transaction: activeTransaction,
            });
            const generatedSessions: PlannedSessionDetail[] = [];
            for (const plan of command.sessions ?? []) {
                const session = await this.generateSession(id, plan, blockIds, metadata, activeTransaction);
                generatedSessions.push(session);
            }
            const detail = await this.detail(result.state.id, activeTransaction);
            return { ...detail, generatedSessions };
        });
    }

    /** Attach an existing planned session to a program with its relative placement and block scopes. */
    async attachSession(id: string, command: AttachSessionCommand, transaction?: Transaction): Promise<ProgramDetail> {
        const programId = validEntityId(id);
        return this.inTransaction(transaction, async activeTransaction => {
            const program = await this.runtime.repository.readProgram(programId, activeTransaction);
            if (!program) throw new ProgramNotFoundError(id);
            const blockIds = new Set(program.blocks.map(block => block.id));
            this.assertBlocksInProgram(command.blockIds ?? [], blockIds);
            await this.runtime.membership.linkProgramSession(
                {
                    programId: id,
                    plannedSessionId: command.plannedSessionId,
                    relativeWeek: command.relativeWeek ?? null,
                    relativeDay: command.relativeDay ?? null,
                    sequence: command.sequence,
                },
                activeTransaction,
            );
            for (const blockId of command.blockIds ?? [])
                await this.runtime.membership.linkSessionBlock(command.plannedSessionId, blockId, activeTransaction);
            return this.detail(id, activeTransaction);
        });
    }

    async detachSession(id: string, plannedSessionId: string, transaction?: Transaction): Promise<ProgramDetail> {
        const programId = validEntityId(id);
        return this.inTransaction(transaction, async activeTransaction => {
            const program = await this.runtime.repository.readProgram(programId, activeTransaction);
            if (!program) throw new ProgramNotFoundError(id);
            await this.runtime.membership.unlinkProgramSession(id, plannedSessionId, activeTransaction);
            return this.detail(id, activeTransaction);
        });
    }

    private async generateSession(
        programId: string,
        plan: ActivateSessionPlan,
        blockIds: ReadonlySet<string>,
        metadata: ProgramMutationMetadata,
        transaction: Transaction,
    ): Promise<PlannedSessionDetail> {
        this.assertBlocksInProgram(plan.blockIds ?? [], blockIds);
        const template = await this.runtime.templates.readForPlanning(plan.templateId, transaction);
        if (!template)
            throw new ApplicationNotFoundError(`Workout template ${plan.templateId} was not found`, {
                templateId: plan.templateId,
            });
        const cloned = await this.runtime.templates.prepareClone(
            plan.templateId,
            { targetKind: "planned", preserveLogicalKeys: true },
            metadata,
            transaction,
        );
        const detail = await this.runtime.plannedSessions.materialize(
            {
                profileId: template.template.profileId,
                currentPrescriptionId: cloned.id,
                title: plan.title ?? template.template.name,
                localDate: plan.localDate ?? null,
                timeZone: plan.timeZone ?? null,
                preferredTime: plan.preferredTime ?? null,
                expectedDurationMinutes: plan.expectedDurationMinutes ?? null,
                notes: plan.notes ?? null,
                tags: plan.tags ?? [],
                sourceTemplateId: plan.templateId,
                sourceTemplateVersion: template.template.version,
            },
            cloned,
            metadata,
            transaction,
        );
        await this.runtime.membership.linkProgramSession(
            {
                programId,
                plannedSessionId: detail.session.id,
                relativeWeek: plan.relativeWeek ?? null,
                relativeDay: plan.relativeDay ?? null,
                sequence: plan.sequence,
            },
            transaction,
        );
        for (const blockId of plan.blockIds ?? [])
            await this.runtime.membership.linkSessionBlock(detail.session.id, blockId, transaction);
        return detail;
    }

    private assertBlocksInProgram(blockIds: readonly string[], programBlockIds: ReadonlySet<string>): void {
        for (const blockId of blockIds)
            if (!programBlockIds.has(blockId))
                throw new ApplicationValidationError("Block does not belong to this program", {
                    blockIds: ["Block does not belong to this program"],
                });
    }

    private async mutate(
        id: string,
        expectedVersion: number | undefined,
        action: ProgramAction,
        metadata: ProgramMutationMetadata,
        transaction: Transaction | undefined,
        prepare: (transaction: Transaction) => Promise<(program: Program) => Program>,
    ): Promise<ProgramDetail> {
        const programId = validEntityId(id);
        const now = this.clock.now();
        return this.inTransaction(transaction, async activeTransaction => {
            const stored = await this.runtime.repository.loadForUpdate(
                PROGRAM_ENTITY_TYPE,
                programId,
                activeTransaction,
            );
            if (!stored) throw new ProgramNotFoundError(id);
            this.expectedVersions.verify(expectedVersion, stored.version);
            const apply = await prepare(activeTransaction);
            const result = await this.runtime.mutations.mutate({
                entityType: PROGRAM_ENTITY_TYPE,
                entityId: programId,
                expectedVersion: expectedVersion!,
                change: state => {
                    const next = apply(Program.rehydrate(state));
                    return {
                        state: next.state,
                        events: [this.event(action, next.state, expectedVersion! + 1, metadata, now)],
                    };
                },
                metadata: revisionMetadata(metadata, `${capitalize(action)} program`),
                transaction: activeTransaction,
            });
            return this.detail(result.state.id, activeTransaction);
        });
    }

    private async detail(id: string, transaction: Transaction): Promise<ProgramDetail> {
        const program = await this.runtime.repository.readProgram(entityId(id), transaction);
        if (!program) throw new ProgramNotFoundError(id);
        return { program, warnings: evaluateProgramWarnings(program) };
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private event(
        action: ProgramAction,
        state: ProgramState,
        aggregateRevision: number,
        metadata: ProgramMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: `training.program.${action}`,
            version: 1,
            occurredAt,
            aggregateType: PROGRAM_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision,
            correlationId: metadata.correlationId,
            payload: { programId: state.id, profileId: state.profileId, status: state.status },
        });
    }
}

/**
 * Read side for programs. Computes warnings through the domain planning policy (block overlaps plus
 * schedule collisions across member sessions), returning structured codes/evidence — never hiding
 * warning logic in SQL or the UI (design 5.6).
 */
export class ProgramQueries<Transaction = unknown> {
    constructor(
        private readonly repository: ProgramRepository<Transaction>,
        private readonly membership: ProgramMembershipRepository<Transaction>,
    ) {}

    list(filter?: ProgramListFilter): Promise<readonly ProgramSummary[]> {
        return this.repository.listPrograms(filter);
    }

    async get(id: string): Promise<ProgramDetail> {
        const programId = validEntityId(id);
        const program = await this.repository.readProgram(programId);
        if (!program) throw new ProgramNotFoundError(id);
        const sessions = await this.membership.listProgramSessions(id);
        const schedules: PlannedSessionSchedule[] = sessions.map(session => ({
            id: session.plannedSessionId,
            localDate: session.localDate,
            preferredTime: session.preferredTime,
        }));
        return { program, warnings: evaluateProgramWarnings(program, schedules) };
    }

    async sessions(id: string): Promise<readonly ProgramSessionMembership[]> {
        const programId = validEntityId(id);
        const program = await this.repository.readProgram(programId);
        if (!program) throw new ProgramNotFoundError(id);
        return this.membership.listProgramSessions(id);
    }
}

const programRevisionResourceMapper: SnapshotResourceMapper<ProgramState, ProgramResource> = {
    toResource: (state, revision) => ({ ...state, version: revision.version }),
};

export class ProgramRevisionHandler<Transaction = unknown> implements RevisionResourceHandler<ProgramResource> {
    readonly entityType = PROGRAM_ENTITY_TYPE;
    private readonly historyService: RevisionHistoryService<ProgramState, ProgramResource, Transaction>;

    constructor(
        private readonly mutations: RevisionMutationService<ProgramState, DomainEvent, Transaction>,
        revisions: RevisionStore<Transaction>,
        private readonly clock: Clock = { now: () => new Date() },
        private readonly generateId: () => string = () => {
            throw new Error("Program event ID generation is not configured");
        },
    ) {
        this.historyService = new RevisionHistoryService(revisions, programSerializer, programRevisionResourceMapper);
    }

    history(
        entity: EntityId,
        pagination: { limit: number; beforeVersion?: number },
    ): Promise<RevisionHistoryPage<ProgramResource>> {
        return this.historyService.history({ entityType: this.entityType, entityId: entity, ...pagination });
    }

    async restore(input: {
        entityId: EntityId;
        restoreVersion: number;
        expectedVersion: number;
        metadata: Omit<RevisionMetadata, "source">;
        transaction?: unknown;
    }): Promise<{ version: number; resource: ProgramResource }> {
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
                    name: "training.program.revision-restored",
                    version: 1,
                    occurredAt: now,
                    aggregateType: this.entityType,
                    aggregateId: input.entityId,
                    aggregateRevision: input.expectedVersion + 1,
                    correlationId: input.metadata.correlationId,
                    payload: { programId: input.entityId, restoredVersion: input.restoreVersion },
                }),
            ],
            ...(input.transaction !== undefined ? { transaction: input.transaction as Transaction } : {}),
        });
        return {
            version: result.version,
            resource: programRevisionResourceMapper.toResource(result.state, {
                entityType: this.entityType,
                entityId: input.entityId,
                version: result.version,
                schemaVersion: programSerializer.currentSchemaVersion,
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

function revisionMetadata(metadata: ProgramMutationMetadata, summary: string): RevisionMetadata {
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
        throw new ApplicationValidationError("Program ID must be a UUID", { programId: ["Program ID must be a UUID"] });
    }
}
