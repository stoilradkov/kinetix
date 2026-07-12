import { z } from "zod";

export const healthResponseSchema = z.object({
    status: z.enum(["ok", "error"]),
    service: z.literal("kinetix-api"),
    timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export interface ApiError {
    message: string;
    statusCode: number;
    error?: string;
}
