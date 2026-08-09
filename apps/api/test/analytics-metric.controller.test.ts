import { describe, expect, it, vi } from "vitest";

import type {
    DerivedMetricRepository,
    DerivedMetricView,
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

function createController(views: DerivedMetricView[]) {
    const repository = { query: vi.fn(async () => views) };
    const rebuild = {
        fromPendingInvalidations: vi.fn(async () => ({ recomputed: 3, drainedInvalidations: 2 })),
        full: vi.fn(async () => ({ recomputed: 9, drainedInvalidations: 0 })),
        fromScope: vi.fn(async () => ({ recomputed: 1, drainedInvalidations: 0 })),
    };
    const controller = new AnalyticsMetricController(
        repository as unknown as DerivedMetricRepository,
        rebuild as unknown as RebuildMetrics,
    );
    return { controller, repository, rebuild };
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
