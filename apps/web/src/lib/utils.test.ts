import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
    it("merges Tailwind classes predictably", () => {
        expect(cn("px-2", "px-4", { block: true })).toBe("px-4 block");
    });
});
