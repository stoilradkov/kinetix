import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "#src/index";

describe("healthResponseSchema", () => {
    it("preserves the health wire contract", () => {
        expect(
            healthResponseSchema.parse({
                status: "ok",
                service: "kinetix-api",
                timestamp: "2026-07-12T12:00:00.000Z",
            }),
        ).toMatchObject({ status: "ok", service: "kinetix-api" });
    });
});
