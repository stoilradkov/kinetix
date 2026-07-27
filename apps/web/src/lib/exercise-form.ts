import {
    createExerciseRequestSchema,
    exerciseClassificationSchema,
    exerciseLateralitySchema,
    exerciseLoadModelSchema,
    repetitionSemanticsSchema,
    updateExerciseRequestSchema,
    type CreateExerciseRequest,
    type ExerciseCatalogItemResponse,
    type ExtensibleCatalogItemResponse,
    type MuscleCatalogItemResponse,
    type UpdateExerciseRequest,
} from "@kinetix/types";
import { z } from "zod";

const exerciseFormFieldsSchema = z.object({
    slug: z
        .string()
        .trim()
        .min(1, "Slug is required")
        .max(160, "Slug must be 160 characters or fewer")
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens"),
    name: z.string().trim().min(1, "Name is required").max(160, "Name must be 160 characters or fewer"),
    aliases: z.string().max(16_000, "Aliases are too long"),
    equipmentTypeId: z.string().uuid("Choose an equipment type"),
    movementPatternId: z.string().uuid("Choose a movement pattern"),
    classification: exerciseClassificationSchema,
    laterality: exerciseLateralitySchema,
    bodyPosition: z
        .string()
        .trim()
        .min(1, "Body position is required")
        .max(120, "Body position must be 120 characters or fewer"),
    repetitionSemantics: repetitionSemanticsSchema,
    loadModel: exerciseLoadModelSchema,
    supportedMeasurements: z.string().trim().min(1, "Add at least one supported measurement"),
    primaryMuscleId: z.string().uuid("Choose a primary muscle"),
    notes: z.string().trim().max(4_000, "Notes must be 4,000 characters or fewer"),
    position: z.number().int("Position must be a whole number").nonnegative("Position cannot be negative"),
});

export const exerciseFormSchema = exerciseFormFieldsSchema.superRefine((values, context) => {
    const result = createExerciseRequestSchema.safeParse(exerciseRequestCandidate(values));
    if (result.success) return;

    for (const issue of result.error.issues) {
        context.addIssue({
            code: "custom",
            path: [contractPathToFormPath(issue.path[0])],
            message: issue.message,
        });
    }
});

export type ExerciseFormValues = z.infer<typeof exerciseFormSchema>;

export interface ExerciseFormCatalogs {
    readonly equipment: readonly ExtensibleCatalogItemResponse[];
    readonly movementPatterns: readonly ExtensibleCatalogItemResponse[];
    readonly muscles: readonly MuscleCatalogItemResponse[];
}

export function exerciseFormDefaults(
    exercise: ExerciseCatalogItemResponse | undefined,
    catalogs: ExerciseFormCatalogs,
): ExerciseFormValues {
    return {
        slug: exercise?.slug ?? "",
        name: exercise?.name ?? "",
        aliases: exercise?.aliases.join(", ") ?? "",
        equipmentTypeId: exercise?.equipment.id ?? catalogs.equipment[0]?.id ?? "",
        movementPatternId: exercise?.movementPattern.id ?? catalogs.movementPatterns[0]?.id ?? "",
        classification: exercise?.classification ?? "compound",
        laterality: exercise?.laterality ?? "bilateral",
        bodyPosition: exercise?.bodyPosition ?? "standing",
        repetitionSemantics: exercise?.repetitionSemantics ?? "total",
        loadModel: exercise?.loadModel ?? "external_only",
        supportedMeasurements: exercise?.supportedMeasurements.join(", ") ?? "repetitions, external_load",
        primaryMuscleId:
            exercise?.muscles.find(assignment => assignment.role === "primary")?.muscle.id ??
            catalogs.muscles[0]?.id ??
            "",
        notes: exercise?.notes ?? "",
        position: exercise?.position ?? 0,
    };
}

export function exerciseMetadataInput(values: ExerciseFormValues): UpdateExerciseRequest {
    return updateExerciseRequestSchema.parse({
        slug: values.slug,
        name: values.name,
        equipmentTypeId: values.equipmentTypeId,
        movementPatternId: values.movementPatternId,
        classification: values.classification,
        laterality: values.laterality,
        bodyPosition: values.bodyPosition,
        repetitionSemantics: values.repetitionSemantics,
        loadModel: values.loadModel,
        supportedMeasurements: commaValues(values.supportedMeasurements),
        notes: values.notes || null,
        position: values.position,
    });
}

export function exerciseCreateInput(values: ExerciseFormValues): CreateExerciseRequest {
    return createExerciseRequestSchema.parse(exerciseRequestCandidate(values));
}

export function commaValues(value: string): string[] {
    return value
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

function exerciseRequestCandidate(values: z.infer<typeof exerciseFormFieldsSchema>) {
    return {
        slug: values.slug,
        name: values.name,
        aliases: commaValues(values.aliases),
        equipmentTypeId: values.equipmentTypeId,
        movementPatternId: values.movementPatternId,
        classification: values.classification,
        laterality: values.laterality,
        bodyPosition: values.bodyPosition,
        repetitionSemantics: values.repetitionSemantics,
        loadModel: values.loadModel,
        supportedMeasurements: commaValues(values.supportedMeasurements),
        muscles: [{ muscleGroupId: values.primaryMuscleId, role: "primary" as const }],
        tagIds: [],
        relationships: [],
        notes: values.notes || null,
        position: values.position,
    };
}

function contractPathToFormPath(path: PropertyKey | undefined): keyof ExerciseFormValues {
    if (path === "muscles") return "primaryMuscleId";
    if (
        path === "slug" ||
        path === "name" ||
        path === "aliases" ||
        path === "equipmentTypeId" ||
        path === "movementPatternId" ||
        path === "classification" ||
        path === "laterality" ||
        path === "bodyPosition" ||
        path === "repetitionSemantics" ||
        path === "loadModel" ||
        path === "supportedMeasurements" ||
        path === "notes" ||
        path === "position"
    )
        return path;
    return "name";
}
