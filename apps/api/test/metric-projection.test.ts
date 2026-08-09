import { describe, expect, it } from "vitest";

import {
    coalesceInvalidations,
    expandInvalidation,
    invalidationScopeKey,
    isoWeekStart,
    metricFingerprintDescriptor,
    metricNaturalKeyDescriptor,
    sortInputRefs,
    type InvalidationScope,
    type MetricInputRef,
    type MetricResult,
    type MetricTarget,
} from "#src/modules/training/domain/index";
import { hashRequest } from "#src/platform/application/index";

const target: MetricTarget = {
    scope: { type: "session", id: "session-1" },
    period: { kind: "all_time" },
    dimensions: { exercise: "squat" },
};

function inputRef(overrides: Partial<MetricInputRef> = {}): MetricInputRef {
    return { entityType: "training-session", entityId: "session-1", revision: 3, ...overrides };
}

function result(overrides: Partial<MetricResult> = {}): MetricResult {
    return {
        scope: target.scope,
        period: target.period,
        dimensions: target.dimensions,
        value: { numeric: 42, text: null, unit: "kg", details: {} },
        inputs: [inputRef()],
        ...overrides,
    };
}

describe("metric natural key + fingerprint canonicalization", () => {
    it("natural key ignores calculator version but distinguishes scope/period/dimensions", () => {
        const base = hashRequest(metricNaturalKeyDescriptor("strength.volume", target));
        const otherScope = hashRequest(
            metricNaturalKeyDescriptor("strength.volume", { ...target, scope: { type: "session", id: "session-2" } }),
        );
        const otherDimensions = hashRequest(
            metricNaturalKeyDescriptor("strength.volume", { ...target, dimensions: { exercise: "bench" } }),
        );
        expect(base).not.toEqual(otherScope);
        expect(base).not.toEqual(otherDimensions);
    });

    it("fingerprint changes when the calculator version, config, value, or input revision changes", () => {
        const v1 = hashRequest(metricFingerprintDescriptor("strength.volume", 1, { cutoff: 12 }, result()));
        expect(hashRequest(metricFingerprintDescriptor("strength.volume", 2, { cutoff: 12 }, result()))).not.toEqual(
            v1,
        );
        expect(hashRequest(metricFingerprintDescriptor("strength.volume", 1, { cutoff: 10 }, result()))).not.toEqual(
            v1,
        );
        expect(
            hashRequest(
                metricFingerprintDescriptor(
                    "strength.volume",
                    1,
                    { cutoff: 12 },
                    result({ inputs: [inputRef({ revision: 4 })] }),
                ),
            ),
        ).not.toEqual(v1);
    });

    it("fingerprint is independent of the order inputs were loaded in", () => {
        const a = inputRef({ entityId: "a" });
        const b = inputRef({ entityId: "b" });
        const forward = hashRequest(metricFingerprintDescriptor("k", 1, {}, result({ inputs: [a, b] })));
        const reversed = hashRequest(metricFingerprintDescriptor("k", 1, {}, result({ inputs: [b, a] })));
        expect(forward).toEqual(reversed);
    });

    it("sorts input refs deterministically by type, id, then revision", () => {
        const sorted = sortInputRefs([
            inputRef({ entityType: "b", entityId: "z", revision: 1 }),
            inputRef({ entityType: "a", entityId: "y", revision: 2 }),
            inputRef({ entityType: "a", entityId: "y", revision: 1 }),
        ]);
        expect(sorted.map(ref => `${ref.entityType}:${ref.entityId}:${ref.revision}`)).toEqual([
            "a:y:1",
            "a:y:2",
            "b:z:1",
        ]);
    });
});

describe("invalidation coalescing", () => {
    it("deduplicates overlapping scopes while preserving first-seen order", () => {
        const scopes: InvalidationScope[] = [
            { dependency: "session", scopeType: "session", scopeId: "s1" },
            { dependency: "session", scopeType: "exercise", scopeId: "e1" },
            { dependency: "session", scopeType: "session", scopeId: "s1" },
        ];
        const coalesced = coalesceInvalidations(scopes);
        expect(coalesced).toHaveLength(2);
        expect(coalesced.map(invalidationScopeKey)).toEqual(["session|session|s1", "session|exercise|e1"]);
    });
});

describe("source-change → invalidation-scope expansion", () => {
    it("fans a session change out to the session, its windows, plan/program links, and touched entities", () => {
        const scopes = expandInvalidation({
            kind: "session",
            sessionId: "s1",
            profileId: "p1",
            localDate: "2026-08-05", // a Wednesday
            exerciseIds: ["ex1"],
            muscleIds: ["m1"],
            gearIds: ["g1"],
            programIds: ["prog1"],
            programBlockIds: ["b1"],
            plannedSessionIds: ["pl1"],
        });
        const keys = scopes.map(invalidationScopeKey);
        expect(keys).toContain("session|session|s1");
        expect(keys).toContain("session|profile-day|p1:2026-08-05");
        expect(keys).toContain("session|profile-week|p1:2026-08-03"); // Monday of that week
        expect(keys).toContain("session|profile-rolling-7|p1:2026-08-05");
        expect(keys).toContain("session|profile-rolling-28|p1:2026-08-05");
        expect(keys).toContain("session|program|prog1");
        expect(keys).toContain("session|program-block|b1");
        expect(keys).toContain("plan|planned-session|pl1");
        expect(keys).toContain("session|exercise|ex1");
        expect(keys).toContain("session|muscle|m1");
        expect(keys).toContain("session|gear|g1");
    });

    it("omits window scopes when the session has no local date", () => {
        const scopes = expandInvalidation({ kind: "session", sessionId: "s1", profileId: "p1", localDate: null });
        expect(scopes.map(invalidationScopeKey)).toEqual(["session|session|s1"]);
    });

    it("expands an exercise change to the exercise and its family", () => {
        const scopes = expandInvalidation({ kind: "exercise", exerciseId: "ex1", familyId: "fam1" });
        expect(scopes.map(invalidationScopeKey)).toEqual(["exercise|exercise|ex1", "exercise|exercise-family|fam1"]);
    });

    it("expands a context change to only the sessions whose calculations reference it", () => {
        const scopes = expandInvalidation({ kind: "context", profileId: "p1", affectedSessionIds: ["s1", "s2"] });
        expect(scopes.map(invalidationScopeKey)).toEqual(["context|session|s1", "context|session|s2"]);
    });

    it("expands a zone change to only the runs in its effective interval", () => {
        const scopes = expandInvalidation({ kind: "zone", zoneId: "z1", affectedSessionIds: ["s1"] });
        expect(scopes.map(invalidationScopeKey)).toEqual(["zone|session|s1"]);
    });

    it("expands a plan change to the plan and every mapped actual session", () => {
        const scopes = expandInvalidation({ kind: "plan", plannedSessionId: "pl1", affectedSessionIds: ["s1", "s2"] });
        expect(scopes.map(invalidationScopeKey)).toEqual([
            "plan|planned-session|pl1",
            "plan|session|s1",
            "plan|session|s2",
        ]);
    });
});

describe("isoWeekStart", () => {
    it("returns the Monday of the containing week in UTC", () => {
        expect(isoWeekStart("2026-08-05")).toEqual("2026-08-03"); // Wed → Mon
        expect(isoWeekStart("2026-08-03")).toEqual("2026-08-03"); // Mon → Mon
        expect(isoWeekStart("2026-08-09")).toEqual("2026-08-03"); // Sun → previous Mon
    });
});
