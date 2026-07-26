import { describe, expect, it, vi } from "vitest";

import { CliApiError, cliExitCode } from "#src/api-error";
import { createProgram } from "#src/command";

describe("kin", () => {
    it("prints local information", async () => {
        const output = vi.fn();
        const program = createProgram({ fetch, output });

        await program.parseAsync(["node", "kin", "info"]);

        expect(output).toHaveBeenCalledWith("Kinetix");
        expect(output).toHaveBeenCalledWith("API: http://localhost:3000/api/v1");
    });

    it("sends explicit version and idempotency headers when restoring history", async () => {
        const output = vi.fn();
        const request = vi.fn(async () =>
            Response.json({
                version: 4,
                etag: '"4"',
                resource: { name: "Original" },
            }),
        );
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "history",
            "restore",
            "program",
            "0198a4db-d8da-7000-8000-000000000001",
            "1",
            "--version",
            "3",
            "--idempotency-key",
            "restore-1",
            "--json",
        ]);

        expect(request).toHaveBeenCalledWith(
            expect.stringContaining("/history/program/0198a4db-d8da-7000-8000-000000000001/restore/1"),
            expect.objectContaining({
                method: "POST",
                headers: expect.any(Headers),
            }),
        );
        const init = request.mock.calls[0]?.[1];
        const headers = init?.headers as Headers;
        expect(headers.get("if-match")).toBe('"3"');
        expect(headers.get("idempotency-key")).toBe("restore-1");
        expect(output).toHaveBeenCalledWith(
            JSON.stringify({ version: 4, etag: '"4"', resource: { name: "Original" } }),
        );
    });

    it("maps machine-readable API failures to deterministic exit codes", () => {
        expect(
            cliExitCode(
                new CliApiError({
                    code: "VERSION_CONFLICT",
                    message: "stale",
                    correlationId: "request-1",
                }),
            ),
        ).toBe(5);
    });
});
