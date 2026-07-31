import { describe, expect, it } from "vitest";

import { createProgramRequestSchema } from "@kinetix/types";

import {
    emptyProgramBlock,
    programCreateInput,
    programFormSchema,
    type ProgramBlockFormValues,
    type ProgramFormValues,
} from "@/lib/program-form";

const parentId = "0198a4db-d8da-7000-8000-0000000000f1";
const childId = "0198a4db-d8da-7000-8000-0000000000f2";

function block(overrides: Partial<ProgramBlockFormValues> & { id: string }): ProgramBlockFormValues {
    return { ...emptyProgramBlock(overrides.id), ...overrides };
}

function values(overrides?: Partial<ProgramFormValues>): ProgramFormValues {
    return {
        name: "Off-season strength",
        description: "",
        scheduleMode: "ordered",
        startDate: "",
        endDate: "",
        focus: "",
        blocks: [
            block({ id: parentId, type: "mesocycle", label: "Base", position: "0" }),
            block({ id: childId, type: "microcycle", label: "Week 1", position: "0", parentBlockId: parentId }),
        ],
        ...overrides,
    };
}

describe("programCreateInput", () => {
    it("maps the string form model to a valid create request", () => {
        const request = programCreateInput(values());
        expect(createProgramRequestSchema.safeParse(request).success).toBe(true);
        expect(request).toMatchObject({
            name: "Off-season strength",
            description: null,
            scheduleMode: "ordered",
            startDate: null,
            blocks: [
                { id: parentId, parentBlockId: null, type: "mesocycle", position: 0 },
                { id: childId, parentBlockId: parentId, type: "microcycle", position: 0 },
            ],
        });
    });

    it("keeps dates and focus when provided", () => {
        const request = programCreateInput(
            values({ scheduleMode: "dated", startDate: "2026-01-01", endDate: "2026-03-01", focus: "Hypertrophy" }),
        );
        expect(request.startDate).toBe("2026-01-01");
        expect(request.endDate).toBe("2026-03-01");
        expect(request.focus).toBe("Hypertrophy");
    });
});

describe("programFormSchema", () => {
    it("rejects an inverted date range", () => {
        const result = programFormSchema.safeParse(values({ startDate: "2026-03-01", endDate: "2026-01-01" }));
        expect(result.success).toBe(false);
    });

    it("rejects duplicate sibling positions", () => {
        const result = programFormSchema.safeParse(
            values({
                blocks: [
                    block({ id: parentId, type: "mesocycle", label: "A", position: "0" }),
                    block({ id: childId, type: "mesocycle", label: "B", position: "0" }),
                ],
            }),
        );
        expect(result.success).toBe(false);
    });

    it("requires a label on custom blocks", () => {
        const result = programFormSchema.safeParse(
            values({ blocks: [block({ id: parentId, type: "custom", label: "", position: "0" })] }),
        );
        expect(result.success).toBe(false);
    });
});
