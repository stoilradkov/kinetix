import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'production']);

export const apiEnvSchema = z.object({
  NODE_ENV: environmentSchema.default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose'])
    .default('log'),
});

export const cliEnvSchema = z.object({
  KINETIX_API_URL: z.string().url().default('http://localhost:3000/api/v1'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type CliEnv = z.infer<typeof cliEnvSchema>;

export function parseApiEnv(input: Record<string, unknown>): ApiEnv {
  return apiEnvSchema.parse(input);
}

export function parseCliEnv(input: Record<string, unknown>): CliEnv {
  return cliEnvSchema.parse(input);
}
