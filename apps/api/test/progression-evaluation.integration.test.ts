import { describe, expect, it } from "vitest";

import { createDatabase, progressionRules, trainingSessions } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { canonicalMetricKey, ProgressionRule, type MetricEvaluation } from "#src/modules/training/domain/index";
import type { ProgressionEvaluationRecord } from "#src/modules/training/application/index";
import { DrizzleProgressionEvaluationRepository } from "#src/modules/training/infrastructure/drizzle-progression-evaluation-repository";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const profileId = "0198a4db-d8da-7000-8000-0000000e0001";
const ruleId = "0198a4db-d8da-7000-8000-0000000e0002";
const sessionId = "0198a4db-d8da-7000-8000-0000000e0003";
const scopeId = "0198a4db-d8da-7000-8000-0000000e0004";
const evaluationId = "0198a4db-d8da-7000-8000-0000000e0005";
const now = new Date("2026-08-09T12:00:00.000Z");
const fingerprint = "a".repeat(64);

const explanation: MetricEvaluation = {
    kind: "metric",
    matched: true,
    metricKey: "rpe",
    canonicalKey: canonicalMetricKey({ key: "rpe", scope: "session" }),
    operator: "lte",
    comparand: 8,
    observed: 7,
    missing: false,
    sourceRevision: 1,
};

function record(overrides: Partial<ProgressionEvaluationRecord> = {}): ProgressionEvaluationRecord {
    return {
        id: evaluationId,
        profileId,
        ruleId,
        ruleVersion: 1,
        ruleName: "Progress on low RPE",
        trainingSessionId: sessionId,
        trainingSessionVersion: 1,
        trigger: "session_completed",
        scopeType: "program",
        scopeId,
        target: { mode: "next", selector: { kind: "scope" } },
        matched: true,
        status: "pending",
        explanation,
        missingMetrics: [],
        contextRevisions: { session: 1 },
        contextFacts: { [explanation.canonicalKey]: { value: 7, sourceRevision: 1 } },
        contextFingerprint: fingerprint,
        safety: {
            outcome: "pass",
            findings: [
                {
                    policyKey: "active_pain",
                    outcome: "pass",
                    message: "No active pain",
                    evidence: {},
                    missingInputs: [],
                },
            ],
            missingInputs: [],
        },
        conflict: { conflicting: false, ruleIds: [], fields: [] },
        autoApplyEligible: false,
        autoApplyReason: "Rule is not enabled for automatic application",
        evaluatedAt: now,
        actions: [
            {
                position: 0,
                actionType: "adjust_load",
                action: { type: "adjust_load", mode: "percent", value: 2.5 },
                status: "proposed",
            },
        ],
        ...overrides,
    };
}

describe.runIf(testDatabaseUrl)("progression evaluations PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleProgressionEvaluationRepository(connection as unknown as DatabaseService);

    /**
     * Run one case inside a transaction that always rolls back, so the FK rule/session rows this suite
     * needs never commit — it can run alongside the other progression suites against the shared dev
     * database without polluting their global exact-match rule listings.
     */
    async function inRollback(work: (tx: unknown) => Promise<void>): Promise<void> {
        const rollback = Symbol("rollback");
        try {
            await connection.db.transaction(async tx => {
                await seed(tx);
                await work(tx);
                return Promise.reject(rollback);
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    }

    async function seed(tx: unknown): Promise<void> {
        const db = tx as typeof connection.db;
        const ruleState = ProgressionRule.create(
            {
                id: ruleId,
                profileId,
                name: "Progress on low RPE",
                scope: { type: "program", id: scopeId },
                target: { mode: "next", selector: { kind: "scope" } },
                condition: { kind: "metric", metric: { key: "rpe", scope: "session" }, operator: "lte", value: 8 },
                actions: [{ type: "adjust_load", mode: "percent", value: 2.5 }],
            },
            now,
        ).state;
        await db.insert(progressionRules).values({
            id: ruleState.id,
            profileId: ruleState.profileId,
            name: ruleState.name,
            description: ruleState.description,
            scopeType: ruleState.scope.type,
            scopeId: ruleState.scope.id,
            targetMode: ruleState.target.mode,
            targetSelector: ruleState.target.selector,
            conditionSchemaVersion: ruleState.conditionSchemaVersion,
            condition: ruleState.condition as unknown as Record<string, unknown>,
            actionSchemaVersion: ruleState.actionSchemaVersion,
            actions: ruleState.actions as unknown as Record<string, unknown>[],
            triggers: [...ruleState.triggers],
            enabled: ruleState.enabled,
            autoApply: ruleState.autoApply,
            safetyPolicy: ruleState.safetyPolicy as unknown as Record<string, unknown>,
            status: ruleState.status,
            version: 1,
            createdAt: now,
            updatedAt: now,
        });
        await db.insert(trainingSessions).values({
            id: sessionId,
            profileId,
            status: "draft",
            localDate: "2026-08-09",
            timeZone: "UTC",
        });
    }

    it("round-trips an evaluation with its explanation, retained context, and proposed actions", async () => {
        await inRollback(async tx => {
            await repository.insert(record(), tx);

            const read = await repository.readById(evaluationId, tx);
            expect(read).not.toBeNull();
            expect(read!.status).toBe("pending");
            expect(read!.explanation).toMatchObject({ kind: "metric", matched: true, observed: 7 });
            expect(read!.contextRevisions).toEqual({ session: 1 });
            expect(read!.contextFacts[explanation.canonicalKey]).toEqual({ value: 7, sourceRevision: 1 });
            expect(read!.actions).toHaveLength(1);
            expect(read!.actions[0]).toMatchObject({ actionType: "adjust_load", status: "proposed" });
            expect(read!.safety).toMatchObject({ outcome: "pass", missingInputs: [] });
            expect(read!.safety.findings[0]).toMatchObject({ policyKey: "active_pain", outcome: "pass" });
            expect(read!.conflict).toEqual({ conflicting: false, ruleIds: [], fields: [] });
            expect(read!.autoApplyEligible).toBe(false);

            const forSession = await repository.listForSession(sessionId, tx);
            expect(forSession).toHaveLength(1);
        });
    });

    it("enforces the unique context fingerprint so replays cannot duplicate", async () => {
        await inRollback(async tx => {
            await repository.insert(record(), tx);
            expect(await repository.existsByFingerprint(fingerprint, tx)).toBe(true);
            await expect(
                repository.insert(record({ id: "0198a4db-d8da-7000-8000-0000000e0006" }), tx),
            ).rejects.toThrow();
        });
    });

    it("filters the profile approval queue by status", async () => {
        await inRollback(async tx => {
            await repository.insert(record(), tx);
            await repository.insert(
                record({
                    id: "0198a4db-d8da-7000-8000-0000000e0007",
                    status: "unmatched",
                    matched: false,
                    contextFingerprint: "b".repeat(64),
                    actions: [],
                }),
                tx,
            );
            const pending = await repository.listForProfile({ profileId, status: "pending" }, tx);
            expect(pending).toHaveLength(1);
            expect(pending[0]!.status).toBe("pending");
        });
    });
});
