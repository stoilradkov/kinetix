import { describe, expect, it } from "vitest";

import { PlannedSession } from "#src/modules/training/domain/index";

const now = new Date("2026-08-02T09:00:00.000Z");
const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

function planned() {
    return PlannedSession.create({ id: id(1), profileId: id(2), currentPrescriptionId: id(3) }, now);
}

describe("planned session outcome recompute", () => {
    it("drives a planned session to completed from actual coverage", () => {
        const session = planned().recomputeOutcome("completed", now);
        expect(session.state.status).toBe("completed");
    });

    it("marks a completed session partially_completed on reopen recompute", () => {
        const session = planned().recomputeOutcome("completed", now).recomputeOutcome("partially_completed", now);
        expect(session.state.status).toBe("partially_completed");
    });

    it("returns a completed session to planned when its actual coverage is archived away", () => {
        const session = planned().recomputeOutcome("completed", now).recomputeOutcome("planned", now);
        expect(session.state.status).toBe("planned");
    });

    it("never overrides an explicit skip", () => {
        const session = planned().skip({ reason: "illness" }, now).recomputeOutcome("completed", now);
        expect(session.state.status).toBe("skipped");
        expect(session.state.skipReason).toBe("illness");
    });

    it("never overrides an explicit cancel", () => {
        const session = planned().cancel({ reason: "schedule" }, now).recomputeOutcome("partially_completed", now);
        expect(session.state.status).toBe("cancelled");
    });
});
