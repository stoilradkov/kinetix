import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ProgramResponse, ProgramSessionMembership } from "@kinetix/types";

// A stubbed router Link renders a plain anchor so navigation targets can be asserted without a router.
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

vi.mock("@tanstack/react-query", () => ({
    useQuery: () => ({ isPending: false, isError: false, data: undefined }),
    useMutation: (options: { mutationFn: (value: unknown) => Promise<unknown> }) => ({
        mutate: (value: unknown) => options.mutationFn(value),
        isPending: false,
        isError: false,
        error: null,
        reset: vi.fn(),
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}));

vi.mock("@/lib/api", () => ({
    programQueryOptions: (id: string) => ({ queryKey: ["training-program", id] }),
    programSessionsQueryOptions: (id: string) => ({ queryKey: ["training-program-sessions", id] }),
    programAdherenceQueryOptions: (id: string) => ({ queryKey: ["training-program-adherence", id] }),
    plannedSessionQueryOptions: (id: string | null) => ({ queryKey: ["training-planned-session", id] }),
    changePlannedSessionOutcome: vi.fn(),
    changeProgramStartDate: vi.fn(),
    reschedulePlannedSession: vi.fn(),
}));

// Imported after the mocks so the component picks them up.
import { ProgramDetail } from "@/components/training/program-detail";

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
        id: "0198a4db-d8da-7000-8000-0000000000a1",
        profileId: "0198a4db-d8da-7000-8000-0000000000d9",
        name: "Hypertrophy Block",
        description: null,
        status: "active",
        scheduleMode: "dated",
        startDate: "2026-08-03",
        endDate: "2026-09-14",
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

beforeAll(() => {
    // Radix menus probe pointer-capture and scrolling APIs jsdom does not implement.
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

describe("ProgramDetail header", () => {
    it("shows a breadcrumb back to Programs plus the program name, status, and week progress", () => {
        render(<ProgramDetail program={program()} sessions={[membership({ relativeWeek: 0 })]} />);

        const back = screen.getByRole("link", { name: "Programs" });
        expect(back).toHaveAttribute("href", "/training/programs");
        expect(screen.getByRole("heading", { name: "Hypertrophy Block" })).toBeVisible();
        expect(screen.getByText("active")).toBeVisible();
        // Dated program with a start date reads as "Week X of Y".
        expect(screen.getByText(/Week \d+ of 1/)).toBeVisible();
    });

    it("prompts activation when the program has no planned sessions yet", () => {
        render(<ProgramDetail program={program()} sessions={[]} />);
        expect(screen.getByText(/No planned sessions yet/)).toBeVisible();
    });
});

describe("ProgramDetail session tree", () => {
    it("groups planned sessions into ordered week sections", () => {
        render(
            <ProgramDetail
                program={program()}
                sessions={[
                    membership({ relativeWeek: 1, title: "Lower B" }),
                    membership({ relativeWeek: 0, title: "Upper A" }),
                ]}
            />,
        );
        const headings = screen.getAllByText(/^Week \d+$/).map(node => node.textContent);
        expect(headings).toEqual(["Week 1", "Week 2"]);
        expect(screen.getByText("Upper A")).toBeVisible();
        expect(screen.getByText("Lower B")).toBeVisible();
    });

    it("labels sessions with neither week nor date as unscheduled", () => {
        render(
            <ProgramDetail program={program({ scheduleMode: "ordered", startDate: null })} sessions={[membership()]} />,
        );
        expect(screen.getByText("Unscheduled")).toBeVisible();
    });
});

describe("ProgramDetail completion state", () => {
    it("links a completed session forward to its performed training session", () => {
        render(
            <ProgramDetail
                program={program()}
                sessions={[
                    membership({
                        relativeWeek: 0,
                        status: "completed",
                        title: "Upper A",
                        actualSessionId: "0198a4db-d8da-7000-8000-000000009999",
                    }),
                ]}
            />,
        );
        expect(screen.getByText("Completed")).toBeVisible();
        const link = screen.getByRole("link", { name: /View session/ });
        expect(link).toHaveAttribute("href", "/training/sessions/0198a4db-d8da-7000-8000-000000009999");
    });

    it("shows no forward link for a completed session that maps to nothing performed", () => {
        render(
            <ProgramDetail
                program={program()}
                sessions={[membership({ relativeWeek: 0, status: "completed", actualSessionId: null })]}
            />,
        );
        expect(screen.getByText("Completed")).toBeVisible();
        expect(screen.queryByRole("link", { name: /View session/ })).toBeNull();
    });

    it("flags an overdue planned session and offers its reschedule actions", () => {
        render(
            <ProgramDetail
                program={program()}
                sessions={[membership({ relativeWeek: 0, status: "planned", overdue: true })]}
            />,
        );
        expect(screen.getByText("Upcoming")).toBeVisible();
        expect(screen.getByText("overdue")).toBeVisible();
        expect(screen.getByRole("button", { name: "Session actions" })).toBeVisible();
    });

    it("renders terminal states as muted labels with no actions menu", () => {
        render(
            <ProgramDetail
                program={program()}
                sessions={[membership({ relativeWeek: 0, status: "skipped", title: "Missed one" })]}
            />,
        );
        expect(screen.getByText("Skipped")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Session actions" })).toBeNull();
    });
});
