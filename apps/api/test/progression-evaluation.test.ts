import { describe, expect, it } from "vitest";

import {
    buildEvaluationFingerprintSeed,
    canonicalMetricKey,
    evaluateProgressionRule,
    type ActionV1,
    type ConditionV1,
    type MetricFact,
    type MetricLookup,
    type MetricSelector,
} from "#src/modules/training/domain/index";

const fact = (value: number | boolean | null, sourceRevision: number | null = 1): MetricFact => ({
    value,
    sourceRevision,
});

function lookup(entries: Record<string, MetricFact>): MetricLookup {
    return new Map(Object.entries(entries));
}

const rpe: MetricSelector = { key: "rpe", scope: "session" };
const completedAllSets: MetricSelector = { key: "completed_all_sets", scope: "session" };
const streak: MetricSelector = { key: "consecutive_successful_sessions", scope: "exercise" };

type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between";

const metric = (
    selector: MetricSelector,
    operator: Operator,
    value: number | readonly [number, number] | boolean,
): ConditionV1 => ({ kind: "metric", metric: selector, operator, value });

const bumpLoad: ActionV1 = { type: "adjust_load", mode: "percent", value: 2.5 };

describe("canonicalMetricKey", () => {
    it("is stable regardless of filter key order", () => {
        const a: MetricSelector = { key: "weekly_volume", scope: "program", filters: { tag: "x", exerciseId: "e" } };
        const b: MetricSelector = { key: "weekly_volume", scope: "program", filters: { exerciseId: "e", tag: "x" } };
        expect(canonicalMetricKey(a)).toBe(canonicalMetricKey(b));
    });

    it("distinguishes windows and scopes", () => {
        const base: MetricSelector = { key: "rpe", scope: "session" };
        const windowed: MetricSelector = { key: "rpe", scope: "session", window: { kind: "sessions", value: 3 } };
        expect(canonicalMetricKey(base)).not.toBe(canonicalMetricKey(windowed));
    });
});

describe("evaluateProgressionRule", () => {
    it("matches a satisfied numeric comparison and proposes actions", () => {
        const condition = metric(rpe, "lte", 8);
        const facts = lookup({ [canonicalMetricKey(rpe)]: fact(7) });

        const outcome = evaluateProgressionRule({ condition, actions: [bumpLoad], facts });

        expect(outcome.matched).toBe(true);
        expect(outcome.status).toBe("pending");
        expect(outcome.proposedActions).toEqual([{ position: 0, action: bumpLoad }]);
        expect(outcome.explanation).toMatchObject({ kind: "metric", matched: true, observed: 7, missing: false });
    });

    it("does not match and proposes nothing when the comparison fails", () => {
        const condition = metric(rpe, "lte", 6);
        const facts = lookup({ [canonicalMetricKey(rpe)]: fact(9) });

        const outcome = evaluateProgressionRule({ condition, actions: [bumpLoad], facts });

        expect(outcome.matched).toBe(false);
        expect(outcome.status).toBe("unmatched");
        expect(outcome.proposedActions).toEqual([]);
    });

    it("evaluates nested boolean groups deterministically", () => {
        const condition: ConditionV1 = {
            kind: "all",
            conditions: [
                metric(completedAllSets, "eq", true),
                { kind: "any", conditions: [metric(rpe, "lte", 7), metric(streak, "gte", 3)] },
            ],
        };
        const facts = lookup({
            [canonicalMetricKey(completedAllSets)]: fact(true),
            [canonicalMetricKey(rpe)]: fact(9),
            [canonicalMetricKey(streak)]: fact(4),
        });

        const outcome = evaluateProgressionRule({ condition, actions: [bumpLoad], facts });
        expect(outcome.matched).toBe(true);
    });

    it("treats a missing metric as unmet and records it, and negates deterministically", () => {
        const missing = metric(rpe, "lte", 8);
        const facts = lookup({});

        const positive = evaluateProgressionRule({ condition: missing, actions: [bumpLoad], facts });
        expect(positive.matched).toBe(false);
        expect(positive.missingMetrics).toEqual([canonicalMetricKey(rpe)]);

        const negated = evaluateProgressionRule({
            condition: { kind: "not", condition: missing },
            actions: [bumpLoad],
            facts,
        });
        expect(negated.matched).toBe(true);
        expect(negated.missingMetrics).toEqual([canonicalMetricKey(rpe)]);
    });

    it("supports between and boolean semantics", () => {
        const between = metric(rpe, "between", [6, 8]);
        expect(
            evaluateProgressionRule({
                condition: between,
                actions: [bumpLoad],
                facts: lookup({ [canonicalMetricKey(rpe)]: fact(7) }),
            }).matched,
        ).toBe(true);
        expect(
            evaluateProgressionRule({
                condition: between,
                actions: [bumpLoad],
                facts: lookup({ [canonicalMetricKey(rpe)]: fact(9) }),
            }).matched,
        ).toBe(false);

        const boolCondition = metric(completedAllSets, "neq", true);
        expect(
            evaluateProgressionRule({
                condition: boolCondition,
                actions: [bumpLoad],
                facts: lookup({ [canonicalMetricKey(completedAllSets)]: fact(false) }),
            }).matched,
        ).toBe(true);
    });

    it("records the source revision each metric fact came from", () => {
        const condition = metric(rpe, "lte", 8);
        const facts = lookup({ [canonicalMetricKey(rpe)]: fact(7, 42) });
        const outcome = evaluateProgressionRule({ condition, actions: [bumpLoad], facts });
        expect(outcome.explanation).toMatchObject({ kind: "metric", sourceRevision: 42 });
    });
});

describe("buildEvaluationFingerprintSeed", () => {
    it("normalises context revisions so key order does not change identity", () => {
        const base = {
            ruleId: "rule",
            ruleVersion: 2,
            conditionSchemaVersion: 1,
            actionSchemaVersion: 1,
            trigger: "session_completed" as const,
            targetMode: "next",
            targetSelector: { kind: "scope" as const },
            scopeType: "program",
            scopeId: "program-1",
            subjectId: "session-1",
        };
        const a = buildEvaluationFingerprintSeed({ ...base, contextRevisions: { session: 3, adherence: 1 } });
        const b = buildEvaluationFingerprintSeed({ ...base, contextRevisions: { adherence: 1, session: 3 } });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
});
