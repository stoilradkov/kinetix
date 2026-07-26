import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    ExpectedVersionGuard,
    type RevisionMutationService,
    type TransactionalEventPublisher,
    type UnitOfWork,
} from "#src/platform/application/index";
import { DomainEvent, entityId, type Clock, type EntityId } from "#src/platform/domain/index";

import type { ExerciseRepository, ExerciseMutationMetadata } from "#src/modules/training/application/exercises";
import {
    ExerciseDefinition,
    ExerciseMergePolicy,
    type ExerciseDefinitionState,
    type ExerciseMergeIntent,
    type ExerciseRedirect,
    type ExerciseReferenceImpact,
} from "#src/modules/training/domain/index";

export const EXERCISE_MERGE_REPOSITORY = Symbol("EXERCISE_MERGE_REPOSITORY");
export const EXERCISE_REFERENCE_UPDATER = Symbol("EXERCISE_REFERENCE_UPDATER");
export const EXERCISE_MERGE_SERVICE = Symbol("EXERCISE_MERGE_SERVICE");

export interface ExerciseMergePreview {
    readonly canonicalExercise: {
        readonly id: string;
        readonly name: string;
        readonly version: number;
    };
    readonly mergedExercise: {
        readonly id: string;
        readonly name: string;
        readonly version: number;
    };
    readonly redirectedAliases: readonly string[];
    readonly externalIds: readonly {
        readonly provider: string;
        readonly externalId: string;
    }[];
    readonly referenceImpact: readonly ExerciseReferenceImpact[];
    readonly totalReferenceCount: number;
    readonly affectedExerciseIds: readonly string[];
    readonly affectedFamilyExerciseIds: readonly string[];
    readonly after: {
        readonly resolvedExerciseId: string;
        readonly mergedExerciseSelectable: false;
        readonly historicalSnapshotsPreserved: true;
    };
}

export interface ExerciseMergeRecord {
    readonly id: string;
    readonly status: "applied" | "reverted";
    readonly version: number;
    readonly canonicalExercise: {
        readonly id: string;
        readonly name: string;
        readonly version: number;
    };
    readonly mergedExercise: {
        readonly id: string;
        readonly name: string;
        readonly version: number;
    };
    readonly mergedExerciseVersionAfterApply: number;
    readonly revertedCanonicalExerciseVersion: number | null;
    readonly revertedMergedExerciseVersion: number | null;
    readonly redirectedAliases: readonly string[];
    readonly externalIds: readonly {
        readonly provider: string;
        readonly externalId: string;
    }[];
    readonly referenceImpact: readonly ExerciseReferenceImpact[];
    readonly totalReferenceCount: number;
    readonly affectedExerciseIds: readonly string[];
    readonly affectedFamilyExerciseIds: readonly string[];
    readonly reason: string | null;
    readonly revertReason: string | null;
    readonly appliedAt: string;
    readonly revertedAt: string | null;
}

export interface ExerciseMergeHistoryPage {
    readonly items: readonly ExerciseMergeRecord[];
    readonly nextCursor: number | null;
}

export interface ExerciseMergeRepository<Transaction = unknown> {
    activeRedirects(transaction?: Transaction): Promise<readonly ExerciseRedirect[]>;
    resolveCanonicalId(exerciseId: EntityId, transaction?: Transaction): Promise<EntityId>;
    externalIdsFor(
        exerciseId: EntityId,
        transaction?: Transaction,
    ): Promise<readonly { readonly provider: string; readonly externalId: string }[]>;
    affectedFamilyExerciseIds(exerciseIds: readonly EntityId[], transaction?: Transaction): Promise<readonly string[]>;
    apply(
        intent: ExerciseMergeIntent,
        mergedExerciseVersionAfterApply: number,
        transaction: Transaction,
    ): Promise<ExerciseMergeRecord>;
    loadForUpdate(id: EntityId, transaction: Transaction): Promise<ExerciseMergeRecord | null>;
    revert(
        input: {
            readonly id: EntityId;
            readonly expectedVersion: number;
            readonly revertedCanonicalExerciseVersion: number;
            readonly revertedMergedExerciseVersion: number;
            readonly revertedAt: Date;
            readonly reason: string | null;
        },
        transaction: Transaction,
    ): Promise<ExerciseMergeRecord>;
    get(id: EntityId): Promise<ExerciseMergeRecord | null>;
    history(exerciseId: EntityId, limit: number, cursor?: number): Promise<ExerciseMergeHistoryPage>;
}

/**
 * Updates current, mutable Training references only. Historical occurrence
 * snapshots and external IDs are deliberately outside this port.
 */
export interface ExerciseReferenceUpdater<Transaction = unknown> {
    preview(
        mergedExerciseId: EntityId,
        canonicalExerciseId: EntityId,
        transaction: Transaction,
    ): Promise<readonly ExerciseReferenceImpact[]>;
    redirect(
        mergeId: EntityId,
        mergedExerciseId: EntityId,
        canonicalExerciseId: EntityId,
        transaction: Transaction,
    ): Promise<readonly ExerciseReferenceImpact[]>;
    revert(mergeId: EntityId, transaction: Transaction): Promise<void>;
}

export interface PreviewExerciseMergeCommand {
    readonly canonicalExerciseId: string;
    readonly mergedExerciseId: string;
    readonly expectedCanonicalVersion: number;
    readonly expectedMergedVersion: number;
}

export interface MergeExerciseCommand extends PreviewExerciseMergeCommand {
    readonly reason?: string | null;
}

export interface RevertExerciseMergeCommand {
    readonly expectedMergeVersion: number;
    readonly expectedCanonicalVersion: number;
    readonly expectedMergedVersion: number;
    readonly reason?: string | null;
}

interface ExerciseMergeRuntime<Transaction> {
    readonly unitOfWork: UnitOfWork<Transaction>;
    readonly exercises: ExerciseRepository<Transaction>;
    readonly merges: ExerciseMergeRepository<Transaction>;
    readonly references: ExerciseReferenceUpdater<Transaction>;
    readonly mutations: RevisionMutationService<ExerciseDefinitionState, DomainEvent, Transaction>;
    readonly events: TransactionalEventPublisher<DomainEvent, Transaction>;
    readonly clock?: Clock;
    readonly generateId?: () => string;
}

export class ExerciseMergeService<Transaction = unknown> {
    private readonly policy = new ExerciseMergePolicy();
    private readonly expectedVersions = new ExpectedVersionGuard();
    private readonly clock: Clock;
    private readonly generateId: () => string;

    constructor(private readonly runtime: ExerciseMergeRuntime<Transaction>) {
        this.clock = runtime.clock ?? { now: () => new Date() };
        this.generateId =
            runtime.generateId ??
            (() => {
                throw new Error("Exercise merge ID generation is not configured");
            });
    }

    preview(input: PreviewExerciseMergeCommand): Promise<ExerciseMergePreview> {
        return this.runtime.unitOfWork.execute(async transaction => {
            const prepared = await this.prepare("00000000-0000-7000-8000-000000000000", input, transaction, null);
            return previewFrom(prepared.intent);
        });
    }

    merge(
        input: MergeExerciseCommand,
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseMergeRecord> {
        return this.inTransaction(transaction, metadata, async activeTransaction => {
            const mergeId = validEntityId(this.generateId(), "Exercise merge ID");
            const now = this.clock.now();
            let prepared = await this.prepare(mergeId, input, activeTransaction, input.reason ?? null, now);

            const archived = await this.runtime.mutations.mutate({
                entityType: "training.exercise",
                entityId: validEntityId(input.mergedExerciseId, "Merged exercise ID"),
                expectedVersion: input.expectedMergedVersion,
                change: state => ({
                    state: ExerciseDefinition.rehydrate(state).archive(now).state,
                }),
                metadata: {
                    source: metadata.source ?? "user",
                    actorId: metadata.actorId ?? null,
                    reason: input.reason ?? metadata.reason ?? null,
                    summary: `Merged exercise into ${prepared.intent.canonicalExerciseName}`,
                    correlationId: metadata.correlationId,
                },
                transaction: activeTransaction,
            });

            const actualImpact = await this.runtime.references.redirect(
                mergeId,
                validEntityId(input.mergedExerciseId, "Merged exercise ID"),
                validEntityId(input.canonicalExerciseId, "Canonical exercise ID"),
                activeTransaction,
            );
            if (!sameImpact(prepared.intent.referenceImpact, actualImpact))
                prepared = {
                    ...prepared,
                    intent: this.policy.plan(
                        {
                            ...prepared.policyInput,
                            referenceImpact: actualImpact,
                        },
                        now,
                    ),
                };

            const record = await this.runtime.merges.apply(prepared.intent, archived.version, activeTransaction);
            await this.runtime.events.publish(
                [this.catalogChangedEvent(record, "merged", metadata, now)],
                activeTransaction,
                metadata,
            );
            return record;
        });
    }

    revert(
        mergeId: string,
        input: RevertExerciseMergeCommand,
        metadata: ExerciseMutationMetadata,
        transaction?: Transaction,
    ): Promise<ExerciseMergeRecord> {
        return this.inTransaction(transaction, metadata, async activeTransaction => {
            const id = validEntityId(mergeId, "Exercise merge ID");
            const merge = await this.runtime.merges.loadForUpdate(id, activeTransaction);
            if (!merge) throw new ExerciseMergeNotFoundError(mergeId);
            this.expectedVersions.verify(input.expectedMergeVersion, merge.version);
            if (merge.status === "reverted")
                throw new ApplicationValidationError("The exercise merge has already been reverted");

            const canonicalId = validEntityId(merge.canonicalExercise.id, "Canonical exercise ID");
            const mergedId = validEntityId(merge.mergedExercise.id, "Merged exercise ID");
            const [canonical, merged] = await this.requiredExercisePair(canonicalId, mergedId, activeTransaction);
            const redirects = await this.runtime.merges.activeRedirects(activeTransaction);
            this.expectedVersions.verify(input.expectedCanonicalVersion, canonical.version);
            this.expectedVersions.verify(input.expectedMergedVersion, merged.version);
            this.policy.assertRevertible({
                intent: intentFromRecord(merge),
                canonical: canonical.state,
                merged: merged.state,
                activeRedirects: redirects,
            });

            const now = this.clock.now();
            await this.runtime.references.revert(id, activeTransaction);
            const restored = await this.runtime.mutations.mutate({
                entityType: "training.exercise",
                entityId: mergedId,
                expectedVersion: input.expectedMergedVersion,
                change: state => ({
                    state: ExerciseDefinition.rehydrate(state).restore(now).state,
                }),
                metadata: {
                    source: metadata.source ?? "user",
                    actorId: metadata.actorId ?? null,
                    reason: input.reason ?? metadata.reason ?? null,
                    summary: `Reverted merge into ${merge.canonicalExercise.name}`,
                    correlationId: metadata.correlationId,
                },
                transaction: activeTransaction,
            });
            const reverted = await this.runtime.merges.revert(
                {
                    id,
                    expectedVersion: input.expectedMergeVersion,
                    revertedCanonicalExerciseVersion: canonical.version,
                    revertedMergedExerciseVersion: restored.version,
                    revertedAt: now,
                    reason: input.reason ?? null,
                },
                activeTransaction,
            );
            await this.runtime.events.publish(
                [this.catalogChangedEvent(reverted, "merge-reverted", metadata, now)],
                activeTransaction,
                metadata,
            );
            return reverted;
        });
    }

    async get(mergeId: string): Promise<ExerciseMergeRecord> {
        const merge = await this.runtime.merges.get(validEntityId(mergeId, "Exercise merge ID"));
        if (!merge) throw new ExerciseMergeNotFoundError(mergeId);
        return merge;
    }

    history(exerciseId: string, limit: number, cursor?: number): Promise<ExerciseMergeHistoryPage> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw new ApplicationValidationError("Exercise merge history limit must be between 1 and 100");
        if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0))
            throw new ApplicationValidationError("Exercise merge history cursor is invalid");
        return this.runtime.merges.history(validEntityId(exerciseId, "Exercise ID"), limit, cursor);
    }

    async resolveCanonicalId(exerciseId: string): Promise<string> {
        return this.runtime.merges.resolveCanonicalId(validEntityId(exerciseId, "Exercise ID"));
    }

    private async prepare(
        mergeId: EntityId | string,
        input: PreviewExerciseMergeCommand,
        transaction: Transaction,
        reason: string | null,
        now = this.clock.now(),
    ): Promise<{
        readonly intent: ExerciseMergeIntent;
        readonly policyInput: Parameters<ExerciseMergePolicy["plan"]>[0];
    }> {
        const canonicalId = validEntityId(input.canonicalExerciseId, "Canonical exercise ID");
        const mergedId = validEntityId(input.mergedExerciseId, "Merged exercise ID");
        if (canonicalId === mergedId) throw new ApplicationValidationError("An exercise cannot be merged into itself");
        const [canonical, merged] = await this.requiredExercisePair(canonicalId, mergedId, transaction);
        const [redirects, externalIds, referenceImpact, affectedFamilyExerciseIds] = await Promise.all([
            this.runtime.merges.activeRedirects(transaction),
            this.runtime.merges.externalIdsFor(mergedId, transaction),
            this.runtime.references.preview(mergedId, canonicalId, transaction),
            this.runtime.merges.affectedFamilyExerciseIds([canonicalId, mergedId], transaction),
        ]);
        this.expectedVersions.verify(input.expectedCanonicalVersion, canonical.version);
        this.expectedVersions.verify(input.expectedMergedVersion, merged.version);
        const policyInput = {
            id: mergeId,
            canonical: canonical.state,
            merged: merged.state,
            canonicalExerciseVersion: canonical.version,
            mergedExerciseVersion: merged.version,
            activeRedirects: redirects,
            externalIds,
            referenceImpact,
            affectedFamilyExerciseIds,
            reason,
        };
        return { intent: this.policy.plan(policyInput, now), policyInput };
    }

    private async requiredExercise(
        id: EntityId,
        transaction: Transaction,
    ): Promise<{ readonly state: ExerciseDefinitionState; readonly version: number }> {
        const stored = await this.runtime.exercises.loadForUpdate("training.exercise", id, transaction);
        if (!stored) throw new ApplicationNotFoundError(`Exercise ${id} was not found`, { exerciseId: id });
        return stored;
    }

    private async requiredExercisePair(
        canonicalId: EntityId,
        mergedId: EntityId,
        transaction: Transaction,
    ): Promise<
        readonly [
            { readonly state: ExerciseDefinitionState; readonly version: number },
            { readonly state: ExerciseDefinitionState; readonly version: number },
        ]
    > {
        const orderedIds = [canonicalId, mergedId].sort();
        const first = await this.requiredExercise(orderedIds[0] as EntityId, transaction);
        const second = await this.requiredExercise(orderedIds[1] as EntityId, transaction);
        return canonicalId === orderedIds[0] ? [first, second] : [second, first];
    }

    private catalogChangedEvent(
        merge: ExerciseMergeRecord,
        action: "merged" | "merge-reverted",
        metadata: ExerciseMutationMetadata,
        occurredAt: Date,
    ): DomainEvent {
        return new DomainEvent({
            id: this.generateId(),
            name: "training.catalog.changed",
            version: 1,
            occurredAt,
            aggregateType: "training.exercise-merge",
            aggregateId: merge.id,
            aggregateRevision: merge.version,
            correlationId: metadata.correlationId,
            payload: {
                action,
                mergeId: merge.id,
                canonicalExerciseId: merge.canonicalExercise.id,
                mergedExerciseId: merge.mergedExercise.id,
                affectedExerciseIds: merge.affectedExerciseIds,
                affectedFamilyExerciseIds: merge.affectedFamilyExerciseIds,
            },
        });
    }

    private inTransaction<Result>(
        transaction: Transaction | undefined,
        metadata: ExerciseMutationMetadata,
        work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result> {
        return transaction === undefined ? this.runtime.unitOfWork.execute(work, metadata) : work(transaction);
    }
}

export class ExerciseMergeNotFoundError extends ApplicationNotFoundError {
    constructor(readonly mergeId: string) {
        super(`Exercise merge ${mergeId} was not found`, { mergeId });
        this.name = "ExerciseMergeNotFoundError";
    }
}

function previewFrom(intent: ExerciseMergeIntent): ExerciseMergePreview {
    return {
        canonicalExercise: {
            id: intent.canonicalExerciseId,
            name: intent.canonicalExerciseName,
            version: intent.canonicalExerciseVersion,
        },
        mergedExercise: {
            id: intent.mergedExerciseId,
            name: intent.mergedExerciseName,
            version: intent.mergedExerciseVersion,
        },
        redirectedAliases: intent.redirectedAliases,
        externalIds: intent.externalIds,
        referenceImpact: intent.referenceImpact,
        totalReferenceCount: intent.referenceImpact.reduce((total, item) => total + item.count, 0),
        affectedExerciseIds: intent.affectedExerciseIds,
        affectedFamilyExerciseIds: intent.affectedFamilyExerciseIds,
        after: {
            resolvedExerciseId: intent.canonicalExerciseId,
            mergedExerciseSelectable: false,
            historicalSnapshotsPreserved: true,
        },
    };
}

function intentFromRecord(record: ExerciseMergeRecord): ExerciseMergeIntent {
    return {
        id: record.id,
        canonicalExerciseId: record.canonicalExercise.id,
        mergedExerciseId: record.mergedExercise.id,
        canonicalExerciseName: record.canonicalExercise.name,
        mergedExerciseName: record.mergedExercise.name,
        canonicalExerciseVersion: record.canonicalExercise.version,
        mergedExerciseVersion: record.mergedExercise.version,
        redirectedAliases: record.redirectedAliases,
        externalIds: record.externalIds,
        referenceImpact: record.referenceImpact,
        affectedExerciseIds: record.affectedExerciseIds,
        affectedFamilyExerciseIds: record.affectedFamilyExerciseIds,
        reason: record.reason,
        appliedAt: record.appliedAt,
    };
}

function validEntityId(value: string, name: string): EntityId {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError(`${name} must be a UUID`);
    }
}

function sameImpact(left: readonly ExerciseReferenceImpact[], right: readonly ExerciseReferenceImpact[]): boolean {
    return (
        left.length === right.length &&
        left.every((item, index) => {
            const candidate = right[index];
            return candidate?.referenceType === item.referenceType && candidate.count === item.count;
        })
    );
}
