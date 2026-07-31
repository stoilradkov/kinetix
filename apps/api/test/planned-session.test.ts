import { describe, expect, it } from "vitest";

import { PlannedSession, type CreatePlannedSessionInput } from "#src/modules/training/domain/index";

const ids = {
    session: "0198a4db-d8da-7000-8000-000000006001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    prescriptionA: "0198a4db-d8da-7000-8000-0000000060a1",
    prescriptionB: "0198a4db-d8da-7000-8000-0000000060b2",
    template: "0198a4db-d8da-7000-8000-0000000060c3",
} as const;
const now = new Date("2026-07-29T12:00:00.000Z");
const later = new Date("2026-07-29T13:00:00.000Z");

function input(overrides: Partial<CreatePlannedSessionInput> = {}): CreatePlannedSessionInput {
    return { id: ids.session, profileId: ids.profile, currentPrescriptionId: ids.prescriptionA, ...overrides };
}

describe("PlannedSession domain", () => {
    it("creates a planned session with optional schedule fields", () => {
        const state = PlannedSession.create(
            input({ title: "Upper A", localDate: "2026-08-01", preferredTime: "07:30" }),
            now,
        ).state;
        expect(state).toMatchObject({
            status: "planned",
            title: "Upper A",
            localDate: "2026-08-01",
            preferredTime: "07:30",
            archivedAt: null,
        });
    });

    it("rejects a preferred time that is not HH:MM", () => {
        expect(() => PlannedSession.create(input({ preferredTime: "7am" }), now)).toThrow();
    });

    it("requires source template id and version together", () => {
        expect(() => PlannedSession.create(input({ sourceTemplateId: ids.template }), now)).toThrow();
        const ok = PlannedSession.create(
            input({ sourceTemplateId: ids.template, sourceTemplateVersion: 3 }),
            now,
        ).state;
        expect(ok).toMatchObject({ sourceTemplateId: ids.template, sourceTemplateVersion: 3 });
    });

    it("advances the prescription pointer on edit", () => {
        const created = PlannedSession.create(input(), now);
        const edited = PlannedSession.rehydrate(created.state).update(
            { currentPrescriptionId: ids.prescriptionB },
            later,
        ).state;
        expect(edited.currentPrescriptionId).toBe(ids.prescriptionB);
        expect(created.state.currentPrescriptionId).toBe(ids.prescriptionA);
    });

    it("completes, marking partial when requested", () => {
        const created = PlannedSession.create(input(), now);
        expect(PlannedSession.rehydrate(created.state).complete({}, later).state.status).toBe("completed");
        expect(PlannedSession.rehydrate(created.state).complete({ partial: true }, later).state.status).toBe(
            "partially_completed",
        );
    });

    it("skips and cancels with a structured reason", () => {
        const skipped = PlannedSession.create(input(), now).skip({ reason: "illness", notes: "Flu" }, later).state;
        expect(skipped).toMatchObject({ status: "skipped", skipReason: "illness", skipNotes: "Flu" });
        const cancelled = PlannedSession.create(input(), now).cancel({ reason: "schedule" }, later).state;
        expect(cancelled).toMatchObject({ status: "cancelled", skipReason: "schedule", skipNotes: null });
    });

    it("refuses to complete a session that is not planned", () => {
        const skipped = PlannedSession.create(input(), now).skip({ reason: "pain" }, later);
        expect(() => PlannedSession.rehydrate(skipped.state).complete({}, later)).toThrow();
    });

    it("reopens a terminal session back to planned, clearing the reason", () => {
        const cancelled = PlannedSession.create(input(), now).cancel({ reason: "equipment_unavailable" }, later);
        const reopened = PlannedSession.rehydrate(cancelled.state).reopen(later).state;
        expect(reopened).toMatchObject({ status: "planned", skipReason: null, skipNotes: null });
    });

    it("reschedules an open session's date and time", () => {
        const created = PlannedSession.create(input({ localDate: "2026-08-01" }), now);
        const moved = PlannedSession.rehydrate(created.state).reschedule(
            { localDate: "2026-08-08", preferredTime: "09:00" },
            later,
        ).state;
        expect(moved).toMatchObject({ localDate: "2026-08-08", preferredTime: "09:00" });
    });

    it("refuses to reschedule a terminal session", () => {
        const skipped = PlannedSession.create(input({ localDate: "2026-08-01" }), now).skip({ reason: "pain" }, later);
        expect(() => PlannedSession.rehydrate(skipped.state).reschedule({ localDate: "2026-08-08" }, later)).toThrow();
    });

    it("archives and restores independently of lifecycle status", () => {
        const completed = PlannedSession.create(input(), now).complete({}, later);
        const archived = PlannedSession.rehydrate(completed.state).archive(later).state;
        expect(archived.archivedAt).not.toBeNull();
        expect(archived.status).toBe("completed");
        const restored = PlannedSession.rehydrate(archived).restore(later).state;
        expect(restored.archivedAt).toBeNull();
    });
});
