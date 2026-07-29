import { DomainEvent as PlatformDomainEvent, type Clock } from "#src/platform/domain/index";
import type { DomainEvent } from "#src/platform/domain/index";

import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    type CommandContext,
    type OutboxWriter,
    type UnitOfWork,
} from "#src/platform/application/index";
import {
    TrainingMax,
    resolveEffectiveTrainingMax,
    type RecordTrainingMaxInput,
    type TrainingMaxState,
    type TrainingMaxType,
} from "#src/modules/training/domain/index";
import type { ExerciseCatalogItem } from "#src/modules/training/application/catalog";
import type { ProfileReader } from "#src/modules/profile/index";

export const TRAINING_MAX_REPOSITORY = Symbol("TRAINING_MAX_REPOSITORY");
export const TRAINING_MAX_COMMANDS = Symbol("TRAINING_MAX_COMMANDS");
export const TRAINING_MAX_QUERIES = Symbol("TRAINING_MAX_QUERIES");
export const TRAINING_TARGET_CONTEXT_READER = Symbol("TRAINING_TARGET_CONTEXT_READER");
export const TRAINING_MAX_ENTITY_TYPE = "training.training-max";

export type TrainingMaxResource = TrainingMaxState;

/** Identifies one training-max series within the active profile. */
export interface TrainingMaxSeriesRef {
    readonly exerciseId: string;
    readonly maxType: TrainingMaxType;
    readonly customLabel: string | null;
}

export interface TrainingMaxCurrentFilter {
    readonly exerciseId?: string;
}

export interface TrainingMaxRepository<Transaction = unknown> {
    insert(state: TrainingMaxState, transaction: Transaction): Promise<void>;
    /** The current open record for a series, locked for the enclosing transaction. */
    findOpenForUpdate(
        profileId: string,
        series: TrainingMaxSeriesRef,
        transaction: Transaction,
    ): Promise<TrainingMaxState | null>;
    close(id: string, effectiveTo: string, updatedAt: string, transaction: Transaction): Promise<void>;
    findById(id: string, transaction?: Transaction): Promise<TrainingMaxState | null>;
    listCurrent(profileId: string, filter?: TrainingMaxCurrentFilter): Promise<readonly TrainingMaxState[]>;
    listSeries(profileId: string, series: TrainingMaxSeriesRef): Promise<readonly TrainingMaxState[]>;
}

/** Catalog reads used to validate that a training max targets a real exercise. */
export interface TrainingMaxCatalogReader {
    listExercises(): Promise<readonly ExerciseCatalogItem[]>;
}

export interface TrainingMaxMutationMetadata extends CommandContext {
    readonly reason?: string | null;
}

export interface RecordTrainingMaxCommand extends Omit<RecordTrainingMaxInput, "id" | "profileId"> {
    readonly id?: string;
}

export class TrainingMaxNotFoundError extends ApplicationNotFoundError {
    constructor(readonly trainingMaxId: string) {
        super(`Training max ${trainingMaxId} was not found`, { trainingMaxId });
        this.name = "TrainingMaxNotFoundError";
    }
}

export class TrainingMaxExerciseNotFoundError extends ApplicationValidationError {
    constructor(readonly exerciseId: string) {
        super(`Exercise ${exerciseId} does not exist`, { exerciseId: ["This exercise does not exist"] });
        this.name = "TrainingMaxExerciseNotFoundError";
    }
}

export class TrainingMaxBackdatedError extends ApplicationValidationError {
    constructor() {
        super("A new training max must take effect after the current record", {
            effectiveFrom: ["Effective-from must be after the current record's start"],
        });
        this.name = "TrainingMaxBackdatedError";
    }
}

interface TrainingMaxCommandRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly repository: TrainingMaxRepository<Transaction>;
    readonly catalog: TrainingMaxCatalogReader;
    readonly outbox: OutboxWriter<Transaction>;
    readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class TrainingMaxCommands<Transaction = unknown> {
    private readonly clock: Clock;
    private readonly generateId: () => string;

    constructor(private readonly runtime: TrainingMaxCommandRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Training max ID generation is not configured");
            });
    }

    async record(
        input: RecordTrainingMaxCommand,
        metadata: TrainingMaxMutationMetadata,
        transaction?: Transaction,
    ): Promise<TrainingMaxResource> {
        const now = this.clock.now();
        const profileId = await this.runtime.profileReader.requireActiveProfileId();
        await this.assertExerciseExists(input.exerciseId);
        const recorded = TrainingMax.record({ ...input, id: input.id ?? this.generateId(), profileId }, now);
        const state = recorded.state;
        const series: TrainingMaxSeriesRef = {
            exerciseId: state.exerciseId,
            maxType: state.maxType,
            customLabel: state.customLabel,
        };
        return this.inTransaction(transaction, async activeTransaction => {
            const open = await this.runtime.repository.findOpenForUpdate(profileId, series, activeTransaction);
            let closed: TrainingMaxState | null = null;
            if (open) {
                if (state.effectiveFrom <= open.effectiveFrom) throw new TrainingMaxBackdatedError();
                const closedMax = TrainingMax.rehydrate(open).close(state.effectiveFrom, now);
                closed = closedMax.state;
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

    private async assertExerciseExists(exerciseId: string): Promise<void> {
        const exercises = await this.runtime.catalog.listExercises();
        if (!exercises.some(exercise => exercise.id === exerciseId))
            throw new TrainingMaxExerciseNotFoundError(exerciseId);
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work) : work(transaction);
    }

    private changedEvent(
        state: TrainingMaxState,
        closed: TrainingMaxState | null,
        occurredAt: Date,
        metadata: TrainingMaxMutationMetadata,
    ): DomainEvent {
        return new PlatformDomainEvent({
            id: this.generateId(),
            name: "training.training-max.changed",
            version: 1,
            occurredAt,
            aggregateType: TRAINING_MAX_ENTITY_TYPE,
            aggregateId: state.id,
            aggregateRevision: 1,
            correlationId: metadata.correlationId,
            payload: {
                trainingMaxId: state.id,
                profileId: state.profileId,
                exerciseId: state.exerciseId,
                maxType: state.maxType,
                customLabel: state.customLabel,
                source: state.source,
                // Affected interval drives targeted analytics invalidation.
                effectiveFrom: closed ? closed.effectiveFrom : state.effectiveFrom,
                effectiveTo: null,
                supersededTrainingMaxId: closed ? closed.id : null,
            },
        });
    }
}

/** Read side for current and historical training maxima. */
export class TrainingMaxQueries<Transaction = unknown> {
    constructor(
        private readonly repository: TrainingMaxRepository<Transaction>,
        private readonly profileReader: Pick<ProfileReader, "requireActiveProfileId">,
    ) {}

    async listCurrent(filter?: TrainingMaxCurrentFilter): Promise<readonly TrainingMaxResource[]> {
        const profileId = await this.profileReader.requireActiveProfileId();
        return this.repository.listCurrent(profileId, filter);
    }

    async history(series: TrainingMaxSeriesRef): Promise<readonly TrainingMaxResource[]> {
        const profileId = await this.profileReader.requireActiveProfileId();
        return this.repository.listSeries(profileId, series);
    }

    async current(series: TrainingMaxSeriesRef): Promise<TrainingMaxResource | null> {
        const profileId = await this.profileReader.requireActiveProfileId();
        const records = await this.repository.listSeries(profileId, series);
        return records.find(record => record.effectiveTo === null) ?? null;
    }

    async asOf(series: TrainingMaxSeriesRef, at: string): Promise<TrainingMaxResource | null> {
        const profileId = await this.profileReader.requireActiveProfileId();
        const records = await this.repository.listSeries(profileId, series);
        return resolveEffectiveTrainingMax(records, at);
    }
}

/** Effective training max in force at an instant, plus the record that supplied it. */
export interface ResolvedTrainingMax {
    readonly trainingMaxId: string;
    readonly exerciseId: string;
    readonly maxType: TrainingMaxType;
    readonly customLabel: string | null;
    readonly valueKg: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
}

export interface ResolveTrainingMaxQuery {
    readonly profileId: string;
    readonly exerciseId: string;
    readonly maxType: TrainingMaxType;
    readonly customLabel?: string | null;
    readonly at: string;
}

/**
 * Capability-shaped port used by session start and analytics to resolve the
 * training target context that was in force at a supplied instant, returning the
 * exact record ID so historical calculations stay reproducible.
 */
export interface TrainingTargetContextReader {
    resolveTrainingMax(query: ResolveTrainingMaxQuery): Promise<ResolvedTrainingMax | null>;
}

export class RepositoryTrainingTargetContextReader<Transaction = unknown> implements TrainingTargetContextReader {
    constructor(private readonly repository: TrainingMaxRepository<Transaction>) {}

    async resolveTrainingMax(query: ResolveTrainingMaxQuery): Promise<ResolvedTrainingMax | null> {
        const records = await this.repository.listSeries(query.profileId, {
            exerciseId: query.exerciseId,
            maxType: query.maxType,
            customLabel: query.customLabel ?? null,
        });
        const effective = resolveEffectiveTrainingMax(records, query.at);
        if (!effective) return null;
        return {
            trainingMaxId: effective.id,
            exerciseId: effective.exerciseId,
            maxType: effective.maxType,
            customLabel: effective.customLabel,
            valueKg: effective.valueKg,
            effectiveFrom: effective.effectiveFrom,
            effectiveTo: effective.effectiveTo,
        };
    }
}
