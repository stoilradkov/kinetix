import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { workoutTemplatePrescriptions, workoutTemplates, type Database, type WorkoutTemplateRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    WORKOUT_TEMPLATE_ENTITY_TYPE,
    type WorkoutTemplateListFilter,
    type WorkoutTemplateRepository,
    type WorkoutTemplateResource,
} from "#src/modules/training/application/index";
import {
    WorkoutTemplate,
    workoutTemplateStatuses,
    type WorkoutTemplateState,
    type WorkoutTemplateStatus,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import type { EntityId } from "#src/platform/domain/index";

@Injectable()
export class DrizzleWorkoutTemplateRepository implements WorkoutTemplateRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async readTemplate(id: EntityId, transaction?: unknown): Promise<WorkoutTemplateResource | null> {
        const row = (
            await this.executor(transaction).select().from(workoutTemplates).where(eq(workoutTemplates.id, id)).limit(1)
        )[0];
        return row ? { ...hydrate(row), version: row.version } : null;
    }

    async listTemplates(filter?: WorkoutTemplateListFilter): Promise<readonly WorkoutTemplateResource[]> {
        const rows = await this.database.db
            .select()
            .from(workoutTemplates)
            .where(filter?.includeArchived ? undefined : eq(workoutTemplates.status, "active"))
            .orderBy(asc(workoutTemplates.status), asc(workoutTemplates.name), asc(workoutTemplates.id));
        return rows.map(row => ({ ...hydrate(row), version: row.version }));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: WorkoutTemplateState; version: number } | null> {
        assertEntityType(entityType);
        const row = (
            await this.executor(transaction)
                .select()
                .from(workoutTemplates)
                .where(eq(workoutTemplates.id, id))
                .limit(1)
                .for("update")
        )[0];
        return row ? { state: hydrate(row), version: row.version } : null;
    }

    async create(
        entityType: string,
        id: EntityId,
        state: WorkoutTemplateState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Workout template state ID does not match its aggregate ID");
        WorkoutTemplate.rehydrate(state);
        await this.executor(transaction).insert(workoutTemplates).values(rootValues(state, version));
        await this.linkPrescription(state.id, version, state.currentPrescriptionId, transaction);
    }

    async save(
        entityType: string,
        id: EntityId,
        state: WorkoutTemplateState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Workout template state ID does not match its aggregate ID");
        WorkoutTemplate.rehydrate(state);
        const updated = await this.executor(transaction)
            .update(workoutTemplates)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(workoutTemplates.id, id), eq(workoutTemplates.version, expectedVersion)))
            .returning({ id: workoutTemplates.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
        await this.linkPrescription(state.id, nextVersion, state.currentPrescriptionId, transaction);
    }

    /**
     * Preserve the version→prescription link so every published template prescription can be
     * rehydrated later (design 10.3). The primary key is (template, version); a restore that
     * re-points at an existing prescription re-writes the same link idempotently.
     */
    private async linkPrescription(
        templateId: string,
        templateVersion: number,
        prescriptionId: string,
        transaction: unknown,
    ): Promise<void> {
        await this.executor(transaction)
            .insert(workoutTemplatePrescriptions)
            .values({ templateId, templateVersion, prescriptionId })
            .onConflictDoUpdate({
                target: [workoutTemplatePrescriptions.templateId, workoutTemplatePrescriptions.templateVersion],
                set: { prescriptionId },
            });
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: WorkoutTemplateRow): WorkoutTemplateState {
    return WorkoutTemplate.rehydrate({
        id: row.id,
        profileId: row.profileId,
        name: row.name,
        description: row.description,
        currentPrescriptionId: row.currentPrescriptionId,
        status: checkedStatus(row.status),
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: WorkoutTemplateState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        name: state.name,
        description: state.description,
        currentPrescriptionId: state.currentPrescriptionId,
        status: state.status,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        version,
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: WorkoutTemplateState, version: number) {
    return {
        name: state.name,
        description: state.description,
        currentPrescriptionId: state.currentPrescriptionId,
        status: state.status,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        version,
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== WORKOUT_TEMPLATE_ENTITY_TYPE)
        throw new Error(`Unsupported workout template entity type '${entityType}'`);
}

function checkedStatus(value: string): WorkoutTemplateStatus {
    return (workoutTemplateStatuses as readonly string[]).includes(value)
        ? (value as WorkoutTemplateStatus)
        : invalidPersisted("workout template status", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
