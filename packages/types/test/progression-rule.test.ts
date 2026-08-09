import { describe, expect, it } from "vitest";

import {
    createProgressionRuleRequestSchema,
    progressionConditionDepth,
    progressionConditionSchema,
    type ProgressionCondition,
} from "#src/progression-rule";

const scopeId = "0198a4db-d8da-7000-8000-000000000f01";

function request(overrides: Record<string, unknown> = {}) {
    return {
        name: "Progress bench",
        scope: { type: "template", id: scopeId },
        target: { mode: "next", selector: { kind: "scope" } },
        condition: {
            kind: "metric",
            metric: { key: "completed_all_sets", scope: "exercise" },
            operator: "eq",
            value: true,
        },
        actions: [{ type: "adjust_load", mode: "percent", value: 2.5 }],
        ...overrides,
    };
}

describe("progression rule contracts", () => {
    it("parses a recursive all/any/not condition tree", () => {
        const condition: ProgressionCondition = {
            kind: "all",
            conditions: [
                { kind: "metric", metric: { key: "readiness", scope: "session" }, operator: "gte", value: 6 },
                {
                    kind: "not",
                    condition: {
                        kind: "metric",
                        metric: { key: "rpe", scope: "exercise" },
                        operator: "between",
                        value: [8, 10],
                    },
                },
            ],
        };
        expect(progressionConditionSchema.safeParse(condition).success).toBe(true);
        expect(progressionConditionDepth(condition)).toBe(3);
    });

    it("rejects unknown metric keys, operators, and filters", () => {
        expect(
            progressionConditionSchema.safeParse({
                kind: "metric",
                metric: { key: "hax", scope: "session" },
                operator: "eq",
                value: 1,
            }).success,
        ).toBe(false);
        expect(
            progressionConditionSchema.safeParse({
                kind: "metric",
                metric: { key: "rpe", scope: "session" },
                operator: "pwn",
                value: 1,
            }).success,
        ).toBe(false);
        expect(
            progressionConditionSchema.safeParse({
                kind: "metric",
                metric: { key: "rpe", scope: "session", filters: { evil: "x" } },
                operator: "eq",
                value: 1,
            }).success,
        ).toBe(false);
    });

    it("enforces boolean-metric and between value coherence", () => {
        expect(
            progressionConditionSchema.safeParse({
                kind: "metric",
                metric: { key: "completed_all_sets", scope: "exercise" },
                operator: "gt",
                value: true,
            }).success,
        ).toBe(false);
        expect(
            progressionConditionSchema.safeParse({
                kind: "metric",
                metric: { key: "rpe", scope: "session" },
                operator: "between",
                value: [9, 7],
            }).success,
        ).toBe(false);
    });

    it("rejects a condition tree deeper than the maximum depth", () => {
        let condition: ProgressionCondition = {
            kind: "metric",
            metric: { key: "rpe", scope: "session" },
            operator: "eq",
            value: 1,
        };
        for (let depth = 0; depth < 7; depth += 1) condition = { kind: "not", condition };
        expect(createProgressionRuleRequestSchema.safeParse(request({ condition })).success).toBe(false);
    });

    it("accepts every action but rejects malformed action fields", () => {
        expect(
            createProgressionRuleRequestSchema.safeParse(
                request({
                    actions: [
                        { type: "adjust_load", mode: "absolute", value: 2.5, unit: "kg" },
                        { type: "set_effort_target", rpe: 8 },
                        { type: "recommendation", messageTemplate: "deload" },
                    ],
                }),
            ).success,
        ).toBe(true);
        expect(
            createProgressionRuleRequestSchema.safeParse(
                request({ actions: [{ type: "adjust_load", mode: "absolute", value: 5 }] }),
            ).success,
        ).toBe(false);
        expect(
            createProgressionRuleRequestSchema.safeParse(request({ actions: [{ type: "invent_action", value: 1 }] }))
                .success,
        ).toBe(false);
    });

    it("forbids template-targeted auto-apply and rejects unknown top-level keys", () => {
        expect(
            createProgressionRuleRequestSchema.safeParse(
                request({ target: { mode: "template", selector: { kind: "scope" } }, autoApply: true }),
            ).success,
        ).toBe(false);
        expect(createProgressionRuleRequestSchema.safeParse(request({ hackerField: true })).success).toBe(false);
    });
});
