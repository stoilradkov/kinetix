import { describe, expect, it, vi } from "vitest";

import type {
    AdherenceQueryPage,
    AdherenceQueryService,
    AdherenceResultDetail,
    CalculateAdherence,
    SessionAdherenceDetailView,
} from "#src/modules/training/application/index";
import { AdherenceController } from "#src/modules/training/presentation/index";
import { ApplicationValidationError } from "#src/platform/application/index";

const sessionId = "0198a4db-d8da-7000-8000-00000000c001";
const now = new Date("2026-08-09T09:00:00.000Z");

function resultDetail(overrides: Partial<AdherenceResultDetail> = {}): AdherenceResultDetail {
    return {
        id: "0198a4db-d8da-7000-8000-00000000c010",
        trainingSessionId: sessionId,
        trainingSessionVersion: 2,
        plannedSessionId: null,
        sourcePrescriptionId: "0198a4db-d8da-7000-8000-00000000c020",
        resolvedPrescriptionId: "0198a4db-d8da-7000-8000-00000000c021",
        formula: "adherence.overall.v1",
        scope: "strength",
        overall: 92.5,
        sourceFingerprint: "a".repeat(64),
        components: [
            {
                key: "reps",
                scope: "strength",
                score: 80,
                weight: 20,
                included: true,
                exclusion: null,
                inputs: { actualTotal: 8 },
            },
        ],
        exclusions: [],
        calculatedAt: now,
        status: "current",
        plannedSessionTitle: "Week 1 · Lower A",
        ...overrides,
    };
}

function createController(view: SessionAdherenceDetailView, page?: AdherenceQueryPage) {
    const calculate = { recalculateForSession: vi.fn(async () => ({ trainingSessionId: sessionId, results: [] })) };
    const queries = {
        readForSession: vi.fn(async () => view),
        queryResults: vi.fn(async () => page ?? { items: view.results, nextCursor: null }),
    };
    const controller = new AdherenceController(
        calculate as unknown as CalculateAdherence,
        queries as unknown as AdherenceQueryService,
    );
    return { controller, calculate, queries };
}

describe("AdherenceController", () => {
    it("reads the current results for a session with status and planned-session title", async () => {
        const view = { trainingSessionId: sessionId, results: [resultDetail({ status: "stale" })] };
        const { controller, queries } = createController(view);
        const response = await controller.read(sessionId);
        expect(response.results).toHaveLength(1);
        expect(response.results[0]!.overall).toBe(92.5);
        expect(response.results[0]!.status).toBe("stale");
        expect(response.results[0]!.plannedSessionTitle).toBe("Week 1 · Lower A");
        expect(response.results[0]!.calculatedAt).toBe(now.toISOString());
        expect(queries.readForSession).toHaveBeenCalledWith(sessionId);
    });

    it("rejects a non-UUID session id", async () => {
        const { controller } = createController({ trainingSessionId: sessionId, results: [] });
        await expect(controller.read("not-a-uuid")).rejects.toBeInstanceOf(ApplicationValidationError);
    });

    it("queries adherence with parsed cursor/filters and returns a keyset page", async () => {
        const page = { items: [resultDetail()], nextCursor: "next" };
        const { controller, queries } = createController({ trainingSessionId: sessionId, results: [] }, page);
        const response = await controller.query({ limit: "10", programId: "0198a4db-d8da-7000-8000-00000000c099" });
        expect(response.items).toHaveLength(1);
        expect(response.nextCursor).toBe("next");
        expect(queries.queryResults).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 10, programId: "0198a4db-d8da-7000-8000-00000000c099" }),
        );
    });

    it("rejects an out-of-range query scope", async () => {
        const { controller } = createController({ trainingSessionId: sessionId, results: [] });
        await expect(controller.query({ scope: "session" })).rejects.toBeTruthy();
    });

    it("exposes the stable versioned formula metadata", () => {
        const { controller } = createController({ trainingSessionId: sessionId, results: [] });
        const metadata = controller.formula();
        expect(metadata.formula).toBe("adherence.overall.v1");
        expect(metadata.schemaVersion).toBe(1);
        expect(metadata.strengthComponents.length).toBeGreaterThan(0);
    });

    it("recalculates synchronously and re-reads the enriched results", async () => {
        const view = { trainingSessionId: sessionId, results: [resultDetail({ overall: 100 })] };
        const { controller, calculate, queries } = createController(view);
        const response = await controller.recalculate(sessionId, undefined, undefined, undefined);
        expect(response.results[0]!.overall).toBe(100);
        expect(response.results[0]!.status).toBe("current");
        expect(calculate.recalculateForSession).toHaveBeenCalledWith(
            { sessionId },
            expect.objectContaining({ source: "user" }),
            undefined,
        );
        expect(queries.readForSession).toHaveBeenCalledWith(sessionId, undefined);
    });
});
