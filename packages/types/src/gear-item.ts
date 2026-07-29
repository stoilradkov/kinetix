import { z } from "zod";

export const gearTypeSchema = z.enum(["shoes", "equipment"]);
export const gearStatusSchema = z.enum(["active", "archived"]);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format");
const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a decimal number");
const distanceLimitSchema = z.object({ value: z.number().positive(), unit: z.enum(["m", "km", "mi"]) }).strict();
const nameSchema = z.string().trim().min(1).max(120);
const notesSchema = z.string().max(1_000);

export const gearItemResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        name: z.string(),
        gearType: gearTypeSchema,
        acquiredOn: isoDateSchema.nullable(),
        retiredOn: isoDateSchema.nullable(),
        distanceLimitM: decimalStringSchema.nullable(),
        notes: z.string().nullable(),
        status: gearStatusSchema,
        archivedAt: z.string().datetime().nullable(),
        version: z.number().int().positive(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const gearItemListResponseSchema = z.object({ items: z.array(gearItemResponseSchema) }).strict();

export const createGearItemRequestSchema = z
    .object({
        name: nameSchema,
        gearType: gearTypeSchema,
        acquiredOn: isoDateSchema.nullable().optional(),
        retiredOn: isoDateSchema.nullable().optional(),
        distanceLimit: distanceLimitSchema.nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

export const updateGearItemRequestSchema = z
    .object({
        name: nameSchema.optional(),
        gearType: gearTypeSchema.optional(),
        acquiredOn: isoDateSchema.nullable().optional(),
        retiredOn: isoDateSchema.nullable().optional(),
        distanceLimit: distanceLimitSchema.nullable().optional(),
        notes: notesSchema.nullable().optional(),
    })
    .strict();

export type GearTypeValue = z.infer<typeof gearTypeSchema>;
export type GearStatusValue = z.infer<typeof gearStatusSchema>;
export type GearItemResponse = z.infer<typeof gearItemResponseSchema>;
export type GearItemListResponse = z.infer<typeof gearItemListResponseSchema>;
export type CreateGearItemRequest = z.infer<typeof createGearItemRequestSchema>;
export type UpdateGearItemRequest = z.infer<typeof updateGearItemRequestSchema>;
