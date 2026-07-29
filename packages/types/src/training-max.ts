import { z } from "zod";

export const trainingMaxTypeSchema = z.enum(["estimated_1rm", "training_max", "custom"]);
export const trainingMaxSourceSchema = z.enum([
    "web",
    "cli",
    "agent",
    "bulk_import",
    "progression_rule",
    "manual_correction",
    "provider_sync",
]);
export const trainingMaxUnitSchema = z.enum(["kg", "lb"]);

const loadSchema = z.object({ value: z.number().positive(), unit: trainingMaxUnitSchema }).strict();
const customLabelSchema = z.string().trim().min(1).max(60);
const noteSchema = z.string().max(500);
const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a decimal number");

export const trainingMaxResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        exerciseId: z.string().uuid(),
        maxType: trainingMaxTypeSchema,
        customLabel: z.string().nullable(),
        valueKg: decimalStringSchema,
        enteredValue: decimalStringSchema,
        enteredUnit: trainingMaxUnitSchema,
        source: trainingMaxSourceSchema,
        note: z.string().nullable(),
        effectiveFrom: z.string().datetime(),
        effectiveTo: z.string().datetime().nullable(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const trainingMaxListResponseSchema = z.object({ items: z.array(trainingMaxResponseSchema) }).strict();

const customLabelRules = <T extends { maxType: z.infer<typeof trainingMaxTypeSchema>; customLabel?: string | null }>(
    value: T,
    ctx: z.RefinementCtx,
): void => {
    if (value.maxType === "custom" && (value.customLabel === undefined || value.customLabel === null))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customLabel"], message: "A custom max needs a label" });
    if (value.maxType !== "custom" && value.customLabel != null)
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["customLabel"],
            message: "Only custom maxima may carry a label",
        });
};

export const recordTrainingMaxRequestSchema = z
    .object({
        exerciseId: z.string().uuid(),
        maxType: trainingMaxTypeSchema,
        customLabel: customLabelSchema.nullable().optional(),
        load: loadSchema,
        source: trainingMaxSourceSchema.optional(),
        note: noteSchema.nullable().optional(),
        effectiveFrom: z.string().datetime().optional(),
    })
    .strict()
    .superRefine(customLabelRules);

export type TrainingMaxTypeValue = z.infer<typeof trainingMaxTypeSchema>;
export type TrainingMaxSourceValue = z.infer<typeof trainingMaxSourceSchema>;
export type TrainingMaxUnitValue = z.infer<typeof trainingMaxUnitSchema>;
export type TrainingMaxResponse = z.infer<typeof trainingMaxResponseSchema>;
export type TrainingMaxListResponse = z.infer<typeof trainingMaxListResponseSchema>;
export type RecordTrainingMaxRequest = z.infer<typeof recordTrainingMaxRequestSchema>;
