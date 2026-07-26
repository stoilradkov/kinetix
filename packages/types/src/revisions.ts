import { z } from "zod";

export const revisionSourceSchema = z.enum(["user", "agent", "import", "sync", "system", "restore"]);
export const revisionResourceSchema = z.record(z.string(), z.unknown());

export const revisionHistoryItemSchema = z.object({
    version: z.number().int().positive(),
    etag: z.string().regex(/^"[1-9]\d*"$/),
    schemaVersion: z.number().int().positive(),
    source: revisionSourceSchema,
    actorId: z.string().nullable(),
    reason: z.string().nullable(),
    summary: z.string().min(1),
    correlationId: z.string().min(1),
    createdAt: z.string().datetime(),
    resource: revisionResourceSchema,
});

export const revisionHistoryResponseSchema = z.object({
    items: z.array(revisionHistoryItemSchema),
    nextCursor: z.number().int().positive().nullable(),
});

export const revisionHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    beforeVersion: z.coerce.number().int().positive().optional(),
});

export const restoreRevisionRequestSchema = z
    .object({
        reason: z.string().trim().min(1).max(500).optional(),
    })
    .strict();

export const restoreRevisionResponseSchema = z.object({
    version: z.number().int().positive(),
    etag: z.string().regex(/^"[1-9]\d*"$/),
    resource: revisionResourceSchema,
});

export type RevisionHistoryItem = z.infer<typeof revisionHistoryItemSchema>;
export type RevisionHistoryQuery = z.infer<typeof revisionHistoryQuerySchema>;
export type RevisionHistoryResponse = z.infer<typeof revisionHistoryResponseSchema>;
export type RestoreRevisionRequest = z.infer<typeof restoreRevisionRequestSchema>;
export type RestoreRevisionResponse = z.infer<typeof restoreRevisionResponseSchema>;
