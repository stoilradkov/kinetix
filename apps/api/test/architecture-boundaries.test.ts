import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
    cwd: new URL("../../..", import.meta.url).pathname,
});

async function lint(source: string, filePath: string) {
    const [result] = await eslint.lintText(source, { filePath });
    return result?.messages.map(({ message, ruleId }) => ({ message, ruleId }));
}

describe("architecture import boundaries", () => {
    it("allows domain and application code to depend inward", async () => {
        await expect(
            lint(
                "import type { Clock } from '#src/platform/domain/index.js';\nexport type UsesClock = Clock;",
                "apps/api/test/fixtures/domain/allowed.fixture.ts",
            ),
        ).resolves.toEqual([]);
        await expect(
            lint(
                "import type { Clock } from '#/platform/domain/index.js';\nexport type UsesClock = Clock;",
                "apps/api/test/fixtures/application/allowed.fixture.ts",
            ),
        ).resolves.toEqual([]);
    });

    it.each([
        ["domain framework import", "import { Module } from '@nestjs/common';\nexport { Module };", "domain"],
        ["domain Drizzle import", "import { sql } from 'drizzle-orm';\nexport { sql };", "domain"],
        [
            "application infrastructure import",
            "import { Adapter } from '#src/modules/training/infrastructure/adapter.js';\nexport { Adapter };",
            "application",
        ],
        [
            "cross-module infrastructure import",
            "import { Adapter } from '#src/modules/profile/infrastructure/adapter.js';\nexport { Adapter };",
            "infrastructure",
        ],
        [
            "cross-module schema import",
            "import { profiles } from '@kinetix/db/schema/profile';\nexport { profiles };",
            "infrastructure",
        ],
    ])("rejects %s", async (_name, source, folder) => {
        const messages = await lint(source, `apps/api/test/fixtures/${folder}/invalid.fixture.ts`);

        expect(messages).toContainEqual(expect.objectContaining({ ruleId: "no-restricted-imports" }));
    });
});
