import { z } from "zod";

export const revisionSourceSchema = z.enum(["user", "agent", "import", "sync", "system", "restore"]);

export const revisionHistoryItemSchema = z.object({
    version: z.number().int().positive(),
    schemaVersion: z.number().int().positive(),
    source: revisionSourceSchema,
    actorId: z.string().nullable(),
    reason: z.string().nullable(),
    summary: z.string().min(1),
    correlationId: z.string().min(1),
    createdAt: z.string().datetime(),
});

export const revisionHistoryResponseSchema = z.object({
    items: z.array(revisionHistoryItemSchema),
    nextCursor: z.number().int().positive().nullable(),
});

export const restoreRevisionRequestSchema = z.object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500).optional(),
});

export type RevisionHistoryItem = z.infer<typeof revisionHistoryItemSchema>;
export type RevisionHistoryResponse = z.infer<typeof revisionHistoryResponseSchema>;
export type RestoreRevisionRequest = z.infer<typeof restoreRevisionRequestSchema>;
