import { z } from "zod";

export const profileSexSchema = z.enum(["female", "male", "intersex", "other"]);
export const massUnitSchema = z.enum(["kg", "lb"]);
export const distanceUnitSchema = z.enum(["km", "mi"]);
export const lengthUnitSchema = z.enum(["cm", "in"]);

export const unitPreferencesSchema = z
    .object({ mass: massUnitSchema, distance: distanceUnitSchema, length: lengthUnitSchema })
    .strict();

const birthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Birth date must use the YYYY-MM-DD format");
const heightMetresSchema = z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/, "Height must be a metre value with up to three decimals");

export const coreProfileResponseSchema = z
    .object({
        id: z.string().uuid(),
        status: z.enum(["active", "archived"]),
        birthDate: birthDateSchema.nullable(),
        sex: profileSexSchema.nullable(),
        heightMeters: z.string().nullable(),
        timeZone: z.string().min(1),
        unitPreferences: unitPreferencesSchema,
        version: z.number().int().positive(),
        archivedAt: z.string().datetime().nullable(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const createProfileRequestSchema = z
    .object({
        timeZone: z.string().min(1),
        unitPreferences: unitPreferencesSchema,
        birthDate: birthDateSchema.nullable().optional(),
        sex: profileSexSchema.nullable().optional(),
        heightMeters: heightMetresSchema.nullable().optional(),
    })
    .strict();

export const updateProfileRequestSchema = z
    .object({
        timeZone: z.string().min(1).optional(),
        unitPreferences: unitPreferencesSchema.optional(),
        birthDate: birthDateSchema.nullable().optional(),
        sex: profileSexSchema.nullable().optional(),
        heightMeters: heightMetresSchema.nullable().optional(),
    })
    .strict();

export type ProfileSexValue = z.infer<typeof profileSexSchema>;
export type ProfileUnitPreferences = z.infer<typeof unitPreferencesSchema>;
export type CoreProfileResponse = z.infer<typeof coreProfileResponseSchema>;
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
