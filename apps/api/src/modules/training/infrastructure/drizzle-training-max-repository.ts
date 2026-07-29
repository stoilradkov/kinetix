import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";

import { trainingMaxes, type Database, type TrainingMaxRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    TrainingMaxCurrentFilter,
    TrainingMaxRepository,
    TrainingMaxSeriesRef,
} from "#src/modules/training/application/index";
import {
    DecimalValue,
    TrainingMax,
    trainingMaxSources,
    trainingMaxTypes,
    trainingMaxUnits,
    type TrainingMaxSource,
    type TrainingMaxState,
    type TrainingMaxType,
    type TrainingMaxUnit,
} from "#src/modules/training/domain/index";

@Injectable()
export class DrizzleTrainingMaxRepository implements TrainingMaxRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async insert(state: TrainingMaxState, transaction: unknown): Promise<void> {
        TrainingMax.rehydrate(state);
        await this.executor(transaction).insert(trainingMaxes).values(rowValues(state));
    }

    async findOpenForUpdate(
        profileId: string,
        series: TrainingMaxSeriesRef,
        transaction: unknown,
    ): Promise<TrainingMaxState | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(trainingMaxes)
                .where(and(seriesCondition(profileId, series), isNull(trainingMaxes.effectiveTo)))
                .limit(1)
                .for("update")
        )[0];
        return row ? hydrate(row) : null;
    }

    async close(id: string, effectiveTo: string, updatedAt: string, transaction: unknown): Promise<void> {
        const updated = await this.executor(transaction)
            .update(trainingMaxes)
            .set({ effectiveTo: new Date(effectiveTo), updatedAt: new Date(updatedAt) })
            .where(and(eq(trainingMaxes.id, id), isNull(trainingMaxes.effectiveTo)))
            .returning({ id: trainingMaxes.id });
        if (updated.length !== 1) throw new Error(`Failed to close open training max ${id}`);
    }

    async findById(id: string, transaction?: unknown): Promise<TrainingMaxState | null> {
        const row = (
            await this.executor(transaction).select().from(trainingMaxes).where(eq(trainingMaxes.id, id)).limit(1)
        )[0];
        return row ? hydrate(row) : null;
    }

    async listCurrent(profileId: string, filter?: TrainingMaxCurrentFilter): Promise<readonly TrainingMaxState[]> {
        const conditions: SQL[] = [eq(trainingMaxes.profileId, profileId), isNull(trainingMaxes.effectiveTo)];
        if (filter?.exerciseId !== undefined) conditions.push(eq(trainingMaxes.exerciseId, filter.exerciseId));
        const rows = await this.database.db
            .select()
            .from(trainingMaxes)
            .where(and(...conditions))
            .orderBy(asc(trainingMaxes.exerciseId), asc(trainingMaxes.maxType), asc(trainingMaxes.customLabel));
        return rows.map(hydrate);
    }

    async listSeries(profileId: string, series: TrainingMaxSeriesRef): Promise<readonly TrainingMaxState[]> {
        const rows = await this.database.db
            .select()
            .from(trainingMaxes)
            .where(seriesCondition(profileId, series))
            .orderBy(asc(trainingMaxes.effectiveFrom), asc(trainingMaxes.createdAt));
        return rows.map(hydrate);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function seriesCondition(profileId: string, series: TrainingMaxSeriesRef): SQL {
    return and(
        eq(trainingMaxes.profileId, profileId),
        eq(trainingMaxes.exerciseId, series.exerciseId),
        eq(trainingMaxes.maxType, series.maxType),
        series.customLabel === null
            ? isNull(trainingMaxes.customLabel)
            : eq(trainingMaxes.customLabel, series.customLabel),
    ) as SQL;
}

function rowValues(state: TrainingMaxState) {
    return {
        id: state.id,
        profileId: state.profileId,
        exerciseId: state.exerciseId,
        maxType: state.maxType,
        customLabel: state.customLabel,
        valueKg: state.valueKg,
        enteredValue: state.enteredValue,
        enteredUnit: state.enteredUnit,
        source: state.source,
        note: state.note,
        effectiveFrom: new Date(state.effectiveFrom),
        effectiveTo: state.effectiveTo === null ? null : new Date(state.effectiveTo),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function hydrate(row: TrainingMaxRow): TrainingMaxState {
    return TrainingMax.rehydrate({
        id: row.id,
        profileId: row.profileId,
        exerciseId: row.exerciseId,
        maxType: checkedType(row.maxType),
        customLabel: row.customLabel,
        valueKg: DecimalValue.from(row.valueKg).toString(),
        enteredValue: DecimalValue.from(row.enteredValue).toString(),
        enteredUnit: checkedUnit(row.enteredUnit),
        source: checkedSource(row.source),
        note: row.note,
        effectiveFrom: row.effectiveFrom.toISOString(),
        effectiveTo: row.effectiveTo === null ? null : row.effectiveTo.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function checkedType(value: string): TrainingMaxType {
    return (trainingMaxTypes as readonly string[]).includes(value)
        ? (value as TrainingMaxType)
        : invalidPersisted("training max type", value);
}

function checkedSource(value: string): TrainingMaxSource {
    return (trainingMaxSources as readonly string[]).includes(value)
        ? (value as TrainingMaxSource)
        : invalidPersisted("training max source", value);
}

function checkedUnit(value: string): TrainingMaxUnit {
    return (trainingMaxUnits as readonly string[]).includes(value)
        ? (value as TrainingMaxUnit)
        : invalidPersisted("training max unit", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
