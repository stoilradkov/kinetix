import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

describe("kin", () => {
    it("prints local information", async () => {
        const output = vi.fn();
        const program = createProgram({ fetch, output });

        await program.parseAsync(["node", "kin", "info"]);

        expect(output).toHaveBeenCalledWith("Kinetix");
        expect(output).toHaveBeenCalledWith("API: http://localhost:3000/api/v1");
    });
});
