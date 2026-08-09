import { describe, expect, it, vi } from "vitest";

import { createProgram } from "#src/command";

const rule = {
    id: "0198a4db-d8da-7000-8000-000000005001",
    profileId: "0198a4db-d8da-7000-8000-0000000000d9",
    name: "Progress bench",
    description: null,
    scope: { type: "template", id: "0198a4db-d8da-7000-8000-0000000050a1" },
    target: { mode: "next", selector: { kind: "scope" } },
    conditionSchemaVersion: 1,
    condition: {
        kind: "metric",
        metric: { key: "completed_all_sets", scope: "exercise" },
        operator: "eq",
        value: true,
    },
    actionSchemaVersion: 1,
    actions: [{ type: "adjust_load", mode: "percent", value: 2.5 }],
    triggers: ["session_completed"],
    enabled: true,
    autoApply: false,
    safetyPolicy: { policyKey: null, config: {} },
    status: "active",
    archivedAt: null,
    version: 1,
    createdAt: "2026-08-09T12:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
};

describe("kin training rules", () => {
    it("lists rules with scope and enabled filters", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ items: [rule] }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "rules",
            "list",
            "--include-archived",
            "--scope-type",
            "template",
            "--enabled",
            "true",
        ]);

        const url = String(request.mock.calls[0]?.[0]);
        expect(url).toContain("/training/rules?");
        expect(url).toContain("includeArchived=true");
        expect(url).toContain("scopeType=template");
        expect(url).toContain("enabled=true");
        expect(output).toHaveBeenCalledWith(`${rule.id}\t1\tactive\tenabled\ttemplate\tnext\tProgress bench`);
    });

    it("creates a rule from stdin/file JSON", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json(rule));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "rules",
            "create",
            "--input",
            JSON.stringify({
                name: "Progress bench",
                scope: rule.scope,
                target: rule.target,
                condition: rule.condition,
                actions: rule.actions,
            }),
            "--idempotency-key",
            "retry-1",
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain("/training/rules");
        expect(init?.method).toBe("POST");
        expect((init?.headers as Headers).get("idempotency-key")).toBe("retry-1");
    });

    it("updates a rule with If-Match", async () => {
        const output = vi.fn();
        const request = vi.fn(async () => Response.json({ ...rule, version: 2, enabled: false }));
        const program = createProgram({ fetch: request, output });

        await program.parseAsync([
            "node",
            "kin",
            "training",
            "rules",
            "update",
            rule.id,
            "--version",
            "1",
            "--input",
            JSON.stringify({ enabled: false }),
        ]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain(`/training/rules/${rule.id}`);
        expect(init?.method).toBe("PATCH");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
    });

    it("archives a rule with If-Match", async () => {
        const output = vi.fn();
        const request = vi.fn(async () =>
            Response.json({ ...rule, status: "archived", archivedAt: rule.createdAt, version: 2 }),
        );
        const program = createProgram({ fetch: request, output });

        await program.parseAsync(["node", "kin", "training", "rules", "archive", rule.id, "--version", "1"]);

        const [url, init] = request.mock.calls[0] ?? [];
        expect(url).toContain(`/training/rules/${rule.id}/archive`);
        expect(init?.method).toBe("POST");
        expect((init?.headers as Headers).get("if-match")).toBe('"1"');
    });
});
