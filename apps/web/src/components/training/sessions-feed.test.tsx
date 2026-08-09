import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TrainingSessionSummary } from "@kinetix/types";

// A stubbed router Link renders a plain anchor so row navigation targets can be asserted without a router.
vi.mock("@tanstack/react-router", () => ({
    Link: ({
        to,
        params,
        children,
        ...rest
    }: {
        readonly to: string;
        readonly params?: { readonly id?: string };
        readonly children: React.ReactNode;
    }) => (
        <a data-to={to} href={params?.id ? to.replace("$id", params.id) : to} {...rest}>
            {children}
        </a>
    ),
}));

import { SessionsFeed } from "@/components/training/sessions-feed";
import { groupSessionsByWeek } from "@/lib/session-weeks";

function summary(overrides: Partial<TrainingSessionSummary> = {}): TrainingSessionSummary {
    return {
        id: "0198a4db-d8da-7000-8000-000000009001",
        profileId: "0198a4db-d8da-7000-8000-0000000000d9",
        status: "completed",
        title: "Upper A",
        localDate: "2026-08-05",
        timeZone: "Europe/Sofia",
        startedAt: null,
        endedAt: null,
        durationMinutes: null,
        readiness: { energy: null, motivation: null, fatigue: null, soreness: null, stress: null, recovery: null },
        postWorkout: { energy: null, motivation: null, enjoyment: null, difficulty: null, fatigue: null, notes: null },
        notes: null,
        tags: [],
        sourcePlannedSessionId: null,
        version: 1,
        archivedAt: null,
        createdAt: "2026-08-05T09:00:00.000Z",
        updatedAt: "2026-08-05T09:00:00.000Z",
        activityCount: 1,
        painRecordCount: 0,
        programId: null,
        programName: null,
        activityKinds: ["strength"],
        totalSetCount: 12,
        ...overrides,
    };
}

const feedProps = {
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: () => {},
};

afterEach(cleanup);

describe("groupSessionsByWeek", () => {
    it("groups by Monday-anchored week and keeps newest week first", () => {
        // Sorted newest-first: two in the week of Mon Aug 3, one in the prior week (Mon Jul 27).
        const weeks = groupSessionsByWeek([
            summary({ id: "a", localDate: "2026-08-09" }), // Sunday — still the Aug 3 week
            summary({ id: "b", localDate: "2026-08-03" }), // Monday — same week
            summary({ id: "c", localDate: "2026-07-31" }), // Friday — prior week
        ]);

        expect(weeks.map(week => week.weekStart)).toEqual(["2026-08-03", "2026-07-27"]);
        expect(weeks[0]!.sessions.map(session => session.id)).toEqual(["a", "b"]);
        expect(weeks[1]!.sessions.map(session => session.id)).toEqual(["c"]);
        expect(weeks[0]!.label).toBe("Week of Aug 3, 2026");
    });

    it("splits sessions that straddle a Monday boundary into separate weeks", () => {
        const weeks = groupSessionsByWeek([
            summary({ id: "mon", localDate: "2026-08-03" }), // Monday: start of its week
            summary({ id: "sun", localDate: "2026-08-02" }), // Sunday: end of the previous week
        ]);

        expect(weeks).toHaveLength(2);
        expect(weeks[0]!.weekStart).toBe("2026-08-03");
        expect(weeks[1]!.weekStart).toBe("2026-07-27");
    });
});

describe("SessionsFeed", () => {
    it("renders the loading state while pending", () => {
        render(<SessionsFeed {...feedProps} isPending sessions={[]} />);
        expect(screen.getByText("Loading sessions…")).toBeVisible();
    });

    it("renders the error message on failure", () => {
        render(<SessionsFeed {...feedProps} error={new Error("boom")} isError sessions={[]} />);
        expect(screen.getByText("boom")).toBeVisible();
    });

    it("renders an empty state when no sessions match", () => {
        render(<SessionsFeed {...feedProps} sessions={[]} />);
        expect(screen.getByText("No sessions match these filters yet.")).toBeVisible();
    });

    it("renders week headers with counts and rows that link to detail", () => {
        render(
            <SessionsFeed
                {...feedProps}
                sessions={[
                    summary({ id: "a", title: "Upper A", localDate: "2026-08-05", programName: "Hypertrophy" }),
                    summary({ id: "b", title: "Lower B", localDate: "2026-08-04" }),
                    summary({ id: "c", title: "Long Run", localDate: "2026-07-30", activityKinds: ["running"] }),
                ]}
            />,
        );

        expect(screen.getByText("Week of Aug 3, 2026 · 2 sessions")).toBeVisible();
        expect(screen.getByText("Week of Jul 27, 2026 · 1 session")).toBeVisible();

        const upper = screen.getByRole("link", { name: /Upper A/ });
        expect(upper).toHaveAttribute("href", "/training/sessions/a");
        expect(within(upper).getByText("Hypertrophy")).toBeVisible();
        expect(within(upper).getByText("12 sets")).toBeVisible();

        // Version chips and provenance tags are intentionally dropped from feed rows.
        expect(screen.queryByText("v1")).toBeNull();
    });

    it("appends rows across weeks as more pages arrive", () => {
        const { rerender } = render(
            <SessionsFeed {...feedProps} sessions={[summary({ id: "a", localDate: "2026-08-05" })]} />,
        );
        expect(screen.getAllByRole("link")).toHaveLength(1);

        rerender(
            <SessionsFeed
                {...feedProps}
                sessions={[
                    summary({ id: "a", localDate: "2026-08-05" }),
                    summary({ id: "b", localDate: "2026-07-30" }),
                ]}
            />,
        );
        expect(screen.getAllByRole("link")).toHaveLength(2);
        expect(screen.getByText(/Week of Jul 27/)).toBeVisible();
    });

    it("shows Load more only when another page exists and fires the callback", () => {
        const onLoadMore = vi.fn();
        const { rerender } = render(
            <SessionsFeed {...feedProps} hasNextPage onLoadMore={onLoadMore} sessions={[summary()]} />,
        );

        const button = screen.getByRole("button", { name: /Load more/ });
        fireEvent.click(button);
        expect(onLoadMore).toHaveBeenCalledTimes(1);

        rerender(<SessionsFeed {...feedProps} hasNextPage={false} onLoadMore={onLoadMore} sessions={[summary()]} />);
        expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull();
        expect(screen.getByText(/reached the start of your history/)).toBeVisible();
    });
});
