import { z } from "zod";

export const catalogOwnershipSchema = z.enum(["seeded", "user"]);
export const analyticsMappingStatusSchema = z.enum(["standard", "unmapped"]);
export const exerciseClassificationSchema = z.enum(["compound", "isolation"]);
export const exerciseLateralitySchema = z.enum(["bilateral", "unilateral"]);
export const repetitionSemanticsSchema = z.enum(["total", "per_side", "alternating"]);
export const exerciseLoadModelSchema = z.enum([
    "external_only",
    "full_bodyweight_plus_added_minus_assistance",
    "manual_effective_load",
    "none",
]);
export const exerciseMeasurementTypeSchema = z.enum([
    "repetitions",
    "external_load",
    "bodyweight",
    "added_load",
    "assistance",
    "effective_load",
    "duration",
    "distance",
    "power",
]);

export const muscleCatalogItemSchema = z
    .object({
        schemaVersion: z.literal(1),
        id: z.string().uuid(),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        name: z.string().min(1),
        position: z.number().int().nonnegative(),
    })
    .strict();

export const extensibleCatalogItemSchema = muscleCatalogItemSchema
    .extend({
        ownership: catalogOwnershipSchema,
        analyticsMappingStatus: analyticsMappingStatusSchema,
    })
    .strict();

export const tagCatalogItemSchema = muscleCatalogItemSchema
    .extend({
        ownership: catalogOwnershipSchema,
        category: z.enum(["run_classification", "custom"]),
    })
    .strict();

export const exerciseCatalogItemSchema = z
    .object({
        schemaVersion: z.literal(1),
        id: z.string().uuid(),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        name: z.string().min(1),
        aliases: z.array(z.string().min(1)),
        status: z.enum(["active", "archived"]),
        ownership: catalogOwnershipSchema,
        equipment: extensibleCatalogItemSchema,
        movementPattern: extensibleCatalogItemSchema,
        classification: exerciseClassificationSchema,
        laterality: exerciseLateralitySchema,
        bodyPosition: z.string().min(1),
        repetitionSemantics: repetitionSemanticsSchema,
        loadModel: exerciseLoadModelSchema,
        supportedMeasurements: z.array(exerciseMeasurementTypeSchema),
        muscles: z.array(
            z
                .object({
                    muscle: muscleCatalogItemSchema,
                    role: z.enum(["primary", "secondary"]),
                })
                .strict(),
        ),
        tags: z.array(tagCatalogItemSchema),
        notes: z.string().nullable(),
        version: z.number().int().positive(),
        position: z.number().int().nonnegative(),
    })
    .strict();

export const muscleCatalogListResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        items: z.array(muscleCatalogItemSchema),
    })
    .strict();

export const equipmentCatalogListResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        items: z.array(extensibleCatalogItemSchema),
    })
    .strict();

export const movementPatternCatalogListResponseSchema = equipmentCatalogListResponseSchema;

export const tagCatalogListResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        items: z.array(tagCatalogItemSchema),
    })
    .strict();

export const exerciseCatalogListResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        items: z.array(exerciseCatalogItemSchema),
    })
    .strict();

export type MuscleCatalogItemResponse = z.infer<typeof muscleCatalogItemSchema>;
export type ExtensibleCatalogItemResponse = z.infer<typeof extensibleCatalogItemSchema>;
export type TagCatalogItemResponse = z.infer<typeof tagCatalogItemSchema>;
export type ExerciseCatalogItemResponse = z.infer<typeof exerciseCatalogItemSchema>;
export type MuscleCatalogListResponse = z.infer<typeof muscleCatalogListResponseSchema>;
export type EquipmentCatalogListResponse = z.infer<typeof equipmentCatalogListResponseSchema>;
export type MovementPatternCatalogListResponse = z.infer<typeof movementPatternCatalogListResponseSchema>;
export type TagCatalogListResponse = z.infer<typeof tagCatalogListResponseSchema>;
export type ExerciseCatalogListResponse = z.infer<typeof exerciseCatalogListResponseSchema>;
