import { afterEach, describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";

import { analyticsInvalidations, createDatabase, derivedMetricInputs, derivedMetrics } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import type { DerivedMetricRecord } from "#src/modules/training/application/index";
import type { InvalidationScope } from "#src/modules/training/domain/index";
import { DrizzleAnalyticsInvalidationStore } from "#src/modules/training/infrastructure/drizzle-analytics-invalidation-store";
import { DrizzleDerivedMetricRepository } from "#src/modules/training/infrastructure/drizzle-derived-metric-repository";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const now = new Date("2026-08-09T09:00:00.000Z");
const profileId = "0198a4db-d8da-7000-8000-0000000d0001";
const nkA = "1".repeat(64);
const nkB = "2".repeat(64);
const scopeId = "0198a4db-d8da-7000-8000-0000000d0010";
const exerciseId = "0198a4db-d8da-7000-8000-0000000d0020";

let seq = 0;
const metricId = () => `0198a4db-d8da-7000-8000-${(0xd1000 + (seq += 1)).toString(16).padStart(12, "0")}`;

function record(overrides: Partial<DerivedMetricRecord> = {}): DerivedMetricRecord {
    return {
        id: overrides.id ?? metricId(),
        profileId,
        calculatorKey: "smoke.count",
        calculatorVersion: 1,
        naturalKey: nkA,
        scope: { type: "session", id: scopeId },
        period: { kind: "all_time" },
        dimensions: { unit: "reps" },
        numericValue: 42,
        textValue: null,
        unit: "reps",
        details: { note: "seed" },
        sourceFingerprint: "a".repeat(64),
        calculatedAt: now,
        inputs: [{ entityType: "exercise", entityId: exerciseId, revision: 1 }],
        ...overrides,
    };
}

describe.runIf(testDatabaseUrl)("derived-metric projection PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const repository = new DrizzleDerivedMetricRepository(connection as unknown as DatabaseService);
    const store = new DrizzleAnalyticsInvalidationStore(connection as unknown as DatabaseService);

    afterEach(async () => {
        await connection.db.delete(derivedMetrics).where(eq(derivedMetrics.profileId, profileId));
        await connection.db.delete(analyticsInvalidations).where(eq(analyticsInvalidations.reason, "test"));
    });

    it("inserts a current projection with its input references", async () => {
        await connection.db.transaction(tx => repository.supersedeAndInsert(nkA, record(), tx));
        const view = await repository.currentByNaturalKey(nkA);
        expect(view?.numericValue).toBe(42);
        expect(view?.state).toBe("current");
        expect(view?.stale).toBe(false);
        const inputs = await connection.db
            .select()
            .from(derivedMetricInputs)
            .where(eq(derivedMetricInputs.metricId, view!.id));
        expect(inputs).toHaveLength(1);
        expect(inputs[0]!.entityType).toBe("exercise");
    });

    it("supersedes the old row and keeps at most one current per natural key", async () => {
        await connection.db.transaction(tx => repository.supersedeAndInsert(nkA, record({ numericValue: 42 }), tx));
        await connection.db.transaction(tx =>
            repository.supersedeAndInsert(nkA, record({ numericValue: 99, sourceFingerprint: "b".repeat(64) }), tx),
        );
        const current = await connection.db
            .select()
            .from(derivedMetrics)
            .where(and(eq(derivedMetrics.naturalKey, nkA), eq(derivedMetrics.state, "current")));
        const superseded = await connection.db
            .select()
            .from(derivedMetrics)
            .where(and(eq(derivedMetrics.naturalKey, nkA), eq(derivedMetrics.state, "superseded")));
        expect(current).toHaveLength(1);
        expect(Number(current[0]!.numericValue)).toBe(99);
        expect(superseded).toHaveLength(1);
        expect(superseded[0]!.supersededAt).not.toBeNull();
    });

    it("marks stale and finds affected by projection scope or by input reference", async () => {
        await connection.db.transaction(tx => repository.supersedeAndInsert(nkA, record(), tx));

        const byScope: InvalidationScope = { dependency: "session", scopeType: "session", scopeId };
        const byInput: InvalidationScope = { dependency: "exercise", scopeType: "exercise", scopeId: exerciseId };

        expect((await repository.findAffected([byScope])).map(target => target.calculatorKey)).toEqual(["smoke.count"]);
        expect(await repository.findAffected([byInput])).toHaveLength(1);
        expect(
            await repository.findAffected([{ dependency: "session", scopeType: "session", scopeId: "none" }]),
        ).toHaveLength(0);

        await connection.db.transaction(tx => repository.markStale([byInput], tx));
        expect((await repository.currentByNaturalKey(nkA))?.stale).toBe(true);
        await connection.db.transaction(tx => repository.clearStale(nkA, tx));
        expect((await repository.currentByNaturalKey(nkA))?.stale).toBe(false);
    });

    it("filters the query and lists current targets", async () => {
        await connection.db.transaction(tx => repository.supersedeAndInsert(nkA, record(), tx));
        await connection.db.transaction(tx =>
            repository.supersedeAndInsert(
                nkB,
                record({ naturalKey: nkB, scope: { type: "profile", id: profileId } }),
                tx,
            ),
        );
        const scoped = await repository.query({ scopeType: "profile", limit: 10 });
        expect(scoped).toHaveLength(1);
        expect(scoped[0]!.scope.type).toBe("profile");
        expect(await repository.listCurrentTargets()).toHaveLength(2);
    });

    it("coalesces duplicate pending invalidations and drains them", async () => {
        const scope = { dependency: "session" as const, scopeType: "session", scopeId, reason: "test", eventId: null };
        await connection.db.transaction(tx => store.append([scope, scope], tx));
        await connection.db.transaction(tx => store.append([scope], tx)); // duplicate pending → coalesced away

        const pendingBefore = await connection.db
            .select()
            .from(analyticsInvalidations)
            .where(and(eq(analyticsInvalidations.reason, "test"), eq(analyticsInvalidations.status, "pending")));
        expect(pendingBefore).toHaveLength(1);

        await connection.db.transaction(async tx => {
            const claimed = await store.claimPending(50, tx);
            await store.markProcessed(
                claimed.map(item => item.id),
                now,
                tx,
            );
        });
        const pendingAfter = await connection.db
            .select()
            .from(analyticsInvalidations)
            .where(and(eq(analyticsInvalidations.reason, "test"), eq(analyticsInvalidations.status, "pending")));
        expect(pendingAfter).toHaveLength(0);
    });
});
