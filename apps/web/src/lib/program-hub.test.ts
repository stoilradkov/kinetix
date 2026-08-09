import { describe, expect, it } from "vitest";

import type { ProgramResponse, ProgramSessionMembership } from "@kinetix/types";

import { groupPlannedSessions, programProgress } from "@/lib/program-hub";

function membership(overrides: Partial<ProgramSessionMembership> = {}): ProgramSessionMembership {
    return {
        plannedSessionId: crypto.randomUUID(),
        sequence: 0,
        relativeWeek: null,
        relativeDay: null,
        localDate: null,
        preferredTime: null,
        status: "planned",
        title: "Session",
        overdue: false,
        actualSessionId: null,
        actualSessionStatus: null,
        ...overrides,
    };
}

function program(overrides: Partial<ProgramResponse> = {}): ProgramResponse {
    return {
        id: crypto.randomUUID(),
        profileId: crypto.randomUUID(),
        name: "Block",
        description: null,
        status: "active",
        scheduleMode: "dated",
        startDate: "2026-08-03",
        endDate: null,
        focus: null,
        version: 2,
        archivedAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        blocks: [],
        goalIds: [],
        warnings: [],
        ...overrides,
    };
}

describe("groupPlannedSessions", () => {
    it("groups by relative week, ordered ascending, labelled 1-indexed", () => {
        const groups = groupPlannedSessions([
            membership({ relativeWeek: 1, title: "W2" }),
            membership({ relativeWeek: 0, title: "W1" }),
        ]);
        expect(groups.map(group => group.label)).toEqual(["Week 1", "Week 2"]);
        expect(groups[0]!.sessions[0]!.title).toBe("W1");
    });

    it("orders sessions within a week by day, then activation sequence", () => {
        const [week] = groupPlannedSessions([
            membership({ relativeWeek: 0, relativeDay: 2, sequence: 5, title: "later" }),
            membership({ relativeWeek: 0, relativeDay: 0, sequence: 9, title: "earlier" }),
        ]);
        expect(week!.sessions.map(session => session.title)).toEqual(["earlier", "later"]);
    });

    it("falls back to a calendar-week section when there is no relative week", () => {
        const [week] = groupPlannedSessions([membership({ localDate: "2026-08-05" })]);
        expect(week!.label).toMatch(/^Week of /);
        expect(week!.unscheduled).toBe(false);
    });

    it("drops sessions with neither week nor date into a trailing unscheduled section", () => {
        const groups = groupPlannedSessions([
            membership({ relativeWeek: 0 }),
            membership({ localDate: null, relativeWeek: null }),
        ]);
        const last = groups.at(-1)!;
        expect(last.label).toBe("Unscheduled");
        expect(last.unscheduled).toBe(true);
    });
});

describe("programProgress", () => {
    it("reads a dated program's elapsed week as 'Week X of Y', clamped in range", () => {
        const groups = groupPlannedSessions([
            membership({ relativeWeek: 0 }),
            membership({ relativeWeek: 1 }),
            membership({ relativeWeek: 2 }),
        ]);
        // 2026-08-18 is 15 days (2 whole weeks) after the 2026-08-03 start → week 3.
        const progress = programProgress(program(), groups, "2026-08-18");
        expect(progress).toMatchObject({ current: 3, total: 3, label: "Week 3 of 3" });
    });

    it("never reports a week beyond the last scheduled one", () => {
        const groups = groupPlannedSessions([membership({ relativeWeek: 0 }), membership({ relativeWeek: 1 })]);
        const progress = programProgress(program(), groups, "2027-01-01");
        expect(progress).toMatchObject({ current: 2, total: 2 });
    });

    it("falls back to completed-session count when the program is not dated", () => {
        const groups = groupPlannedSessions([membership({ status: "completed" }), membership({ status: "planned" })]);
        const progress = programProgress(program({ scheduleMode: "relative", startDate: null }), groups, "2026-08-18");
        expect(progress).toMatchObject({ current: 1, total: 2, percent: 50, label: "1 of 2 sessions complete" });
    });

    it("returns null when there is nothing to summarise", () => {
        expect(programProgress(program({ scheduleMode: "relative", startDate: null }), [], "2026-08-18")).toBeNull();
    });
});
