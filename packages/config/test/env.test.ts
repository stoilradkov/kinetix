import { describe, expect, it } from "vitest";

import { parseApiEnv, parseCliEnv } from "#src/index";

describe("environment parsing", () => {
    it("provides local API defaults", () => {
        const config = parseApiEnv({
            DATABASE_URL: "postgresql://kinetix:kinetix@localhost:5432/kinetix",
        });

        expect(config.PORT).toBe(3000);
        expect(config.CORS_ORIGINS).toEqual(["http://localhost:5173", "http://localhost:5174"]);
        expect(config.WORKERS_ENABLED).toBe(true);
        expect(config.WORKER_LEASE_DURATION_MS).toBe(30_000);
    });

    it("provides the local CLI API URL", () => {
        expect(parseCliEnv({}).KINETIX_API_URL).toContain("/api/v1");
    });
});
