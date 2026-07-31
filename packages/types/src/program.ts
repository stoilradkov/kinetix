import { z } from "zod";

import { plannedSessionResponseSchema, plannedSessionStatusSchema } from "#src/planned-session";

/**
 * Wire contracts for Program, its nested blocks, and membership (design 5.6, 10.3). A program owns
 * metadata plus an acyclic block tree; planned sessions are separate aggregates linked by join
 * rows. Overlaps and schedule collisions are reported as structured warnings, never validation
 * errors. Detail responses embed the block tree, goal links, and current warnings; list responses
 * stay metadata-only with counts for bounded queries.
 */

export const programStatusSchema = z.enum(["draft", "active", "paused", "completed", "archived"]);
export const programScheduleModeSchema = z.enum(["relative", "dated", "ordered"]);
export const programBlockTypeSchema = z.enum(["macrocycle", "mesocycle", "microcycle", "custom"]);
export const planningWarningCodeSchema = z.enum(["block_overlap", "schedule_collision"]);

const nameSchema = z.string().trim().min(1).max(160);
const descriptionSchema = z.string().max(4_000);
const focusSchema = z.string().max(500);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date");
const preferredTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be an HH:MM time");
const slugSchema = z.string().trim().min(1).max(80);

export const planningWarningSchema = z
    .object({
        code: planningWarningCodeSchema,
        message: z.string(),
        evidence: z.record(z.string(), z.unknown()),
    })
    .strict();

/** Blocks carry client-minted UUIDs so a payload can reference its own parents by id. */
export const programBlockRequestSchema = z
    .object({
        id: z.string().uuid(),
        parentBlockId: z.string().uuid().nullable().optional(),
        type: programBlockTypeSchema,
        label: z.string().trim().min(1).max(160).nullable().optional(),
        position: z.number().int().nonnegative(),
        startDate: localDateSchema.nullable().optional(),
        endDate: localDateSchema.nullable().optional(),
        relativeStartWeek: z.number().int().nonnegative().nullable().optional(),
        relativeEndWeek: z.number().int().nonnegative().nullable().optional(),
        focus: focusSchema.nullable().optional(),
        targetMuscles: z.array(slugSchema).optional(),
        targetVolume: z.string().max(120).nullable().optional(),
        targetIntensity: z.string().max(120).nullable().optional(),
        deload: z.boolean().optional(),
        expectedAdaptations: z.string().max(2_000).nullable().optional(),
        notes: z.string().max(2_000).nullable().optional(),
        tags: z.array(slugSchema).optional(),
    })
    .strict();

export const programBlockResponseSchema = z
    .object({
        id: z.string().uuid(),
        parentBlockId: z.string().uuid().nullable(),
        type: programBlockTypeSchema,
        label: z.string().nullable(),
        position: z.number().int().nonnegative(),
        startDate: z.string().nullable(),
        endDate: z.string().nullable(),
        relativeStartWeek: z.number().int().nonnegative().nullable(),
        relativeEndWeek: z.number().int().nonnegative().nullable(),
        focus: z.string().nullable(),
        targetMuscles: z.array(z.string()),
        targetVolume: z.string().nullable(),
        targetIntensity: z.string().nullable(),
        deload: z.boolean(),
        expectedAdaptations: z.string().nullable(),
        notes: z.string().nullable(),
        tags: z.array(z.string()),
    })
    .strict();

const programSummaryShape = {
    id: z.string().uuid(),
    profileId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    status: programStatusSchema,
    scheduleMode: programScheduleModeSchema,
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    focus: z.string().nullable(),
    version: z.number().int().positive(),
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
} as const;

export const programSummarySchema = z
    .object({
        ...programSummaryShape,
        blockCount: z.number().int().nonnegative(),
        sessionCount: z.number().int().nonnegative(),
    })
    .strict();

export const programResponseSchema = z
    .object({
        ...programSummaryShape,
        blocks: z.array(programBlockResponseSchema),
        goalIds: z.array(z.string().uuid()),
        warnings: z.array(planningWarningSchema),
    })
    .strict();

export const programListResponseSchema = z.object({ items: z.array(programSummarySchema) }).strict();

export const programSessionMembershipSchema = z
    .object({
        plannedSessionId: z.string().uuid(),
        sequence: z.number().int().nonnegative(),
        relativeWeek: z.number().int().nonnegative().nullable(),
        relativeDay: z.number().int().nonnegative().nullable(),
        localDate: z.string().nullable(),
        preferredTime: z.string().nullable(),
        status: plannedSessionStatusSchema,
        title: z.string().nullable(),
        /** Derived: a still-planned session whose local date is before today (design PR-5). */
        overdue: z.boolean(),
    })
    .strict();

/** One before/after date move produced by a start-date change. */
export const sessionDateShiftSchema = z
    .object({ id: z.string().uuid(), fromDate: localDateSchema, toDate: localDateSchema })
    .strict();

export const programSessionsResponseSchema = z.object({ items: z.array(programSessionMembershipSchema) }).strict();

export const createProgramRequestSchema = z
    .object({
        name: nameSchema,
        description: descriptionSchema.nullable().optional(),
        scheduleMode: programScheduleModeSchema.optional(),
        startDate: localDateSchema.nullable().optional(),
        endDate: localDateSchema.nullable().optional(),
        focus: focusSchema.nullable().optional(),
        blocks: z.array(programBlockRequestSchema).optional(),
        goalIds: z.array(z.string().uuid()).optional(),
    })
    .strict();

export const updateProgramRequestSchema = z
    .object({
        name: nameSchema.optional(),
        description: descriptionSchema.nullable().optional(),
        scheduleMode: programScheduleModeSchema.optional(),
        startDate: localDateSchema.nullable().optional(),
        endDate: localDateSchema.nullable().optional(),
        focus: focusSchema.nullable().optional(),
        blocks: z.array(programBlockRequestSchema).optional(),
        goalIds: z.array(z.string().uuid()).optional(),
    })
    .strict();

export const activateProgramSessionPlanSchema = z
    .object({
        templateId: z.string().uuid(),
        title: z.string().trim().min(1).max(160).nullable().optional(),
        localDate: localDateSchema.nullable().optional(),
        timeZone: z.string().trim().min(1).max(80).nullable().optional(),
        preferredTime: preferredTimeSchema.nullable().optional(),
        expectedDurationMinutes: z.number().int().nonnegative().nullable().optional(),
        notes: z.string().max(4_000).nullable().optional(),
        tags: z.array(slugSchema).optional(),
        relativeWeek: z.number().int().nonnegative().nullable().optional(),
        relativeDay: z.number().int().nonnegative().nullable().optional(),
        sequence: z.number().int().nonnegative(),
        blockIds: z.array(z.string().uuid()).optional(),
    })
    .strict();

export const activateProgramRequestSchema = z
    .object({ sessions: z.array(activateProgramSessionPlanSchema).optional() })
    .strict();

export const activateProgramResponseSchema = z
    .object({
        ...programSummaryShape,
        blocks: z.array(programBlockResponseSchema),
        goalIds: z.array(z.string().uuid()),
        warnings: z.array(planningWarningSchema),
        generatedSessions: z.array(plannedSessionResponseSchema),
    })
    .strict();

export const changeProgramStartDateRequestSchema = z.object({ startDate: localDateSchema.nullable() }).strict();

export const changeProgramStartDateResponseSchema = z
    .object({
        ...programSummaryShape,
        blocks: z.array(programBlockResponseSchema),
        goalIds: z.array(z.string().uuid()),
        warnings: z.array(planningWarningSchema),
        movedSessions: z.array(sessionDateShiftSchema),
    })
    .strict();

export const attachProgramSessionRequestSchema = z
    .object({
        plannedSessionId: z.string().uuid(),
        relativeWeek: z.number().int().nonnegative().nullable().optional(),
        relativeDay: z.number().int().nonnegative().nullable().optional(),
        sequence: z.number().int().nonnegative(),
        blockIds: z.array(z.string().uuid()).optional(),
    })
    .strict();

export type ProgramStatusValue = z.infer<typeof programStatusSchema>;
export type ProgramScheduleModeValue = z.infer<typeof programScheduleModeSchema>;
export type ProgramBlockTypeValue = z.infer<typeof programBlockTypeSchema>;
export type PlanningWarningValue = z.infer<typeof planningWarningSchema>;
export type ProgramBlockRequest = z.infer<typeof programBlockRequestSchema>;
export type ProgramBlockResponse = z.infer<typeof programBlockResponseSchema>;
export type ProgramSummary = z.infer<typeof programSummarySchema>;
export type ProgramResponse = z.infer<typeof programResponseSchema>;
export type ProgramListResponse = z.infer<typeof programListResponseSchema>;
export type ProgramSessionMembership = z.infer<typeof programSessionMembershipSchema>;
export type SessionDateShift = z.infer<typeof sessionDateShiftSchema>;
export type ProgramSessionsResponse = z.infer<typeof programSessionsResponseSchema>;
export type ChangeProgramStartDateRequest = z.infer<typeof changeProgramStartDateRequestSchema>;
export type ChangeProgramStartDateResponse = z.infer<typeof changeProgramStartDateResponseSchema>;
export type CreateProgramRequest = z.infer<typeof createProgramRequestSchema>;
export type UpdateProgramRequest = z.infer<typeof updateProgramRequestSchema>;
export type ActivateProgramSessionPlan = z.infer<typeof activateProgramSessionPlanSchema>;
export type ActivateProgramRequest = z.infer<typeof activateProgramRequestSchema>;
export type ActivateProgramResponse = z.infer<typeof activateProgramResponseSchema>;
export type AttachProgramSessionRequest = z.infer<typeof attachProgramSessionRequestSchema>;
