import { z } from "zod";

import { publishPrescriptionRequestSchema, sessionPrescriptionResponseSchema } from "#src/session-prescription";

/**
 * Wire contracts for PlannedSession (design 5.7, 10.3). A planned session owns schedule/lifecycle
 * metadata plus one immutable prescription tree. Create/update carry a whole prescription draft
 * (the server forces `kind: "planned"` and manages lineage); detail responses embed the published
 * tree while list responses stay metadata-only for bounded queries.
 */

export const plannedSessionStatusSchema = z.enum([
    "planned",
    "completed",
    "partially_completed",
    "skipped",
    "cancelled",
]);

export const skipCancelReasonSchema = z.enum([
    "illness",
    "fatigue",
    "pain",
    "schedule",
    "recovery",
    "equipment_unavailable",
    "other",
]);

const titleSchema = z.string().trim().min(1).max(160);
const notesSchema = z.string().max(4_000);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date");
const preferredTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be an HH:MM time");
const tagSchema = z.string().trim().min(1).max(80);

/** A planned-session edit describes the whole prescription minus server-managed kind/lineage. */
export const plannedSessionPrescriptionDraftSchema = publishPrescriptionRequestSchema.omit({
    kind: true,
    sourcePrescriptionId: true,
    sourceKind: true,
});

const plannedSessionSummaryShape = {
    id: z.string().uuid(),
    profileId: z.string().uuid(),
    title: z.string().nullable(),
    status: plannedSessionStatusSchema,
    localDate: z.string().nullable(),
    timeZone: z.string().nullable(),
    preferredTime: z.string().nullable(),
    expectedDurationMinutes: z.number().int().nonnegative().nullable(),
    notes: z.string().nullable(),
    tags: z.array(z.string()),
    skipReason: skipCancelReasonSchema.nullable(),
    skipNotes: z.string().nullable(),
    currentPrescriptionId: z.string().uuid(),
    sourceTemplateId: z.string().uuid().nullable(),
    sourceTemplateVersion: z.number().int().positive().nullable(),
    version: z.number().int().positive(),
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
} as const;

export const plannedSessionSummarySchema = z.object(plannedSessionSummaryShape).strict();

export const plannedSessionResponseSchema = z
    .object({ ...plannedSessionSummaryShape, prescription: sessionPrescriptionResponseSchema })
    .strict();

export const plannedSessionListResponseSchema = z.object({ items: z.array(plannedSessionSummarySchema) }).strict();

export const createPlannedSessionRequestSchema = z
    .object({
        title: titleSchema.nullable().optional(),
        localDate: localDateSchema.nullable().optional(),
        timeZone: z.string().trim().min(1).max(80).nullable().optional(),
        preferredTime: preferredTimeSchema.nullable().optional(),
        expectedDurationMinutes: z.number().int().nonnegative().nullable().optional(),
        notes: notesSchema.nullable().optional(),
        tags: z.array(tagSchema).optional(),
        prescription: plannedSessionPrescriptionDraftSchema,
    })
    .strict();

export const updatePlannedSessionRequestSchema = z
    .object({
        title: titleSchema.nullable().optional(),
        localDate: localDateSchema.nullable().optional(),
        timeZone: z.string().trim().min(1).max(80).nullable().optional(),
        preferredTime: preferredTimeSchema.nullable().optional(),
        expectedDurationMinutes: z.number().int().nonnegative().nullable().optional(),
        notes: notesSchema.nullable().optional(),
        tags: z.array(tagSchema).optional(),
        prescription: plannedSessionPrescriptionDraftSchema.optional(),
    })
    .strict();

export const completePlannedSessionRequestSchema = z.object({ partial: z.boolean().optional() }).strict();

export const skipCancelPlannedSessionRequestSchema = z
    .object({ reason: skipCancelReasonSchema.nullable().optional(), notes: notesSchema.nullable().optional() })
    .strict();

export type PlannedSessionStatusValue = z.infer<typeof plannedSessionStatusSchema>;
export type SkipCancelReasonValue = z.infer<typeof skipCancelReasonSchema>;
export type PlannedSessionPrescriptionDraft = z.infer<typeof plannedSessionPrescriptionDraftSchema>;
export type PlannedSessionSummary = z.infer<typeof plannedSessionSummarySchema>;
export type PlannedSessionResponse = z.infer<typeof plannedSessionResponseSchema>;
export type PlannedSessionListResponse = z.infer<typeof plannedSessionListResponseSchema>;
export type CreatePlannedSessionRequest = z.infer<typeof createPlannedSessionRequestSchema>;
export type UpdatePlannedSessionRequest = z.infer<typeof updatePlannedSessionRequestSchema>;
export type CompletePlannedSessionRequest = z.infer<typeof completePlannedSessionRequestSchema>;
export type SkipCancelPlannedSessionRequest = z.infer<typeof skipCancelPlannedSessionRequestSchema>;
