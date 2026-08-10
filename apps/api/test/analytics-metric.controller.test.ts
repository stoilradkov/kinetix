import { describe, expect, it, vi } from "vitest";

import type {
    DerivedMetricRepository,
    DerivedMetricView,
    FindingRepository,
    FindingView,
    RebuildMetrics,
} from "#src/modules/training/application/index";
import { AnalyticsMetricController } from "#src/modules/training/presentation/index";
import { ApplicationValidationError } from "#src/platform/application/index";

const now = new Date("2026-08-09T09:00:00.000Z");

function view(overrides: Partial<DerivedMetricView> = {}): DerivedMetricView {
    return {
        id: "0198a4db-d8da-7000-8000-00000000e010",
        profileId: "0198a4db-d8da-7000-8000-00000000e001",
        calculatorKey: "smoke.count",
        calculatorVersion: 1,
        scope: { type: "session", id: "0198a4db-d8da-7000-8000-00000000e002" },
        period: { kind: "all_time" },
        dimensions: { unit: "reps" },
        numericValue: 42,
        textValue: null,
        unit: "reps",
        details: { note: "seed" },
        sourceFingerprint: "a".repeat(64),
        state: "current",
        stale: false,
        calculatedAt: now,
        supersededAt: null,
        ...overrides,
    };
}

function finding(overrides: Partial<FindingView> = {}): FindingView {
    return {
        id: "0198a4db-d8da-7000-8000-00000000f010",
        profileId: "0198a4db-d8da-7000-8000-00000000e001",
        findingKey: "record.max_load",
        findingVersion: 1,
        scope: { type: "profile-exercise", id: "p:e" },
        dimensions: { basis: "historical", aggregation: "exercise" },
        numericValue: 140,
        unit: "kg",
        status: "active",
        evidence: { exerciseId: "e", numericValue: 140, unit: "kg" },
        sourceFingerprint: "b".repeat(64),
        state: "current",
        reviewAt: null,
        expiresAt: null,
        calculatedAt: now,
        supersededAt: null,
        ...overrides,
    };
}

function createController(views: DerivedMetricView[], findings: FindingView[] = []) {
    const repository = { query: vi.fn(async () => views) };
    const findingRepository = { query: vi.fn(async () => findings) };
    const rebuild = {
        fromPendingInvalidations: vi.fn(async () => ({ recomputed: 3, drainedInvalidations: 2 })),
        full: vi.fn(async () => ({ recomputed: 9, drainedInvalidations: 0 })),
        fromScope: vi.fn(async () => ({ recomputed: 1, drainedInvalidations: 0 })),
    };
    const controller = new AnalyticsMetricController(
        repository as unknown as DerivedMetricRepository,
        findingRepository as unknown as FindingRepository,
        rebuild as unknown as RebuildMetrics,
    );
    return { controller, repository, findingRepository, rebuild };
}

describe("AnalyticsMetricController.metrics", () => {
    it("maps current projections to the wire resource and defaults the limit", async () => {
        const { controller, repository } = createController([view()]);
        const response = await controller.metrics("smoke.count", "session", undefined, undefined, undefined);
        expect(response.items).toHaveLength(1);
        expect(response.items[0]!.calculatorKey).toBe("smoke.count");
        expect(response.items[0]!.numericValue).toBe(42);
        expect(repository.query).toHaveBeenCalledWith({
            calculatorKey: "smoke.count",
            scopeType: "session",
            scopeId: undefined,
            includeSuperseded: false,
            limit: 50,
        });
    });

    it("passes includeSuperseded through when requested", async () => {
        const { controller, repository } = createController([view({ state: "superseded", supersededAt: now })]);
        await controller.metrics(undefined, undefined, undefined, "true", "10");
        expect(repository.query).toHaveBeenCalledWith(expect.objectContaining({ includeSuperseded: true, limit: 10 }));
    });

    it("rejects an out-of-range limit", async () => {
        const { controller } = createController([]);
        await expect(controller.metrics(undefined, undefined, undefined, undefined, "500")).rejects.toBeInstanceOf(
            ApplicationValidationError,
        );
    });
});

describe("AnalyticsMetricController.catalog", () => {
    it("returns the versioned strength calculator metadata parsed through the wire contract", () => {
        const { controller } = createController([]);
        const response = controller.catalog();
        expect(response.schemaVersion).toBe(1);
        expect(response.calculators.length).toBeGreaterThanOrEqual(11);
        const workReps = response.calculators.find(c => c.key === "strength.work_reps");
        expect(workReps).toMatchObject({ version: 1, unit: "reps", scopeKind: "session" });
        expect(workReps?.dimensions).toContain("basis");
        expect(response.calculators.some(c => c.scopeKind === "window")).toBe(true);
    });

    it("includes the six 1RM formulas and the primary estimate", () => {
        const { controller } = createController([]);
        const keys = controller.catalog().calculators.map(c => c.key);
        for (const key of [
            "estimated_1rm.primary",
            "estimated_1rm.epley",
            "estimated_1rm.brzycki",
            "estimated_1rm.lombardi",
            "estimated_1rm.mayhew",
            "estimated_1rm.oconner",
            "estimated_1rm.wathan",
        ])
            expect(keys).toContain(key);
    });
});

describe("AnalyticsMetricController.records", () => {
    it("maps current record findings to the wire resource and defaults the limit", async () => {
        const { controller, findingRepository } = createController([], [finding()]);
        const response = await controller.records(
            "record.max_load",
            "profile-exercise",
            undefined,
            undefined,
            undefined,
        );
        expect(response.items).toHaveLength(1);
        expect(response.items[0]!).toMatchObject({ findingKey: "record.max_load", numericValue: 140, unit: "kg" });
        expect(findingRepository.query).toHaveBeenCalledWith({
            findingKey: "record.max_load",
            scopeType: "profile-exercise",
            scopeId: undefined,
            includeSuperseded: false,
            limit: 50,
        });
    });
});

describe("AnalyticsMetricController.recordsCatalog", () => {
    it("returns the versioned record metadata parsed through the wire contract", () => {
        const { controller } = createController([]);
        const response = controller.recordsCatalog();
        expect(response.schemaVersion).toBe(1);
        expect(response.records.map(r => r.key)).toEqual([
            "record.max_load",
            "record.estimated_1rm",
            "record.rep_max_at_load",
            "record.exercise_volume",
        ]);
    });
});

describe("AnalyticsMetricController.rebuildMetrics", () => {
    it("drains pending invalidations for a targeted rebuild", async () => {
        const { controller, rebuild } = createController([]);
        const response = await controller.rebuildMetrics({ mode: "targeted" }, undefined, undefined);
        expect(response).toEqual({ recomputed: 3, drainedInvalidations: 2 });
        expect(rebuild.fromPendingInvalidations).toHaveBeenCalledOnce();
    });

    it("sweeps everything for a full rebuild", async () => {
        const { controller, rebuild } = createController([]);
        const response = await controller.rebuildMetrics({ mode: "full" }, undefined, undefined);
        expect(response.recomputed).toBe(9);
        expect(rebuild.full).toHaveBeenCalledOnce();
    });

    it("rebuilds one explicit dependency scope", async () => {
        const { controller, rebuild } = createController([]);
        await controller.rebuildMetrics(
            { mode: "scope", dependency: "session", scopeType: "session", scopeId: "s1" },
            undefined,
            undefined,
        );
        expect(rebuild.fromScope).toHaveBeenCalledWith(
            { dependency: "session", scopeType: "session", scopeId: "s1" },
            expect.objectContaining({ source: expect.any(String) }),
        );
    });

    it("rejects an invalid rebuild request", async () => {
        const { controller } = createController([]);
        await expect(controller.rebuildMetrics({ mode: "nonsense" }, undefined, undefined)).rejects.toBeInstanceOf(
            ApplicationValidationError,
        );
    });
});
