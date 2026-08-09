import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
    progressionEvaluationActions,
    progressionEvaluations,
    type Database,
    type ProgressionEvaluationActionRow,
    type ProgressionEvaluationRow,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    type ProgressionDecisionRecord,
    type ProgressionEvaluationActionStatus,
    type ProgressionEvaluationActionView,
    type ProgressionEvaluationListFilter,
    type ProgressionEvaluationRecord,
    type ProgressionEvaluationRepository,
    type ProgressionEvaluationView,
    type ProgressionResultRevisionView,
} from "#src/modules/training/application/index";
import type {
    ActionV1,
    ConditionEvaluation,
    MetricFact,
    ProgressionActionType,
    ProgressionEvaluationStatus,
    RuleScope,
    RuleTargetSelector,
    RuleTrigger,
    SafetyFinding,
    SafetyOutcome,
} from "#src/modules/training/domain/index";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * Append-only projection adapter for progression evaluations (design §15.2). An evaluation and its
 * proposed actions are inserted atomically in the caller's transaction; the unique context fingerprint
 * (enforced by the schema and pre-checked by {@link existsByFingerprint}) keeps event/job replay from
 * duplicating evaluations. Reads rejoin actions so every result stays fully explainable. Drizzle rows
 * never escape this boundary.
 */
@Injectable()
export class DrizzleProgressionEvaluationRepository implements ProgressionEvaluationRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async existsByFingerprint(fingerprint: string, transaction?: unknown): Promise<boolean> {
        const executor = this.executor(transaction);
        const row = (
            await executor
                .select({ id: progressionEvaluations.id })
                .from(progressionEvaluations)
                .where(eq(progressionEvaluations.contextFingerprint, fingerprint))
                .limit(1)
        )[0];
        return row !== undefined;
    }

    async insert(record: ProgressionEvaluationRecord, transaction: unknown): Promise<ProgressionEvaluationView> {
        const executor = this.executor(transaction);
        await executor.insert(progressionEvaluations).values({
            id: record.id,
            profileId: record.profileId,
            ruleId: record.ruleId,
            ruleVersion: record.ruleVersion,
            ruleName: record.ruleName,
            trainingSessionId: record.trainingSessionId,
            trainingSessionVersion: record.trainingSessionVersion,
            trigger: record.trigger,
            scopeType: record.scopeType,
            scopeId: record.scopeId,
            targetMode: record.target.mode,
            targetSelector: record.target.selector,
            matched: record.matched,
            status: record.status,
            explanation: record.explanation as unknown as Record<string, unknown>,
            missingMetrics: [...record.missingMetrics],
            contextRevisions: record.contextRevisions,
            contextFacts: record.contextFacts,
            contextFingerprint: record.contextFingerprint,
            safetyOutcome: record.safety.outcome,
            safetyFindings: record.safety.findings as unknown as Record<string, unknown>[],
            safetyMissingInputs: [...record.safety.missingInputs],
            conflict: record.conflict.conflicting,
            conflictingRuleIds: [...record.conflict.ruleIds],
            conflictFields: [...record.conflict.fields],
            autoApplyEligible: record.autoApplyEligible,
            autoApplyReason: record.autoApplyReason,
            evaluatedAt: record.evaluatedAt,
        });
        if (record.actions.length > 0)
            await executor.insert(progressionEvaluationActions).values(
                record.actions.map(action => ({
                    evaluationId: record.id,
                    position: action.position,
                    actionType: action.actionType,
                    action: action.action,
                    status: action.status,
                })),
            );
        return toView(record);
    }

    async readById(id: string, transaction?: unknown): Promise<ProgressionEvaluationView | null> {
        const executor = this.executor(transaction);
        const row = (
            await executor.select().from(progressionEvaluations).where(eq(progressionEvaluations.id, id)).limit(1)
        )[0];
        if (!row) return null;
        const actions = await this.loadActions([row.id], executor);
        return hydrate(row, actions.get(row.id) ?? []);
    }

    async loadForUpdate(id: string, transaction: unknown): Promise<ProgressionEvaluationView | null> {
        const executor = this.executor(transaction);
        // Row lock so two concurrent approvers serialize and only one can apply the proposal (design §15.3).
        const row = (
            await executor
                .select()
                .from(progressionEvaluations)
                .where(eq(progressionEvaluations.id, id))
                .limit(1)
                .for("update")
        )[0];
        if (!row) return null;
        const actions = await this.loadActions([row.id], executor);
        return hydrate(row, actions.get(row.id) ?? []);
    }

    async recordDecision(
        decision: ProgressionDecisionRecord,
        transaction: unknown,
    ): Promise<ProgressionEvaluationView> {
        const executor = this.executor(transaction);
        await executor
            .update(progressionEvaluations)
            .set({
                status: decision.status,
                decidedAt: decision.decidedAt,
                decidedBy: decision.decidedBy,
                decisionReason: decision.decisionReason,
                resultRevisions: decision.resultRevisions.map(revision => ({ ...revision })),
            })
            .where(eq(progressionEvaluations.id, decision.id));
        await executor
            .update(progressionEvaluationActions)
            .set({ status: decision.actionStatus })
            .where(eq(progressionEvaluationActions.evaluationId, decision.id));
        const view = await this.readById(decision.id, transaction);
        if (!view) throw new Error(`Progression evaluation ${decision.id} vanished during a decision`);
        return view;
    }

    async markStale(id: string, transaction: unknown): Promise<void> {
        await this.executor(transaction)
            .update(progressionEvaluations)
            .set({ stale: true })
            .where(eq(progressionEvaluations.id, id));
    }

    async listForSession(sessionId: string, transaction?: unknown): Promise<readonly ProgressionEvaluationView[]> {
        const executor = this.executor(transaction);
        const rows = await executor
            .select()
            .from(progressionEvaluations)
            .where(eq(progressionEvaluations.trainingSessionId, sessionId))
            .orderBy(desc(progressionEvaluations.evaluatedAt), asc(progressionEvaluations.id));
        return this.hydrateAll(rows, executor);
    }

    async listForProfile(
        filter: ProgressionEvaluationListFilter,
        transaction?: unknown,
    ): Promise<readonly ProgressionEvaluationView[]> {
        const executor = this.executor(transaction);
        const conditions = [];
        if (filter.profileId !== undefined) conditions.push(eq(progressionEvaluations.profileId, filter.profileId));
        if (filter.status !== undefined) conditions.push(eq(progressionEvaluations.status, filter.status));
        if (filter.ruleId !== undefined) conditions.push(eq(progressionEvaluations.ruleId, filter.ruleId));
        const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
        const rows = await executor
            .select()
            .from(progressionEvaluations)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(progressionEvaluations.evaluatedAt), asc(progressionEvaluations.id))
            .limit(limit);
        return this.hydrateAll(rows, executor);
    }

    private async hydrateAll(
        rows: readonly ProgressionEvaluationRow[],
        executor: Database,
    ): Promise<readonly ProgressionEvaluationView[]> {
        if (rows.length === 0) return [];
        const actions = await this.loadActions(
            rows.map(row => row.id),
            executor,
        );
        return rows.map(row => hydrate(row, actions.get(row.id) ?? []));
    }

    private async loadActions(
        evaluationIds: readonly string[],
        executor: Database,
    ): Promise<Map<string, ProgressionEvaluationActionRow[]>> {
        const rows = await executor
            .select()
            .from(progressionEvaluationActions)
            .where(inArray(progressionEvaluationActions.evaluationId, [...evaluationIds]))
            .orderBy(asc(progressionEvaluationActions.evaluationId), asc(progressionEvaluationActions.position));
        const grouped = new Map<string, ProgressionEvaluationActionRow[]>();
        for (const row of rows) {
            const list = grouped.get(row.evaluationId) ?? [];
            list.push(row);
            grouped.set(row.evaluationId, list);
        }
        return grouped;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function toView(record: ProgressionEvaluationRecord): ProgressionEvaluationView {
    return {
        id: record.id,
        profileId: record.profileId,
        ruleId: record.ruleId,
        ruleVersion: record.ruleVersion,
        ruleName: record.ruleName,
        trainingSessionId: record.trainingSessionId,
        trainingSessionVersion: record.trainingSessionVersion,
        trigger: record.trigger,
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        target: record.target,
        matched: record.matched,
        status: record.status,
        explanation: record.explanation,
        missingMetrics: record.missingMetrics,
        contextRevisions: record.contextRevisions,
        contextFacts: record.contextFacts,
        contextFingerprint: record.contextFingerprint,
        safety: record.safety,
        conflict: record.conflict,
        autoApplyEligible: record.autoApplyEligible,
        autoApplyReason: record.autoApplyReason,
        stale: record.stale,
        decidedAt: record.decidedAt,
        decidedBy: record.decidedBy,
        decisionReason: record.decisionReason,
        resultRevisions: record.resultRevisions,
        actions: record.actions,
        evaluatedAt: record.evaluatedAt,
    };
}

function hydrate(
    row: ProgressionEvaluationRow,
    actionRows: readonly ProgressionEvaluationActionRow[],
): ProgressionEvaluationView {
    return {
        id: row.id,
        profileId: row.profileId,
        ruleId: row.ruleId,
        ruleVersion: row.ruleVersion,
        ruleName: row.ruleName,
        trainingSessionId: row.trainingSessionId,
        trainingSessionVersion: row.trainingSessionVersion,
        trigger: row.trigger as RuleTrigger,
        scopeType: row.scopeType as RuleScope["type"],
        scopeId: row.scopeId,
        target: { mode: row.targetMode as never, selector: row.targetSelector as unknown as RuleTargetSelector },
        matched: row.matched,
        status: row.status as ProgressionEvaluationStatus,
        explanation: row.explanation as unknown as ConditionEvaluation,
        missingMetrics: row.missingMetrics,
        contextRevisions: row.contextRevisions,
        contextFacts: row.contextFacts as unknown as Record<string, MetricFact>,
        contextFingerprint: row.contextFingerprint,
        safety: {
            outcome: row.safetyOutcome as SafetyOutcome,
            findings: row.safetyFindings as unknown as SafetyFinding[],
            missingInputs: row.safetyMissingInputs,
        },
        conflict: {
            conflicting: row.conflict,
            ruleIds: row.conflictingRuleIds,
            fields: row.conflictFields,
        },
        autoApplyEligible: row.autoApplyEligible,
        autoApplyReason: row.autoApplyReason,
        stale: row.stale,
        decidedAt: row.decidedAt,
        decidedBy: row.decidedBy,
        decisionReason: row.decisionReason,
        resultRevisions: row.resultRevisions as unknown as ProgressionResultRevisionView[],
        actions: actionRows.map(toActionView),
        evaluatedAt: row.evaluatedAt,
    };
}

function toActionView(row: ProgressionEvaluationActionRow): ProgressionEvaluationActionView {
    return {
        position: row.position,
        actionType: row.actionType as ProgressionActionType,
        action: row.action as unknown as ActionV1,
        status: row.status as ProgressionEvaluationActionStatus,
    };
}
