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
export const exerciseRelationshipTypeSchema = z.enum(["variation", "progression", "regression", "analytics_family"]);

export const exerciseMuscleAssignmentInputSchema = z
    .object({
        muscleGroupId: z.string().uuid(),
        role: z.enum(["primary", "secondary"]),
    })
    .strict();

export const exerciseRelationshipInputSchema = z
    .object({
        targetExerciseId: z.string().uuid(),
        type: exerciseRelationshipTypeSchema,
    })
    .strict();

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
        forkedFromExerciseId: z.string().uuid().nullable().default(null),
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
        relationships: z.array(exerciseRelationshipInputSchema).default([]),
        notes: z.string().nullable(),
        version: z.number().int().positive(),
        position: z.number().int().nonnegative(),
        archivedAt: z.string().datetime().nullable().optional(),
        createdAt: z.string().datetime().optional(),
        updatedAt: z.string().datetime().optional(),
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
        nextCursor: z.number().int().nonnegative().nullable().default(null),
    })
    .strict();

const exerciseDefinitionInputShape = {
    slug: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(160),
    aliases: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
    equipmentTypeId: z.string().uuid(),
    movementPatternId: z.string().uuid(),
    classification: exerciseClassificationSchema,
    laterality: exerciseLateralitySchema,
    bodyPosition: z.string().trim().min(1).max(120),
    repetitionSemantics: repetitionSemanticsSchema,
    loadModel: exerciseLoadModelSchema,
    supportedMeasurements: z.array(exerciseMeasurementTypeSchema).min(1),
    muscles: z.array(exerciseMuscleAssignmentInputSchema).min(1).max(100),
    tagIds: z.array(z.string().uuid()).max(100).default([]),
    relationships: z.array(exerciseRelationshipInputSchema).max(100).default([]),
    notes: z.string().trim().min(1).max(4_000).nullable().default(null),
    position: z.number().int().nonnegative().default(0),
} as const;

export const createExerciseRequestSchema = z
    .object(exerciseDefinitionInputShape)
    .strict()
    .superRefine(validateExerciseDefinitionInput);

export const updateExerciseRequestSchema = z
    .object({
        slug: exerciseDefinitionInputShape.slug.optional(),
        name: exerciseDefinitionInputShape.name.optional(),
        equipmentTypeId: exerciseDefinitionInputShape.equipmentTypeId.optional(),
        movementPatternId: exerciseDefinitionInputShape.movementPatternId.optional(),
        classification: exerciseDefinitionInputShape.classification.optional(),
        laterality: exerciseDefinitionInputShape.laterality.optional(),
        bodyPosition: exerciseDefinitionInputShape.bodyPosition.optional(),
        repetitionSemantics: exerciseDefinitionInputShape.repetitionSemantics.optional(),
        loadModel: exerciseDefinitionInputShape.loadModel.optional(),
        supportedMeasurements: exerciseDefinitionInputShape.supportedMeasurements.optional(),
        notes: z.string().trim().min(1).max(4_000).nullable().optional(),
        position: exerciseDefinitionInputShape.position.optional(),
    })
    .strict()
    .refine(value => Object.keys(value).length > 0, "At least one exercise field is required");

export const replaceExerciseAliasesRequestSchema = z
    .object({
        aliases: z.array(z.string().trim().min(1).max(160)).max(100),
    })
    .strict();

export const replaceExerciseMusclesRequestSchema = z
    .object({
        muscles: z.array(exerciseMuscleAssignmentInputSchema).min(1).max(100),
    })
    .strict()
    .superRefine((value, context) => validateMuscles(value.muscles, context));

export const replaceExerciseTagsRequestSchema = z
    .object({
        tagIds: z.array(z.string().uuid()).max(100),
    })
    .strict()
    .superRefine((value, context) => validateUnique(value.tagIds, "tag ID", ["tagIds"], context));

export const replaceExerciseRelationshipsRequestSchema = z
    .object({
        relationships: z.array(exerciseRelationshipInputSchema).max(100),
    })
    .strict()
    .superRefine((value, context) => {
        validateUnique(
            value.relationships.map(item => `${item.type}:${item.targetExerciseId}`),
            "relationship",
            ["relationships"],
            context,
        );
    });

export const exerciseCatalogListQuerySchema = z
    .object({
        status: z.enum(["active", "archived", "all"]).default("active"),
        ownership: catalogOwnershipSchema.optional(),
        equipmentTypeId: z.string().uuid().optional(),
        movementPatternId: z.string().uuid().optional(),
        muscleGroupId: z.string().uuid().optional(),
        tagId: z.string().uuid().optional(),
        relationshipType: exerciseRelationshipTypeSchema.optional(),
        search: z.string().trim().min(1).max(160).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.coerce.number().int().nonnegative().optional(),
    })
    .strict();

export const exerciseSnapshotV1Schema = z
    .object({
        schemaVersion: z.literal(1),
        exerciseId: z.string().uuid(),
        exerciseVersion: z.number().int().positive(),
        name: z.string().min(1),
        equipmentTypeId: z.string().uuid(),
        movementPatternId: z.string().uuid(),
        classification: exerciseClassificationSchema,
        laterality: exerciseLateralitySchema,
        bodyPosition: z.string().min(1),
        repetitionSemantics: repetitionSemanticsSchema,
        loadModel: exerciseLoadModelSchema,
        supportedMeasurements: z.array(exerciseMeasurementTypeSchema),
        muscles: z.array(exerciseMuscleAssignmentInputSchema),
        tagIds: z.array(z.string().uuid()),
        analyticsFamilyExerciseIds: z.array(z.string().uuid()),
    })
    .strict();

export const exerciseReferenceImpactSchema = z
    .object({
        referenceType: z.string().trim().min(1).max(120),
        count: z.number().int().nonnegative(),
    })
    .strict();

export const exerciseExternalIdSchema = z
    .object({
        provider: z.string().trim().min(1).max(120),
        externalId: z.string().trim().min(1).max(500),
    })
    .strict();

const exerciseMergeCandidateSchema = z
    .object({
        id: z.string().uuid(),
        name: z.string().min(1),
        version: z.number().int().positive(),
    })
    .strict();

export const exerciseMergePreviewRequestSchema = z
    .object({
        canonicalExerciseId: z.string().uuid(),
        mergedExerciseId: z.string().uuid(),
        expectedCanonicalVersion: z.number().int().positive(),
        expectedMergedVersion: z.number().int().positive(),
    })
    .strict()
    .refine(value => value.canonicalExerciseId !== value.mergedExerciseId, {
        message: "An exercise cannot be merged into itself",
        path: ["mergedExerciseId"],
    });

export const mergeExerciseRequestSchema = exerciseMergePreviewRequestSchema
    .safeExtend({
        reason: z.string().trim().min(1).max(500).nullable().optional(),
    })
    .strict();

export const revertExerciseMergeRequestSchema = z
    .object({
        expectedCanonicalVersion: z.number().int().positive(),
        expectedMergedVersion: z.number().int().positive(),
        reason: z.string().trim().min(1).max(500).nullable().optional(),
    })
    .strict();

export const exerciseMergePreviewResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        canonicalExercise: exerciseMergeCandidateSchema,
        mergedExercise: exerciseMergeCandidateSchema,
        redirectedAliases: z.array(z.string().min(1)),
        externalIds: z.array(exerciseExternalIdSchema),
        referenceImpact: z.array(exerciseReferenceImpactSchema),
        totalReferenceCount: z.number().int().nonnegative(),
        affectedExerciseIds: z.array(z.string().uuid()).min(2),
        affectedFamilyExerciseIds: z.array(z.string().uuid()).min(2),
        after: z
            .object({
                resolvedExerciseId: z.string().uuid(),
                mergedExerciseSelectable: z.literal(false),
                historicalSnapshotsPreserved: z.literal(true),
            })
            .strict(),
    })
    .strict();

export const exerciseMergeResourceSchema = z
    .object({
        schemaVersion: z.literal(1),
        id: z.string().uuid(),
        status: z.enum(["applied", "reverted"]),
        version: z.number().int().positive(),
        canonicalExercise: exerciseMergeCandidateSchema,
        mergedExercise: exerciseMergeCandidateSchema,
        mergedExerciseVersionAfterApply: z.number().int().positive(),
        revertedCanonicalExerciseVersion: z.number().int().positive().nullable(),
        revertedMergedExerciseVersion: z.number().int().positive().nullable(),
        redirectedAliases: z.array(z.string().min(1)),
        externalIds: z.array(exerciseExternalIdSchema),
        referenceImpact: z.array(exerciseReferenceImpactSchema),
        totalReferenceCount: z.number().int().nonnegative(),
        affectedExerciseIds: z.array(z.string().uuid()).min(2),
        affectedFamilyExerciseIds: z.array(z.string().uuid()).min(2),
        reason: z.string().nullable(),
        revertReason: z.string().nullable(),
        appliedAt: z.string().datetime(),
        revertedAt: z.string().datetime().nullable(),
    })
    .strict();

export const exerciseMergeHistoryResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        items: z.array(exerciseMergeResourceSchema),
        nextCursor: z.number().int().nonnegative().nullable(),
    })
    .strict();

export const exerciseResolutionResponseSchema = z
    .object({
        schemaVersion: z.literal(1),
        requestedExerciseId: z.string().uuid(),
        resolvedExerciseId: z.string().uuid(),
        redirected: z.boolean(),
        exercise: exerciseCatalogItemSchema,
    })
    .strict();

export const exerciseMutationResponseSchema = exerciseCatalogItemSchema;

export type MuscleCatalogItemResponse = z.infer<typeof muscleCatalogItemSchema>;
export type ExtensibleCatalogItemResponse = z.infer<typeof extensibleCatalogItemSchema>;
export type TagCatalogItemResponse = z.infer<typeof tagCatalogItemSchema>;
export type ExerciseCatalogItemResponse = z.infer<typeof exerciseCatalogItemSchema>;
export type MuscleCatalogListResponse = z.infer<typeof muscleCatalogListResponseSchema>;
export type EquipmentCatalogListResponse = z.infer<typeof equipmentCatalogListResponseSchema>;
export type MovementPatternCatalogListResponse = z.infer<typeof movementPatternCatalogListResponseSchema>;
export type TagCatalogListResponse = z.infer<typeof tagCatalogListResponseSchema>;
export type ExerciseCatalogListResponse = z.infer<typeof exerciseCatalogListResponseSchema>;
export type CreateExerciseRequest = z.infer<typeof createExerciseRequestSchema>;
export type UpdateExerciseRequest = z.infer<typeof updateExerciseRequestSchema>;
export type ReplaceExerciseAliasesRequest = z.infer<typeof replaceExerciseAliasesRequestSchema>;
export type ReplaceExerciseMusclesRequest = z.infer<typeof replaceExerciseMusclesRequestSchema>;
export type ReplaceExerciseTagsRequest = z.infer<typeof replaceExerciseTagsRequestSchema>;
export type ReplaceExerciseRelationshipsRequest = z.infer<typeof replaceExerciseRelationshipsRequestSchema>;
export type ExerciseCatalogListQuery = z.infer<typeof exerciseCatalogListQuerySchema>;
export type ExerciseSnapshotV1Response = z.infer<typeof exerciseSnapshotV1Schema>;
export type ExerciseReferenceImpactResponse = z.infer<typeof exerciseReferenceImpactSchema>;
export type ExerciseMergePreviewRequest = z.infer<typeof exerciseMergePreviewRequestSchema>;
export type MergeExerciseRequest = z.infer<typeof mergeExerciseRequestSchema>;
export type RevertExerciseMergeRequest = z.infer<typeof revertExerciseMergeRequestSchema>;
export type ExerciseMergePreviewResponse = z.infer<typeof exerciseMergePreviewResponseSchema>;
export type ExerciseMergeResource = z.infer<typeof exerciseMergeResourceSchema>;
export type ExerciseMergeHistoryResponse = z.infer<typeof exerciseMergeHistoryResponseSchema>;
export type ExerciseResolutionResponse = z.infer<typeof exerciseResolutionResponseSchema>;

function validateExerciseDefinitionInput(
    value: {
        name: string;
        aliases: string[];
        loadModel: z.infer<typeof exerciseLoadModelSchema>;
        supportedMeasurements: z.infer<typeof exerciseMeasurementTypeSchema>[];
        muscles: z.infer<typeof exerciseMuscleAssignmentInputSchema>[];
        tagIds: string[];
        relationships: z.infer<typeof exerciseRelationshipInputSchema>[];
    },
    context: z.RefinementCtx,
): void {
    const normalizedAliases = [value.name, ...value.aliases].map(normalizeContractValue);
    validateUnique(normalizedAliases, "normalized alias", ["aliases"], context);
    validateUnique(value.supportedMeasurements, "supported measurement", ["supportedMeasurements"], context);
    validateMuscles(value.muscles, context);
    validateUnique(value.tagIds, "tag ID", ["tagIds"], context);
    validateUnique(
        value.relationships.map(item => `${item.type}:${item.targetExerciseId}`),
        "relationship",
        ["relationships"],
        context,
    );

    const loadMeasurements = new Set(["external_load", "bodyweight", "added_load", "assistance", "effective_load"]);
    const selectedLoadMeasurements = value.supportedMeasurements.filter(item => loadMeasurements.has(item));
    const invalid =
        (value.loadModel === "external_only" &&
            (!value.supportedMeasurements.includes("external_load") ||
                selectedLoadMeasurements.some(item => item !== "external_load"))) ||
        (value.loadModel === "full_bodyweight_plus_added_minus_assistance" &&
            (!value.supportedMeasurements.includes("bodyweight") ||
                selectedLoadMeasurements.some(item => !["bodyweight", "added_load", "assistance"].includes(item)))) ||
        (value.loadModel === "manual_effective_load" &&
            (!value.supportedMeasurements.includes("effective_load") ||
                selectedLoadMeasurements.some(
                    item => !["bodyweight", "added_load", "assistance", "effective_load"].includes(item),
                ))) ||
        (value.loadModel === "none" && selectedLoadMeasurements.length > 0);
    if (invalid)
        context.addIssue({
            code: "custom",
            path: ["supportedMeasurements"],
            message: `Supported measurements are incompatible with load model '${value.loadModel}'`,
        });
}

function validateMuscles(
    muscles: z.infer<typeof exerciseMuscleAssignmentInputSchema>[],
    context: z.RefinementCtx,
): void {
    if (!muscles.some(item => item.role === "primary"))
        context.addIssue({
            code: "custom",
            path: ["muscles"],
            message: "At least one primary muscle is required",
        });
    validateUnique(
        muscles.map(item => item.muscleGroupId),
        "muscle group",
        ["muscles"],
        context,
    );
}

function validateUnique(values: readonly string[], kind: string, path: PropertyKey[], context: z.RefinementCtx): void {
    if (new Set(values).size !== values.length)
        context.addIssue({ code: "custom", path, message: `Duplicate ${kind} values are not allowed` });
}

function normalizeContractValue(value: string): string {
    return value.trim().normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}
