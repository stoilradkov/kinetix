import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
    trainingInjuries,
    trainingInjuryExercises,
    trainingInjuryMuscles,
    type Database,
    type TrainingInjuryRow,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    TRAINING_INJURY_ENTITY_TYPE,
    type TrainingInjuryListFilter,
    type TrainingInjuryRepository,
    type TrainingInjuryResource,
} from "#src/modules/training/application/index";
import {
    TrainingInjury,
    injurySeverities,
    injurySides,
    injuryStatuses,
    type InjurySeverity,
    type InjurySide,
    type InjuryStatus,
    type TrainingInjuryState,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleTrainingInjuryRepository implements TrainingInjuryRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readInjury(id: EntityId, transaction?: unknown): Promise<TrainingInjuryResource | null> {
        const executor = this.executor(transaction);
        const row = (await executor.select().from(trainingInjuries).where(eq(trainingInjuries.id, id)).limit(1))[0];
        if (!row) return null;
        const links = await this.readLinks(executor, [id]);
        return this.toResource(row, links);
    }

    async listInjuries(filter?: TrainingInjuryListFilter): Promise<readonly TrainingInjuryResource[]> {
        const rows = await this.database.db
            .select()
            .from(trainingInjuries)
            .where(filter?.status === undefined ? undefined : and(eq(trainingInjuries.status, filter.status)))
            .orderBy(asc(trainingInjuries.onsetDate), asc(trainingInjuries.createdAt), asc(trainingInjuries.id));
        const links = await this.readLinks(
            this.database.db,
            rows.map(row => row.id),
        );
        return rows.map(row => this.toResource(row, links));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: TrainingInjuryState; version: number } | null> {
        assertEntityType(entityType);
        const executor = this.executor(transaction);
        const row = (
            await executor.select().from(trainingInjuries).where(eq(trainingInjuries.id, id)).limit(1).for("update")
        )[0];
        if (!row) return null;
        const links = await this.readLinks(executor, [id]);
        return { state: hydrate(row, links), version: row.version };
    }

    async create(
        entityType: string,
        id: EntityId,
        state: TrainingInjuryState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Training injury state ID does not match its aggregate ID");
        TrainingInjury.rehydrate(state);
        const executor = this.executor(transaction);
        await executor.insert(trainingInjuries).values(rootValues(state, version));
        await this.writeLinks(executor, state);
    }

    async save(
        entityType: string,
        id: EntityId,
        state: TrainingInjuryState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Training injury state ID does not match its aggregate ID");
        TrainingInjury.rehydrate(state);
        const executor = this.executor(transaction);
        const updated = await executor
            .update(trainingInjuries)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(trainingInjuries.id, id), eq(trainingInjuries.version, expectedVersion)))
            .returning({ id: trainingInjuries.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
        await executor.delete(trainingInjuryMuscles).where(eq(trainingInjuryMuscles.injuryId, id));
        await executor.delete(trainingInjuryExercises).where(eq(trainingInjuryExercises.injuryId, id));
        await this.writeLinks(executor, state);
    }

    private async writeLinks(executor: Database, state: TrainingInjuryState): Promise<void> {
        if (state.muscleGroupIds.length > 0)
            await executor
                .insert(trainingInjuryMuscles)
                .values(state.muscleGroupIds.map(muscleGroupId => ({ injuryId: state.id, muscleGroupId })));
        if (state.exerciseIds.length > 0)
            await executor
                .insert(trainingInjuryExercises)
                .values(state.exerciseIds.map(exerciseId => ({ injuryId: state.id, exerciseId })));
    }

    private async readLinks(executor: Database, injuryIds: readonly string[]): Promise<InjuryLinks> {
        const muscles = new Map<string, string[]>();
        const exercises = new Map<string, string[]>();
        if (injuryIds.length === 0) return { muscles, exercises };
        const muscleRows = await executor
            .select()
            .from(trainingInjuryMuscles)
            .where(inArray(trainingInjuryMuscles.injuryId, [...injuryIds]));
        for (const link of muscleRows) push(muscles, link.injuryId, link.muscleGroupId);
        const exerciseRows = await executor
            .select()
            .from(trainingInjuryExercises)
            .where(inArray(trainingInjuryExercises.injuryId, [...injuryIds]));
        for (const link of exerciseRows) push(exercises, link.injuryId, link.exerciseId);
        return { muscles, exercises };
    }

    private toResource(row: TrainingInjuryRow, links: InjuryLinks): TrainingInjuryResource {
        return { ...hydrate(row, links), version: row.version };
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

interface InjuryLinks {
    readonly muscles: Map<string, string[]>;
    readonly exercises: Map<string, string[]>;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
}

function hydrate(row: TrainingInjuryRow, links: InjuryLinks): TrainingInjuryState {
    return TrainingInjury.rehydrate({
        id: row.id,
        profileId: row.profileId,
        name: row.name,
        bodyArea: row.bodyArea,
        side: row.side === null ? null : checkedSide(row.side),
        severity: checkedSeverity(row.severity),
        status: checkedStatus(row.status),
        onsetDate: row.onsetDate,
        resolvedDate: row.resolvedDate,
        notes: row.notes,
        muscleGroupIds: links.muscles.get(row.id) ?? [],
        exerciseIds: links.exercises.get(row.id) ?? [],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: TrainingInjuryState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        name: state.name,
        bodyArea: state.bodyArea,
        side: state.side,
        severity: state.severity,
        status: state.status,
        onsetDate: state.onsetDate,
        resolvedDate: state.resolvedDate,
        notes: state.notes,
        version,
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: TrainingInjuryState, version: number) {
    return {
        name: state.name,
        bodyArea: state.bodyArea,
        side: state.side,
        severity: state.severity,
        status: state.status,
        onsetDate: state.onsetDate,
        resolvedDate: state.resolvedDate,
        notes: state.notes,
        version,
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== TRAINING_INJURY_ENTITY_TYPE)
        throw new Error(`Unsupported training injury entity type '${entityType}'`);
}

function checkedSide(value: string): InjurySide {
    return (injurySides as readonly string[]).includes(value)
        ? (value as InjurySide)
        : invalidPersisted("training injury side", value);
}

function checkedSeverity(value: string): InjurySeverity {
    return (injurySeverities as readonly string[]).includes(value)
        ? (value as InjurySeverity)
        : invalidPersisted("training injury severity", value);
}

function checkedStatus(value: string): InjuryStatus {
    return (injuryStatuses as readonly string[]).includes(value)
        ? (value as InjuryStatus)
        : invalidPersisted("training injury status", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
