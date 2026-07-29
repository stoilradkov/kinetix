import { z } from "zod";

export const equipmentIncrementScopeSchema = z.enum(["default", "exercise", "equipment"]);

const massSchema = z.object({ value: z.number().positive(), unit: z.enum(["kg", "lb"]) }).strict();
const minimumSchema = z.object({ value: z.number().nonnegative(), unit: z.enum(["kg", "lb"]) }).strict();
const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a decimal number");
const labelSchema = z.string().trim().min(1).max(80);

export const equipmentIncrementResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        scope: equipmentIncrementScopeSchema,
        exerciseId: z.string().uuid().nullable(),
        equipmentTypeId: z.string().uuid().nullable(),
        incrementKg: decimalStringSchema,
        minimumKg: decimalStringSchema.nullable(),
        label: z.string().nullable(),
        version: z.number().int().positive(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const equipmentIncrementListResponseSchema = z
    .object({ items: z.array(equipmentIncrementResponseSchema) })
    .strict();

export const createEquipmentIncrementRequestSchema = z
    .object({
        scope: equipmentIncrementScopeSchema,
        exerciseId: z.string().uuid().nullable().optional(),
        equipmentTypeId: z.string().uuid().nullable().optional(),
        increment: massSchema,
        minimum: minimumSchema.nullable().optional(),
        label: labelSchema.nullable().optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (value.scope === "exercise" && !value.exerciseId)
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exerciseId"], message: "exerciseId is required" });
        if (value.scope === "equipment" && !value.equipmentTypeId)
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["equipmentTypeId"],
                message: "equipmentTypeId is required",
            });
        if (value.scope !== "exercise" && value.exerciseId)
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exerciseId"], message: "exerciseId is not allowed" });
        if (value.scope !== "equipment" && value.equipmentTypeId)
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["equipmentTypeId"],
                message: "equipmentTypeId is not allowed",
            });
    });

export const updateEquipmentIncrementRequestSchema = z
    .object({
        increment: massSchema.optional(),
        minimum: minimumSchema.nullable().optional(),
        label: labelSchema.nullable().optional(),
    })
    .strict();

export type EquipmentIncrementScopeValue = z.infer<typeof equipmentIncrementScopeSchema>;
export type EquipmentIncrementResponse = z.infer<typeof equipmentIncrementResponseSchema>;
export type EquipmentIncrementListResponse = z.infer<typeof equipmentIncrementListResponseSchema>;
export type CreateEquipmentIncrementRequest = z.infer<typeof createEquipmentIncrementRequestSchema>;
export type UpdateEquipmentIncrementRequest = z.infer<typeof updateEquipmentIncrementRequestSchema>;
