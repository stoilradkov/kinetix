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
    it.each([
        ["domain framework import", "import { Module } from '@nestjs/common';\nexport { Module };", "domain"],
        ["domain Drizzle import", "import { sql } from 'drizzle-orm';\nexport { sql };", "domain"],
        [
            "application infrastructure import",
            "import { Adapter } from '#src/modules/training/infrastructure/adapter';\nexport { Adapter };",
            "application",
        ],
        [
            "cross-module infrastructure import",
            "import { Adapter } from '#src/modules/profile/infrastructure/adapter';\nexport { Adapter };",
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
