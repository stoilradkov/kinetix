import { z } from "zod";

export const zoneFamilySchema = z.enum(["heart_rate", "pace", "power"]);
export const zoneMethodSchema = z.enum([
    "percent_max_hr",
    "percent_hr_reserve",
    "lactate_threshold",
    "percent_threshold_pace",
    "percent_ftp",
    "manual",
]);
export const zoneSourceSchema = z.enum([
    "web",
    "cli",
    "agent",
    "bulk_import",
    "progression_rule",
    "manual_correction",
    "provider_sync",
]);

const methodsByFamily: Record<z.infer<typeof zoneFamilySchema>, readonly z.infer<typeof zoneMethodSchema>[]> = {
    heart_rate: ["percent_max_hr", "percent_hr_reserve", "lactate_threshold", "manual"],
    pace: ["percent_threshold_pace", "manual"],
    power: ["percent_ftp", "manual"],
};

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a decimal number");
const configSchema = z.record(z.string(), z.number().positive());
const noteSchema = z.string().max(500);

export const zoneRangeResponseSchema = z
    .object({
        id: z.string().uuid(),
        position: z.number().int().nonnegative(),
        name: z.string(),
        lowerBound: decimalStringSchema,
        upperBound: decimalStringSchema.nullable(),
        lowerInclusive: z.boolean(),
        upperInclusive: z.boolean(),
    })
    .strict();

export const zoneDefinitionResponseSchema = z
    .object({
        id: z.string().uuid(),
        profileId: z.string().uuid(),
        family: zoneFamilySchema,
        method: zoneMethodSchema,
        config: configSchema,
        ranges: z.array(zoneRangeResponseSchema),
        source: zoneSourceSchema,
        note: z.string().nullable(),
        effectiveFrom: z.string().datetime(),
        effectiveTo: z.string().datetime().nullable(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const zoneDefinitionListResponseSchema = z.object({ items: z.array(zoneDefinitionResponseSchema) }).strict();

const zoneRangeInputSchema = z
    .object({
        position: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(60),
        lowerBound: z.number().nonnegative(),
        upperBound: z.number().positive().nullable().optional(),
        lowerInclusive: z.boolean().optional(),
        upperInclusive: z.boolean().optional(),
    })
    .strict();

export const recordZoneDefinitionRequestSchema = z
    .object({
        family: zoneFamilySchema,
        method: zoneMethodSchema,
        config: configSchema.optional(),
        ranges: z.array(zoneRangeInputSchema).min(1),
        source: zoneSourceSchema.optional(),
        note: noteSchema.nullable().optional(),
        effectiveFrom: z.string().datetime().optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (!methodsByFamily[value.family].includes(value.method))
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["method"],
                message: `Method is not valid for ${value.family} zones`,
            });
    });

export type ZoneFamilyValue = z.infer<typeof zoneFamilySchema>;
export type ZoneMethodValue = z.infer<typeof zoneMethodSchema>;
export type ZoneDefinitionResponse = z.infer<typeof zoneDefinitionResponseSchema>;
export type ZoneDefinitionListResponse = z.infer<typeof zoneDefinitionListResponseSchema>;
export type RecordZoneDefinitionRequest = z.infer<typeof recordZoneDefinitionRequestSchema>;
