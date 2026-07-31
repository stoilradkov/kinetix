import { describe, expect, it } from "vitest";

import {
    Program,
    evaluateProgramWarnings,
    type CreateProgramInput,
    type ProgramBlockInput,
} from "#src/modules/training/domain/index";

const ids = {
    program: "0198a4db-d8da-7000-8000-000000005001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    blockA: "0198a4db-d8da-7000-8000-0000000050a1",
    blockB: "0198a4db-d8da-7000-8000-0000000050b2",
    blockC: "0198a4db-d8da-7000-8000-0000000050c3",
    goal: "0198a4db-d8da-7000-8000-0000000050e1",
} as const;
const now = new Date("2026-07-29T12:00:00.000Z");
const later = new Date("2026-07-29T13:00:00.000Z");

function input(overrides: Partial<CreateProgramInput> = {}): CreateProgramInput {
    return { id: ids.program, profileId: ids.profile, name: "Off-season", ...overrides };
}

function block(overrides: Partial<ProgramBlockInput> & { id: string }): ProgramBlockInput {
    return { type: "mesocycle", position: 0, ...overrides };
}

describe("Program domain — lifecycle", () => {
    it("creates a draft program with an ordered default schedule", () => {
        const state = Program.create(input(), now).state;
        expect(state).toMatchObject({ status: "draft", scheduleMode: "ordered", archivedAt: null });
    });

    it("supports a relative program that stays active without dates", () => {
        const program = Program.create(input({ scheduleMode: "relative" }), now).activate(now);
        expect(program.state).toMatchObject({ status: "active", startDate: null, endDate: null });
    });

    it("walks the full lifecycle draft→active→paused→active→completed→archived→draft", () => {
        let program = Program.create(input(), now);
        program = program.activate(now);
        expect(program.state.status).toBe("active");
        program = program.pause(now);
        expect(program.state.status).toBe("paused");
        program = program.resume(now);
        expect(program.state.status).toBe("active");
        program = program.complete(now);
        expect(program.state.status).toBe("completed");
        program = program.archive(now);
        expect(program.state).toMatchObject({ status: "archived" });
        expect(program.state.archivedAt).not.toBeNull();
        program = program.restore(now);
        expect(program.state).toMatchObject({ status: "draft", archivedAt: null });
    });

    it("rejects an invalid transition (draft cannot complete)", () => {
        expect(() => Program.create(input(), now).complete(now)).toThrow();
    });

    it("rejects an inverted date range", () => {
        expect(() =>
            Program.create(input({ scheduleMode: "dated", startDate: "2026-03-01", endDate: "2026-01-01" }), now),
        ).toThrow();
    });
});

describe("Program domain — block tree", () => {
    it("accepts a nested acyclic tree with default and custom block types", () => {
        const state = Program.create(
            input({
                blocks: [
                    block({ id: ids.blockA, type: "macrocycle", position: 0 }),
                    block({ id: ids.blockB, type: "custom", label: "Peak", position: 0, parentBlockId: ids.blockA }),
                ],
            }),
            now,
        ).state;
        expect(state.blocks).toHaveLength(2);
        expect(state.blocks[1]).toMatchObject({ type: "custom", label: "Peak", parentBlockId: ids.blockA });
    });

    it("requires a label on custom blocks", () => {
        expect(() =>
            Program.create(input({ blocks: [block({ id: ids.blockA, type: "custom", position: 0 })] }), now),
        ).toThrow();
    });

    it("rejects a parent outside the program", () => {
        expect(() =>
            Program.create(input({ blocks: [block({ id: ids.blockA, parentBlockId: ids.blockB, position: 0 })] }), now),
        ).toThrow();
    });

    it("rejects a cyclic hierarchy", () => {
        expect(() =>
            Program.create(
                input({
                    blocks: [
                        block({ id: ids.blockA, parentBlockId: ids.blockB, position: 0 }),
                        block({ id: ids.blockB, parentBlockId: ids.blockA, position: 0 }),
                    ],
                }),
                now,
            ),
        ).toThrow();
    });

    it("rejects duplicate sibling positions", () => {
        expect(() =>
            Program.create(
                input({
                    blocks: [block({ id: ids.blockA, position: 0 }), block({ id: ids.blockB, position: 0 })],
                }),
                now,
            ),
        ).toThrow();
    });

    it("replaces the block set on update", () => {
        const created = Program.create(input({ blocks: [block({ id: ids.blockA, position: 0 })] }), now);
        const updated = Program.rehydrate(created.state).update(
            { blocks: [block({ id: ids.blockC, type: "microcycle", position: 0, deload: true })] },
            later,
        ).state;
        expect(updated.blocks).toHaveLength(1);
        expect(updated.blocks[0]).toMatchObject({ id: ids.blockC, deload: true });
    });

    it("carries goal links, targets, and tags", () => {
        const state = Program.create(
            input({
                goalIds: [ids.goal, ids.goal],
                blocks: [
                    block({
                        id: ids.blockA,
                        position: 0,
                        targetMuscles: ["quads", "quads"],
                        targetVolume: "20 sets",
                        tags: ["base"],
                    }),
                ],
            }),
            now,
        ).state;
        expect(state.goalIds).toEqual([ids.goal]);
        expect(state.blocks[0]?.targetMuscles).toEqual(["quads"]);
        expect(state.blocks[0]?.targetVolume).toBe("20 sets");
    });
});

describe("evaluateProgramWarnings", () => {
    it("warns on overlapping sibling date ranges without rejecting them", () => {
        const program = Program.create(
            input({
                blocks: [
                    block({ id: ids.blockA, position: 0, startDate: "2026-01-01", endDate: "2026-02-01" }),
                    block({ id: ids.blockB, position: 1, startDate: "2026-01-15", endDate: "2026-02-15" }),
                ],
            }),
            now,
        ).state;
        const warnings = evaluateProgramWarnings(program);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({ code: "block_overlap" });
    });

    it("warns on schedule collisions between member sessions", () => {
        const program = Program.create(input(), now).state;
        const warnings = evaluateProgramWarnings(program, [
            { id: "s1", localDate: "2026-01-01", preferredTime: "08:00" },
            { id: "s2", localDate: "2026-01-01", preferredTime: "08:00" },
        ]);
        expect(warnings.some(warning => warning.code === "schedule_collision")).toBe(true);
    });

    it("does not warn when non-overlapping or unscheduled", () => {
        const program = Program.create(
            input({
                blocks: [
                    block({ id: ids.blockA, position: 0, startDate: "2026-01-01", endDate: "2026-01-10" }),
                    block({ id: ids.blockB, position: 1, startDate: "2026-01-11", endDate: "2026-01-20" }),
                ],
            }),
            now,
        ).state;
        expect(evaluateProgramWarnings(program, [{ id: "s1", localDate: null, preferredTime: null }])).toHaveLength(0);
    });
});
