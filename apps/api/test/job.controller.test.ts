import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    type JobStatusReader,
} from "#src/platform/application/index";
import { JobController } from "#src/platform/presentation/index";

describe("job status presentation", () => {
    it("returns progress and safe errors without stored payloads or fingerprints", async () => {
        const id = randomUUID();
        const now = new Date("2026-07-26T12:00:00.000Z");
        const controller = new JobController({
            find: async () => ({
                id,
                type: "training.analytics.recalculate",
                version: 1,
                state: "queued",
                attempts: 1,
                maxAttempts: 5,
                nextAttemptAt: now,
                idempotencyKey: "sensitive-internal-key",
                correlationId: "request-1",
                causationId: "event-1",
                progress: { completed: 2, total: 8, message: "Calculating metrics" },
                error: {
                    code: "TRANSIENT_FAILURE",
                    message: "Temporary processing failure",
                    retryable: true,
                    failedAt: now,
                },
                startedAt: now,
                completedAt: null,
                createdAt: now,
                updatedAt: now,
            }),
        } satisfies JobStatusReader);

        const resource = await controller.status(id);

        expect(resource).toMatchObject({
            id,
            state: "queued",
            progress: { completed: 2, total: 8, percentage: 25 },
            error: { code: "TRANSIENT_FAILURE", retryable: true },
        });
        expect(resource).not.toHaveProperty("payload");
        expect(resource).not.toHaveProperty("payloadFingerprint");
        expect(resource).not.toHaveProperty("idempotencyKey");
        expect(resource).not.toHaveProperty("causationId");
    });

    it("maps missing jobs through the application not-found contract", async () => {
        const controller = new JobController({ find: async () => null });

        await expect(controller.status(randomUUID())).rejects.toBeInstanceOf(ApplicationNotFoundError);
    });

    it("rejects invalid IDs before querying PostgreSQL", async () => {
        const jobs = { find: async () => null };
        const controller = new JobController(jobs);

        await expect(controller.status("not-a-uuid")).rejects.toBeInstanceOf(ApplicationValidationError);
    });
});
