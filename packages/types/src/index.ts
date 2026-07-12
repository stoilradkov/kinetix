import { z } from 'zod';

export const projectStatusSchema = z.enum(['active', 'paused', 'archived']);

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120),
  status: projectStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createProjectSchema = projectSchema.pick({ name: true }).extend({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a URL-safe slug'),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.literal('kinetix-api'),
  timestamp: z.string().datetime(),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}
