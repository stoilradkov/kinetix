import { describe, expect, it, vi } from "vitest";

import type {
    ProgramCommands,
    ProgramDetail,
    ProgramQueries,
    ProgramResource,
} from "#src/modules/training/application/index";
import { ProgramNotFoundError } from "#src/modules/training/application/index";
import { ProgramController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    program: "0198a4db-d8da-7000-8000-000000005001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    block: "0198a4db-d8da-7000-8000-0000000050a1",
};

function programResource(overrides: Partial<ProgramResource> = {}): ProgramResource {
    return {
        id: ids.program,
        profileId: ids.profile,
        name: "Off-season",
        description: null,
        status: "draft",
        scheduleMode: "ordered",
        startDate: null,
        endDate: null,
        focus: null,
        blocks: [
            {
                id: ids.block,
                parentBlockId: null,
                type: "mesocycle",
                label: null,
                position: 0,
                startDate: null,
                endDate: null,
                relativeStartWeek: null,
                relativeEndWeek: null,
                focus: null,
                targetMuscles: [],
                targetVolume: null,
                targetIntensity: null,
                deload: false,
                expectedAdaptations: null,
                notes: null,
                tags: [],
            },
        ],
        goalIds: [],
        archivedAt: null,
        version: 1,
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T12:00:00.000Z",
        ...overrides,
    };
}

function detail(overrides: Partial<ProgramResource> = {}): ProgramDetail {
    return {
        program: programResource(overrides),
        warnings: [{ code: "block_overlap", message: "Blocks A and B overlap", evidence: { blockIds: [] } }],
    };
}

function summary() {
    const { blocks, goalIds, ...rest } = programResource();
    void blocks;
    void goalIds;
    return { ...rest, blockCount: 1, sessionCount: 0 };
}

function queries(overrides: Partial<ProgramQueries> = {}): ProgramQueries {
    return {
        list: async () => [summary()],
        get: async () => detail(),
        sessions: async () => [],
        ...overrides,
    } as unknown as ProgramQueries;
}

function controller(overrides: { commands?: Partial<ProgramCommands>; queries?: ProgramQueries }): ProgramController {
    return new ProgramController((overrides.commands ?? {}) as ProgramCommands, overrides.queries ?? queries());
}

describe("ProgramController", () => {
    it("lists program summaries with counts and without the block tree", async () => {
        const result = await controller({}).list(undefined);
        expect(result.items[0]).toMatchObject({ id: ids.program, blockCount: 1 });
        expect(result.items[0]).not.toHaveProperty("blocks");
    });

    it("gets a program with blocks, goal links, warnings, and ETag", async () => {
        const response = { setHeader: vi.fn() };
        const result = await controller({}).get(ids.program, response);
        expect(result.blocks).toHaveLength(1);
        expect(result.warnings[0]).toMatchObject({ code: "block_overlap" });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("creates a program, returning its ETag", async () => {
        const create = vi.fn(async () => detail());
        const response = { setHeader: vi.fn() };
        const result = await controller({ commands: { create } }).create(
            { name: "Off-season" },
            "request-1",
            undefined,
            response,
        );
        expect(result).toMatchObject({ id: ids.program, version: 1 });
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("activates through the command, echoing generated sessions", async () => {
        const activate = vi.fn(async () => ({ ...detail(), generatedSessions: [] }));
        const response = { setHeader: vi.fn() };
        const result = await controller({ commands: { activate } }).activate(
            ids.program,
            {},
            '"1"',
            "r",
            undefined,
            response,
        );
        expect(result).toMatchObject({ id: ids.program });
        expect(result.generatedSessions).toEqual([]);
        expect(activate).toHaveBeenCalledWith(ids.program, 1, {}, expect.any(Object), undefined);
    });

    it("changes the start date, echoing the moved sessions", async () => {
        const moved = { id: "0198a4db-d8da-7000-8000-0000000060a1", fromDate: "2026-08-05", toDate: "2026-08-12" };
        const changeStartDate = vi.fn(async () => ({ ...detail({ startDate: "2026-08-08" }), movedSessions: [moved] }));
        const response = { setHeader: vi.fn() };
        const result = await controller({ commands: { changeStartDate } }).changeStartDate(
            ids.program,
            { startDate: "2026-08-08" },
            '"1"',
            "r",
            undefined,
            response,
        );
        expect(result.movedSessions).toEqual([moved]);
        expect(changeStartDate).toHaveBeenCalledWith(
            ids.program,
            1,
            { startDate: "2026-08-08" },
            expect.any(Object),
            undefined,
        );
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("pauses through the command", async () => {
        const pause = vi.fn(async () => detail({ status: "paused", version: 2 }));
        const result = await controller({ commands: { pause } }).pause(ids.program, '"1"', "r", undefined, {
            setHeader: vi.fn(),
        });
        expect(result).toMatchObject({ status: "paused", version: 2 });
        expect(pause).toHaveBeenCalledWith(ids.program, 1, expect.any(Object), undefined);
    });

    it("requires If-Match on update and surfaces an unknown program", async () => {
        expect(() =>
            controller({}).update(ids.program, { name: "x" }, undefined, "r", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
        await expect(
            controller({
                queries: queries({
                    get: async () => {
                        throw new ProgramNotFoundError(ids.program);
                    },
                }),
            }).get(ids.program, { setHeader: vi.fn() }),
        ).rejects.toBeInstanceOf(ProgramNotFoundError);
    });
});
