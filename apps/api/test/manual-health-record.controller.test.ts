import { describe, expect, it, vi } from "vitest";

import {
    ManualHealthRecordNotFoundError,
    type HealthRecordRepository,
    type ManualHealthRecordCommands,
    type ManualHealthRecordResource,
} from "#src/modules/health-data/application/index";
import { ManualHealthRecordController } from "#src/modules/health-data/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    record: "0198a4db-d8da-7000-8000-0000000000b1",
    profile: "0198a4db-d8da-7000-8000-0000000000b9",
};

function resource(version = 1): ManualHealthRecordResource {
    return {
        id: ids.record,
        profileId: ids.profile,
        type: "body_weight",
        source: "manual",
        effectiveAt: "2026-07-28T06:30:00.000Z",
        timeZone: null,
        notes: null,
        body: { type: "body_weight", massKg: 82.1 },
        bodySchemaVersion: 1,
        archivedAt: null,
        version,
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:00.000Z",
    };
}

function repository(overrides: Partial<HealthRecordRepository> = {}): HealthRecordRepository {
    return {
        readRecord: async () => resource(),
        listRecords: async () => [resource()],
        ...overrides,
    } as unknown as HealthRecordRepository;
}

describe("ManualHealthRecordController", () => {
    it("lists records", async () => {
        const controller = new ManualHealthRecordController({} as ManualHealthRecordCommands, repository());
        await expect(controller.list(undefined, undefined, undefined, undefined)).resolves.toMatchObject({
            items: [{ id: ids.record }],
        });
    });

    it("validates creation, maps the resource, and returns its ETag", async () => {
        const create = vi.fn(async () => resource());
        const response = { setHeader: vi.fn() };
        const controller = new ManualHealthRecordController(
            { create } as unknown as ManualHealthRecordCommands,
            repository(),
        );

        const result = await controller.create(
            { effectiveAt: "2026-07-28T06:30:00.000Z", body: { type: "body_weight", massKg: 82.1 } },
            "request-1",
            undefined,
            response,
        );

        expect(result).toMatchObject({ id: ids.record, version: 1 });
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ body: { type: "body_weight", massKg: 82.1 } }),
            expect.objectContaining({ correlationId: "request-1", source: "user" }),
            undefined,
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("requires optimistic concurrency for updates and archives", () => {
        const controller = new ManualHealthRecordController({} as ManualHealthRecordCommands, repository());
        expect(() =>
            controller.update(ids.record, { notes: "x" }, undefined, "request-2", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
        expect(() => controller.archive(ids.record, undefined, "request-3", undefined, { setHeader: vi.fn() })).toThrow(
            ExpectedVersionRequiredError,
        );
    });

    it("reports an unknown record on get", async () => {
        const controller = new ManualHealthRecordController(
            {} as ManualHealthRecordCommands,
            repository({ readRecord: async () => null }),
        );
        await expect(controller.get(ids.record, { setHeader: vi.fn() })).rejects.toBeInstanceOf(
            ManualHealthRecordNotFoundError,
        );
    });
});
