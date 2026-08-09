import { describe, expect, it } from "vitest";

import type { ProgramStatusValue, ProgramSummary } from "@kinetix/types";

import {
    filterProgramsByTab,
    formatProgramDateRange,
    programBadgeVariant,
    sortProgramsByStartDate,
} from "@/lib/program-list";

function program(overrides: Partial<ProgramSummary> = {}): ProgramSummary {
    return {
        id: "0198a4db-d8da-7000-8000-000000000001",
        profileId: "0198a4db-d8da-7000-8000-0000000000d9",
        name: "Base Building",
        description: null,
        status: "active",
        scheduleMode: "relative",
        startDate: "2026-08-03",
        endDate: null,
        focus: null,
        version: 1,
        archivedAt: null,
        createdAt: "2026-08-01T09:00:00.000Z",
        updatedAt: "2026-08-01T09:00:00.000Z",
        blockCount: 1,
        sessionCount: 3,
        ...overrides,
    };
}

describe("filterProgramsByTab", () => {
    it("keeps active and paused under the Active tab", () => {
        const programs = [
            program({ id: "a", status: "active" }),
            program({ id: "p", status: "paused" }),
            program({ id: "d", status: "draft" }),
            program({ id: "c", status: "completed" }),
            program({ id: "z", status: "archived" }),
        ];
        expect(filterProgramsByTab(programs, "active").map(item => item.id)).toEqual(["a", "p"]);
    });

    it("isolates each remaining lifecycle state to its own tab", () => {
        const programs = [
            program({ id: "d", status: "draft" }),
            program({ id: "c", status: "completed" }),
            program({ id: "z", status: "archived" }),
            program({ id: "a", status: "active" }),
        ];
        expect(filterProgramsByTab(programs, "draft").map(item => item.id)).toEqual(["d"]);
        expect(filterProgramsByTab(programs, "completed").map(item => item.id)).toEqual(["c"]);
        expect(filterProgramsByTab(programs, "archived").map(item => item.id)).toEqual(["z"]);
    });
});

describe("programBadgeVariant", () => {
    it("maps lifecycle states to Kinetic-Calm variants and never uses amber milestone", () => {
        const expected: Record<ProgramStatusValue, string> = {
            active: "success",
            paused: "warning",
            completed: "secondary",
            archived: "secondary",
            draft: "outline",
        };
        for (const [status, variant] of Object.entries(expected)) {
            expect(programBadgeVariant(status as ProgramStatusValue)).toBe(variant);
        }
        expect(Object.values(expected)).not.toContain("milestone");
    });
});

describe("sortProgramsByStartDate", () => {
    it("orders dated programs newest start first with undated last", () => {
        const programs = [
            program({ id: "old", startDate: "2025-01-01" }),
            program({ id: "undated", startDate: null }),
            program({ id: "new", startDate: "2026-08-03" }),
        ];
        expect(sortProgramsByStartDate(programs).map(item => item.id)).toEqual(["new", "old", "undated"]);
    });

    it("breaks start-date ties on createdAt descending", () => {
        const programs = [
            program({ id: "earlier", startDate: "2026-08-03", createdAt: "2026-07-01T00:00:00.000Z" }),
            program({ id: "later", startDate: "2026-08-03", createdAt: "2026-07-20T00:00:00.000Z" }),
        ];
        expect(sortProgramsByStartDate(programs).map(item => item.id)).toEqual(["later", "earlier"]);
    });

    it("does not mutate the input array", () => {
        const programs = [program({ id: "a", startDate: "2025-01-01" }), program({ id: "b", startDate: "2026-01-01" })];
        const before = programs.map(item => item.id);
        sortProgramsByStartDate(programs);
        expect(programs.map(item => item.id)).toEqual(before);
    });
});

describe("formatProgramDateRange", () => {
    it("elides the shared year for a same-year range", () => {
        expect(formatProgramDateRange(program({ startDate: "2026-08-03", endDate: "2026-11-02" }))).toBe(
            "Aug 3 – Nov 2, 2026",
        );
    });

    it("keeps both years when a range spans a year boundary", () => {
        expect(formatProgramDateRange(program({ startDate: "2025-12-01", endDate: "2026-02-01" }))).toBe(
            "Dec 1, 2025 – Feb 1, 2026",
        );
    });

    it("shows an open-ended start when there is no end date", () => {
        expect(formatProgramDateRange(program({ startDate: "2026-08-03", endDate: null }))).toBe("From Aug 3, 2026");
    });

    it("returns null for an unscheduled program", () => {
        expect(formatProgramDateRange(program({ startDate: null, endDate: null }))).toBeNull();
    });
});
