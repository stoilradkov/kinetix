import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";

import { progressionRules, type Database, type ProgressionRuleRow } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    PROGRESSION_RULE_ENTITY_TYPE,
    type ApplicableProgressionRuleReader,
    type ProgressionRuleListFilter,
    type ProgressionRuleRepository,
    type ProgressionRuleResource,
} from "#src/modules/training/application/index";
import {
    ProgressionRule,
    type ActionV1,
    type ConditionV1,
    type ProgressionRuleState,
    type ProgressionRuleStatus,
    type RuleScopeType,
    type RuleTargetMode,
    type RuleTargetSelector,
    type RuleTrigger,
    type SafetyPolicy,
    progressionRuleStatuses,
    ruleScopeTypes,
    ruleTargetModes,
} from "#src/modules/training/domain/index";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId, type EntityId } from "#src/platform/domain/index";

/**
 * Persistence adapter for the ProgressionRule root (issue #39, G1) that also serves the applicable-rule
 * reads the evaluation pipeline needs (issue #40, G2). Every row is revalidated through the domain model
 * on hydration; Drizzle rows never escape the boundary.
 */
@Injectable()
export class DrizzleProgressionRuleRepository implements ProgressionRuleRepository, ApplicableProgressionRuleReader {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async findEnabledByTrigger(
        trigger: RuleTrigger,
        transaction?: unknown,
    ): Promise<readonly ProgressionRuleResource[]> {
        const executor = this.executor(transaction);
        const rows = await executor
            .select()
            .from(progressionRules)
            .where(
                and(
                    eq(progressionRules.status, "active"),
                    eq(progressionRules.enabled, true),
                    sql`${progressionRules.triggers} @> ${JSON.stringify([trigger])}::jsonb`,
                ),
            );
        return rows.map(row => this.toResource(row));
    }

    findById(ruleId: string, transaction?: unknown): Promise<ProgressionRuleResource | null> {
        return this.readRule(entityId(ruleId), transaction);
    }

    async readRule(id: EntityId, transaction?: unknown): Promise<ProgressionRuleResource | null> {
        const executor = this.executor(transaction);
        const row = (await executor.select().from(progressionRules).where(eq(progressionRules.id, id)).limit(1))[0];
        if (!row) return null;
        return this.toResource(row);
    }

    async listRules(filter?: ProgressionRuleListFilter): Promise<readonly ProgressionRuleResource[]> {
        const conditions = [];
        if (!filter?.includeArchived) conditions.push(eq(progressionRules.status, "active"));
        if (filter?.scopeType !== undefined) conditions.push(eq(progressionRules.scopeType, filter.scopeType));
        if (filter?.enabled !== undefined) conditions.push(eq(progressionRules.enabled, filter.enabled));
        const rows = await this.database.db
            .select()
            .from(progressionRules)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(asc(progressionRules.createdAt), asc(progressionRules.id));
        return rows.map(row => this.toResource(row));
    }

    async loadForUpdate(
        entityType: string,
        id: EntityId,
        transaction: unknown,
    ): Promise<{ state: ProgressionRuleState; version: number } | null> {
        assertEntityType(entityType);
        const executor = this.executor(transaction);
        const row = (
            await executor.select().from(progressionRules).where(eq(progressionRules.id, id)).limit(1).for("update")
        )[0];
        if (!row) return null;
        return { state: hydrate(row), version: row.version };
    }

    async create(
        entityType: string,
        id: EntityId,
        state: ProgressionRuleState,
        version: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Progression rule state ID does not match its aggregate ID");
        ProgressionRule.rehydrate(state);
        const executor = this.executor(transaction);
        await executor.insert(progressionRules).values(rootValues(state, version));
    }

    async save(
        entityType: string,
        id: EntityId,
        state: ProgressionRuleState,
        expectedVersion: number,
        nextVersion: number,
        transaction: unknown,
    ): Promise<void> {
        assertEntityType(entityType);
        if (id !== state.id) throw new Error("Progression rule state ID does not match its aggregate ID");
        ProgressionRule.rehydrate(state);
        const executor = this.executor(transaction);
        const updated = await executor
            .update(progressionRules)
            .set(rootUpdateValues(state, nextVersion))
            .where(and(eq(progressionRules.id, id), eq(progressionRules.version, expectedVersion)))
            .returning({ id: progressionRules.id });
        if (updated.length !== 1) throw new VersionConflictError(expectedVersion, nextVersion);
    }

    private toResource(row: ProgressionRuleRow): ProgressionRuleResource {
        return { ...hydrate(row), version: row.version };
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function hydrate(row: ProgressionRuleRow): ProgressionRuleState {
    return ProgressionRule.rehydrate({
        id: row.id,
        profileId: row.profileId,
        name: row.name,
        description: row.description,
        scope: { type: checkedScopeType(row.scopeType), id: row.scopeId },
        target: {
            mode: checkedTargetMode(row.targetMode),
            selector: row.targetSelector as unknown as RuleTargetSelector,
        },
        conditionSchemaVersion: row.conditionSchemaVersion,
        condition: row.condition as unknown as ConditionV1,
        actionSchemaVersion: row.actionSchemaVersion,
        actions: row.actions as unknown as ActionV1[],
        triggers: row.triggers as unknown as RuleTrigger[],
        enabled: row.enabled,
        autoApply: row.autoApply,
        safetyPolicy: row.safetyPolicy as unknown as SafetyPolicy,
        status: checkedStatus(row.status),
        archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }).state;
}

function rootValues(state: ProgressionRuleState, version: number) {
    return {
        id: state.id,
        profileId: state.profileId,
        name: state.name,
        description: state.description,
        scopeType: state.scope.type,
        scopeId: state.scope.id,
        targetMode: state.target.mode,
        targetSelector: state.target.selector as unknown as Record<string, unknown>,
        conditionSchemaVersion: state.conditionSchemaVersion,
        condition: state.condition as unknown as Record<string, unknown>,
        actionSchemaVersion: state.actionSchemaVersion,
        actions: state.actions as unknown as Record<string, unknown>[],
        triggers: [...state.triggers],
        enabled: state.enabled,
        autoApply: state.autoApply,
        safetyPolicy: state.safetyPolicy as unknown as Record<string, unknown>,
        status: state.status,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        version,
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
    };
}

function rootUpdateValues(state: ProgressionRuleState, version: number) {
    return {
        name: state.name,
        description: state.description,
        scopeType: state.scope.type,
        scopeId: state.scope.id,
        targetMode: state.target.mode,
        targetSelector: state.target.selector as unknown as Record<string, unknown>,
        conditionSchemaVersion: state.conditionSchemaVersion,
        condition: state.condition as unknown as Record<string, unknown>,
        actionSchemaVersion: state.actionSchemaVersion,
        actions: state.actions as unknown as Record<string, unknown>[],
        triggers: [...state.triggers],
        enabled: state.enabled,
        autoApply: state.autoApply,
        safetyPolicy: state.safetyPolicy as unknown as Record<string, unknown>,
        status: state.status,
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        version,
        updatedAt: new Date(state.updatedAt),
    };
}

function assertEntityType(entityType: string): void {
    if (entityType !== PROGRESSION_RULE_ENTITY_TYPE)
        throw new Error(`Unsupported progression rule entity type '${entityType}'`);
}

function checkedScopeType(value: string): RuleScopeType {
    return (ruleScopeTypes as readonly string[]).includes(value)
        ? (value as RuleScopeType)
        : invalidPersisted("progression rule scope type", value);
}

function checkedTargetMode(value: string): RuleTargetMode {
    return (ruleTargetModes as readonly string[]).includes(value)
        ? (value as RuleTargetMode)
        : invalidPersisted("progression rule target mode", value);
}

function checkedStatus(value: string): ProgressionRuleStatus {
    return (progressionRuleStatuses as readonly string[]).includes(value)
        ? (value as ProgressionRuleStatus)
        : invalidPersisted("progression rule status", value);
}

function invalidPersisted(kind: string, value: string): never {
    throw new Error(`Invalid persisted ${kind}: ${value}`);
}
