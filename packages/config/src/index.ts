import { z } from "zod";

const environmentSchema = z.enum(["development", "test", "production"]);

export const apiEnvSchema = z.object({
    NODE_ENV: environmentSchema.default("development"),
    PORT: z.coerce.number().int().positive().max(65_535).default(3000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().url(),
    CORS_ORIGINS: z
        .string()
        .default("http://localhost:5173,http://localhost:5174")
        .transform(value =>
            value
                .split(",")
                .map(origin => origin.trim())
                .filter(Boolean),
        ),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "log", "debug", "verbose"]).default("log"),
    WORKERS_ENABLED: z
        .union([z.boolean(), z.enum(["true", "false"])])
        .default("true")
        .transform(value => value === true || value === "true"),
    WORKER_ID: z.string().trim().min(1).max(180).optional(),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    WORKER_LEASE_DURATION_MS: z.coerce
        .number()
        .int()
        .min(1_000)
        .max(15 * 60_000)
        .default(30_000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
});

export const cliEnvSchema = z.object({
    KINETIX_API_URL: z.string().url().default("http://localhost:3000/api/v1"),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type CliEnv = z.infer<typeof cliEnvSchema>;

export function parseApiEnv(input: Record<string, unknown>): ApiEnv {
    return apiEnvSchema.parse(input);
}

export function parseCliEnv(input: Record<string, unknown>): CliEnv {
    return cliEnvSchema.parse(input);
}
