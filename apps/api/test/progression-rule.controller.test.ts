import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
    ProgressionRuleNotFoundError,
    type ProgressionRuleCommands,
    type ProgressionRuleRepository,
    type ProgressionRuleResource,
} from "#src/modules/training/application/index";
import { ProgressionRuleController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    rule: "0198a4db-d8da-7000-8000-000000000d01",
    profile: "0198a4db-d8da-7000-8000-000000000d02",
    scope: "0198a4db-d8da-7000-8000-000000000d03",
};

function resource(version = 1): ProgressionRuleResource {
    return {
        id: ids.rule,
        profileId: ids.profile,
        name: "Progress bench",
        description: null,
        scope: { type: "template", id: ids.scope },
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
        version,
        createdAt: "2026-08-09T12:00:00.000Z",
        updatedAt: "2026-08-09T12:00:00.000Z",
    };
}

function repository(overrides: Partial<ProgressionRuleRepository> = {}): ProgressionRuleRepository {
    return {
        readRule: async () => resource(),
        listRules: async () => [resource()],
        ...overrides,
    } as unknown as ProgressionRuleRepository;
}

const validBody = {
    name: "Progress bench",
    scope: { type: "template", id: ids.scope },
    target: { mode: "next", selector: { kind: "scope" } },
    condition: {
        kind: "metric",
        metric: { key: "completed_all_sets", scope: "exercise" },
        operator: "eq",
        value: true,
    },
    actions: [{ type: "adjust_load", mode: "percent", value: 2.5 }],
};

describe("ProgressionRuleController", () => {
    it("lists rules", async () => {
        const controller = new ProgressionRuleController({} as ProgressionRuleCommands, repository());
        await expect(controller.list({})).resolves.toMatchObject({ items: [{ id: ids.rule }] });
    });

    it("creates a valid rule, maps the resource, and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new ProgressionRuleController(
            { create } as unknown as ProgressionRuleCommands,
            repository(),
        );

        const result = await controller.create(validBody, "request-1", undefined, response);

        expect(result).toMatchObject({ id: ids.rule, version: 1 });
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ name: "Progress bench" }),
            expect.objectContaining({ correlationId: "request-1", source: "user" }),
            undefined,
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("rejects an arbitrary/unknown expression with a 422 and field paths", () => {
        const controller = new ProgressionRuleController({} as ProgressionRuleCommands, repository());
        const badBody = {
            ...validBody,
            condition: {
                kind: "metric",
                metric: { key: "__proto__", scope: "session" },
                operator: "run_code",
                value: 1,
            },
        };
        try {
            controller.create(badBody, undefined, undefined, { setHeader: vi.fn() });
            throw new Error("expected a validation error");
        } catch (error) {
            expect(error).toBeInstanceOf(HttpException);
            expect((error as HttpException).getStatus()).toBe(422);
            const payload = (error as HttpException).getResponse() as {
                code: string;
                fieldErrors: Record<string, unknown>;
            };
            expect(payload.code).toBe("VALIDATION_FAILED");
            expect(Object.keys(payload.fieldErrors).length).toBeGreaterThan(0);
        }
    });

    it("rejects a template-targeted auto-apply rule at the contract boundary", () => {
        const controller = new ProgressionRuleController({} as ProgressionRuleCommands, repository());
        const badBody = { ...validBody, target: { mode: "template", selector: { kind: "scope" } }, autoApply: true };
        expect(() => controller.create(badBody, undefined, undefined, { setHeader: vi.fn() })).toThrow(HttpException);
    });

    it("requires optimistic concurrency for updates, archive, and restore", () => {
        const controller = new ProgressionRuleController({} as ProgressionRuleCommands, repository());
        expect(() =>
            controller.update(ids.rule, { enabled: false }, undefined, "r", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
        expect(() => controller.archive(ids.rule, undefined, "r", undefined, { setHeader: vi.fn() })).toThrow(
            ExpectedVersionRequiredError,
        );
        expect(() => controller.restore(ids.rule, undefined, "r", undefined, { setHeader: vi.fn() })).toThrow(
            ExpectedVersionRequiredError,
        );
    });

    it("archives through the command with the parsed If-Match version", async () => {
        const archive = vi.fn(async () => resource(2));
        const response = { setHeader: vi.fn() };
        const controller = new ProgressionRuleController(
            { archive } as unknown as ProgressionRuleCommands,
            repository(),
        );
        await controller.archive(ids.rule, '"1"', "request-2", undefined, response);
        expect(archive).toHaveBeenCalledWith(ids.rule, 1, expect.anything(), undefined);
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"2"');
    });

    it("reports an unknown rule on get", async () => {
        const controller = new ProgressionRuleController(
            {} as ProgressionRuleCommands,
            repository({ readRule: async () => null }),
        );
        await expect(controller.get(ids.rule, { setHeader: vi.fn() })).rejects.toBeInstanceOf(
            ProgressionRuleNotFoundError,
        );
    });
});
