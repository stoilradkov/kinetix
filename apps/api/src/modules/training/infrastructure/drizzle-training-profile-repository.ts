import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { trainingProfiles, type Database, type TrainingProfileRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    ActiveTrainingProfileExistsError,
    TRAINING_PROFILE_ENTITY_TYPE,
    type StoredTrainingProfile,
    type TrainingProfileRepository,
    type TrainingProfileResource,
} from "#src/modules/training/application/index";
import {
    TrainingProfile,
    trainingExperiences,
    trainingProfileStatuses,
    type TrainingExperience,
    type TrainingProfileState,
    type TrainingProfileStatus,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleTrainingProfileRepository implements TrainingProfileRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async findActive(transaction?: unknown): Promise<StoredTrainingProfile | null> {
        const row = (
            await this.executor(transaction)
                .select()
                .from(trainingProfiles)
                .where(eq(trainingProfiles.status, "active"))
                .limit(1)
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async readActive(transaction?: unknown): Promise<TrainingProfileResource | null> {
        const stored = await this.findActive(transaction);
        return stored ? { ...stored.state, version: stored.version } : null;
    }

    async readProfile(id: EntityId, transaction?: unknown): Promise<TrainingProfileResource | null> {
        const row = (
            await this.executor(transaction).select().from(trainingProfiles).where(eq(trainingProfiles.id, id)).limit(1)
        )[0];
        return row ? { ...hydrate(row), version: row.version } : null;
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: TrainingProfileState; version: number } | null> {
        assertEntityType(entityType);
        const row = (
            await this.executor(transaction)
                .select()
                .from(trainingProfiles)
                .where(eq(trainingProfiles.id, id))
                .limit(1)
                .for("update")
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async create(
        entityType: string,
        id: EntityId,
        state: TrainingProfileState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Training profile state ID does not match its aggregate ID");
        TrainingProfile.rehydrate(state);
        try {
            await this.executor(transaction).insert(trainingProfiles).values(rootValues(state, version));
        } catch (error) {
            throw mapWriteError(error);
        }
    }

    async save(
        entityType: string,
        id: EntityId,
        state: TrainingProfileState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Training profile state ID does not match its aggregate ID");
        TrainingProfile.rehydrate(state);
        try {
            const updated = await this.executor(transaction)
                .update(trainingProfiles)
                .set(rootUpdateValues(state, nextVersion))
                .where(and(eq(trainingProfiles.id, id), eq(trainingProfiles.version, expectedVersion)))
                .returning({ id: trainingProfiles.id });
            if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
        } catch (error) {
            throw mapWriteError(error);
        }
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: TrainingProfileRow): TrainingProfileState {
    return TrainingProfile.rehydrate({
        id: row.id,
        profileId: row.profileId,
        status: checkedStatus(row.status),
        experience: checkedExperience(row.experience),
        oneRepMaxRepCutoff: row.oneRepMaxRepCutoff,
        hardSetRpeThreshold: Number(row.hardSetRpeThreshold),
        hardSetRirThreshold: row.hardSetRirThreshold,
        calculatorVersion: row.calculatorVersion,
        ruleVersion: row.ruleVersion,
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: TrainingProfileState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        status: state.status,
        experience: state.experience,
        oneRepMaxRepCutoff: state.oneRepMaxRepCutoff,
        hardSetRpeThreshold: String(state.hardSetRpeThreshold),
        hardSetRirThreshold: state.hardSetRirThreshold,
        calculatorVersion: state.calculatorVersion,
        ruleVersion: state.ruleVersion,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: TrainingProfileState, version: number) {
    return {
        status: state.status,
        experience: state.experience,
        oneRepMaxRepCutoff: state.oneRepMaxRepCutoff,
        hardSetRpeThreshold: String(state.hardSetRpeThreshold),
        hardSetRirThreshold: state.hardSetRirThreshold,
        calculatorVersion: state.calculatorVersion,
        ruleVersion: state.ruleVersion,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== TRAINING_PROFILE_ENTITY_TYPE)
        throw new Error(`Unsupported training profile entity type '${entityType}'`);
}

function mapWriteError(error: unknown): unknown {
    if (error instanceof VersionConflictError) return error;
    const databaseError = postgresError(error);
    if (databaseError?.code === "23505") {
        const constraint =
            typeof databaseError.constraint_name === "string"
                ? databaseError.constraint_name
                : typeof databaseError.constraint === "string"
                  ? databaseError.constraint
                  : "";
        if (constraint.includes("training_profiles_single_active_unique"))
            return new ActiveTrainingProfileExistsError();
    }
    return error;
}

function postgresError(error: unknown): { code?: unknown; constraint_name?: unknown; constraint?: unknown } | null {
    if (typeof error !== "object" || error === null) return null;
    const candidate = error as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && candidate.code.startsWith("23")) return candidate;
    return postgresError(candidate.cause);
}

function checkedStatus(value: string): TrainingProfileStatus {
    return (trainingProfileStatuses as readonly string[]).includes(value)
        ? (value as TrainingProfileStatus)
        : invalidPersisted("training profile status", value);
}

function checkedExperience(value: string): TrainingExperience {
    return (trainingExperiences as readonly string[]).includes(value)
        ? (value as TrainingExperience)
        : invalidPersisted("training experience", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
