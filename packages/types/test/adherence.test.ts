import { describe, expect, it } from "vitest";

import {
    adherenceComponentResponseSchema,
    adherenceFormulaResponseSchema,
    adherenceQueryResponseSchema,
    adherenceQuerySchema,
    adherenceResultResponseSchema,
    sessionAdherenceResponseSchema,
} from "#src/index";

const sessionId = "0198a4db-d8da-7000-8000-000000008001";
const prescriptionId = "0198a4db-d8da-7000-8000-000000008002";
const resultId = "0198a4db-d8da-7000-8000-000000008003";
const fingerprint = "a".repeat(64);

function component(overrides: Record<string, unknown> = {}) {
    return {
        key: "reps",
        scope: "strength",
        score: 80,
        weight: 20,
        included: true,
        exclusion: null,
        inputs: { actualTotal: 8, targetLow: 10, targetHigh: 10, comparedEntities: 1 },
        ...overrides,
    };
}

function result(overrides: Record<string, unknown> = {}) {
    return {
        id: resultId,
        trainingSessionId: sessionId,
        trainingSessionVersion: 2,
        plannedSessionId: null,
        sourcePrescriptionId: prescriptionId,
        resolvedPrescriptionId: prescriptionId,
        formula: "adherence.overall.v1",
        scope: "strength",
        overall: 92.5,
        sourceFingerprint: fingerprint,
        components: [component()],
        exclusions: [],
        calculatedAt: "2026-08-09T09:00:00.000Z",
        status: "current",
        plannedSessionTitle: "Week 1 · Lower A",
        ...overrides,
    };
}

describe("adherence contracts", () => {
    it("accepts a component with evidence inputs", () => {
        expect(adherenceComponentResponseSchema.parse(component())).toMatchObject({ key: "reps", score: 80 });
    });

    it("accepts an excluded component with a null score and a reason", () => {
        const excluded = component({ score: null, included: false, exclusion: "missing_target" });
        expect(adherenceComponentResponseSchema.parse(excluded).score).toBeNull();
    });

    it("rejects an unknown component key", () => {
        expect(adherenceComponentResponseSchema.safeParse(component({ key: "tempo" })).success).toBe(false);
    });

    it("rejects a score above 100", () => {
        expect(adherenceComponentResponseSchema.safeParse(component({ score: 101 })).success).toBe(false);
    });

    it("accepts a full result and a session projection", () => {
        expect(adherenceResultResponseSchema.parse(result()).overall).toBe(92.5);
        const projection = sessionAdherenceResponseSchema.parse({ trainingSessionId: sessionId, results: [result()] });
        expect(projection.results).toHaveLength(1);
    });

    it("rejects a malformed source fingerprint", () => {
        expect(adherenceResultResponseSchema.safeParse(result({ sourceFingerprint: "xyz" })).success).toBe(false);
    });

    it("carries the recalculation status and planned-session link", () => {
        expect(adherenceResultResponseSchema.parse(result({ status: "stale" })).status).toBe("stale");
        expect(
            adherenceResultResponseSchema.parse(result({ plannedSessionTitle: null })).plannedSessionTitle,
        ).toBeNull();
    });

    it("rejects an unknown recalculation status", () => {
        expect(adherenceResultResponseSchema.safeParse(result({ status: "dunno" })).success).toBe(false);
    });

    it("rejects unknown keys (strict)", () => {
        expect(adherenceResultResponseSchema.safeParse(result({ extra: true })).success).toBe(false);
    });

    it("coerces the query limit and defaults it, and keeps opaque cursor/filters", () => {
        const parsed = adherenceQuerySchema.parse({ limit: "25", programId: sessionId, scope: "running" });
        expect(parsed.limit).toBe(25);
        expect(parsed.scope).toBe("running");
        expect(adherenceQuerySchema.parse({}).limit).toBe(50);
    });

    it("rejects a query with an out-of-range scope or bad date", () => {
        expect(adherenceQuerySchema.safeParse({ scope: "session" }).success).toBe(false);
        expect(adherenceQuerySchema.safeParse({ from: "08-2026" }).success).toBe(false);
        expect(adherenceQuerySchema.safeParse({ unknown: 1 }).success).toBe(false);
    });

    it("accepts a keyset-paginated query response", () => {
        const page = adherenceQueryResponseSchema.parse({ items: [result()], nextCursor: "abc" });
        expect(page.items).toHaveLength(1);
        expect(adherenceQueryResponseSchema.parse({ items: [] }).nextCursor).toBeNull();
    });

    it("accepts stable versioned formula-display metadata", () => {
        const metadata = {
            schemaVersion: 1,
            formula: "adherence.overall.v1",
            scoring: "100 inside the range; otherwise a linear penalty to the nearest boundary.",
            strengthComponents: [{ key: "reps", scope: "strength", weight: 20, label: "Repetitions" }],
            runningComponents: [{ key: "distance", scope: "running", weight: 25, label: "Distance" }],
        };
        expect(adherenceFormulaResponseSchema.parse(metadata).formula).toBe("adherence.overall.v1");
    });

    it("rejects a formula metadata with the wrong version literal", () => {
        expect(
            adherenceFormulaResponseSchema.safeParse({
                schemaVersion: 2,
                formula: "adherence.overall.v1",
                scoring: "x",
                strengthComponents: [],
                runningComponents: [],
            }).success,
        ).toBe(false);
    });
});
