import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
    RevisionResourceRegistry,
    StaleAggregateVersionError,
    type RevisionResourceHandler,
} from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";
import { RevisionController } from "#src/platform/presentation/index";

const id = entityId("0198a4db-d8da-7000-8000-000000000001");

describe("revision presentation", () => {
    it("returns newest-first public resources with version ETags", async () => {
        const { controller } = createController();

        await expect(controller.history("program", id, { limit: "20" })).resolves.toEqual({
            items: [
                expect.objectContaining({
                    version: 3,
                    etag: '"3"',
                    resource: { name: "Current" },
                    createdAt: "2026-07-26T12:00:00.000Z",
                }),
            ],
            nextCursor: null,
        });
    });

    it("requires If-Match and returns a new ETag after restore", async () => {
        const { controller, handler } = createController();
        const response = { setHeader: vi.fn() };

        await expect(
            controller.restore("program", id, "1", '"3"', "request-2", { reason: "Undo edit" }, response),
        ).resolves.toEqual({
            version: 4,
            etag: '"4"',
            resource: { name: "Original" },
        });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"4"');
        expect(handler.restore).toHaveBeenCalledWith(
            expect.objectContaining({
                restoreVersion: 1,
                expectedVersion: 3,
                metadata: expect.objectContaining({
                    reason: "Undo edit",
                    correlationId: "request-2",
                }),
            }),
        );
        await expect(controller.restore("program", id, "1", undefined, undefined, {}, response)).rejects.toMatchObject({
            status: 428,
        });
    });

    it("maps stale restores to a version conflict with the current ETag", async () => {
        const { controller, handler } = createController();
        handler.restore.mockRejectedValueOnce(new StaleAggregateVersionError(2, 3));

        const error = await controller
            .restore("program", id, "1", '"2"', undefined, {}, { setHeader: vi.fn() })
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(409);
        expect((error as HttpException).getResponse()).toEqual(
            expect.objectContaining({ code: "VERSION_CONFLICT", currentVersion: 3, etag: '"3"' }),
        );
    });

    it("returns the approved 422 validation contract", async () => {
        const { controller } = createController();

        const error = await controller
            .restore("program", id, "1", '"3"', "request-2", { reason: "" }, { setHeader: vi.fn() })
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(422);
        expect((error as HttpException).getResponse()).toEqual(
            expect.objectContaining({
                code: "VALIDATION_FAILED",
                fieldErrors: { reason: expect.any(Array) },
            }),
        );
    });

    it("passes retryable restores through the idempotent transaction", async () => {
        const execute = vi.fn(
            async (
                input: { context: { correlationId: string } },
                command: (transaction: unknown) => Promise<{ status: number; body: unknown }>,
            ) => ({
                ...(await command({ id: "idempotency-transaction" })),
                replayed: true,
                context: input.context,
            }),
        );
        const { registry, handler } = createController();
        const controller = new RevisionController(registry, { execute } as never);
        const response = { setHeader: vi.fn() };

        await expect(
            controller.restore("program", id, "1", '"3"', "request-2", {}, response, "restore-key-1"),
        ).resolves.toMatchObject({ version: 4, etag: '"4"' });

        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: "revision.restore",
                key: "restore-key-1",
                context: expect.objectContaining({ correlationId: "request-2" }),
            }),
            expect.any(Function),
        );
        expect(handler.restore).toHaveBeenCalledWith(
            expect.objectContaining({ transaction: { id: "idempotency-transaction" } }),
        );
        expect(response.setHeader).toHaveBeenCalledWith("Idempotency-Replayed", "true");
    });
});

function createController() {
    const registry = new RevisionResourceRegistry();
    const handler = {
        entityType: "program",
        history: vi.fn(async () => ({
            items: [
                {
                    entityType: "program",
                    entityId: id,
                    version: 3,
                    schemaVersion: 1,
                    source: "user" as const,
                    actorId: null,
                    reason: null,
                    summary: "Renamed program",
                    correlationId: "request-1",
                    createdAt: new Date("2026-07-26T12:00:00.000Z"),
                    resource: { name: "Current" },
                },
            ],
            nextCursor: null,
        })),
        restore: vi.fn(async () => ({ version: 4, resource: { name: "Original" } })),
    } satisfies RevisionResourceHandler;
    registry.register(handler);
    return { controller: new RevisionController(registry), handler, registry };
}
