import { describe, expect, it } from "vitest";

import { TrainingSession, type CreateTrainingSessionInput } from "#src/modules/training/domain/index";

const ids = {
    session: "0198a4db-d8da-7000-8000-000000007001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    planned: "0198a4db-d8da-7000-8000-0000000070f0",
    activityA: "0198a4db-d8da-7000-8000-0000000070a1",
    activityB: "0198a4db-d8da-7000-8000-0000000070a2",
    painA: "0198a4db-d8da-7000-8000-0000000070b1",
    ghost: "0198a4db-d8da-7000-8000-0000000070ff",
} as const;

const now = new Date("2026-08-02T12:00:00.000Z");
const later = new Date("2026-08-02T13:30:00.000Z");
const latest = new Date("2026-08-02T14:00:00.000Z");

function input(overrides: Partial<CreateTrainingSessionInput> = {}): CreateTrainingSessionInput {
    return {
        id: ids.session,
        profileId: ids.profile,
        localDate: "2026-08-02",
        timeZone: "Europe/Sofia",
        ...overrides,
    };
}

describe("TrainingSession domain", () => {
    it("creates an unplanned draft with explicit missing values", () => {
        const state = TrainingSession.create(input(), now).state;
        expect(state).toMatchObject({
            status: "draft",
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
            startedAt: null,
            endedAt: null,
            durationMinutes: null,
            sourcePlannedSessionId: null,
            archivedAt: null,
        });
        expect(state.readiness).toEqual({
            energy: null,
            motivation: null,
            fatigue: null,
            soreness: null,
            stress: null,
            recovery: null,
        });
        expect(state.activities).toEqual([]);
        expect(state.painRecords).toEqual([]);
    });

    it("records the planned-session link when supplied", () => {
        const state = TrainingSession.create(input({ sourcePlannedSessionId: ids.planned }), now).state;
        expect(state.sourcePlannedSessionId).toBe(ids.planned);
    });

    it("rejects an invalid IANA time zone", () => {
        expect(() => TrainingSession.create(input({ timeZone: "Mars/Phobos" }), now)).toThrow();
    });

    it("rejects a malformed local date", () => {
        expect(() => TrainingSession.create(input({ localDate: "2026-8-2" }), now)).toThrow();
    });

    describe("lifecycle", () => {
        it("starts a draft, stamping the server start instant", () => {
            const started = TrainingSession.create(input(), now).start(later).state;
            expect(started.status).toBe("in_progress");
            expect(started.startedAt).toBe(later.toISOString());
        });

        it("refuses to start a non-draft session", () => {
            const started = TrainingSession.create(input(), now).start(later);
            expect(() => started.start(latest)).toThrow();
        });

        it("completes an in-progress session, stamping the end instant", () => {
            const completed = TrainingSession.create(input(), now).start(later).complete({}, latest).state;
            expect(completed.status).toBe("completed");
            expect(completed.endedAt).toBe(latest.toISOString());
        });

        it("refuses to complete a draft session", () => {
            expect(() => TrainingSession.create(input(), now).complete({}, later)).toThrow();
        });

        it("reopens a completed session back to in_progress", () => {
            const reopened = TrainingSession.create(input(), now)
                .start(later)
                .complete({}, latest)
                .reopen(latest).state;
            expect(reopened.status).toBe("in_progress");
            expect(reopened.endedAt).toBe(latest.toISOString());
        });

        it("refuses to reopen a session that is not completed", () => {
            expect(() => TrainingSession.create(input(), now).start(later).reopen(latest)).toThrow();
        });

        it("archives and restores independently of lifecycle status", () => {
            const session = TrainingSession.create(input(), now).start(later).complete({}, latest);
            const archived = session.archive(latest).state;
            expect(archived.archivedAt).not.toBeNull();
            expect(archived.status).toBe("completed");
            const restored = TrainingSession.rehydrate(archived).restore(latest).state;
            expect(restored.archivedAt).toBeNull();
            expect(restored.status).toBe("completed");
        });

        it("blocks editing a completed session until it is reopened", () => {
            const completed = TrainingSession.create(input(), now).start(later).complete({}, latest);
            expect(() => completed.update({ notes: "late edit" }, latest)).toThrow();
            const editable = TrainingSession.rehydrate(completed.state).reopen(latest);
            expect(editable.update({ notes: "corrected" }, latest).state.notes).toBe("corrected");
        });
    });

    describe("time", () => {
        it("keeps the local date fixed even when the start instant is on the next UTC day", () => {
            const session = TrainingSession.create(
                input({ localDate: "2026-08-02", timeZone: "Pacific/Kiritimati" }),
                now,
            ).start(new Date("2026-08-03T00:30:00.000Z")).state;
            expect(session.localDate).toBe("2026-08-02");
        });

        it("treats duration as independent of activity durations", () => {
            const session = TrainingSession.create(input(), now).start(later);
            const updated = session.update(
                {
                    durationMinutes: 45,
                    activities: [{ id: ids.activityA, type: "strength", position: 0, durationSeconds: 5_400 }],
                },
                latest,
            ).state;
            expect(updated.durationMinutes).toBe(45);
            expect(updated.activities[0]!.durationSeconds).toBe(5_400);
        });

        it("rejects an end time before the start time", () => {
            const session = TrainingSession.create(input(), now).start(new Date("2026-08-02T13:00:00.000Z"));
            expect(() => session.update({ endedAt: "2026-08-02T12:00:00.000Z" }, latest)).toThrow();
        });
    });

    describe("readiness and ratings", () => {
        it("stores in-range readiness and merges partial updates", () => {
            const session = TrainingSession.create(input({ readiness: { energy: 4, stress: 2 } }), now);
            expect(session.state.readiness.energy).toBe(4);
            const merged = session.update({ readiness: { motivation: 5 } }, later).state.readiness;
            expect(merged).toMatchObject({ energy: 4, stress: 2, motivation: 5 });
        });

        it("rejects a readiness value outside 1-5", () => {
            expect(() => TrainingSession.create(input({ readiness: { energy: 6 } }), now)).toThrow();
            expect(() => TrainingSession.create(input({ readiness: { energy: 0 } }), now)).toThrow();
        });

        it("captures post-workout ratings on completion", () => {
            const completed = TrainingSession.create(input(), now)
                .start(later)
                .complete({ postWorkout: { enjoyment: 5, difficulty: 3, notes: "solid" } }, latest).state;
            expect(completed.postWorkout).toMatchObject({ enjoyment: 5, difficulty: 3, notes: "solid" });
        });
    });

    describe("pain records", () => {
        it("captures area, side, severity, links, and flags", () => {
            const session = TrainingSession.create(
                input({
                    activities: [{ id: ids.activityA, type: "strength", position: 0 }],
                    painRecords: [
                        {
                            id: ids.painA,
                            activityId: ids.activityA,
                            bodyArea: "Lower back",
                            side: "left",
                            severity: 6,
                            painType: "sharp",
                            onsetDuringSession: true,
                            stoppedActivity: true,
                            notes: "on the third set",
                        },
                    ],
                }),
                now,
            ).state;
            expect(session.painRecords[0]).toMatchObject({
                bodyArea: "Lower back",
                side: "left",
                severity: 6,
                onsetDuringSession: true,
                stoppedActivity: true,
            });
        });

        it("rejects a pain record referencing an unknown activity", () => {
            expect(() =>
                TrainingSession.create(
                    input({
                        painRecords: [
                            { id: ids.painA, activityId: ids.ghost, bodyArea: "Knee", side: "right", severity: 3 },
                        ],
                    }),
                    now,
                ),
            ).toThrow();
        });

        it("rejects severity outside 0-10", () => {
            expect(() =>
                TrainingSession.create(
                    input({ painRecords: [{ id: ids.painA, bodyArea: "Knee", side: "right", severity: 11 }] }),
                    now,
                ),
            ).toThrow();
        });

        it("clears a pain link when its activity is removed by an edit", () => {
            const session = TrainingSession.create(
                input({
                    activities: [{ id: ids.activityA, type: "strength", position: 0 }],
                    painRecords: [
                        { id: ids.painA, activityId: ids.activityA, bodyArea: "Knee", side: "right", severity: 3 },
                    ],
                }),
                now,
            );
            const edited = session.update({ activities: [] }, later).state;
            expect(edited.painRecords[0]!.activityId).toBeNull();
        });
    });

    describe("activities", () => {
        it("rejects duplicate activity positions", () => {
            expect(() =>
                TrainingSession.create(
                    input({
                        activities: [
                            { id: ids.activityA, type: "strength", position: 0 },
                            { id: ids.activityB, type: "running", position: 0 },
                        ],
                    }),
                    now,
                ),
            ).toThrow();
        });

        it("rejects an unknown activity type", () => {
            expect(() =>
                TrainingSession.create(
                    input({ activities: [{ id: ids.activityA, type: "mobility" as never, position: 0 }] }),
                    now,
                ),
            ).toThrow();
        });
    });

    describe("tags", () => {
        it("normalizes tags case-insensitively, keeping the first-seen display", () => {
            const state = TrainingSession.create(input({ tags: ["Long Run", "long run", "Tempo"] }), now).state;
            expect(state.tags).toEqual(["Long Run", "Tempo"]);
        });
    });
});
