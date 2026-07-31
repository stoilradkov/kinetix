import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";

import { plannedSessionPrescriptions, plannedSessions, type Database, type PlannedSessionRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    PLANNED_SESSION_ENTITY_TYPE,
    type PlannedSessionListFilter,
    type PlannedSessionRepository,
    type PlannedSessionResource,
} from "#src/modules/training/application/index";
import {
    PlannedSession,
    plannedSessionStatuses,
    skipCancelReasons,
    type PlannedSessionState,
    type PlannedSessionStatus,
    type SkipCancelReason,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzlePlannedSessionRepository implements PlannedSessionRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readSession(id: EntityId, transaction?: unknown): Promise<PlannedSessionResource | null> {
        const row = (
            await this.executor(transaction).select().from(plannedSessions).where(eq(plannedSessions.id, id)).limit(1)
        )[0];
        return row ? { ...hydrate(row), version: row.version } : null;
    }

    async listSessions(filter?: PlannedSessionListFilter): Promise<readonly PlannedSessionResource[]> {
        const rows = await this.database.db
            .select()
            .from(plannedSessions)
            .where(filter?.includeArchived ? undefined : isNull(plannedSessions.archivedAt))
            .orderBy(asc(plannedSessions.localDate), asc(plannedSessions.createdAt), asc(plannedSessions.id));
        return rows.map(row => ({ ...hydrate(row), version: row.version }));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: PlannedSessionState; version: number } | null> {
        assertEntityType(entityType);
        const row = (
            await this.executor(transaction)
                .select()
                .from(plannedSessions)
                .where(eq(plannedSessions.id, id))
                .limit(1)
                .for("update")
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async create(
        entityType: string,
        id: EntityId,
        state: PlannedSessionState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Planned session state ID does not match its aggregate ID");
        PlannedSession.rehydrate(state);
        await this.executor(transaction).insert(plannedSessions).values(rootValues(state, version));
        await this.linkPrescription(state.id, version, state.currentPrescriptionId, transaction);
    }

    async save(
        entityType: string,
        id: EntityId,
        state: PlannedSessionState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Planned session state ID does not match its aggregate ID");
        PlannedSession.rehydrate(state);
        const updated = await this.executor(transaction)
            .update(plannedSessions)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(plannedSessions.id, id), eq(plannedSessions.version, expectedVersion)))
            .returning({ id: plannedSessions.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
        await this.linkPrescription(state.id, nextVersion, state.currentPrescriptionId, transaction);
    }

    /** Preserve the version→prescription link so every published planned prescription survives (design 10.3). */
    private async linkPrescription(
        plannedSessionId: string,
        plannedSessionVersion: number,
        prescriptionId: string,
        transaction: unknown,
    ): Promise<void> {
        await this.executor(transaction)
            .insert(plannedSessionPrescriptions)
            .values({ plannedSessionId, plannedSessionVersion, prescriptionId })
            .onConflictDoUpdate({
                target: [
                    plannedSessionPrescriptions.plannedSessionId,
                    plannedSessionPrescriptions.plannedSessionVersion,
                ],
                set: { prescriptionId },
            });
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: PlannedSessionRow): PlannedSessionState {
    return PlannedSession.rehydrate({
        id: row.id,
        profileId: row.profileId,
        title: row.title,
        status: checkedStatus(row.status),
        localDate: row.localDate,
        timeZone: row.timeZone,
        preferredTime: row.preferredTime,
        expectedDurationMinutes: row.expectedDurationMinutes,
        notes: row.notes,
        tags: row.tags,
        skipReason: row.skipReason === null ? null : checkedReason(row.skipReason),
        skipNotes: row.skipNotes,
        currentPrescriptionId: row.currentPrescriptionId,
        sourceTemplateId: row.sourceTemplateId,
        sourceTemplateVersion: row.sourceTemplateVersion,
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: PlannedSessionState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        title: state.title,
        status: state.status,
        localDate: state.localDate,
        timeZone: state.timeZone,
        preferredTime: state.preferredTime,
        expectedDurationMinutes: state.expectedDurationMinutes,
        notes: state.notes,
        tags: [...state.tags],
        skipReason: state.skipReason,
        skipNotes: state.skipNotes,
        currentPrescriptionId: state.currentPrescriptionId,
        sourceTemplateId: state.sourceTemplateId,
        sourceTemplateVersion: state.sourceTemplateVersion,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: PlannedSessionState, version: number) {
    return {
        title: state.title,
        status: state.status,
        localDate: state.localDate,
        timeZone: state.timeZone,
        preferredTime: state.preferredTime,
        expectedDurationMinutes: state.expectedDurationMinutes,
        notes: state.notes,
        tags: [...state.tags],
        skipReason: state.skipReason,
        skipNotes: state.skipNotes,
        currentPrescriptionId: state.currentPrescriptionId,
        sourceTemplateId: state.sourceTemplateId,
        sourceTemplateVersion: state.sourceTemplateVersion,
        version,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== PLANNED_SESSION_ENTITY_TYPE)
        throw new Error(`Unsupported planned session entity type '${entityType}'`);
}

function checkedStatus(value: string): PlannedSessionStatus {
    return (plannedSessionStatuses as readonly string[]).includes(value)
        ? (value as PlannedSessionStatus)
        : invalidPersisted("planned session status", value);
}

function checkedReason(value: string): SkipCancelReason {
    return (skipCancelReasons as readonly string[]).includes(value)
        ? (value as SkipCancelReason)
        : invalidPersisted("skip/cancel reason", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
