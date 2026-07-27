import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { profiles, type Database, type ProfileRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    ActiveCoreProfileExistsError,
    CORE_PROFILE_ENTITY_TYPE,
    type CoreProfileRepository,
    type CoreProfileResource,
    type StoredCoreProfile,
} from "#src/modules/profile/application/index";
import {
    CoreProfile,
    distanceUnits,
    lengthUnits,
    massUnits,
    profileSexes,
    profileStatuses,
    type CoreProfileState,
    type DistanceUnit,
    type LengthUnit,
    type MassUnit,
    type ProfileSex,
    type ProfileStatus,
    type UnitPreferences,
} from "#src/modules/profile/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleCoreProfileRepository implements CoreProfileRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async findActive(transaction?: unknown): Promise<StoredCoreProfile | null> {
        const row = (
            await this.executor(transaction).select().from(profiles).where(eq(profiles.status, "active")).limit(1)
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async readActive(transaction?: unknown): Promise<CoreProfileResource | null> {
        const stored = await this.findActive(transaction);
        return stored ? { ...stored.state, version: stored.version } : null;
    }

    async readProfile(id: EntityId, transaction?: unknown): Promise<CoreProfileResource | null> {
        const row = (await this.executor(transaction).select().from(profiles).where(eq(profiles.id, id)).limit(1))[0];
        return row ? { ...hydrate(row), version: row.version } : null;
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: CoreProfileState; version: number } | null> {
        assertEntityType(entityType);
        const row = (
            await this.executor(transaction).select().from(profiles).where(eq(profiles.id, id)).limit(1).for("update")
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async create(
        entityType: string,
        id: EntityId,
        state: CoreProfileState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Core profile state ID does not match its aggregate ID");
        CoreProfile.rehydrate(state);
        try {
            await this.executor(transaction).insert(profiles).values(rootValues(state, version));
        } catch (error) {
            throw mapWriteError(error);
        }
    }

    async save(
        entityType: string,
        id: EntityId,
        state: CoreProfileState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Core profile state ID does not match its aggregate ID");
        CoreProfile.rehydrate(state);
        try {
            const updated = await this.executor(transaction)
                .update(profiles)
                .set(rootUpdateValues(state, nextVersion))
                .where(and(eq(profiles.id, id), eq(profiles.version, expectedVersion)))
                .returning({ id: profiles.id });
            if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
        } catch (error) {
            throw mapWriteError(error);
        }
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: ProfileRow): CoreProfileState {
    return CoreProfile.rehydrate({
        id: row.id,
        status: checkedStatus(row.status),
        birthDate: row.birthDate,
        sex: row.sex === null ? null : checkedSex(row.sex),
        heightMeters: row.heightM,
        timeZone: row.timeZone,
        unitPreferences: checkedUnitPreferences(row.unitPreferences),
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: CoreProfileState, version: number) {
    return {
        id: state.id,
        status: state.status,
        birthDate: state.birthDate,
        sex: state.sex,
        heightM: state.heightMeters,
        timeZone: state.timeZone,
        unitPreferences: state.unitPreferences,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: CoreProfileState, version: number) {
    return {
        status: state.status,
        birthDate: state.birthDate,
        sex: state.sex,
        heightM: state.heightMeters,
        timeZone: state.timeZone,
        unitPreferences: state.unitPreferences,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== CORE_PROFILE_ENTITY_TYPE)
        throw new Error(`Unsupported core profile entity type '${entityType}'`);
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
        if (constraint.includes("profiles_single_active_unique")) return new ActiveCoreProfileExistsError();
    }
    return error;
}

function postgresError(error: unknown): { code?: unknown; constraint_name?: unknown; constraint?: unknown } | null {
    if (typeof error !== "object" || error === null) return null;
    const candidate = error as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && candidate.code.startsWith("23")) return candidate;
    return postgresError(candidate.cause);
}

function checkedStatus(value: string): ProfileStatus {
    return (profileStatuses as readonly string[]).includes(value)
        ? (value as ProfileStatus)
        : invalidPersisted("core profile status", value);
}

function checkedSex(value: string): ProfileSex {
    return (profileSexes as readonly string[]).includes(value)
        ? (value as ProfileSex)
        : invalidPersisted("core profile sex", value);
}

function checkedUnitPreferences(value: { mass: string; distance: string; length: string }): UnitPreferences {
    return {
        mass: checkedEnum(value.mass, massUnits, "mass unit") as MassUnit,
        distance: checkedEnum(value.distance, distanceUnits, "distance unit") as DistanceUnit,
        length: checkedEnum(value.length, lengthUnits, "length unit") as LengthUnit,
    };
}

function checkedEnum(value: string, allowed: readonly string[], kind: string): string {
    return allowed.includes(value) ? value : invalidPersisted(kind, value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
