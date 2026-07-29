import { z } from "zod";

import { publishPrescriptionRequestSchema, sessionPrescriptionResponseSchema } from "#src/session-prescription";

/**
 * Wire contracts for WorkoutTemplate (design 5.5, 10.3). A template owns metadata plus one
 * immutable prescription tree. Create/update carry a whole prescription draft (the server
 * forces `kind: "template"` and manages lineage); detail responses embed the published tree
 * while list responses stay metadata-only for bounded queries.
 */

export const workoutTemplateStatusSchema = z.enum(["active", "archived"]);

const nameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().max(2_000);

/** A template edit describes the whole prescription minus server-managed kind/lineage. */
export const workoutTemplatePrescriptionDraftSchema = publishPrescriptionRequestSchema.omit({
    kind: true,
    sourcePrescriptionId: true,
    sourceKind: true,
});

const workoutTemplateSummaryShape = {
    id: z.string().uuid(),
    profileId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    currentPrescriptionId: z.string().uuid(),
    status: workoutTemplateStatusSchema,
    archivedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
} as const;

/** Compact per-activity counts for the list view, so the client renders a summary without the tree. */
export const workoutTemplateActivitySummarySchema = z
    .object({
        type: z.enum(["strength", "running"]),
        exerciseCount: z.number().int().nonnegative(),
        setCount: z.number().int().nonnegative(),
        runStepCount: z.number().int().nonnegative(),
    })
    .strict();

export const workoutTemplateSummarySchema = z
    .object({
        ...workoutTemplateSummaryShape,
        activities: z.array(workoutTemplateActivitySummarySchema),
    })
    .strict();

export const workoutTemplateResponseSchema = z
    .object({ ...workoutTemplateSummaryShape, prescription: sessionPrescriptionResponseSchema })
    .strict();

export const workoutTemplateListResponseSchema = z.object({ items: z.array(workoutTemplateSummarySchema) }).strict();

export const createWorkoutTemplateRequestSchema = z
    .object({
        name: nameSchema,
        description: descriptionSchema.nullable().optional(),
        prescription: workoutTemplatePrescriptionDraftSchema,
    })
    .strict();

export const updateWorkoutTemplateRequestSchema = z
    .object({
        name: nameSchema.optional(),
        description: descriptionSchema.nullable().optional(),
        prescription: workoutTemplatePrescriptionDraftSchema.optional(),
    })
    .strict();

export type WorkoutTemplateStatusValue = z.infer<typeof workoutTemplateStatusSchema>;
export type WorkoutTemplateActivitySummary = z.infer<typeof workoutTemplateActivitySummarySchema>;
export type WorkoutTemplatePrescriptionDraft = z.infer<typeof workoutTemplatePrescriptionDraftSchema>;
export type WorkoutTemplateSummary = z.infer<typeof workoutTemplateSummarySchema>;
export type WorkoutTemplateResponse = z.infer<typeof workoutTemplateResponseSchema>;
export type WorkoutTemplateListResponse = z.infer<typeof workoutTemplateListResponseSchema>;
export type CreateWorkoutTemplateRequest = z.infer<typeof createWorkoutTemplateRequestSchema>;
export type UpdateWorkoutTemplateRequest = z.infer<typeof updateWorkoutTemplateRequestSchema>;
