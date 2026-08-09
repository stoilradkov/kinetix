import { describe, expect, it } from "vitest";

import {
    AdherenceQueryService,
    deriveAdherenceStatus,
    type AdherenceRecalcState,
    type AdherenceRecalcStateReader,
    type AdherenceResultQueryCriteria,
    type AdherenceResultQueryPageRows,
    type AdherenceResultQueryPort,
    type AdherenceResultQueryRow,
} from "#src/modules/training/application/index";

const sessionA = "0198a4db-d8da-7000-8000-0000000000a1";
const sessionB = "0198a4db-d8da-7000-8000-0000000000b1";

function row(overrides: Partial<AdherenceResultQueryRow> = {}): AdherenceResultQueryRow {
    return {
        id: "0198a4db-d8da-7000-8000-0000000000f1",
        trainingSessionId: sessionA,
        trainingSessionVersion: 2,
        plannedSessionId: "0198a4db-d8da-7000-8000-0000000000c1",
        sourcePrescriptionId: "0198a4db-d8da-7000-8000-0000000000d1",
        resolvedPrescriptionId: "0198a4db-d8da-7000-8000-0000000000d2",
        formula: "adherence.overall.v1",
        scope: "strength",
        overall: 90,
        sourceFingerprint: "a".repeat(64),
        components: [],
        exclusions: [],
        calculatedAt: new Date("2026-08-09T09:00:00.000Z"),
        plannedSessionTitle: "Week 1 · Lower A",
        ...overrides,
    };
}

class FakeQueryPort implements AdherenceResultQueryPort {
    lastCriteria: AdherenceResultQueryCriteria | null = null;
    constructor(
        private readonly page: AdherenceResultQueryPageRows,
        private readonly bySession: readonly AdherenceResultQueryRow[] = [],
    ) {}
    async query(criteria: AdherenceResultQueryCriteria): Promise<AdherenceResultQueryPageRows> {
        this.lastCriteria = criteria;
        return this.page;
    }
    async readForSession(): Promise<readonly AdherenceResultQueryRow[]> {
        return this.bySession;
    }
}

class FakeStateReader implements AdherenceRecalcStateReader {
    requested: readonly string[] = [];
    constructor(private readonly states: ReadonlyMap<string, AdherenceRecalcState>) {}
    async readStates(sessionIds: readonly string[]): Promise<ReadonlyMap<string, AdherenceRecalcState>> {
        this.requested = sessionIds;
        return this.states;
    }
}

describe("deriveAdherenceStatus", () => {
    it("reports current when the version matches and no job is in flight", () => {
        expect(
            deriveAdherenceStatus({ trainingSessionVersion: 2 }, { currentSessionVersion: 2, jobStatus: null }),
        ).toBe("current");
        expect(
            deriveAdherenceStatus({ trainingSessionVersion: 2 }, { currentSessionVersion: 2, jobStatus: "succeeded" }),
        ).toBe("current");
    });

    it("reports pending for a queued or running recompute job", () => {
        expect(
            deriveAdherenceStatus({ trainingSessionVersion: 2 }, { currentSessionVersion: 2, jobStatus: "queued" }),
        ).toBe("pending");
        expect(
            deriveAdherenceStatus({ trainingSessionVersion: 3 }, { currentSessionVersion: 3, jobStatus: "running" }),
        ).toBe("pending");
    });

    it("reports failed when the last recompute job failed, even if the version matches", () => {
        expect(
            deriveAdherenceStatus({ trainingSessionVersion: 2 }, { currentSessionVersion: 2, jobStatus: "failed" }),
        ).toBe("failed");
    });

    it("reports stale when the session advanced past the result with no in-flight job", () => {
        expect(
            deriveAdherenceStatus({ trainingSessionVersion: 2 }, { currentSessionVersion: 4, jobStatus: null }),
        ).toBe("stale");
        // A dropped-coalesced (succeeded) job that never re-ran still leaves the result stale.
        expect(
            deriveAdherenceStatus({ trainingSessionVersion: 2 }, { currentSessionVersion: 4, jobStatus: "succeeded" }),
        ).toBe("stale");
    });

    it("reports current when no recompute state is known", () => {
        expect(deriveAdherenceStatus({ trainingSessionVersion: 9 }, null)).toBe("current");
    });
});

describe("AdherenceQueryService", () => {
    it("annotates a page with per-session status and passes the filter through", async () => {
        const port = new FakeQueryPort({
            items: [
                row({ id: "r1", trainingSessionId: sessionA, trainingSessionVersion: 2 }),
                row({ id: "r2", trainingSessionId: sessionB, trainingSessionVersion: 1 }),
            ],
            nextCursor: "next",
        });
        const states = new Map<string, AdherenceRecalcState>([
            [sessionA, { currentSessionVersion: 2, jobStatus: null }],
            [sessionB, { currentSessionVersion: 3, jobStatus: "queued" }],
        ]);
        const service = new AdherenceQueryService({ query: port, stateReader: new FakeStateReader(states) });

        const page = await service.queryResults({ limit: 50, programId: "prog" });

        expect(page.nextCursor).toBe("next");
        expect(page.items.map(item => item.status)).toEqual(["current", "pending"]);
        expect(port.lastCriteria).toMatchObject({ limit: 50, programId: "prog" });
    });

    it("reads a session's results and requests recompute state once per distinct session", async () => {
        const port = new FakeQueryPort({ items: [], nextCursor: null }, [
            row({ id: "r1", trainingSessionVersion: 1 }),
            row({ id: "r2", trainingSessionVersion: 1 }),
        ]);
        const reader = new FakeStateReader(new Map([[sessionA, { currentSessionVersion: 5, jobStatus: null }]]));
        const service = new AdherenceQueryService({ query: port, stateReader: reader });

        const view = await service.readForSession(sessionA);

        expect(view.trainingSessionId).toBe(sessionA);
        expect(view.results.map(result => result.status)).toEqual(["stale", "stale"]);
        expect(reader.requested).toEqual([sessionA]);
    });

    it("skips the state read when there are no rows", async () => {
        const reader = new FakeStateReader(new Map());
        const service = new AdherenceQueryService({
            query: new FakeQueryPort({ items: [], nextCursor: null }),
            stateReader: reader,
        });
        const page = await service.queryResults({ limit: 50 });
        expect(page.items).toEqual([]);
        expect(reader.requested).toEqual([]);
    });
});
