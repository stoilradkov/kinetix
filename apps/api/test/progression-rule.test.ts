import { describe, expect, it } from "vitest";

import { DomainValidationError } from "#src/platform/domain/index";
import {
    ProgressionRule,
    progressionActionTypes,
    type ActionV1,
    type ConditionV1,
    type CreateProgressionRuleInput,
} from "#src/modules/training/domain/index";

const ids = {
    rule: "0198a4db-d8da-7000-8000-000000000a01",
    profile: "0198a4db-d8da-7000-8000-000000000a02",
    scope: "0198a4db-d8da-7000-8000-000000000a03",
    logical: "0198a4db-d8da-7000-8000-000000000a04",
    exercise: "0198a4db-d8da-7000-8000-000000000a05",
} as const;
const now = new Date("2026-08-09T10:00:00.000Z");

function input(overrides: Partial<CreateProgressionRuleInput> = {}): CreateProgressionRuleInput {
    return {
        id: ids.rule,
        profileId: ids.profile,
        name: "Progress bench",
        scope: { type: "template", id: ids.scope },
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

describe("ProgressionRule domain", () => {
    it("creates a rule with defaults (enabled, requires approval, session trigger)", () => {
        const rule = ProgressionRule.create(input(), now).state;
        expect(rule).toMatchObject({
            id: ids.rule,
            profileId: ids.profile,
            enabled: true,
            autoApply: false,
            triggers: ["session_completed"],
            status: "active",
            archivedAt: null,
            conditionSchemaVersion: 1,
            actionSchemaVersion: 1,
        });
    });

    it("accepts a nested recursive condition tree", () => {
        const condition: ConditionV1 = {
            kind: "all",
            conditions: [
                { kind: "metric", metric: { key: "readiness", scope: "session" }, operator: "gte", value: 6 },
                {
                    kind: "not",
                    condition: {
                        kind: "metric",
                        metric: { key: "reported_pain", scope: "exercise" },
                        operator: "gt",
                        value: 3,
                    },
                },
                {
                    kind: "any",
                    conditions: [
                        {
                            kind: "metric",
                            metric: { key: "rpe", scope: "exercise" },
                            operator: "between",
                            value: [8, 10],
                        },
                    ],
                },
            ],
        };
        expect(() => ProgressionRule.create(input({ condition }), now)).not.toThrow();
    });

    it("rejects condition nesting beyond the maximum depth", () => {
        let condition: ConditionV1 = {
            kind: "metric",
            metric: { key: "readiness", scope: "session" },
            operator: "eq",
            value: 1,
        };
        for (let depth = 0; depth < 7; depth += 1) condition = { kind: "not", condition };
        expect(() => ProgressionRule.create(input({ condition }), now)).toThrow(DomainValidationError);
    });

    it("rejects empty all/any groups", () => {
        expect(() => ProgressionRule.create(input({ condition: { kind: "all", conditions: [] } }), now)).toThrow(
            DomainValidationError,
        );
    });

    it("rejects unknown metric keys, operators, and filters", () => {
        expect(() =>
            ProgressionRule.create(
                input({
                    condition: {
                        kind: "metric",
                        metric: { key: "made_up" as never, scope: "session" },
                        operator: "eq",
                        value: 1,
                    },
                }),
                now,
            ),
        ).toThrow(DomainValidationError);
        expect(() =>
            ProgressionRule.create(
                input({
                    condition: {
                        kind: "metric",
                        metric: { key: "rpe", scope: "session" },
                        operator: "approx" as never,
                        value: 1,
                    },
                }),
                now,
            ),
        ).toThrow(DomainValidationError);
        expect(() =>
            ProgressionRule.create(
                input({
                    condition: {
                        kind: "metric",
                        metric: { key: "rpe", scope: "session", filters: { unknownFilter: "x" } },
                        operator: "eq",
                        value: 1,
                    },
                }),
                now,
            ),
        ).toThrow(DomainValidationError);
    });

    it("enforces value/operator coherence per metric value type", () => {
        // boolean metric cannot use a numeric comparator
        expect(() =>
            ProgressionRule.create(
                input({
                    condition: {
                        kind: "metric",
                        metric: { key: "completed_all_sets", scope: "exercise" },
                        operator: "gt",
                        value: true,
                    },
                }),
                now,
            ),
        ).toThrow(DomainValidationError);
        // between needs an ordered numeric pair
        expect(() =>
            ProgressionRule.create(
                input({
                    condition: {
                        kind: "metric",
                        metric: { key: "rpe", scope: "session" },
                        operator: "between",
                        value: [9, 7],
                    },
                }),
                now,
            ),
        ).toThrow(DomainValidationError);
        // numeric metric cannot receive a boolean
        expect(() =>
            ProgressionRule.create(
                input({
                    condition: {
                        kind: "metric",
                        metric: { key: "rpe", scope: "session" },
                        operator: "eq",
                        value: true,
                    },
                }),
                now,
            ),
        ).toThrow(DomainValidationError);
    });

    it("accepts every registered action type", () => {
        const actions: ActionV1[] = [
            { type: "adjust_load", mode: "absolute", value: 2.5, unit: "kg" },
            { type: "adjust_load", mode: "percent", value: 5 },
            { type: "adjust_reps", value: 1 },
            { type: "adjust_sets", value: -1 },
            { type: "set_effort_target", rpe: 8 },
            { type: "adjust_run_target", field: "pace", mode: "percent", value: -2 },
            { type: "substitute_exercise", exerciseId: ids.exercise },
            { type: "repeat_block" },
            { type: "insert_deload" },
            { type: "reschedule_session", offsetDays: 2 },
            { type: "skip_session", reason: "travel" },
            { type: "recommendation", messageTemplate: "Consider a deload" },
        ];
        expect([...new Set(actions.map(action => action.type))].sort()).toEqual([...progressionActionTypes].sort());
        expect(() => ProgressionRule.create(input({ actions }), now)).not.toThrow();
    });

    it("enforces action field/unit rules", () => {
        expect(() =>
            ProgressionRule.create(
                input({ actions: [{ type: "adjust_load", mode: "absolute", value: 5 } as ActionV1] }),
                now,
            ),
        ).toThrow(DomainValidationError);
        expect(() =>
            ProgressionRule.create(
                input({ actions: [{ type: "adjust_load", mode: "percent", value: 5, unit: "kg" } as ActionV1] }),
                now,
            ),
        ).toThrow(DomainValidationError);
        expect(() =>
            ProgressionRule.create(input({ actions: [{ type: "set_effort_target" } as ActionV1] }), now),
        ).toThrow(DomainValidationError);
    });

    it("rejects unknown schema versions", () => {
        expect(() => ProgressionRule.create(input({ conditionSchemaVersion: 2 }), now)).toThrow(DomainValidationError);
        expect(() => ProgressionRule.create(input({ actionSchemaVersion: 9 }), now)).toThrow(DomainValidationError);
    });

    it("rejects unknown scope types, target modes, and selectors", () => {
        expect(() => ProgressionRule.create(input({ scope: { type: "galaxy" as never, id: ids.scope } }), now)).toThrow(
            DomainValidationError,
        );
        expect(() =>
            ProgressionRule.create(input({ target: { mode: "someday" as never, selector: { kind: "scope" } } }), now),
        ).toThrow(DomainValidationError);
        expect(() =>
            ProgressionRule.create(input({ target: { mode: "next", selector: { kind: "planet" as never } } }), now),
        ).toThrow(DomainValidationError);
    });

    it("carries a logical-key selector and validates it as a UUID", () => {
        const rule = ProgressionRule.create(
            input({ target: { mode: "block_future", selector: { kind: "exercise", logicalKey: ids.logical } } }),
            now,
        ).state;
        expect(rule.target.selector).toEqual({ kind: "exercise", logicalKey: ids.logical });
        expect(() =>
            ProgressionRule.create(
                input({ target: { mode: "next", selector: { kind: "exercise", logicalKey: "not-a-uuid" } } }),
                now,
            ),
        ).toThrow(DomainValidationError);
    });

    it("forbids auto-applying a template-targeted rule", () => {
        expect(() =>
            ProgressionRule.create(
                input({ target: { mode: "template", selector: { kind: "scope" } }, autoApply: true }),
                now,
            ),
        ).toThrow(DomainValidationError);
    });

    it("rejects unknown and duplicate triggers", () => {
        expect(() => ProgressionRule.create(input({ triggers: ["never" as never] }), now)).toThrow(
            DomainValidationError,
        );
        expect(() => ProgressionRule.create(input({ triggers: ["manual", "manual"] }), now)).toThrow(
            DomainValidationError,
        );
    });

    it("archives and restores with a paired archive timestamp", () => {
        const later = new Date("2026-08-10T10:00:00.000Z");
        const rule = ProgressionRule.create(input(), now);
        const archived = rule.archive(later).state;
        expect(archived).toMatchObject({ status: "archived", archivedAt: later.toISOString() });
        const restored = ProgressionRule.rehydrate(archived).restore(later).state;
        expect(restored).toMatchObject({ status: "active", archivedAt: null });
    });

    it("re-validates persisted state on rehydration", () => {
        const rule = ProgressionRule.create(input(), now).state;
        const corrupted = { ...rule, conditionSchemaVersion: 3 };
        expect(() => ProgressionRule.rehydrate(corrupted)).toThrow(DomainValidationError);
    });
});
