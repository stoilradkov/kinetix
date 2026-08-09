import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, progressionRules } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import { ProgressionRule, type ConditionV1, type CreateProgressionRuleInput } from "#src/modules/training/domain/index";
import { DrizzleProgressionRuleRepository } from "#src/modules/training/infrastructure/drizzle-progression-rule-repository";
import { VersionConflictError } from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-08-09T12:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-000000000c09";
const idA = "0198a4db-d8da-7000-8000-000000000c01";
const idB = "0198a4db-d8da-7000-8000-000000000c02";
const scope = "0198a4db-d8da-7000-8000-000000000c0a";
const logical = "0198a4db-d8da-7000-8000-000000000c0b";
const ENTITY = "training.progression-rule";

function state(id: string, overrides: Partial<CreateProgressionRuleInput> = {}) {
    return ProgressionRule.create(
        {
            id,
            profileId,
            name: "Progress bench",
            scope: { type: "template", id: scope },
            target: { mode: "next", selector: { kind: "scope" } },
            condition: {
                kind: "metric",
                metric: { key: "completed_all_sets", scope: "exercise" },
                operator: "eq",
                value: true,
            },
            actions: [{ type: "adjust_load", mode: "percent", value: 2.5 }],
            ...overrides,
        },
        now,
    ).state;
}

describe.runIf(testDatabaseUrl)("progression rules PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleProgressionRuleRepository(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(progressionRules);
    });

    it("round-trips the nested condition AST, actions, selector, and triggers", async () => {
        const condition: ConditionV1 = {
            kind: "all",
            conditions: [
                {
                    kind: "metric",
                    metric: { key: "readiness", scope: "session", window: { kind: "days", value: 7 } },
                    operator: "gte",
                    value: 6,
                },
                {
                    kind: "not",
                    condition: {
                        kind: "metric",
                        metric: { key: "reported_pain", scope: "exercise" },
                        operator: "gt",
                        value: 3,
                    },
                },
            ],
        };
        await repository.create(
            ENTITY,
            entityId(idA),
            state(idA, {
                condition,
                target: { mode: "block_future", selector: { kind: "exercise", logicalKey: logical } },
                triggers: ["session_completed", "manual"],
                actions: [
                    { type: "adjust_load", mode: "absolute", value: 2.5, unit: "kg" },
                    { type: "recommendation", messageTemplate: "Great work" },
                ],
                safetyPolicy: { policyKey: "conservative", config: { maxLoadIncreasePercent: 10 } },
            }),
            1,
            connection.db,
        );

        const stored = await repository.readRule(entityId(idA));
        expect(stored?.condition).toEqual(condition);
        expect(stored?.target.selector).toEqual({ kind: "exercise", logicalKey: logical });
        expect(stored?.triggers).toEqual(["session_completed", "manual"]);
        expect(stored?.actions).toHaveLength(2);
        expect(stored?.safetyPolicy).toEqual({ policyKey: "conservative", config: { maxLoadIncreasePercent: 10 } });
        expect(stored?.version).toBe(1);
    });

    it("lists active rules by default and filters archived out, and enforces optimistic concurrency", async () => {
        await repository.create(ENTITY, entityId(idA), state(idA), 1, connection.db);
        await repository.create(ENTITY, entityId(idB), state(idB, { enabled: false }), 1, connection.db);

        const archived = ProgressionRule.rehydrate(state(idB, { enabled: false })).archive(now).state;
        await repository.save(ENTITY, entityId(idB), archived, 1, 2, connection.db);

        expect((await repository.listRules()).map(rule => rule.id)).toEqual([idA]);
        expect((await repository.listRules({ includeArchived: true })).map(rule => rule.id).sort()).toEqual(
            [idA, idB].sort(),
        );
        expect((await repository.listRules({ enabled: false, includeArchived: true })).map(rule => rule.id)).toEqual([
            idB,
        ]);

        await expect(repository.save(ENTITY, entityId(idB), archived, 1, 2, connection.db)).rejects.toBeInstanceOf(
            VersionConflictError,
        );
    });
});
