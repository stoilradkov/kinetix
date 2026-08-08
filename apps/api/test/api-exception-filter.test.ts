import { describe, expect, it } from "vitest";

import { mapException } from "#src/platform/presentation/api-exception.filter";

describe("mapException", () => {
    it("maps body-parser size failures to the public 413 error", () => {
        expect(mapException({ type: "entity.too.large", status: 413 })).toEqual({
            status: 413,
            code: "PAYLOAD_TOO_LARGE",
            message: "Request body exceeds the configured HTTP payload limit",
        });
    });
});
