import { describe, expect, it } from "vitest";

import {
    addDaysToLocalDate,
    daysBetweenLocalDates,
    expandProgramSchedule,
    isPlannedSessionOverdue,
    shiftProgramSessionDates,
    type ScheduleContext,
    type SessionScheduleInput,
    type ShiftableSession,
} from "#src/modules/training/domain/index";

function block(id: string, relativeStartWeek: number | null) {
    return {
        id,
        parentBlockId: null,
        type: "mesocycle" as const,
        label: null,
        position: 0,
        startDate: null,
        endDate: null,
        relativeStartWeek,
        relativeEndWeek: null,
        focus: null,
        targetMuscles: [],
        targetVolume: null,
        targetIntensity: null,
        deload: false,
        expectedAdaptations: null,
        notes: null,
        tags: [],
    };
}

function plan(
    overrides: Partial<SessionScheduleInput> & Pick<SessionScheduleInput, "key" | "sequence">,
): SessionScheduleInput {
    return { relativeWeek: null, relativeDay: null, preferredTime: null, ...overrides };
}

describe("addDaysToLocalDate", () => {
    it("adds whole days across a month boundary", () => {
        expect(addDaysToLocalDate("2026-01-30", 3)).toBe("2026-02-02");
    });

    it("stays stable across a spring-forward DST transition (US, 2026-03-08)", () => {
        // Local dates are time-zone naive, so day arithmetic must not lose or gain a day.
        expect(addDaysToLocalDate("2026-03-07", 1)).toBe("2026-03-08");
        expect(addDaysToLocalDate("2026-03-08", 1)).toBe("2026-03-09");
    });

    it("subtracts days", () => {
        expect(addDaysToLocalDate("2026-03-01", -1)).toBe("2026-02-28");
    });

    it("rejects an invalid date", () => {
        expect(() => addDaysToLocalDate("2026-13-01", 1)).toThrow();
    });
});

describe("daysBetweenLocalDates", () => {
    it("returns a signed whole-day difference", () => {
        expect(daysBetweenLocalDates("2026-08-01", "2026-08-08")).toBe(7);
        expect(daysBetweenLocalDates("2026-08-08", "2026-08-01")).toBe(-7);
    });
});

describe("expandProgramSchedule (dated)", () => {
    const context = (startDate: string | null, blocks = [] as ReturnType<typeof block>[]): ScheduleContext => ({
        scheduleMode: "dated",
        startDate,
        blocks,
    });

    it("derives each session date from its relative week/day offset", () => {
        const result = expandProgramSchedule(context("2026-08-03"), [
            plan({ key: "a", sequence: 0, relativeWeek: 0, relativeDay: 0 }),
            plan({ key: "b", sequence: 1, relativeWeek: 0, relativeDay: 2 }),
            plan({ key: "c", sequence: 2, relativeWeek: 1, relativeDay: 0 }),
        ]);
        expect(result.sessions.map(s => s.localDate)).toEqual(["2026-08-03", "2026-08-05", "2026-08-10"]);
    });

    it("anchors the offset to the earliest owning block's relative start week", () => {
        const result = expandProgramSchedule(context("2026-08-03", [block("blk", 2)]), [
            plan({ key: "a", sequence: 0, relativeWeek: 0, relativeDay: 1, blockIds: ["blk"] }),
        ]);
        // start + (2 weeks anchor + 0) * 7 + 1 day = 2026-08-03 + 15 days
        expect(result.sessions[0]!.localDate).toBe("2026-08-18");
    });

    it("lets an explicit local date override the derived one", () => {
        const result = expandProgramSchedule(context("2026-08-03"), [
            plan({ key: "a", sequence: 0, relativeWeek: 5, explicitLocalDate: "2026-09-09" }),
        ]);
        expect(result.sessions[0]!.localDate).toBe("2026-09-09");
    });

    it("orders output by sequence", () => {
        const result = expandProgramSchedule(context("2026-08-03"), [
            plan({ key: "late", sequence: 2, relativeDay: 4 }),
            plan({ key: "early", sequence: 0, relativeDay: 0 }),
        ]);
        expect(result.sessions.map(s => s.key)).toEqual(["early", "late"]);
    });

    it("warns when two generated sessions collide on the same date and preferred time", () => {
        const result = expandProgramSchedule(context("2026-08-03"), [
            plan({ key: "a", sequence: 0, relativeDay: 0, preferredTime: "08:00" }),
            plan({ key: "b", sequence: 1, relativeDay: 0, preferredTime: "08:00" }),
        ]);
        expect(result.warnings.some(w => w.code === "schedule_collision")).toBe(true);
    });

    it("does not warn when the same date carries different preferred times", () => {
        const result = expandProgramSchedule(context("2026-08-03"), [
            plan({ key: "a", sequence: 0, relativeDay: 0, preferredTime: "08:00" }),
            plan({ key: "b", sequence: 1, relativeDay: 0, preferredTime: "17:00" }),
        ]);
        expect(result.warnings).toHaveLength(0);
    });
});

describe("expandProgramSchedule (undated / relative)", () => {
    it("generates ordered unscheduled sessions when relative with no start date", () => {
        const result = expandProgramSchedule({ scheduleMode: "relative", startDate: null, blocks: [] }, [
            plan({ key: "a", sequence: 1, relativeDay: 3 }),
            plan({ key: "b", sequence: 0, relativeDay: 0 }),
        ]);
        expect(result.sessions.map(s => ({ key: s.key, localDate: s.localDate }))).toEqual([
            { key: "b", localDate: null },
            { key: "a", localDate: null },
        ]);
        expect(result.warnings).toHaveLength(0);
    });

    it("leaves dates unset for a dated program that has no start date yet", () => {
        const result = expandProgramSchedule({ scheduleMode: "dated", startDate: null, blocks: [] }, [
            plan({ key: "a", sequence: 0, relativeDay: 0 }),
        ]);
        expect(result.sessions[0]!.localDate).toBeNull();
    });
});

describe("isPlannedSessionOverdue", () => {
    it("flags a planned session dated before today", () => {
        expect(isPlannedSessionOverdue({ localDate: "2026-07-30", status: "planned" }, "2026-07-31")).toBe(true);
    });

    it("does not flag today or future planned sessions", () => {
        expect(isPlannedSessionOverdue({ localDate: "2026-07-31", status: "planned" }, "2026-07-31")).toBe(false);
        expect(isPlannedSessionOverdue({ localDate: "2026-08-01", status: "planned" }, "2026-07-31")).toBe(false);
    });

    it("does not flag terminal or undated sessions", () => {
        expect(isPlannedSessionOverdue({ localDate: "2026-07-01", status: "completed" }, "2026-07-31")).toBe(false);
        expect(isPlannedSessionOverdue({ localDate: "2026-07-01", status: "skipped" }, "2026-07-31")).toBe(false);
        expect(isPlannedSessionOverdue({ localDate: null, status: "planned" }, "2026-07-31")).toBe(false);
    });
});

describe("shiftProgramSessionDates", () => {
    const sessions: ShiftableSession[] = [
        { id: "past-planned", localDate: "2026-07-20", status: "planned" },
        { id: "today-planned", localDate: "2026-07-31", status: "planned" },
        { id: "future-planned", localDate: "2026-08-07", status: "planned" },
        { id: "future-completed", localDate: "2026-08-14", status: "completed" },
        { id: "future-skipped", localDate: "2026-08-21", status: "skipped" },
        { id: "undated", localDate: null, status: "planned" },
    ];

    it("moves only incomplete future sessions by the start-date delta", () => {
        const shifts = shiftProgramSessionDates(sessions, "2026-08-03", "2026-08-10", "2026-07-31");
        expect(shifts).toEqual([
            { id: "today-planned", fromDate: "2026-07-31", toDate: "2026-08-07" },
            { id: "future-planned", fromDate: "2026-08-07", toDate: "2026-08-14" },
        ]);
    });

    it("leaves overdue, completed, terminal, and undated sessions in place", () => {
        const shifts = shiftProgramSessionDates(sessions, "2026-08-03", "2026-08-10", "2026-07-31");
        const movedIds = shifts.map(s => s.id);
        expect(movedIds).not.toContain("past-planned");
        expect(movedIds).not.toContain("future-completed");
        expect(movedIds).not.toContain("future-skipped");
        expect(movedIds).not.toContain("undated");
    });

    it("returns nothing when the start date does not change", () => {
        expect(shiftProgramSessionDates(sessions, "2026-08-03", "2026-08-03", "2026-07-31")).toHaveLength(0);
    });

    it("shifts earlier when the new start date is before the old one", () => {
        const shifts = shiftProgramSessionDates(
            [{ id: "future-planned", localDate: "2026-08-07", status: "planned" }],
            "2026-08-03",
            "2026-07-27",
            "2026-07-20",
        );
        expect(shifts[0]).toEqual({ id: "future-planned", fromDate: "2026-08-07", toDate: "2026-07-31" });
    });
});
