import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AdherenceResultResponse } from "@kinetix/types";

import { AdherenceDisplay } from "@/components/training/adherence-display";
import { AdherenceScoreBadge } from "@/components/training/adherence-score-badge";

function result(overrides: Partial<AdherenceResultResponse> = {}): AdherenceResultResponse {
    return {
        id: "0198a4db-d8da-7000-8000-00000000f001",
        trainingSessionId: "0198a4db-d8da-7000-8000-00000000f002",
        trainingSessionVersion: 2,
        plannedSessionId: "0198a4db-d8da-7000-8000-00000000f003",
        sourcePrescriptionId: "0198a4db-d8da-7000-8000-00000000f004",
        resolvedPrescriptionId: "0198a4db-d8da-7000-8000-00000000f005",
        formula: "adherence.overall.v1",
        scope: "strength",
        overall: 84,
        sourceFingerprint: "a".repeat(64),
        components: [
            {
                key: "reps",
                scope: "strength",
                score: 80,
                weight: 20,
                included: true,
                exclusion: null,
                inputs: { actualTotal: 8, targetLow: 10 },
            },
            {
                key: "load",
                scope: "strength",
                score: null,
                weight: 15,
                included: false,
                exclusion: "missing_target",
                inputs: {},
            },
            {
                key: "exercise_completion",
                scope: "strength",
                score: 100,
                weight: 15,
                included: true,
                exclusion: null,
                inputs: { substituted: 1, addedExercises: 2 },
            },
        ],
        exclusions: ["missing_target"],
        calculatedAt: "2026-08-09T09:00:00.000Z",
        status: "current",
        plannedSessionTitle: "Week 1 · Lower A",
        ...overrides,
    };
}

beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

describe("AdherenceDisplay", () => {
    it("renders the overall percentage, component scores, exclusions, and formula version", () => {
        render(<AdherenceDisplay results={[result()]} />);
        expect(screen.getByText("84%")).toBeInTheDocument();
        expect(screen.getByText("adherence.overall.v1")).toBeInTheDocument();
        expect(screen.getByText("Repetitions")).toBeInTheDocument();
        // The missing-target load component is shown as excluded, not zero.
        expect(screen.getAllByText("no target").length).toBeGreaterThan(0);
        expect(screen.getByText(/vs planned/)).toHaveTextContent("Week 1 · Lower A");
    });

    it("reports substitutions and added work as divergence", () => {
        render(<AdherenceDisplay results={[result()]} />);
        expect(screen.getByText("1 substituted")).toBeInTheDocument();
        expect(screen.getByText("2 added")).toBeInTheDocument();
        expect(screen.getByText(/not penalised/)).toBeInTheDocument();
    });

    it("labels a stale result", () => {
        render(<AdherenceDisplay results={[result({ status: "stale" })]} />);
        expect(screen.getByText("stale")).toBeInTheDocument();
    });
});

describe("AdherenceScoreBadge", () => {
    it("shows the banded percentage and renders nothing without a result", () => {
        const { container } = render(<AdherenceScoreBadge result={undefined} />);
        expect(container).toBeEmptyDOMElement();
        render(<AdherenceScoreBadge result={result({ overall: 95, status: "current" })} />);
        expect(screen.getByText("95%")).toBeInTheDocument();
    });

    it("annotates a stale score", () => {
        render(<AdherenceScoreBadge result={result({ overall: 60, status: "stale" })} />);
        expect(screen.getByText("60%")).toBeInTheDocument();
        expect(screen.getByText("stale")).toBeInTheDocument();
    });
});
