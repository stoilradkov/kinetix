import { z } from "zod";

import type { CreateProgramRequest, ProgramResponse, UpdateProgramRequest } from "@kinetix/types";

/**
 * String-based form model for the program editor and its nested blocks. Inputs stay controlled as
 * strings; the mappers below convert to/from the typed wire contract. Block IDs are minted on the
 * client so a block can reference its parent by id within a single submission (matching the API's
 * block-request contract).
 */

const scheduleModeSchema = z.enum(["relative", "dated", "ordered"]);
const blockTypeSchema = z.enum(["macrocycle", "mesocycle", "microcycle", "custom"]);
const localDateForm = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")]);

export const programBlockFormSchema = z
    .object({
        id: z.string().uuid(),
        parentBlockId: z.string(),
        type: blockTypeSchema,
        label: z.string().max(160),
        position: z.string().regex(/^\d+$/, "Whole number"),
        focus: z.string().max(500),
        deload: z.boolean(),
        notes: z.string().max(2_000),
    })
    .superRefine((block, ctx) => {
        if (block.type === "custom" && block.label.trim().length === 0)
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Custom blocks need a label", path: ["label"] });
    });

export const programFormSchema = z
    .object({
        name: z.string().trim().min(1, "Name is required").max(160),
        description: z.string().max(4_000),
        scheduleMode: scheduleModeSchema,
        startDate: localDateForm,
        endDate: localDateForm,
        focus: z.string().max(500),
        blocks: z.array(programBlockFormSchema),
    })
    .superRefine((values, ctx) => {
        if (values.startDate !== "" && values.endDate !== "" && values.startDate > values.endDate)
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "End date must be on or after the start date",
                path: ["endDate"],
            });
        const seen = new Map<string, Set<number>>();
        values.blocks.forEach((block, index) => {
            const scope = block.parentBlockId || "__root__";
            const position = Number(block.position);
            const used = seen.get(scope) ?? new Set<number>();
            if (used.has(position))
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Sibling blocks need unique positions",
                    path: ["blocks", index, "position"],
                });
            used.add(position);
            seen.set(scope, used);
        });
    });

export type ProgramFormValues = z.infer<typeof programFormSchema>;
export type ProgramBlockFormValues = z.infer<typeof programBlockFormSchema>;

export function programFormDefaults(): ProgramFormValues {
    return { name: "", description: "", scheduleMode: "ordered", startDate: "", endDate: "", focus: "", blocks: [] };
}

export function emptyProgramBlock(id: string): ProgramBlockFormValues {
    return { id, parentBlockId: "", type: "mesocycle", label: "", position: "0", focus: "", deload: false, notes: "" };
}

function blockPayload(values: ProgramFormValues) {
    return values.blocks.map(block => ({
        id: block.id,
        parentBlockId: block.parentBlockId === "" ? null : block.parentBlockId,
        type: block.type,
        label: block.label.trim() === "" ? null : block.label.trim(),
        position: Number(block.position),
        focus: block.focus.trim() === "" ? null : block.focus.trim(),
        deload: block.deload,
        notes: block.notes.trim() === "" ? null : block.notes.trim(),
    }));
}

function metadataPayload(values: ProgramFormValues) {
    return {
        name: values.name.trim(),
        description: values.description.trim() === "" ? null : values.description.trim(),
        scheduleMode: values.scheduleMode,
        startDate: values.startDate === "" ? null : values.startDate,
        endDate: values.endDate === "" ? null : values.endDate,
        focus: values.focus.trim() === "" ? null : values.focus.trim(),
    };
}

export function programCreateInput(values: ProgramFormValues): CreateProgramRequest {
    return { ...metadataPayload(values), blocks: blockPayload(values) };
}

export function programUpdateInput(values: ProgramFormValues): UpdateProgramRequest {
    return { ...metadataPayload(values), blocks: blockPayload(values) };
}

export function programFormValues(response: ProgramResponse): ProgramFormValues {
    return {
        name: response.name,
        description: response.description ?? "",
        scheduleMode: response.scheduleMode,
        startDate: response.startDate ?? "",
        endDate: response.endDate ?? "",
        focus: response.focus ?? "",
        blocks: response.blocks.map(block => ({
            id: block.id,
            parentBlockId: block.parentBlockId ?? "",
            type: block.type,
            label: block.label ?? "",
            position: String(block.position),
            focus: block.focus ?? "",
            deload: block.deload,
            notes: block.notes ?? "",
        })),
    };
}
