import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { TrainingSessionResponse } from "@kinetix/types";

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

// The live logger pulls its own active-view query; a marker keeps the branching test focused.
vi.mock("@/components/training/active/active-workout", () => ({
    ActiveWorkout: ({ sessionId }: { readonly sessionId: string }) => <div>live-logger:{sessionId}</div>,
}));

// Hoisted so the vi.mock factory (itself hoisted above imports) can reference the spy safely.
const { transition } = vi.hoisted(() => ({ transition: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/api", () => ({
    trainingSessionQueryOptions: (id: string) => ({ queryKey: ["training-session", id] }),
    transitionTrainingSession: transition,
}));

let queryState: { isPending: boolean; isError: boolean; data?: TrainingSessionResponse; error?: Error };
vi.mock("@tanstack/react-query", () => ({
    useQuery: () => queryState,
    useMutation: (options: { mutationFn: (value: unknown) => Promise<unknown> }) => ({
        mutate: (value: unknown) => options.mutationFn(value),
        isPending: false,
        isError: false,
        error: null,
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}));

// Imported after the mocks so the component picks them up.
import { SessionDetail, SessionDetailRoute } from "@/components/training/session-detail";

function baseSession(overrides: Partial<TrainingSessionResponse> = {}): TrainingSessionResponse {
    return {
        id: "0198a4db-d8da-7000-8000-000000009001",
        profileId: "0198a4db-d8da-7000-8000-0000000000d9",
        status: "completed",
        title: "Upper A",
        localDate: "2026-08-02",
        timeZone: "Europe/Sofia",
        startedAt: "2026-08-02T10:00:00.000Z",
        endedAt: "2026-08-02T11:00:00.000Z",
        durationMinutes: 60,
        readiness: { energy: 4, motivation: null, fatigue: null, soreness: null, stress: null, recovery: null },
        postWorkout: { energy: null, motivation: null, enjoyment: 5, difficulty: null, fatigue: null, notes: null },
        notes: null,
        tags: ["Push"],
        sourcePlannedSessionId: null,
        version: 3,
        archivedAt: null,
        createdAt: "2026-08-02T09:00:00.000Z",
        updatedAt: "2026-08-02T11:00:00.000Z",
        activities: [],
        painRecords: [],
        plannedLinks: [
            {
                plannedSessionId: "0198a4db-d8da-7000-8000-0000000090b1",
                sourcePrescriptionId: "0198a4db-d8da-7000-8000-0000000090c1",
                resolvedPrescriptionId: "0198a4db-d8da-7000-8000-0000000090c1",
                plannedSessionTitle: "Week 1 · Lower",
                programId: "0198a4db-d8da-7000-8000-0000000090d1",
                programName: "Hypertrophy Block",
            },
        ],
        activityMappings: [],
        occurrenceMappings: [],
        setMappings: [],
        runStepMappings: [],
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

describe("SessionDetailRoute branching", () => {
    it("opens the live logger for an in-progress, non-archived session", () => {
        queryState = { isPending: false, isError: false, data: baseSession({ status: "in_progress" }) };
        render(<SessionDetailRoute sessionId="s-1" />);
        expect(screen.getByText("live-logger:s-1")).toBeVisible();
    });

    it("opens the read-only detail view for a completed session", () => {
        queryState = { isPending: false, isError: false, data: baseSession() };
        render(<SessionDetailRoute sessionId="s-1" />);
        expect(screen.queryByText(/live-logger/)).toBeNull();
        expect(screen.getByRole("heading", { name: "Upper A" })).toBeVisible();
    });

    it("opens the read-only detail view for an archived in-progress session", () => {
        queryState = {
            isPending: false,
            isError: false,
            data: baseSession({ status: "in_progress", archivedAt: "2026-08-03T00:00:00.000Z" }),
        };
        render(<SessionDetailRoute sessionId="s-1" />);
        expect(screen.queryByText(/live-logger/)).toBeNull();
        expect(screen.getByText("archived")).toBeVisible();
    });
});

describe("SessionDetail read view", () => {
    it("names and links the planned session and program, and shows recorded ratings", () => {
        render(<SessionDetail session={baseSession()} />);

        expect(screen.getByRole("heading", { name: "Upper A" })).toBeVisible();
        expect(screen.getByText("Completed")).toBeVisible();
        expect(screen.getByText("v3")).toBeVisible();

        // Both the header and the planned-vs-actual card link the program by name; every one navigates.
        const programLinks = screen.getAllByRole("link", { name: "Hypertrophy Block" });
        expect(programLinks.length).toBeGreaterThan(0);
        programLinks.forEach(link => expect(link).toHaveAttribute("href", "/training/programs"));
        expect(screen.getAllByText("Week 1 · Lower").length).toBeGreaterThan(0);

        // A recorded readiness/post value renders; the rest are omitted rather than shown as zero.
        expect(screen.getByText("Readiness")).toBeVisible();
        expect(screen.getByText("Post-workout")).toBeVisible();
    });

    it("keeps lifecycle actions behind an overflow menu, not inline", () => {
        render(<SessionDetail session={baseSession()} />);

        // No mutation is a stray inline button — they live behind the actions trigger.
        expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();

        const trigger = screen.getByRole("button", { name: "Session actions" });
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
        fireEvent.click(trigger);

        const menu = screen.getByRole("menu");
        expect(within(menu).getByText("Reopen")).toBeVisible();
        expect(within(menu).getByText("Archive")).toBeVisible();
    });

    it("invokes the reopen transition when its menu item is selected", () => {
        transition.mockClear();
        render(<SessionDetail session={baseSession()} />);

        const trigger = screen.getByRole("button", { name: "Session actions" });
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
        fireEvent.click(trigger);
        fireEvent.click(within(screen.getByRole("menu")).getByText("Reopen"));

        expect(transition).toHaveBeenCalledWith(expect.objectContaining({ id: baseSession().id }), "reopen");
    });

    it("offers only Restore for an archived session", () => {
        render(<SessionDetail session={baseSession({ archivedAt: "2026-08-03T00:00:00.000Z" })} />);

        const trigger = screen.getByRole("button", { name: "Session actions" });
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
        fireEvent.click(trigger);

        const menu = screen.getByRole("menu");
        expect(within(menu).getByText("Restore")).toBeVisible();
        expect(within(menu).queryByText("Reopen")).toBeNull();
    });
});
