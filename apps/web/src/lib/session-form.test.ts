import { describe, expect, it } from "vitest";

import type { TrainingSessionResponse } from "@kinetix/types";

import { sessionCreateInput, sessionFormDefaults, sessionFormValues, sessionUpdateInput } from "@/lib/session-form";

function response(): TrainingSessionResponse {
    return {
        id: "0198a4db-d8da-7000-8000-000000007001",
        profileId: "0198a4db-d8da-7000-8000-0000000000d9",
        status: "in_progress",
        title: "Upper A",
        localDate: "2026-08-02",
        timeZone: "Europe/Sofia",
        startedAt: "2026-08-02T10:00:00.000Z",
        endedAt: null,
        durationMinutes: null,
        readiness: { energy: 4, motivation: 5, fatigue: null, soreness: null, stress: 2, recovery: null },
        postWorkout: { energy: null, motivation: null, enjoyment: null, difficulty: null, fatigue: null, notes: null },
        notes: "felt good",
        tags: ["Push"],
        sourcePlannedSessionId: null,
        activities: [],
        painRecords: [],
        plannedLinks: [],
        activityMappings: [],
        occurrenceMappings: [],
        setMappings: [],
        runStepMappings: [],
        version: 2,
        archivedAt: null,
        createdAt: "2026-08-02T09:00:00.000Z",
        updatedAt: "2026-08-02T10:00:00.000Z",
    };
}

describe("session form mapping", () => {
    it("omits date and zone from the create payload when left blank", () => {
        const input = sessionCreateInput(sessionFormDefaults());
        expect(input).not.toHaveProperty("localDate");
        expect(input).not.toHaveProperty("timeZone");
        expect(input.readiness).toEqual({
            energy: null,
            motivation: null,
            fatigue: null,
            soreness: null,
            stress: null,
            recovery: null,
        });
    });

    it("maps a filled create form to the wire contract", () => {
        const input = sessionCreateInput({
            title: "  Leg day  ",
            localDate: "2026-08-03",
            timeZone: "America/New_York",
            notes: "  ",
            tags: [" Push ", ""],
            readiness: { energy: "4", motivation: "", fatigue: "", soreness: "", stress: "2", recovery: "" },
        });
        expect(input).toMatchObject({
            title: "Leg day",
            localDate: "2026-08-03",
            timeZone: "America/New_York",
            notes: null,
            tags: ["Push"],
        });
        expect(input.readiness).toMatchObject({ energy: 4, stress: 2, motivation: null });
    });

    it("round-trips a response through the form model", () => {
        const values = sessionFormValues(response());
        expect(values).toMatchObject({ title: "Upper A", localDate: "2026-08-02", timeZone: "Europe/Sofia" });
        expect(values.readiness).toMatchObject({ energy: "4", motivation: "5", stress: "2", fatigue: "" });
        const update = sessionUpdateInput(values);
        expect(update.readiness).toMatchObject({ energy: 4, motivation: 5, stress: 2, fatigue: null });
        expect(update.tags).toEqual(["Push"]);
    });
});
