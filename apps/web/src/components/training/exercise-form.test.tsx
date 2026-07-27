import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExerciseForm, ExerciseFormLoadState } from "@/components/training/exercise-form";
import type { ExerciseFormCatalogs } from "@/lib/exercise-form";

const catalogs: ExerciseFormCatalogs = {
    equipment: [
        {
            schemaVersion: 1,
            id: "0198a4db-d8da-7000-8000-000000000001",
            slug: "barbell",
            name: "Barbell",
            position: 0,
            ownership: "seeded",
            analyticsMappingStatus: "standard",
        },
    ],
    movementPatterns: [
        {
            schemaVersion: 1,
            id: "0198a4db-d8da-7000-8000-000000000002",
            slug: "horizontal-push",
            name: "Horizontal Push",
            position: 0,
            ownership: "seeded",
            analyticsMappingStatus: "standard",
        },
    ],
    muscles: [
        {
            schemaVersion: 1,
            id: "0198a4db-d8da-7000-8000-000000000003",
            slug: "chest",
            name: "Chest",
            position: 0,
        },
    ],
};

describe("ExerciseForm", () => {
    it("renders a visible loading state and a retryable catalog error", () => {
        const retry = vi.fn();
        const view = render(<ExerciseFormLoadState onRetry={retry} />);

        expect(screen.getByRole("status")).toHaveTextContent("Loading exercise options");

        view.rerender(<ExerciseFormLoadState error={new Error("API unavailable")} onRetry={retry} />);

        expect(screen.getByRole("alert")).toHaveTextContent("Exercise options could not be loaded");
        expect(screen.getByRole("alert")).toHaveTextContent("API unavailable");
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(retry).toHaveBeenCalledOnce();
    });

    it("uses accessible Zod field errors and submits validated values", async () => {
        const submit = vi.fn();
        render(<ExerciseForm catalogs={catalogs} onSubmit={submit} submitLabel="Create exercise" />);

        expect(screen.getByLabelText("Name")).toBeVisible();
        expect(screen.getByLabelText("Slug")).toBeVisible();

        fireEvent.click(screen.getByRole("button", { name: "Create exercise" }));

        expect(await screen.findByText("Name is required")).toBeVisible();
        expect(await screen.findByText("Slug is required")).toBeVisible();
        expect(submit).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bench Press" } });
        fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "bench-press" } });
        fireEvent.click(screen.getByRole("button", { name: "Create exercise" }));

        await waitFor(() => expect(submit).toHaveBeenCalledOnce());
        expect(submit.mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                name: "Bench Press",
                slug: "bench-press",
            }),
        );
    });
});
